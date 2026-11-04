# QA report: QA Lab mechanics check (sandbox)

**Verdict: INCOMPLETE. This is not a visual validation.** It checks that the QA Lab and storefront widget run end to end. No real product, real face footage or real device was involved, so tracking quality, realism and product fidelity are untested.

| Field | Value |
| --- | --- |
| Test kind | Live renderer (existing pipeline) |
| Tested commit | `e1f7a9d0e9-dirty` (working tree that became commits `6a81384`..`HEAD` on 2026-11-04) |
| Tester | Claude (automated, Playwright) |
| Device / browser | Headless Chromium 153, Linux, SwiftShader software WebGL |
| Product | None. Generic demo frame only |
| Asset | `demo-frame.glb`, 28,276 bytes, SHA-256 `2228374ae3c4d71e4f95fac9…` |
| Asset provenance | **Generic frame (not the product)**, method `demo-template` |
| Asset geometry | front 138 mm, height 48 mm, depth 142.7 mm, 804 triangles |

## What ran

| Check | Result |
| --- | --- |
| Asset loads; provenance auto-detected as generic from the file's own metadata | Works |
| Dimension check vs entered values (total width 140, temple 145) | Δ −2.0 mm width, −2.3 mm depth vs temple length |
| Studio captures front, 3/4, side, stamped with provenance and commit | Works |
| Render + photo overlay capture (synthetic labelled pattern, not a product photo) | Works |
| Live mirror from fake camera (no face), QA bar capture | Works; 0 % tracked as expected |
| Deterministic replay ×2 on a synthetic, face-free video (40 frames) | Runs; 0 tracked mismatches, 0 px anchor difference. Trivial without a face: determinism with a tracked face is **not yet shown** |
| Report rule: generic frame cannot pass product fidelity | Enforced |
| Storefront smoke test with a face video (scripts/smoke) | 8 / 8 checks, including "no unexpected external requests" |

## Findings

1. **MediaPipe usage telemetry** to `odml.pa.googleapis.com` on every tracker start (~140 bytes, no image data). Now disabled at build time; CI guards it (D-016).
2. **Closing a session recorded a false error** (`webgl-context-lost`). Fixed.
3. **The committed smoke script was broken** and had not been re-run after an edit. Fixed; now 8 / 8.
4. **Materials: the black demo frame renders mid-grey in the straight-on front view**, while the temples stay black. The flat frame front reflects the bright studio environment almost uniformly. This misrepresents a black frame's colour. Open for Milestone 2 (environment intensity, roughness, or a dimmer environment for dark materials), to be judged against product photos rather than tuned blind.

## Evaluation

| Test | Result | Observation |
| --- | --- | --- |
| Front alignment | NOT TESTED | No real face footage |
| Scale | NOT TESTED | No real product |
| Head rotation | NOT TESTED | No real face footage |
| Occlusion | NOT TESTED | No real face footage |
| Materials | FAIL | Black frame front renders mid-grey in studio front view (finding 4) |
| Tracking stability | NOT TESTED | No real face footage |
| Product fidelity | NOT TESTED | Generic frame: cannot pass by definition |
| Automation | NOT APPLICABLE | Live-renderer track |
