# Decisions

Newest first. Each entry: what, why, and what would change it.

## D-012 · Canonical face mesh as the face occluder (2026-11-03)
**What:** Render MediaPipe's canonical face mesh (Apache-2.0, 468 vertices, 898 triangles) depth-only, 4 mm behind the face, plus a head ellipsoid.
**Why:** The headless camera test showed the far temple drawing across the lens with only an ellipsoid. The canonical mesh is MediaPipe's documented approach.
**Revisit:** Milestone 2, when a per-frame landmark-deformed mesh is evaluated against physical frames.

## D-011 · Frame width is measured from the front of the model (2026-11-03)
**What:** `frontWidth` = x-extent of geometry within the front 12 mm.
**Why:** Splayed temples made bounding-box width 171 mm for a 138 mm frame; published frame width refers to the front.

## D-010 · Demo frame temples splay 8° (2026-11-03)
**Why:** Straight temples at 69 mm passed inside the canonical head (76.6 mm half-width at the ears) and were hidden.

## D-009 · Diagnostics page instead of a CLI proof script (2026-11-03)
**What:** Storage, CDN CORS and image-pixel checks run from an admin page on the development store.
**Why:** CORS and pixel access must be measured from inside the admin iframe, where they actually apply; a page also needs no extra token handling.

## D-008 · Matrix layout detected at runtime (2026-11-03)
**Why:** MediaPipe's JS types do not document row- vs column-major. Detection uses where the translation sits; tested both ways.

## D-007 · Widget in Shadow DOM, loaded on click (2026-11-03)
**Why:** Merchant theme CSS cannot break the mirror; product pages pay 1 KB until a shopper opens it.

## D-006 · Hand-written Prisma migration, verified two ways (2026-11-03)
**What:** Migration SQL written by hand, checked on SQLite locally (`scripts/verify-migrations.mjs`) and against `schema.prisma` for drift in CI.
**Why:** Prisma's engine binaries cannot be downloaded in the build sandbox. The founder's machine and CI use the standard Prisma flow.

## D-005 · GraphQL validated in CI against the live Admin schema (2026-11-03)
**Why:** shopify.dev is unreachable from the build sandbox; `graphql-codegen` in CI fails on any invalid field.

## D-004 · GLBs stored as generic Files, not product media (2026-11-03)
**Why:** Product media would appear in the theme gallery and trigger Shopify's own 3D viewer.
**Pending:** Diagnostics evidence (Files lifecycle, CDN CORS). `AssetStore` keeps alternatives open.

## D-003 · Manifest in an app-owned product metafield (2026-11-03)
**What:** `$app.vm_manifest`, declared in `shopify.app.toml`, `merchant_read`.
**Why:** Only our app can write it, so storefront output cannot be tampered with by other apps; Liquid reads it with no extra request.

## D-002 · No `read_themes` scope (2026-11-03)
**Why:** App Bridge `shopify.app.extensions()` reports block activation without it (ChatGPT review).

## D-001 · Shopify app at the repository root (2026-11-03)
**What:** Template at the root, engines in `packages/*`.
**Why:** The Shopify CLI expects `shopify.app.toml` and `extensions/` at the app root; no path flags for the founder.
