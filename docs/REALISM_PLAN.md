# Realism plan

Status: proposal for review, 2026-11-04. Measurements in §1.2 were taken in headless Chromium (SwiftShader) with `packages/widget/dev/diagnose-materials.html`; they describe the renderer's maths, not a phone screen.

The goal from the brief: a real pair of black acetate glasses, faithfully modelled, looking real on a moving face in our browser renderer. Everything below is ordered towards that one test.

## 1. Diagnosis of the current result

### 1.1 Geometry: `packages/engine-geometry/src/demo-frame.ts` + `mesh.ts`

The demo frame was built to prove the Shopify chain. Its construction, not its triangle count, makes it look fake.

| # | Problem | Where | Effect |
| --- | --- | --- | --- |
| G1 | Rims are a flat 2D ring extruded straight back: rectangular cross-section, no rounding or bevel | `roundedRectLoop` + `addRing` (`mesh.ts`), called in `buildDemoFrameMeshes` | Hard silhouette edges; each face is perfectly flat, so it reflects a single direction of the environment (cause of the grey, §1.2) |
| G2 | The whole front is planar: no wrap, no base curve | all rim and lens points share z = 0 … `frontDepth` | No highlight gradient across the front; looks stamped from sheet |
| G3 | Lens shape is a rounded rectangle with fixed corner radius | `roundedRectLoop(cx, 0, lw, lh, r)` | Cannot represent any real product's lens shape |
| G4 | Bridge is an axis-aligned box placed between the rims | `frame.addBox(... bridgeY ...)` | No arch, no keyhole or saddle, no nose-contact surface; floats above the nose |
| G5 | End pieces and hinges are boxes overlapping the rims | `frame.addBox([... outerX ...])` | No hinge barrels; visible interpenetration at 3/4 view |
| G6 | Temples are two straight beams of constant rectangular section with a kink | `addBeam(p0, p1)`, `addBeam(p1, p2)` | No taper, no curve, no tip; the 3/4 and side views read as sticks |
| G7 | Lenses are flat fans at half depth, 12 % opacity | `addFilledLoop(lenses, inner, depth * 0.5)` | No curvature, edge or thickness; almost invisible |

**Conclusion:** the demo frame cannot be polished into a product. It stays only as a labelled generic integration fixture. A new frame representation is needed (§2.1).

### 1.2 Why black frames render grey: measured

A flat plate with the demo frame's material (glTF base colour 0.03 linear, roughness 0.32, dielectric) facing the camera, rendered with the product's own setup (`configureRenderer` + `prepareGlassesMaterials`):

| Variant | sRGB (0–255) | Linear | Reading |
| --- | --- | --- | --- |
| A. Current setup | 101 | 0.130 | Mid-grey; the demo frame's front measures the same (101) |
| B. Diffuse only (specular off) | 34 | 0.016 | The base colour is fine |
| C. Specular only (base colour 0) | 81 | 0.082 | Reflection is ~63 % of the result |
| D. No tone mapping | 115 | 0.171 | Tone mapping is **not** the cause |
| I. 18 % grey card, diffuse, no tone mapping | 150 | 0.305 | Should read 0.18: environment is ~0.76 stops over-exposed |
| F. `material.envMapIntensity` 1.0 instead of 0.6 | 101 | 0.130 | Identical to A: **the per-material cap does nothing** |
| J. `scene.environmentIntensity` 0.6 / 0.3 | 71 / 35 | 0.063 / 0.017 | The control three.js actually honours |
| K. Plate tilted 20° / 40° away | 43 / 41 | 0.024 / 0.022 | Black again once it stops mirroring the light behind the camera |
| K. Tilted 20° towards the ceiling light | 109 | 0.153 | Greyer |

Causes, in order of size:

