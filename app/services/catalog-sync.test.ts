import { describe, expect, it } from "vitest";
import { mapProductNode, type ProductNode } from "@vm/catalog";
import { fakeAdmin } from "../test/fake-admin";
import { syncCatalog, syncOneProduct, toUpsert, type CatalogRepo, type ProductUpsert } from "./catalog-sync";
import { gql } from "../lib/admin-client";

const node = (id: number, title: string, productType = ""): ProductNode => ({
  id: `gid://shopify/Product/${id}`,
  legacyResourceId: String(id),
  title,
  handle: title.toLowerCase().replace(/\s+/g, "-"),
  productType,
  vendor: "Acme",
  tags: [],
  status: "ACTIVE",
  description: "",
  updatedAt: "2026-11-03T00:00:00Z",
  category: null,
  media: { nodes: [{ __typename: "MediaImage", image: { url: `https://cdn/${id}.jpg`, altText: null, width: 2048, height: 1024 } }] },
  variants: { nodes: [{ id: `gid://shopify/ProductVariant/${id}0`, legacyResourceId: `${id}0`, title: "Default Title", selectedOptions: [{ name: "Title", value: "Default Title" }] }] },
});

/** In-memory repo that behaves like the Prisma implementation, per shop. */
function memoryRepo() {
  const rows = new Map<string, ProductUpsert & { merchantDecision?: string | null; syncedAt: Date }>();
  const syncs: { shop: string; error: string | null }[] = [];
  const key = (shop: string, gid: string) => `${shop}|${gid}`;
  const repo: CatalogRepo = {
    async upsertProducts(list, syncedAt) {
      for (const r of list) rows.set(key(r.shop, r.shopifyGid), { ...rows.get(key(r.shop, r.shopifyGid)), ...r, syncedAt });
    },
    async deleteStale(shop, since) {
      let n = 0;
      for (const [k, r] of rows) if (r.shop === shop && r.syncedAt < since) { rows.delete(k); n++; }
      return n;
    },
    async deleteProduct(shop, gid) { rows.delete(key(shop, gid)); },
    async markSynced(shop, _at, error) { syncs.push({ shop, error }); },
  };
  return { repo, rows, syncs };
}

describe("syncCatalog", () => {
  it("pages through the whole catalog and classifies each product", async () => {
    const pages = [[node(1, "Milo Optical Frame"), node(2, "Linen Shirt")], [node(3, "Riviera Sunglasses")]];
    const { admin, calls } = fakeAdmin({
      VmProductsPage: (v, n) => ({
        products: { nodes: pages[n - 1], pageInfo: { hasNextPage: n < pages.length, endCursor: n < pages.length ? `c${n}` : null } },
      }),
    });
    const { repo, rows, syncs } = memoryRepo();
    const res = await syncCatalog(admin, repo, "a.myshopify.com", { pageSize: 2 });

    expect(res).toMatchObject({ fetched: 3, pages: 2, removed: 0, likelyEyewear: 2 });
    expect(calls.map((c) => c.variables.after)).toEqual([null, "c1"]);
    expect([...rows.values()].map((r) => [r.title, r.eyewearScore >= 0.5])).toEqual([
      ["Milo Optical Frame", true],
      ["Linen Shirt", false],
      ["Riviera Sunglasses", true],
    ]);
    expect(syncs).toEqual([{ shop: "a.myshopify.com", error: null }]);
  });

  it("removes products deleted in Shopify, only within the same shop, and keeps merchant decisions", async () => {
    const { repo, rows } = memoryRepo();
    const earlier = new Date("2026-11-01T00:00:00Z");
    await repo.upsertProducts(
      [
        toUpsert("a.myshopify.com", mapProductNode(node(1, "Milo Glasses"))),
        toUpsert("a.myshopify.com", mapProductNode(node(9, "Gone Glasses"))),
        toUpsert("b.myshopify.com", mapProductNode(node(9, "Other Shop Glasses"))),
      ],
      earlier,
    );
    rows.get("a.myshopify.com|gid://shopify/Product/1")!.merchantDecision = "exclude";

    const { admin } = fakeAdmin({
      VmProductsPage: () => ({ products: { nodes: [node(1, "Milo Glasses v2")], pageInfo: { hasNextPage: false, endCursor: null } } }),
    });
    const res = await syncCatalog(admin, repo, "a.myshopify.com");

    expect(res.removed).toBe(1);
    expect(rows.has("a.myshopify.com|gid://shopify/Product/9")).toBe(false);
    expect(rows.has("b.myshopify.com|gid://shopify/Product/9")).toBe(true);
    const milo = rows.get("a.myshopify.com|gid://shopify/Product/1")!;
    expect(milo.title).toBe("Milo Glasses v2");
    expect(milo.merchantDecision).toBe("exclude");
  });

  it("records the error and rethrows when the API fails", async () => {
    const { admin } = fakeAdmin({ VmProductsPage: () => ({ __envelope: { errors: [{ message: "Access denied for products field." }] } }) });
    const { repo, syncs } = memoryRepo();
    await expect(syncCatalog(admin, repo, "a.myshopify.com")).rejects.toThrow("Access denied");
    expect(syncs[0]!.error).toContain("Access denied");
  });
});

describe("gql", () => {
  it("retries THROTTLED responses then succeeds", async () => {
    const { admin, calls } = fakeAdmin({
      VmProductsPage: (_v, n) =>
        n < 3
          ? { __envelope: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } }
          : { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });
    const data = await gql<{ products: unknown }>(admin, "query VmProductsPage { x }", {}, { backoffMs: 1 });
    expect(data.products).toBeDefined();
    expect(calls).toHaveLength(3);
  });
});

describe("syncOneProduct", () => {
  it("deletes the local row when Shopify returns null", async () => {
    const { repo, rows } = memoryRepo();
    await repo.upsertProducts([toUpsert("a.myshopify.com", mapProductNode(node(5, "Glasses")))], new Date());
    const { admin } = fakeAdmin({ VmProductDetail: () => ({ product: null }) });
    expect(await syncOneProduct(admin, repo, "a.myshopify.com", "gid://shopify/Product/5")).toBe("deleted");
    expect(rows.size).toBe(0);
  });
});
