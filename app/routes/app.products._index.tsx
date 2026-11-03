import { useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listProducts, setMerchantDecision, type ProductFilter } from "../models/catalog.server";
import { STATE_LABEL, STATE_TONE } from "../lib/labels";

const FILTERS: { value: ProductFilter; label: string }[] = [
  { value: "eyewear", label: "Eyewear" },
  { value: "excluded", label: "Not eyewear" },
  { value: "all", label: "All products" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = (FILTERS.find((f) => f.value === url.searchParams.get("filter"))?.value ?? "eyewear") as ProductFilter;
  const products = await listProducts(session.shop, filter);
  return {
    filter,
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      productType: p.productType,
      featuredImageUrl: p.featuredImageUrl,
      variantCount: p.variantCount,
      eyewearScore: p.eyewearScore,
      reasons: JSON.parse(p.eyewearReasons) as string[],
      merchantDecision: p.merchantDecision,
      assets: p.assets.map((a) => ({ state: a.state, label: a.variantLabel })),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const ids = form.getAll("id").map(String);
  const intent = String(form.get("intent"));
  const decision = intent === "include" ? "include" : intent === "exclude" ? "exclude" : null;
  const updated = await setMerchantDecision(session.shop, ids, decision);
  return { updated };
};

function readinessSummary(assets: { state: string }[]) {
  if (!assets.length) return { label: "Not prepared", tone: "neutral" as const };
  const order = ["published", "ready", "needs_review", "generated", "failed", "unsupported"];
  const best = order.find((s) => assets.some((a) => a.state === s)) ?? assets[0]!.state;
  const label = STATE_LABEL[best] ?? best;
  return { label: assets.length > 1 ? `${label} (${assets.length} variants)` : label, tone: STATE_TONE[best] ?? "neutral" };
}

export default function Products() {
  const { products, filter } = useLoaderData<typeof loader>();
  const [, setParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [selected, setSelected] = useState<string[]>([]);
  const allSelected = useMemo(() => products.length > 0 && selected.length === products.length, [products, selected]);

  const bulk = (intent: "include" | "exclude" | "reset") => {
    const fd = new FormData();
    fd.set("intent", intent);
    selected.forEach((id) => fd.append("id", id));
    fetcher.submit(fd, { method: "POST" });
    setSelected([]);
  };

  return (
    <s-page heading="Products">
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-select
            label="Show"
            value={filter}
            onChange={(e) => setParams({ filter: (e.currentTarget as HTMLSelectElement).value })}
          >
            {FILTERS.map((f) => (
              <s-option key={f.value} value={f.value}>
                {f.label}
              </s-option>
            ))}
          </s-select>
          {selected.length > 0 && (
            <s-button-group>
              <s-button onClick={() => bulk("include")}>Mark as eyewear</s-button>
              <s-button onClick={() => bulk("exclude")}>Not eyewear</s-button>
              <s-button variant="tertiary" onClick={() => bulk("reset")}>
                Use automatic detection
              </s-button>
            </s-button-group>
          )}
        </s-stack>
      </s-section>

      <s-section padding="none">
        {products.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              {filter === "eyewear"
                ? "No eyewear found yet. Sync your catalog from Overview, or mark products as eyewear from All products."
                : "No products in this view."}
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>
                <s-checkbox
                  accessibilityLabel="Select all"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected((e.currentTarget as HTMLInputElement).checked ? products.map((p) => p.id) : [])
                  }
                />
              </s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Detected as</s-table-header>
              <s-table-header>Try-on</s-table-header>
              <s-table-header>Variants</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((p) => {
                const r = readinessSummary(p.assets);
                const isEyewear =
                  p.merchantDecision === "include" || (p.merchantDecision !== "exclude" && p.eyewearScore >= 0.5);
                return (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <s-checkbox
                        accessibilityLabel={`Select ${p.title}`}
                        checked={selected.includes(p.id)}
                        onChange={(e) => {
                          const on = (e.currentTarget as HTMLInputElement).checked;
                          setSelected((s) => (on ? [...s, p.id] : s.filter((x) => x !== p.id)));
                        }}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-thumbnail src={p.featuredImageUrl ?? undefined} alt={p.title} size="small" />
                        <s-link onClick={() => navigate(`/app/products/${p.id}`)}>{p.title}</s-link>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-badge tone={isEyewear ? "info" : "neutral"}>{isEyewear ? "Eyewear" : "Not eyewear"}</s-badge>
                        {p.merchantDecision && <s-text color="subdued">set by you</s-text>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={r.tone}>{r.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{p.variantCount}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