1. **A bright light source sits exactly on the camera axis.** three.js `RoomEnvironment` (used in `configureRenderer`, `renderer.ts`) has a large softbox (`light4`, emissive 43) at +Z, where the camera is for a front view. A flat dielectric front at normal incidence mirrors it: 4 % of a very bright panel is mid-grey. Real photographers keep lights off-axis for exactly this reason.
2. **Planar geometry (G1, G2)** makes every pixel of the front reflect that same direction, so the reflection becomes a uniform grey wash instead of highlights on a dark body.
3. **The environment is over-exposed** by ~0.76 stops (grey card 0.305 instead of 0.18).
4. **A bug:** `prepareGlassesMaterials` sets `material.envMapIntensity = 0.6`, but with `scene.environment` three.js overwrites it with `scene.environmentIntensity` (`three/src/renderers/WebGLRenderer.js`, line 2749). The "capped reflections" safeguard never applied.

Not causes: base colour, colour-space handling, tone mapping.

The fix is **not** "darker material" or "weaker reflections" globally. It is a calibrated, off-axis lighting environment, correct intensity control, and curved geometry that produces highlights rather than a wash (§2.2).

### 1.3 Renderer: `packages/widget/src/renderer.ts`

| # | Problem | Where |
| --- | --- | --- |
| R1 | Black renders grey | §1.2 |
| R2 | One fixed studio environment for both studio and live, unrelated to the shopper's room light: frames look pasted on in warm or dim rooms | `configureRenderer` |
| R3 | Materials come straight from glTF as `MeshStandardMaterial`: no clear coat (polished acetate), no transmission or absorption (translucent acetate, tortoise), no lens Fresnel; lenses are constant-opacity alpha | `loadFrame`, `prepareGlassesMaterials` |
| R4 | No contact shadow or ambient occlusion where the frame meets the face: glasses float | absent |
| R5 | Thin parts alias after adaptive resolution drops pixel ratio to 1 | `setPixelRatio` in `index.ts` adaptive block |
| R6 | Video colour (browser `<video>`) and canvas output are never matched for exposure or white balance | absent |

### 1.4 Face integration: `renderer.ts`, `pipeline.ts`, `@vm/contracts`

| # | Problem | Where |
| --- | --- | --- |
| F1 | Occluder is the rigid canonical (average) face pushed back 4 mm plus an ellipsoid: real faces differ, so temples clip into or float off the cheeks | `FACE_OCCLUDER_OFFSET_CM`, `OCCLUDER` |
| F2 | Bridge anchor is a constant from the canonical face; the frame does not rest on *this* person's nose | `DEFAULT_BRIDGE_ANCHOR_CM` |
| F3 | Scale is relative to an average face; physical size is never measured | contracts `assetToFaceMatrix` |
| F4 | Smoothing parameters are untuned; motion latency is unmeasured on devices | `DEFAULT_SMOOTHER` (`core/pose.ts`) |
| F5 | Camera FOV fixed at MediaPipe's 63°. Self-consistent (verified: projected nasion lands on MediaPipe's 2D nasion), but perspective of very close faces is approximate | `FACE_GEOMETRY_CAMERA` |
| F6 | No hair or ear occlusion | absent |
| F7 | Behaviour at large head turns (> 45°) unmeasured | — |

## 2. Exact changes

### 2.1 Geometry: one product frame representation (`FrameModel`)

A single, measurable description of a real frame, produced by hand now (Stage 1) and by automatic fitting later (Stage 4), built into a GLB by one builder. This keeps the `PreparationMethod` architecture: the reference workflow and every automatic method output a `FrameModel`; `existing-glb` stays for manufacturer models.

`packages/engine-geometry/src/frame-model/`:

