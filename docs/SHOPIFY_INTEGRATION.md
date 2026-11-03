# Shopify integration

## Scopes

Requested in `shopify.app.toml`. Each is tied to an operation in the code.

| Scope | Needed for | Code |
| --- | --- | --- |
| `read_products` | `products` / `product` queries for catalog sync and the detail page; `products/update` and `products/delete` webhooks | `app/graphql/products.ts`, `app/services/catalog-sync.ts` |
| `write_products` | `metafieldsSet` / `metafieldsDelete` on products (the storefront manifest) | `app/services/manifest.ts` |
| `write_files` | `stagedUploadsCreate`, `fileCreate`, `fileDelete`, and reading the created file's status | `app/services/asset-storage.ts` |

Not requested:

- `read_themes`: theme block activation is read with App Bridge `shopify.app.extensions()`, which needs no scope (`app/routes/app._index.tsx`).
- Customer, order and analytics scopes: nothing in Milestone 1 uses them.

To verify after install: the install screen must list exactly these three permissions.

## Data model

All merchant data is keyed by `shop` (the `*.myshopify.com` domain). Every query in `app/models/*.server.ts` filters by it.

| Model | Purpose | Lifecycle |
| --- | --- | --- |
| `Session` | Template session storage (offline tokens) | Deleted on uninstall |
| `Shop` | Tenant row; last sync time and error | Created in `afterAuth`; deleted on `app/uninstalled` and `shop/redact`, cascading to products and assets |
| `Product` | Local mirror: snapshot JSON, eyewear score and reasons, merchant include/exclude override | Upserted by sync and webhooks; swept when deleted in Shopify |
| `Asset` | One prepared 3D frame per variant group: method, state, readiness report, spec, anchors, Files GID and URL, approval and publish times | Created by preparation; replaced on re-prepare (old file deleted) |

Unique keys: `(shop, shopifyGid)` on Product, `(productId, variantKey)` on Asset.

## What we write to the merchant's store

| Where | What | Visible to |
| --- | --- | --- |
| Files (Content → Files) | One generic `.glb` file per prepared variant group, alt text "Virtual Mirror 3D frame: …" | Merchant in Files; public URL on the CDN |
| Product metafield `$app.vm_manifest` (json) | Storefront manifest: version, enabled, per-asset variant IDs, label, GLB URL, bridge anchor, front width, scale "source-backed" or "estimated" | Merchant read-only in admin; our theme block |

The metafield definition is declared in `shopify.app.toml` (`[product.metafields.app.vm_manifest]`, admin `merchant_read`). Only our app can write it. Liquid reads it as `product.metafields['$app'].vm_manifest.value` inside our extension.

## Webhooks

| Topic | Route | Effect |
| --- | --- | --- |
| `app/uninstalled` | `/webhooks/app/uninstalled` | Delete sessions and all shop data |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Template handler |
| `products/update`, `products/delete` | `/webhooks/products` | Refresh or remove one product |
| `customers/data_request`, `customers/redact`, `shop/redact` | `/webhooks/compliance` | No customer data is stored; `shop/redact` deletes shop data. **Commented out in the toml until the public app.** |

## Storage decision (pending evidence)

GLBs go to Shopify Files as **generic files**, not product media, so they never appear in the theme's product gallery. Two facts must be measured on a real store before this is final, using the in-app **Diagnostics** page:

1. Shopify accepts a `.glb` as a `GenericFile` (not converted to `Model3d`) and reports `READY`.
2. The CDN URL is readable cross-origin from a storefront (CORS header present).

If either fails, the `AssetStore` interface (`app/services/asset-storage.ts`) lets us switch to an app proxy or external storage without touching callers.

## Distribution

Shopify does not allow changing an app's distribution method later. The development app (`Virtual Mirror (dev)`) is used for all testing; the public App Store app is created separately at Milestone 6.
