import type { FrameModelInput } from "@vm/contracts";
import { superellipse, type V2 } from "./curve";

/**
 * A GENERIC example frame for tests and the QA Lab. It is not a replica of any
 * product and must never be shown to shoppers as one (provenance "generic").
 *
 * Shape: a soft rectangle 52 x 40 mm whose lower nasal corner is drawn in
 * towards the temple, as on many acetate frames, so the bridge has room for
 * the nose. Sizes 52-18-145.
 */
function genericLensContour(): V2[] {
  return superellipse(52, 40, 3.4, 96).map(([x, y]) => {
    const low = Math.max(0, -y / 20); // 0 at mid-height, 1 at the bottom
    return [x * (1 - 0.1 * low) + 2.6 * low * (x < 0 ? 1 : 0.2), y] as V2;
  });
}

export const GENERIC_ACETATE_FRAME: FrameModelInput = {
  v: 1,
  name: "Generic acetate rectangle 52-18-145 (example, not a product)",
  provenance: "generic",
  source: "Hand-written example in engine-geometry fixtures; typical acetate proportions, no real product measured.",
  lens: { contour: genericLensContour(), baseCurve: 4, centerThickness: 2, tint: [0.92, 0.94, 0.96], opacity: 0.08 },
  bridgeWidth: 18,
  bridge: { height: 6, thickness: 6, arch: 2 },
  rim: { faceWidth: { top: 5.5, bottom: 4, temporal: 5, nasal: 4 }, depth: 5.5, frontEdgeRadius: 1.6, backEdgeRadius: 1 },
  wrapDeg: 5,
  endpiece: { length: 6, height: 9, hingeHeight: 9, hingeBack: 8 },
  hinge: { barrelRadius: 1.3, knuckles: 3 },
  temples: {
    length: 145,
    bendAt: 100,
    dropDeg: 35,
    splayDeg: 6,
    width: { hinge: 3.2, tip: 2.6 },
    height: { hinge: 8, tip: 4.2 },
  },
  materials: {
    // Black acetate: albedo ~0.012 linear (~0.1 sRGB card). See REALISM_PLAN F-series for the measured target.
    front: { kind: "acetate", color: [0.012, 0.012, 0.012], roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04 },
  },
};
