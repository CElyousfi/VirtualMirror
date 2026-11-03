import prisma from "../db.server";
import type { CatalogRepo } from "../services/catalog-sync";

/** Prisma implementation of CatalogRepo. Every query is scoped by `shop`. */
export const prismaCatalogRepo: CatalogRepo = {
  async upsertProducts(rows, syncedAt) {
    if (!rows.length) return;
    await prisma.$transaction(
      rows.map((r) =>
        prisma.product.upsert({
          where: { shop_shopifyGid: { shop: r.shop, shopifyGid: r.shopifyGid } },
          create: { ...r, syncedAt },
          // merchantDecision is intentionally not in the update set.
          update: { ...r, syncedAt },
        }),
      ),
    );
  },
  async deleteStale(shop, syncStartedAt) {
    const res = await prisma.product.deleteMany({ where: { shop, syncedAt: { lt: syncStartedAt } } });
    return res.count;
  },
  async deleteProduct(shop, shopifyGid) {
    await prisma.product.deleteMany({ where: { shop, shopifyGid } });
  },
  async markSynced(shop, at, error) {
    await prisma.shop.update({ where: { shop }, data: { lastSyncAt: at, lastSyncError: error } });
  },
};

export type ProductFilter = "eyewear" | "all" | "excluded";

export function isIncluded(p: { eyewearScore: number; merchantDecision: string | null }): boolean {
  if (p.merchantDecision === "include") return true;
  if (p.merchantDecision === "exclude") return false;
  return p.eyewearScore >= 0.5;
}

export async function listProducts(shop: string, filter: ProductFilter) {
  const products = await prisma.product.findMany({
    where: { shop },
    orderBy: [{ eyewearScore: "desc" }, { title: "asc" }],
    include: { assets: { select: { id: true, state: true, publishedAt: true, variantLabel: true } } },
  });
  return products.filter((p) =>
    filter === "all" ? true : filter === "excluded" ? !isIncluded(p) : isIncluded(p),
  );
}

export async function getProduct(shop: string, id: string) {
  return prisma.product.findFirst({ where: { shop, id }, include: { assets: true } });
}

export async function setMerchantDecision(
  shop: string,
  ids: string[],
  decision: "include" | "exclude" | null,
) {
  const res = await prisma.product.updateMany({ where: { shop, id: { in: ids } }, data: { merchantDecision: decision } });
  return res.count;
}

export async function catalogStats(shop: string) {
  const [products, assets, shopRow] = await Promise.all([
    prisma.product.findMany({ where: { shop }, select: { eyewearScore: true, merchantDecision: true } }),
    prisma.asset.groupBy({ by: ["state"], where: { shop }, _count: { _all: true } }),
    prisma.shop.findUnique({ where: { shop } }),
  ]);
  const byState = Object.fromEntries(assets.map((a) => [a.state, a._count._all]));
  return {
    total: products.length,
    included: products.filter(isIncluded).length,
    assetsByState: byState as Record<string, number>,
    lastSyncAt: shopRow?.lastSyncAt ?? null,
    lastSyncError: shopRow?.lastSyncError ?? null,
  };
}
