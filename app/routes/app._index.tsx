import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { catalogStats, prismaCatalogRepo } from "../models/catalog.server";
import { ensureShop } from "../models/shop.server";
import { syncCatalog } from "../services/catalog-sync";
import { themeEditorLink } from "../lib/labels";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await ensureShop(session.shop);
  return {
    stats: await catalogStats(session.shop),
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureShop(session.shop);
  try {
    const result = await syncCatalog(admin, prismaCatalogRepo, session.shop);
    return { ok: true as const, result };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
};

type BlockStatus = "active" | "available" | "unknown";

/** Reads theme block activation via App Bridge; needs no read_themes scope. */
function useTryOnBlockStatus(): BlockStatus {
  const shopify = useAppBridge();
  const [status, setStatus] = useState<BlockStatus>("unknown");
  useEffect(() => {
    const app = (shopify as unknown as { app?: { extensions?: () => Promise<unknown[]> } }).app;
    if (!app?.extensions) return;
    app
      .extensions()
      .then((list) => {
        const blocks = (list as { type: string; activations: { handle: string; status: string }[] }[])
          .filter((e) => e.type === "theme_app_extension")
          .flatMap((e) => e.activations);
        const block = blocks.find((b) => b.handle === "try-on-button");
        setStatus(block?.status === "active" ? "active" : "available");
      })
      .catch(() => setStatus("unknown"));
  }, [shopify]);
  return status;
}

export default function Overview() {
  const { stats, apiKey } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const syncing = fetcher.state !== "idle";
  const blockStatus = useTryOnBlockStatus();

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(`Synced ${fetcher.data.result.fetched} products`);
    else if (fetcher.data && !fetcher.data.ok) shopify.toast.show("Catalog sync failed", { isError: true });
  }, [fetcher.data, shopify]);

  const live = stats.assetsByState.published ?? 0;
  const ready = stats.assetsByState.ready ?? 0;
  const review = stats.assetsByState.needs_review ?? 0;

  return (
    <s-page heading="Virtual Mirror">
      <s-button
        slot="primary-action"
        onClick={() => fetcher.submit({}, { method: "POST" })}
        {...(syncing ? { loading: true } : {})}
      >
        Sync catalog
      </s-button>

      {fetcher.data && !fetcher.data.ok && (
        <s-banner tone="critical" heading="Catalog sync failed">
          <s-paragraph>{fetcher.data.error}</s-paragraph>
        </s-banner>
      )}
      {stats.lastSyncError && !fetcher.data && (
        <s-banner tone="warning" heading="The last catalog sync failed">
          <s-paragraph>{stats.lastSyncError}</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Set up live try-on">
        <s-ordered-list>
          <s-list-item>
            <s-text type="strong">Sync your catalog. </s-text>
            {stats.lastSyncAt
              ? `${stats.total} products synced, ${stats.included} detected as eyewear.`
              : "Not synced yet. Use Sync catalog above."}
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Prepare and approve frames. </s-text>
            {`${live} live, ${ready} ready to publish, ${review} need your review. `}
            <s-link href="/app/products">Open products</s-link>
          </s-list-item>
          <s-list-item>
            <s-text type="strong">Add the Try On Live button to your theme. </s-text>
            {blockStatus === "active" ? (
              <s-badge tone="success">Added to your live theme</s-badge>
            ) : (
              <>
                {blockStatus === "unknown" ? "Status unavailable. " : "Not added yet. "}
                <s-link href={themeEditorLink(apiKey)} target="_top">
                  Add it in the theme editor
                </s-link>
              </>
            )}
          </s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Shoppers see the frames on their own face through their camera, on the product page. The camera feed stays on
          their device and is never uploaded.
        </s-paragraph>
        <s-paragraph>
          A frame is only shown to shoppers after you review and approve it. Virtual Mirror shows how frames look; it does
          not measure fit.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