| Part | Representation | Built as |
| --- | --- | --- |
| Lens contour | Closed curve of points (mm, lens-centred), from a tracing or a photo; right lens mirrored unless given | The shape every other front part follows |
| Rim | Cross-section profile: face width, depth, front/back edge radii (bevels), groove depth | Profile swept along the contour → rounded edges and real highlights (fixes G1) |
| Front curvature | Wrap radius (horizontal) and lens base curve | Front laid on a curved surface (fixes G2) |
| Bridge | Width, height, arch curve, style (keyhole, saddle, pads) | Swept arch blending into both rims; nose-contact surface tagged `VM_NoseContact` (fixes G4) |
| End pieces + hinges | End piece outline, hinge barrel radius / length / position | Swept end piece + cylinders (fixes G5) |
| Temples | 3D path (hinge → straight → bend → tip), section width/height at hinge and tip, splay, tip style | Tapered rounded section swept along a smooth spline (fixes G6) |
| Lenses | Contour inset into the rim groove, base curve, centre thickness, tint, coating | Spherical cap trimmed by the contour, with edge (fixes G7) |
| Materials | Frame: acetate (opaque / translucent + colour or texture), metal; lenses; pads | glTF PBR with `KHR_materials_clearcoat`, `transmission`, `volume`, `ior` |

Output GLB in ASSET space (metres) with anchors `VM_Bridge`, `VM_NoseContact`, `VM_Hinge_L/R`, `VM_TempleTip_L/R`, and UVs along each sweep for textures.

Honest limit: this covers full-rim and semi-rim acetate and metal frames well. Decorative features (engraved temples, logos, rivets, complex filigree) need a manufacturer GLB or a later extension.

### 2.2 Renderer

| Change | File | Fixes |
| --- | --- | --- |
| Use `scene.environmentIntensity` (and a per-material factor applied in shader, not `envMapIntensity`) | `renderer.ts` | Bug in §1.2 |
| Replace `RoomEnvironment` with a **calibrated procedural studio environment**: no emitter on the camera axis; key, fill and rim strip lights off-axis; dark surround; exposure normalised so an 18 % grey card reads 0.18 | `studio-environment.ts` | R1 |
| **Camera-derived lighting for live**: every few frames, estimate brightness and white balance from the face region and the blurred, mirrored video; drive environment intensity and tint (smoothed) | `camera-lighting.ts` | R2, R6 |
| **Material library**: polished acetate = physical material with clear coat; translucent acetate = transmission + absorption (desktop) with an alpha fallback (mobile); metal with measured alloy colours; lenses with Fresnel reflectance (≈4 % head-on rising at grazing angles) and tint absorption | `materials.ts` | R3 |
| **Contact shadow**: the face occluder receives a soft shadow from the frame (shadow-only material), or analytic soft decals under the nose contact and along the temples on low-end devices | `renderer.ts` | R4 |
| Keep pixel ratio ≥ 1.5 for frame pixels when the device allows; MSAA stays | `index.ts` | R5 |

### 2.3 Face integration

| Change | Fixes |
| --- | --- |
| **Landmark-fitted occluder**: each frame, place every canonical vertex at its live landmark's screen position at the rigid-pose depth, so the occluder takes this person's face shape | F1 |
| **Per-person nose anchor**: after the face is stable, fit the bridge anchor to the live nose landmarks (168, 6, 197) and the frame's `VM_NoseContact`; hold it per session | F2 |
| **Optional metric scale** from iris landmarks (human iris ≈ 11.7 mm) as an experiment; default stays "estimated" | F3 |
| **Tune smoothing on replay traces**: minimise jitter on the still segment and lag on the turn segment of the scripted video; publish the numbers | F4 |
| **Hair segmentation** (MediaPipe hair segmenter, Apache-2.0) as a measured experiment; adopt only if it holds frame rate | F6 |
| Large-yaw behaviour measured from replay; temples fade or hold rather than glitch | F7 |

## 3. Reference-asset test plan (one real black acetate pair)

1. **Capture** (founder, §5).
2. **Digitise** the lens contour from the paper tracing in the QA Lab (new contour tool: click along the traced line, set scale from the ruler).
3. **Author the `FrameModel`** from the contour and caliper measurements. Provenance: *manually prepared* (a person authored it from measurements). If the manufacturer supplies a GLB, test it too as a second reference.
4. **Studio comparisons** in the QA Lab, orthographic, photo overlay aligned by the ruler scale:
   - front: silhouette overlap and dimension deltas;
   - three-quarter: rim thickness, bridge curve, hinge, temple;
   - side: temple shape, bend position, front depth;
   - materials: black stays black with highlights where the photo has them.
