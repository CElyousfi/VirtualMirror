import prisma from "../db.server";

/** Create the tenant row on install (idempotent). */
export async function ensureShop(shop: string) {
  await prisma.shop.upsert({ where: { shop }, create: { shop }, update: {} });
}

/**
 * Remove everything we hold for a shop: sessions, products, assets (cascade).
 * Used by app/uninstalled and shop/redact. Files already uploaded to the
 * merchant's Shopify Files stay in their store; Shopify removes app access.
 */
export async function deleteShopData(shop: string) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { shop } }),
    prisma.shop.deleteMany({ where: { shop } }),
  ]);
}
