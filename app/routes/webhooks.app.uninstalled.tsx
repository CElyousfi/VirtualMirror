import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../models/shop.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can arrive more than once; deleting is idempotent.
  await deleteShopData(shop);

  return new Response();
};
