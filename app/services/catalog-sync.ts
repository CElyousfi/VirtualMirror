import {
  classifyEyewear,
  mapProductNode,
  type ProductNode,
  type ProductSnapshot,
} from "@vm/catalog";
import { gql, type AdminGraphql } from "../lib/admin-client";
import { PRODUCT_DETAIL_QUERY, PRODUCT_PAGE_SIZE, PRODUCTS_PAGE_QUERY } from "../graphql/products";

/** Row written for each synced product. Mirrors the Prisma `Product` model. */
export interface ProductUpsert {
  shop: string;
  shopifyGid: string;
  legacyId: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  status: string;
  category: string | null;
  featuredImageUrl: string | null;
  imageCount: number;
  variantCount: number;
  snapshotJson: string;
  eyewearScore: number;
  eyewearReasons: string;
}

/** Persistence the sync needs. Implemented with Prisma in app/models/catalog.server.ts. */
export interface CatalogRepo {
  /** Upsert rows, stamping `syncedAt`. Never touches `merchantDecision`. */
  upsertProducts(rows: ProductUpsert[], syncedAt: Date): Promise<void>;
  /**
   * Delete this shop's products not stamped by the current sync. A timestamp
   * sweep instead of NOT IN (...ids) so large catalogs stay within SQL
   * parameter limits.
   */
  deleteStale(shop: string, syncStartedAt: Date): Promise<number>;
  deleteProduct(shop: string, shopifyGid: string): Promise<void>;
  markSynced(shop: string, at: Date, error: string | null): Promise<void>;
}

export function toUpsert(shop: string, s: ProductSnapshot): ProductUpsert {
  const c = classifyEyewear(s);
  return {
    shop,
    shopifyGid: s.gid,
    legacyId: s.legacyId,
    title: s.title,
    handle: s.handle,
    productType: s.productType,
    vendor: s.vendor,
    status: s.status,
    category: s.category,
    featuredImageUrl: s.images[0]?.url ?? null,
    imageCount: s.images.length,
    variantCount: s.variants.length,
    snapshotJson: JSON.stringify(s),
    eyewearScore: c.score,
    eyewearReasons: JSON.stringify(c.reasons),
  };
}

export interface SyncResult {
  fetched: number;
  pages: number;
  removed: number;
  likelyEyewear: number;
  durationMs: number;
}

/**
 * Full catalog sync: page through every product, upsert, then remove local
 * rows for products deleted in Shopify. Merchant include/exclude decisions are
 * preserved because the upsert never writes `merchantDecision`.
 */
export async function syncCatalog(
  admin: AdminGraphql,
  repo: CatalogRepo,
  shop: string,
  { pageSize = PRODUCT_PAGE_SIZE, now = () => new Date() } = {},
): Promise<SyncResult> {
  const started = Date.now();
  const syncStartedAt = now();
  const seen: string[] = [];
  let after: string | null = null;
  let pages = 0;
  let likely = 0;
  try {
    do {
      const data: {
        products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } = await gql(admin, PRODUCTS_PAGE_QUERY, { first: pageSize, after });
      pages++;
      const rows = data.products.nodes.map((n) => toUpsert(shop, mapProductNode(n)));
      likely += rows.filter((r) => r.eyewearScore >= 0.5).length;
      await repo.upsertProducts(rows, syncStartedAt);
      seen.push(...rows.map((r) => r.shopifyGid));
      after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    } while (after);

    const removed = await repo.deleteStale(shop, syncStartedAt);
    await repo.markSynced(shop, now(), null);
    return { fetched: seen.length, pages, removed, likelyEyewear: likely, durationMs: Date.now() - started };
  } catch (err) {
    await repo.markSynced(shop, now(), err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Fetch one product with variant images (detail page, preparation, webhooks). */
export async function fetchProduct(admin: AdminGraphql, gid: string): Promise<ProductSnapshot | null> {
  const data = await gql<{ product: (ProductNode & { onlineStorePreviewUrl?: string | null }) | null }>(
    admin,
    PRODUCT_DETAIL_QUERY,
    { id: gid },
  );
  return data.product ? mapProductNode(data.product) : null;
}

/** Refresh or remove a single product (products/update, products/delete webhooks). */
export async function syncOneProduct(
  admin: AdminGraphql,
  repo: CatalogRepo,
  shop: string,
  gid: string,
): Promise<"updated" | "deleted"> {
  const snapshot = await fetchProduct(admin, gid);
  if (!snapshot) {
    await repo.deleteProduct(shop, gid);
    return "deleted";
  }
  await repo.upsertProducts([toUpsert(shop, snapshot)], new Date());
  return "updated";
}

export const toProductGid = (legacyId: string | number) => `gid://shopify/Product/${legacyId}`;
