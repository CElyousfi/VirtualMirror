# Visual QA: how to test Virtual Mirror's real renderer

Every image in a QA report must come from our rendering engine: the Shopify storefront widget, or the QA Lab, which runs the same code. Generated still images, edited screenshots or third-party renders are not evidence.

## Two test tracks, never mixed

| Track | Question | Asset under test | Can "product fidelity" pass? |
| --- | --- | --- | --- |
| **A. Live renderer** (now) | Does the existing tracking and rendering pipeline put a given 3D frame on a face convincingly? | Generic demo frame, or a manually prepared GLB of the product | Only with a manually prepared GLB of that exact product. Never with the generic frame. |
| **B. Automatic reconstruction** (future) | Does our engine build a faithful 3D frame from the merchant's photos? | Only assets labelled *automatically generated* | Yes, if it matches the real pair. Automation must be evaluated. |

The QA Lab and the report format enforce this: a report states its track, every capture is stamped with the asset's provenance, and the report refuses a product-fidelity pass for a generic frame.

## 0. Shopify integration test (do this first)

Follow [SETUP.md](SETUP.md) on a **development store**. The "Which steps need your Shopify login" table there lists exactly what Claude cannot do. Record checks I-1 to I-5 from SETUP.md in a report (section 6 below).

## 1. What to supply for each real product

Per product, ideally the physical frame plus:

| Item | How | Why |
| --- | --- | --- |
| Product photos: front, three-quarter (45°), side (90°) | Plain light background, camera level with the frame, 1 m+ away with zoom to limit perspective distortion, a mm ruler in the plane of the frame front if possible | Geometry comparison in the studio viewer |
| Measurements | Arm print (e.g. 52□18-145) **and** total front width, lens height and temple length measured with a ruler or calipers | Scale checks; arm prints round values |
| Volunteer wearing the real frame: front, three-quarter, side | Same room, light and camera position as the try-on test; volunteer's written consent | On-face comparison, the only true test of fit appearance |
| Volunteer test video **without** glasses, 20–30 s | Phone front camera, scripted movement (section 3), written consent | Repeatable replay of tracking and rendering |
| A 3D model of the product, if one exists | Vendor GLB or one made by a 3D artist (provenance: *manually prepared*) | Track A product fidelity is impossible without it |

Until the automatic engine exists, a product without a manually prepared GLB can only be tested with the **generic** frame, which tests tracking, placement, occlusion and stability, not product fidelity.

Personal data: photos and videos of people are personal data. Keep them out of this repository (it is currently **public** on GitHub). Store them in a private folder and reference them by file name.

## 2. Running the QA Lab

```bash
pnpm install
pnpm demo:frame        # writes fixtures/demo-frame.glb
pnpm qa                # opens http://localhost:5173/dev/qa-lab.html
pnpm qa:phone          # same over HTTPS on your Wi-Fi, for the phone's camera
```

`pnpm qa:phone` prints a `https://192.168.x.x:5173/…` address. Open it on a phone on the same Wi-Fi, accept the self-signed certificate warning once, then use **Open live mirror (camera)**.

Workflow in the page:

1. **Test**: choose the track, enter tester and device (model + OS).
2. **Reference product**: name, source, measurements, front / three-quarter / side photos.
3. **Asset**: load the GLB (or the generic demo frame). Set provenance; it is required and is never guessed, except that our own demo frame identifies itself as generic. Note the SHA-256: it identifies the exact file tested.
4. **Viewer**: Front, 3/4 and Side presets match how product photos are taken (front view shows the wearer's left on the right, like a photo). Use orthographic projection, overlay the matching photo, and align it with scale, offset and rotation; *Difference* blend shows mismatches as bright areas. Capture the render and the render-with-overlay for each view.
5. **Live renderer**: open the mirror with the camera, or play a consented video through it. Use the yellow QA bar to **Capture** frames; **Record (local)** saves a .webm to your computer. Nothing is uploaded.
6. **Deterministic replay**: steps through the test video frame by frame (media time) through the same pipeline. Run it twice to check determinism.
7. **Evaluation**: for each criterion choose pass, fail or not tested and write what you saw. Download the report (Markdown) and the JSON (includes per-frame traces).

## 3. Scripted head movement for test videos

Use the same script for every video so results are comparable:

| Time | Movement |
| --- | --- |
| 0–5 s | Still, facing the camera, 40–60 cm away |
| 5–10 s | Turn head slowly left to about 45°, back to centre |
| 10–15 s | Turn right to about 45°, back to centre |
| 15–20 s | Tilt head left and right (ear towards shoulder) |
| 20–25 s | Nod up and down |
| 25–30 s | Lean in to 30 cm, then back to 80 cm |

The still segment gives a meaningful jitter number; the turns give head-angle coverage and occlusion behaviour.

## 4. What is measured, and what is not

| Measure | Source | Notes |
| --- | --- | --- |
| FPS | Live session (camera or real-time video) | Measured on the device running the page. Replay has no FPS. Headless sandbox runs use software WebGL: their FPS means nothing. |
| Tracked % and longest dropout | Live and replay traces | Frames with a face found by MediaPipe |
| Detect time avg / p95 | Live and replay | Time inside MediaPipe per frame |
| Jitter | Trace | RMS of the second difference of the projected bridge point, px and % of face width. Constant-speed motion counts as zero, so it measures shake, not movement. Read it on the still segment. |
| Head-angle range | Trace | Yaw, pitch, roll of the smoothed pose |
| Load times | Live session | Camera ready, tracker ready, frame ready, first tracked |
| Dimension deltas | Studio | Asset front width and depth vs the product sheet |

Not measured automatically: whether it *looks* right. That is a human judgement recorded per criterion with a written observation, never a score.

## 5. Comparisons: front, three-quarter, side

| Comparison | Left | Right | Answers |
| --- | --- | --- | --- |
| Geometry | Studio render (orthographic) with photo overlay | Product photo | Is the 3D frame the same shape and size as the product? |
| On face | Live or replay capture at matching head angle | Photo of the volunteer wearing the real frame | Does it sit, scale and occlude like the real pair? |
| Materials | Studio render on white, live capture | Product photo, worn photo | Colour, gloss, lens tint and transparency |

## 6. Filing a report

Each test produces `qa-<product>-<commit>-<time>.md` and `.json` from the QA Lab. Save the Markdown in `docs/qa-reports/` (one file per product × device × commit) and keep captures and videos in the private folder, named exactly as the report lists them. The report already contains: source product and measurements, preparation method and provenance, tested commit SHA, device and browser, measured FPS and tracking, front / side / three-quarter capture names, known failures, and the verdict.

Verdict rules: **FAIL** if any criterion fails; **INCOMPLETE** if anything is untested or no session was run; **PASS** only when every criterion passed with a written observation.

## 7. Reproducing a test

1. `git checkout <commit from the report>` (reports from a `-dirty` build cannot be reproduced exactly).
2. `pnpm install --frozen-lockfile && pnpm qa`.
3. Load the same GLB: its SHA-256 must match the report.
4. Replay the same video: per-frame traces in the JSON should match. A determinism run that disagrees is itself a finding.

## 8. Network and privacy during tests

The widget fetches only MediaPipe's runtime (jsDelivr) and face model (Google Cloud Storage). MediaPipe's built-in usage logging to `odml.pa.googleapis.com` is disabled in our build (docs/DECISIONS.md D-016) and CI fails if it returns. Camera frames, photos, videos, captures and reports never leave the browser unless you download and share them.