5. **On-face**: the same consenting person, same room and camera position, filmed wearing the real pair and then without glasses (scripted movement). Replay the second video with the virtual frame; capture at matched head angles (0°, ±25°, ±45°) beside frames from the first video.
6. **Live on devices**: iPhone and Android, FPS, load times, tracking, jitter.
7. **Report** per VISUAL_QA.md. Product fidelity can only pass on step 4 + 5 evidence, reviewed by a person who has the real glasses in hand.

## 4. Sequence and acceptance criteria

Steps marked ✱ need no real product and start now.

| Step | Work | Acceptance (measured, not scored) |
| --- | --- | --- |
| ✱ S0.1 | Lighting fix: intensity bug, calibrated studio environment, exposure | 18 % grey card reads 0.18 ± 0.01 linear; flat black acetate at normal incidence ≤ sRGB 45; diagnostics committed and re-runnable |
| ✱ S0.2 | Material library (acetate clear coat, translucent acetate, metal, lens Fresnel) | Lens reflectance ≈ 4 % at 0° and ≥ 15 % at 70°; black acetate body stays ≤ sRGB 45 away from highlights |
| ✱ S0.3 | `FrameModel` + builder | Dimensions within 0.1 mm of the model; lens fits the rim groove; temples clear the canonical head; normals outward; ≤ 60 k triangles, ≤ 1.5 MB |
| ✱ S0.4 | QA Lab contour tool + `FrameModel` editor | Digitised contour round-trips to within 0.2 mm on a synthetic test drawing |
| ✱ S0.5 | Landmark-fitted occluder + nose anchor (maths, unit-tested) | Occluder vertices match landmark screen positions to < 0.5 px in tests |
| S1 | Reference model of the real pair | Front silhouette overlap ≥ 95 % after scale alignment; measured dimensions within 1 mm; 3/4 and side reviewed with written notes |
| S2 | Camera lighting, contact shadow, occluder and anchor on footage | On the scripted video: correct temple occlusion at ±45°; jitter on the still segment ≤ 0.5 % of face width; device FPS recorded |
| S3 | On-face comparison, real vs virtual | Side-by-side captures at matched angles reviewed by the founder with the real pair in hand; each mismatch written down |
| S4 | Automatic fitting towards the reference | Fitted `FrameModel` parameters vs the hand-authored reference: per-parameter error reported; unsupported frames rejected |
| S5 | Shopify integration of the automatic path | Merchant flow unchanged: install → sync → prepare → preview → approve → publish |

The Shopify app is not changed by S0–S3 except that published assets will come from `FrameModel` instead of the demo template.

## 5. What we need from you (minimum for S1)

One pair of **black acetate full-rim** glasses that you physically have.

| Item | Detail |
| --- | --- |
| Measurements with a ruler or calipers (mm) | Arm print; total front width; lens width and height; bridge width; rim face width at the top, outer side and bottom; front thickness (depth); temple length; temple height at the hinge and at the tip; distance from the hinge to the start of the bend; how far the front curves back at the outer edges (lay it face down on a table, measure the gap) |
| Lens contour tracing | Lay the frame front flat on white paper, trace inside each lens opening with a sharp pencil, put a ruler on the paper, photograph straight down |
| Product photos | Front, three-quarter, side and top, plain light background, camera level, ruler in the frame plane (VISUAL_QA.md §1) |
| Material photos | Close-ups of the front and a temple in daylight, to see gloss and any texture |
| On-face set (consented) | One person, same room and phone position: a short video wearing the real pair, and a 30 s scripted video without glasses (VISUAL_QA.md §3) |
| If it exists | The manufacturer's 3D file, or permission to ask for it |

Photos and videos of people stay out of the public repository.
