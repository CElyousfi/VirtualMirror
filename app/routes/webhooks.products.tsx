import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { prismaCatalogRepo } from "../models/catalog.server";
import { syncOneProduct, toProductGid } from "../services/catalog-sync";
import prisma from "../db.server";

/** Handles products/update and products/delete. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  const legacyId = (payload as { id?: number | string }).id;
  if (!legacyId) return new Response();

  // Ignore shops that are not (or no longer) installed.
  const installed = await prisma.shop.findUnique({ where: { shop } });
  if (!installed) return new Response();

  const gid = toProductGid(legacyId);
  if (topic === "PRODUCTS_DELETE" || !admin) {
    await prismaCatalogRepo.deleteProduct(shop, gid);
  } else {
    await syncOneProduct(admin, prismaCatalogRepo, shop, gid);
  }
  return new Response();
};
