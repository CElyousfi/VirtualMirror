# Architecture

## Packages and runtimes

| Package | Runs in | Depends on | Must never import |
| --- | --- | --- | --- |
| `app/` (repo root) | Node server + Shopify admin iframe | all packages | — |
| `extensions/virtual-mirror` | Shopify storefront (Liquid + 1 KB loader) | built widget bundle | — |
| `packages/widget` | Shopper's browser, loaded on click | contracts, three, MediaPipe | Shopify APIs, app code |
| `packages/engine-geometry` | Any JS runtime | contracts, glTF-Transform | DOM, Shopify, React |
| `packages/catalog` | Any JS runtime | contracts | DOM, Shopify client |
| `packages/contracts` | Any JS runtime | zod | everything else |

The engines are runtime-neutral so the same code can run in the merchant's browser (Web Worker) now and in a server queue later.

## Data flow

Merchant side: install → `afterAuth` creates tenant → **Sync catalog** pages the Admin API into `Product` rows and classifies eyewear → merchant opens a product → a `PreparationMethod` produces a `PreparedAsset` → the GLB is stored in Shopify Files → merchant reviews checks and approves → **Show on store** writes `$app.vm_manifest`.

Shopper side: product page renders the block only if the manifest exists → click → loader fetches `virtual-mirror.js` → camera permission → MediaPipe loads → per frame: landmarks + FACE→CAMERA matrix → smoothing → ASSET→FACE→CAMERA transform → render over the mirrored video. Camera frames never leave the device.

## Coordinate spaces

Defined once in `packages/contracts/src/coordinate-spaces.ts`.

| Space | Units | Axes | Origin |
| --- | --- | --- | --- |
| ASSET (every GLB) | metres | +Y up, +Z forward out of the frame front, +X wearer's left | Bridge reference point (or `VM_Bridge` node) |
| FACE (MediaPipe canonical face) | centimetres | +Y up, +Z toward camera, +X subject's left | Canonical model origin |
| CAMERA (MediaPipe metric camera) | centimetres | camera at origin looking −Z, +Y up | Camera |
| SCREEN | pixels | mirroring by CSS `scaleX(-1)` on video and canvas together | |

ASSET and FACE share axis directions, so `assetToFaceMatrix` is translate(−bridge) → scale ×100 → translate(face anchor). The FACE→CAMERA matrix comes from MediaPipe; its memory layout is detected at runtime. The camera uses MediaPipe's documented 63° vertical FOV, confirmed in the headless test by the projected nasion landing on MediaPipe's own 2D nasion landmark.

## Preparation methods

All implement `PreparationMethod` (`packages/contracts/src/preparation.ts`). The admin, storage and widget depend only on `PreparedAsset`.

| Method | Status |
| --- | --- |
| `existing-glb` | Implemented |
| `demo-template` | Implemented (testing only; always needs review) |
| `silhouette-2.5d` | Experiment, not started |
| `manual-dimensions` | Not started |

## Readiness and publication

States: imported → analyzing → generated → needs_review → ready → published, plus failed and unsupported. The state is the minimum across checks. A missing scale source caps at needs_review. Publishing requires Ready **and** explicit merchant approval; blockers can never be overridden.
