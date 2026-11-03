# Implementation status

Last updated: 2026-11-03 · Milestone 1 (Shopify vertical slice) · commit range `f10ee3f..HEAD`

**Milestone 1 is not complete.** Its acceptance test (a development-store product page opens the live mirror and shows tracked 3D glasses) has not been run, because it needs the founder's Shopify account. All code for it exists, passes CI, and the widget has been run end to end in headless Chromium with a fake camera.

## Evidence levels used below

| Level | Meaning |
| --- | --- |
| **Verified on Shopify** | Ran against a real Shopify development store. Nothing is at this level yet. |
| **Verified in CI** | GitHub Actions on every push: Prisma client generation, migration drift check, GraphQL validated against the real Admin API schema, typecheck, lint, unit tests, build. |
| **Verified locally** | Run in the build sandbox (unit tests with fakes, SQLite, headless Chromium). |
| **Untested** | Written, compiles, never executed. |

## What exists

| Area | What | Evidence |
| --- | --- | --- |
| Repo | pnpm monorepo, Shopify React Router template at the root, `packages/*` engines | Verified in CI |
| Scopes | `read_products, write_products, write_files` only; `read_themes` not requested | Verified in CI (config); install screen untested |
| Data model | `Shop`, `Product`, `Asset`, all keyed by shop with cascade delete | Verified locally: migrations applied to SQLite, unique (shop, product) and per-shop cascade checked by `scripts/verify-migrations.mjs`; drift vs `schema.prisma` verified in CI |
| Install / auth | Template OAuth + `afterAuth` creates the tenant row | Untested (needs dev store) |
| Uninstall / redact | `app/uninstalled` and `shop/redact` delete all shop data | Untested; compliance topics commented out in `shopify.app.toml` until the public app |
| Catalog sync | Paged `products` query within query-cost budget, THROTTLED retry, timestamp sweep for deleted products, merchant decisions preserved | Verified locally (5 tests, fake Admin client); GraphQL verified in CI; untested on Shopify |
| Product webhooks | `products/update`, `products/delete` refresh one product | Untested |
| Eyewear detection | Taxonomy, type, title, tags in 7 languages; accessory and drinkware exclusion | Verified locally on a 32-product fixture **written alongside the code** (precision 1.000, recall 1.000). Not evidence of real-catalog accuracy. |
| Admin UI | Overview (sync, setup checklist, theme block status), Products (filter, bulk include/exclude), Product detail (prepare, review, approve, publish, hide, delete), Diagnostics | Typecheck verified in CI; never rendered |
| `PreparationMethod` | Contract in `@vm/contracts`; `existing-glb` and `demo-template` implemented | Verified locally (unit tests on real GLB bytes) |
| `existing-glb` | Parse, geometry, unit auto-fix (cm/mm), orientation, size and triangle budgets, bridge anchor, front-width measurement | Verified locally (8 tests) |
| Demo frame | Parametric generic frame, 138 mm, 804 triangles, 28 KB | Verified locally; it is **not** a reproduction of any product and the UI says so |
| Units / coordinates | One documented conversion ASSET (m) → FACE (cm); canonical landmarks copied from MediaPipe | Verified locally (12 tests) and visually in the headless test (projected nasion lands on MediaPipe's 2D nasion) |
| GLB storage | Staged upload → generic `fileCreate` → poll READY → delete; fails loudly if Shopify makes a Model3d instead | Verified locally with a fake Admin client and fake upload endpoint; **untested on Shopify** |
| Manifest | Only Ready + merchant-approved + stored assets; schema-validated; app-owned metafield `$app.vm_manifest` | Verified locally (4 tests); metafield write untested on Shopify |
| Publish rule | Ready **and** explicit merchant approval; blockers cannot be overridden; template sizes stay labelled "estimated" | Verified locally |
| Theme block | Renders only with a published manifest; 1.0 KB gzipped loader; widget fetched on click | Loader verified locally against the block's rendered markup; Liquid untested |
| Widget | Camera after click only, MediaPipe (GPU, CPU fallback), matrix layout detection, One Euro smoothing, canonical-face and head occluders, variant chips, add to cart, Esc/focus handling, adaptive resolution, per-session stats | Verified locally in headless Chromium with a fake camera: 7/7 smoke checks (`scripts/smoke`) |

## Measured results (with conditions)

| Measurement | Value | Conditions |
| --- | --- | --- |
| Widget bundle | 907 KB, 239–246 KB gzipped | Vite build, CI and sandbox |
| Loader script | 2.6 KB, 1.0 KB gzipped | |
| MediaPipe WASM download | 14.6 MB uncompressed (`vision_wasm_internal.wasm`), compressed size over the CDN not measured | Package file size |
| Face model download | 3.76 MB | `face_landmarker.task` float16 v1 |
| Unit tests | 73 passing | CI run `41739258868` |
| Headless tracking | 33–38 of 33–38 frames tracked on a rotated three-quarter face | Headless Chromium 153, SwiftShader software WebGL, 1280×720 fake camera |
| Headless frame rate | ~1 fps, ~1000 ms per detection | **Software rendering only. Says nothing about phones.** |

No phone or desktop-GPU performance numbers exist yet. None will be written until measured on named hardware.

## Known defects and limitations

1. **Temples draw over hair.** Nothing segments hair yet. Visible when long hair or a hat covers the ears.
2. **Occluders are rigid.** The canonical face mesh and head ellipsoid follow head pose but not the shopper's face shape.
3. **Anchor and scale are estimates.** Bridge placement comes from the canonical (average) face; size is relative to that face, never a physical measurement. Calibration is Milestone 2.
4. **First-open latency is unmeasured and probably high on mobile data**: 14.6 MB WASM plus 3.8 MB model from public CDNs.
5. **Third-party CDNs at runtime**: jsDelivr (WASM) and Google Cloud Storage (model). Self-hosting is a later decision.
6. **The widget bundle includes Zod** (~40 KB gzipped) for manifest validation; could be replaced with a hand-written check.
7. **Admin has no 3D preview yet.** Merchants judge the frame on the storefront. A fixed reference-head preview is Milestone 3.
8. **Prisma engines could not be downloaded in the build sandbox**, so the Prisma-backed code is verified by CI typecheck only, not executed.
9. **MediaPipe privacy notice**: the package README points to <https://goo.gle/mediapipe-privacy>. Camera frames are processed locally, but the notice should be reviewed before we make privacy claims in the App Store listing.

## Blocked on the founder

| What | Why it is blocked | Steps |
| --- | --- | --- |
| Install and auth on a development store | Needs Shopify login | [SETUP.md](SETUP.md) steps 1–4 |
| ChatGPT correction #2: image pixel access in the admin | Needs a real store's CDN | SETUP.md step 8, Diagnostics |
| ChatGPT correction #3: Files lifecycle and CDN CORS | Needs a real store | SETUP.md step 8, Diagnostics |
| **Milestone 1 acceptance** | Needs a real storefront and a phone | SETUP.md steps 5–7 |
| Device measurements | Needs real phones | `?vm_debug=1` screenshots |

## Next

1. Founder runs SETUP.md; fix whatever the first real install exposes.
2. Record Diagnostics results here; decide storage and image-processing paths from them.
3. Real-phone sessions on iPhone Safari and Android Chrome; fill docs/QUALITY_BENCHMARKS.md.
4. Then Milestone 2 (rendering quality) and, in parallel, the 2.5D experiment package.
