# Implementation status

Last updated: 2026-11-04 · Milestone 1 (Shopify vertical slice) + QA Lab · commit range `f10ee3f..HEAD`

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
| `FrameModel` + builder | Measurable frame description (mm) → swept rims, lens shells in the groove, end pieces, hinges, bridge, tapered temples → GLB (metres, anchors, clear coat). QA Lab can build one from JSON or the generic acetate example | Verified locally: 17 tests (closed outward shells, dimensions within 0.1 mm, groove fit, canonical-head clearance, budget) and rendered in the QA Lab studio (headless, software WebGL). Only a **generic** example exists; no real product modelled yet. No merchant-facing method yet |
| Demo frame | Parametric generic frame, 138 mm, 804 triangles, 28 KB | Verified locally; it is **not** a reproduction of any product and the UI says so |
| Units / coordinates | One documented conversion ASSET (m) → FACE (cm); canonical landmarks copied from MediaPipe | Verified locally (12 tests) and visually in the headless test (projected nasion lands on MediaPipe's 2D nasion) |
| GLB storage | Staged upload → generic `fileCreate` → poll READY → delete; fails loudly if Shopify makes a Model3d instead | Verified locally with a fake Admin client and fake upload endpoint; **untested on Shopify** |
| Manifest | Only Ready + merchant-approved + stored assets; schema-validated; app-owned metafield `$app.vm_manifest` | Verified locally (4 tests); metafield write untested on Shopify |
| Publish rule | Ready **and** explicit merchant approval; blockers cannot be overridden; template sizes stay labelled "estimated" | Verified locally |
| Theme block | Renders only with a published manifest; 1.0 KB gzipped loader; widget fetched on click | Loader verified locally against the block's rendered markup; Liquid untested |
| QA Lab | Internal dev page (`pnpm qa`, `pnpm qa:phone`): provenance-labelled asset, studio viewer with front/3/4/side presets and photo overlay, dimension deltas, live mirror from camera or test video, deterministic replay, captures of real renderer output, local recording, Markdown/JSON reports with enforced rules | Verified locally in headless Chromium with synthetic media ([report](qa-reports/2026-11-04-sandbox-mechanics-check.md)); never used on a real device or with real footage |
| Trace metrics and report rules | Tracking %, dropouts, detect avg/p95, jitter, head-angle ranges; generic frames cannot pass product fidelity; untested => INCOMPLETE | Verified locally (17 tests) |
| Provenance | generic / manually prepared / automatically generated, shown in admin, QA Lab, captures and reports | Verified locally |
| Renderer calibration | Calibrated studio lighting, exposure by analytic irradiance, no tone mapping | Verified locally: `scripts/calibration/run.cjs` 8/8 (grey card 0.188, colours ±2 %); runs in CI |
| No third-party telemetry | MediaPipe's usage logging disabled at build time | Verified locally (network log: only runtime and model GETs) and guarded in CI |
| Widget | Camera after click only, MediaPipe (GPU, CPU fallback), matrix layout detection, One Euro smoothing, canonical-face and head occluders, variant chips, add to cart, Esc/focus handling, adaptive resolution, per-session stats with commit SHA | Verified locally in headless Chromium with a fake camera: 8/8 smoke checks (`scripts/smoke`) |

## Measured results (with conditions)

| Measurement | Value | Conditions |
| --- | --- | --- |
| Widget bundle | 907 KB, 239–246 KB gzipped | Vite build, CI and sandbox |
| Loader script | 2.6 KB, 1.0 KB gzipped | |
| MediaPipe WASM download | 14.6 MB uncompressed (`vision_wasm_internal.wasm`), compressed size over the CDN not measured | Package file size |
| Face model download | 3.76 MB | `face_landmarker.task` float16 v1 |
| Unit tests | 114 passing | Local, 2026-11-04 (CI run on push) |
| Generic FrameModel GLB | 32,688 triangles, 620 KB, 147.5 mm | `GENERIC_ACETATE_FRAME`, 52-18-145 |
| Black acetate, studio front view, interior pixels | median 54 sRGB (p25 41, p95 104); was 76 with double specular | QA Lab, headless SwiftShader, studio-v1; not yet compared with a real frame |
| Headless tracking | 33–38 of 33–38 frames tracked on a rotated three-quarter face | Headless Chromium 153, SwiftShader software WebGL, 1280×720 fake camera |
| Headless frame rate | ~1 fps, ~1000 ms per detection | **Software rendering only. Says nothing about phones.** |

No phone or desktop-GPU performance numbers exist yet. None will be written until measured on named hardware.

## Known defects and limitations

1. **Temples draw over hair.** Nothing segments hair yet. Visible when long hair or a hat covers the ears.
2. **Occluders are rigid.** The canonical face mesh and head ellipsoid follow head pose but not the shopper's face shape.
3. **Anchor and scale are estimates.** Bridge placement comes from the canonical (average) face; size is relative to that face, never a physical measurement. Calibration is Milestone 2.
4. **First-open latency is unmeasured and probably high on mobile data**: 14.6 MB WASM plus 3.8 MB model from public CDNs.
5. **Third-party CDNs at runtime**: jsDelivr (WASM) and Google Cloud Storage (model). Self-hosting is a later decision.
6. **Materials: black frames rendered mid-grey** (sRGB 101). **Fixed 2026-11-04** for the studio and the default live lighting: calibrated `studio-v1` environment, intensity bug fixed, no tone mapping; black front now sRGB 34, colours within ±2 % (docs/REALISM_PLAN.md §1.5). Still to judge against real product photos; live lighting does not yet follow the shopper's room.
6b. **Merchant GLBs lost material extensions on unit fix** (clear coat, transmission, IOR …). **Fixed 2026-11-04**, tested.
7. **The widget bundle includes Zod** (~40 KB gzipped) for manifest validation; could be replaced with a hand-written check.
8. **Admin has no 3D preview yet.** Merchants judge the frame on the storefront. A fixed reference-head preview is Milestone 3.
9. **Prisma engines could not be downloaded in the build sandbox**, so the Prisma-backed code is verified by CI typecheck only, not executed.
10. **Shoppers' browsers still contact two third parties**: jsDelivr (MediaPipe runtime) and Google Cloud Storage (face model), which see the shopper's IP address. MediaPipe's own usage logging is disabled (D-016). Self-hosting both files would remove this; decide before the public listing's privacy text is written.
11. **Determinism with a tracked face is unproven.** Replay determinism has only been checked on face-free footage.
12. **No licence-clear face footage exists in the project yet.** Tracking quality cannot be measured until the founder supplies consented videos (docs/VISUAL_QA.md §1, §3).

## Blocked on the founder

| What | Why it is blocked | Steps |
| --- | --- | --- |
| Install and auth on a development store | Needs Shopify login | [SETUP.md](SETUP.md) steps 1–4 |
| ChatGPT correction #2: image pixel access in the admin | Needs a real store's CDN | SETUP.md step 8, Diagnostics |
| ChatGPT correction #3: Files lifecycle and CDN CORS | Needs a real store | SETUP.md step 8, Diagnostics |
| **Milestone 1 acceptance** | Needs a real storefront and a phone | SETUP.md steps 5–7 |
| Device measurements | Needs real phones | `?vm_debug=1` screenshots, or QA Lab live sessions (`pnpm qa:phone`) |
| Visual validation against real eyewear | Needs real products, measurements, consented photos and videos | [VISUAL_QA.md](VISUAL_QA.md) §1 |

## Next

0. Decide whether to keep MediaPipe telemetry disabled (recommended) and whether to make the repository private.
1. Founder runs SETUP.md; fix whatever the first real install exposes.
2. Record Diagnostics results here; decide storage and image-processing paths from them.
3. Real-phone sessions on iPhone Safari and Android Chrome; first QA Lab reports with a consented test video.
3b. First real product: photos, measurements, ideally a manually prepared GLB (VISUAL_QA.md §1).
4. Then Milestone 2 (rendering quality) and, in parallel, the 2.5D experiment package.
