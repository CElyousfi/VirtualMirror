# Decisions

Newest first. Each entry: what, why, and what would change it.

## D-020 · Acetate has a single reflecting interface (2026-11-04)
**What:** When a FrameModel acetate uses clear coat, the exporter sets `KHR_materials_specular` to 0 on the body; metal keeps its own specular.
**Why:** Clear coat adds a lobe on top of the base specular. Measured on a black frame: median 76 sRGB doubled vs 54 single. This is the material equivalent of "don't compensate with stronger reflections".
**Revisit:** S0.2 material library, against S1 photos.

## D-019 · One measurable frame description: `FrameModel` (2026-11-04)
**What:** Frames are described in millimetres (lens contour, rim profile widths and radii, DBL, wrap, base curve, end piece, hinge, temples, materials) and built into a GLB by one builder. Manual authoring now, automatic fitting later, both produce the same object.
**Why:** Everything shoppers see can be traced to numbers a person can check against a real frame, and automatic methods can be scored parameter by parameter against a hand-authored reference.
**Revisit:** Frames the model cannot express (rimless, decorative temples) need manufacturer GLBs via `existing-glb`.

## D-018 · No tone mapping (2026-11-04)
**What:** `NoToneMapping` instead of Khronos PBR Neutral.
**Why:** Measured: with exposure normalised, Neutral darkens base colours by 81 % (0.03) to 5 % (0.7); no tone mapping reproduces them within ±2 %. Frames are composited over camera video that is not tone-mapped. My earlier code comment claiming Neutral leaves values below 0.8 untouched was wrong.

## D-017 · Calibrated studio lighting replaces RoomEnvironment (2026-11-04)
**What:** `studio-v1` described as data (`core/lighting.ts`), exposure computed analytically so an 18 % grey card reads 0.18, applied via `scene.environmentIntensity`. Nothing bright within 30° of the camera axis; dark camera-side flag.
**Why:** RoomEnvironment's on-axis softbox, mirrored by flat fronts, plus 0.76 stops of over-exposure made black frames mid-grey. The per-material cap I had written never worked (three.js ignores `material.envMapIntensity` with `scene.environment`).
**Revisit:** S2, when live lighting comes from the camera image.

## D-016 · MediaPipe usage telemetry disabled at build time (2026-11-04)
**What:** A Vite plugin rewrites MediaPipe's single logging send (POST to `odml.pa.googleapis.com/v1/log`, ~140 bytes of protobuf: task type, library version, timings; no image data) into a no-op. The build fails if the call site is not found exactly once; CI fails if the endpoint appears in the bundle.
**Why:** Found in the QA Lab network log. It runs on every tracker start in shoppers' browsers, has no off switch, and was not covered by our privacy wording. Apache-2.0 permits modification.
**Founder decision pending:** keep disabled (recommended), or re-enable and disclose it.

## D-015 · QA reports cannot overstate results (2026-11-04)
**What:** Report rules in code: generic frames cannot pass product fidelity; pass/fail need a written observation; anything untested makes the verdict INCOMPLETE; live-renderer and automatic-reconstruction tracks are separate; prerecorded videos need a recorded consent basis. No numeric quality scores.

## D-014 · One frame pipeline for storefront and QA (2026-11-04)
**What:** `stepPipeline` (detect, smooth, place, render) is shared by the storefront mirror and QA replay; the studio viewer reuses the mirror's material, tone-mapping and environment setup.
**Why:** QA results must describe the code shoppers run.

## D-013 · QA Lab lives in the widget package as a dev page (2026-11-04)
**What:** `packages/widget/dev/qa-lab.html`, served by Vite (`pnpm qa`, `pnpm qa:phone` over HTTPS). Not in the Shopify admin, not in the storefront bundle.
**Why:** It needs camera access (blocked inside the admin iframe), imports the real renderer source directly, and must never ship to merchants.

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
