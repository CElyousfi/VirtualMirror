import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { groupVariantsForAssets, parseFrameDimensions, type ProductSnapshot } from "@vm/catalog";
import { PROVENANCE_LABEL, provenanceForMethod, type ReadinessReport } from "@vm/contracts";
import { GLB_LIMITS } from "@vm/engine-geometry";
import { authenticate } from "../shopify.server";
import { getProduct, prismaCatalogRepo } from "../models/catalog.server";
import { approveAsset, prepareAsset, publishAsset, removeAsset, unpublishAsset } from "../models/assets.server";
import { syncOneProduct } from "../services/catalog-sync";
import { METHOD_LABEL, STATE_LABEL, STATE_TONE } from "../lib/labels";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const product = await getProduct(session.shop, params.id!);
  if (!product) throw new Response("Product not found", { status: 404 });
  const snapshot = JSON.parse(product.snapshotJson) as ProductSnapshot;
  const groups = groupVariantsForAssets(snapshot);
  const dims = parseFrameDimensions(snapshot.title, snapshot.description);
  return {
    shop: session.shop,
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      image: product.featuredImageUrl,
      reasons: JSON.parse(product.eyewearReasons) as string[],
    },
    dims,
    groups: groups.map((g) => {
      const a = product.assets.find((x) => x.variantKey === g.key);
      return {
        ...g,
        asset: a
          ? {
              id: a.id,
              state: a.state,
              method: a.method,
              readiness: JSON.parse(a.readinessJson) as ReadinessReport,
              frameWidthMm: Math.round(a.frameWidthM * 1000),
              triangleCount: a.triangleCount,
              byteSize: a.byteSize,
              fileUrl: a.fileUrl,
              approvedAt: a.merchantApprovedAt?.toISOString() ?? null,
              publishedAt: a.publishedAt?.toISOString() ?? null,
            }
          : null,
      };
    }),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const variantKey = String(form.get("variantKey") ?? "");
  const assetId = String(form.get("assetId") ?? "");
  try {
    switch (intent) {
      case "refresh": {
        const p = await getProduct(shop, params.id!);
        if (p) await syncOneProduct(admin, prismaCatalogRepo, shop, p.shopifyGid);
        return { ok: true, message: "Product refreshed from Shopify" };
      }
      case "demo":
        await prepareAsset(admin, { shop, productId: params.id!, variantKey, method: "demo-template" });
        return { ok: true, message: "Demo frame prepared" };
      case "upload": {
        const file = form.get("glb");
        if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a .glb file first." };
        if (file.size > GLB_LIMITS.maxBytes) return { ok: false, message: "That file is larger than 15 MB." };
        const glb = new Uint8Array(await file.arrayBuffer());
        await prepareAsset(admin, { shop, productId: params.id!, variantKey, method: "existing-glb", glb });
        return { ok: true, message: "3D model checked and stored" };
      }
      case "approve": {
        const accepted = form.getAll("accept").map(String);
        const a = await approveAsset(shop, assetId, accepted);
        return a.merchantApprovedAt
          ? { ok: true, message: "Approved" }
          : { ok: false, message: "Not approved: some checks still need attention." };
      }
      case "publish":
        await publishAsset(admin, shop, assetId);
        return { ok: true, message: "Live on your store" };
      case "unpublish":
        await unpublishAsset(admin, shop, assetId);
        return { ok: true, message: "Removed from your store" };
      case "remove":
        await removeAsset(admin, shop, assetId);
        return { ok: true, message: "3D frame deleted" };
      default:
        return { ok: false, message: `Unknown action ${intent}` };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
};

type Group = ReturnType<typeof useLoaderData<typeof loader>>["groups"][number];

function AssetCard({ group }: { group: Group }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = fetcher.state !== "idle";
  const a = group.asset;
  const reviewChecks = a?.readiness.checks.filter((c) => c.severity === "review" && !c.passed) ?? [];
  const [accepted, setAccepted] = useState<string[]>([]);

  useEffect(() => {
    if (fetcher.data) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  const submit = (intent: string, extra: Record<string, string | string[]> = {}) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("variantKey", group.key);
    if (a) fd.set("assetId", a.id);
    for (const [k, v] of Object.entries(extra)) (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
    fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
  };

  const upload = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return shopify.toast.show("Choose a .glb file first", { isError: true });
    const fd = new FormData();
    fd.set("intent", "upload");
    fd.set("variantKey", group.key);
    fd.set("glb", file);
    fetcher.submit(fd, { method: "POST", encType: "multipart/form-data" });
  };

  return (
    <s-section heading={group.label}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base" alignItems="center">
          {group.imageUrl && <s-thumbnail src={group.imageUrl} alt={group.label} size="base" />}
          <s-stack direction="block" gap="small-200">
            {a ? (
              <s-stack direction="inline" gap="small-200">
                <s-badge tone={STATE_TONE[a.state] ?? "neutral"}>{STATE_LABEL[a.state] ?? a.state}</s-badge>
                <s-text color="subdued">{METHOD_LABEL[a.method] ?? a.method}</s-text>
                <s-badge tone={provenanceForMethod(a.method) === "generic" ? "warning" : "neutral"}>
                  {PROVENANCE_LABEL[provenanceForMethod(a.method)]}
                </s-badge>
              </s-stack>
            ) : (
              <s-badge tone="neutral">Not prepared</s-badge>
            )}
            {a && a.frameWidthMm > 0 && (
              <s-text color="subdued">
                {`${a.frameWidthMm} mm wide, ${a.triangleCount.toLocaleString("en")} triangles, ${(a.byteSize / 1024).toFixed(0)} KB`}
              </s-text>
            )}
            <s-text color="subdued">{`${group.variantLegacyIds.length} variant(s)`}</s-text>
          </s-stack>
        </s-stack>

        {a && (
          <s-unordered-list>
            {a.readiness.checks.map((c) => (
              <s-list-item key={c.id}>
                {c.passed ? "✓ " : c.severity === "blocker" ? "✗ " : "• "}
                {c.message}
              </s-list-item>
            ))}
          </s-unordered-list>
        )}

        {a && reviewChecks.length > 0 && !a.approvedAt && a.state !== "failed" && a.state !== "unsupported" && (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">Review before approving</s-text>
              {reviewChecks.map((c) => (
                <s-checkbox
                  key={c.id}
                  label={`I accept: ${c.message}`}
                  checked={accepted.includes(c.id)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setAccepted((s) => (on ? [...s, c.id] : s.filter((x) => x !== c.id)));
                  }}
                />
              ))}
            </s-stack>
          </s-box>
        )}

        <s-stack direction="inline" gap="base">
          {a && !a.approvedAt && a.state !== "failed" && a.state !== "unsupported" && (
            <s-button
              variant="primary"
              disabled={busy || accepted.length < reviewChecks.length}
              onClick={() => submit("approve", { accept: accepted })}
            >
              Approve
            </s-button>
          )}
          {a && a.approvedAt && !a.publishedAt && (
            <s-button variant="primary" disabled={busy} onClick={() => submit("publish")}>
              Show on store
            </s-button>
          )}
          {a && a.publishedAt && (
            <s-button disabled={busy} onClick={() => submit("unpublish")}>
              Hide from store
            </s-button>
          )}
          {a && (
            <s-button variant="tertiary" tone="critical" disabled={busy} onClick={() => submit("remove")}>
              Delete 3D frame
            </s-button>
          )}
        </s-stack>

        <s-divider />
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{a ? "Replace the 3D frame" : "Prepare a 3D frame"}</s-text>
          <s-stack direction="inline" gap="base" alignItems="center">
            <input ref={fileRef} type="file" accept=".glb,model/gltf-binary" aria-label="GLB file" />
            <s-button disabled={busy} onClick={upload}>
              Upload .glb
            </s-button>
            <s-button variant="secondary" disabled={busy} onClick={() => submit("demo")}>
              Use generic demo frame (testing)
            </s-button>
          </s-stack>
          {busy && <s-spinner accessibilityLabel="Working" size="base" />}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

export default function ProductDetail() {
  const { product, groups, dims, shop } = useLoaderData<typeof loader>();
  const refresher = useFetcher<typeof action>();
  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">
        Products
      </s-link>
      <s-button slot="secondary-actions" onClick={() => refresher.submit({ intent: "refresh" }, { method: "POST" })}>
        Refresh from Shopify
      </s-button>
      <s-button slot="secondary-actions" href={`https://${shop}/products/${product.handle}`} target="_blank">
        View on store
      </s-button>

      {groups.map((g) => (
        <AssetCard key={g.key} group={g} />
      ))}

      <s-section slot="aside" heading="Product">
        {product.image && <s-thumbnail src={product.image} alt={product.title} size="large" />}
        <s-paragraph>{product.reasons.length ? product.reasons.join(". ") + "." : "Marked as eyewear by you."}</s-paragraph>
      </s-section>
      <s-section slot="aside" heading="Published dimensions">
        {dims.evidence.length ? (
          <s-paragraph>{`Found in the listing: ${dims.evidence.join(", ")}`}</s-paragraph>
        ) : (
          <s-paragraph>
            No frame dimensions found in the title or description. Adding the size (for example 52-18-145) lets frames be
            shown at the right scale.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
