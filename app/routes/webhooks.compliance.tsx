import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../models/shop.server";

/**
 * Mandatory privacy compliance webhooks.
 *
 * Virtual Mirror stores no customer personal data: shopper camera frames never
 * leave the shopper's device and no customer records are kept. So
 * customers/data_request and customers/redact have nothing to return or erase.
 * shop/redact erases everything held for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT") await deleteShopData(shop);

  return new Response();
};
