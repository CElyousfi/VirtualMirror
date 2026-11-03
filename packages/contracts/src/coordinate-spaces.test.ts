import { describe, expect, it } from "vitest";
import {
  CANONICAL_LANDMARKS_CM,
  DEFAULT_BRIDGE_ANCHOR_CM,
  assetToCameraMatrix,
  assetToFaceMatrix,
  identity,
  multiply,
  transformPoint,
  translation,
  uniformScale,
} from "./coordinate-spaces";
import { guessUnitFromFrameWidth, mToCm, mmToM } from "./units";

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, Math.round(-Math.log10(eps))));

describe("units", () => {
  it("converts the three units used at boundaries", () => {
    expect(mToCm(0.14)).toBeCloseTo(14);
    expect(mmToM(52)).toBeCloseTo(0.052);
  });

  it("detects a frame authored in the wrong unit from its width", () => {
    expect(guessUnitFromFrameWidth(0.14)).toEqual({ unit: "metres", toMetres: 1 });
    expect(guessUnitFromFrameWidth(14).unit).toBe("centimetres");
    expect(guessUnitFromFrameWidth(140).unit).toBe("millimetres");
    expect(guessUnitFromFrameWidth(3).unit).toBe("unknown");
  });
});

describe("canonical face model constants", () => {
  it("are mirror-symmetric about x = 0 (sanity check on transcription)", () => {
    const L = CANONICAL_LANDMARKS_CM;
    expect(L.leftEyeOuter[0]).toBeCloseTo(-L.rightEyeOuter[0]);
    expect(L.leftEyeInner[0]).toBeCloseTo(-L.rightEyeInner[0]);
    expect(L.leftFaceEdge[0]).toBeCloseTo(-L.rightFaceEdge[0]);
  });

  it("have +X toward the subject's left and +Z toward the camera", () => {
    const L = CANONICAL_LANDMARKS_CM;
    expect(L.leftEyeOuter[0]).toBeGreaterThan(0);
    expect(L.nasion[2]).toBeGreaterThan(L.leftFaceEdge[2]);
  });

  it("put the default bridge anchor in front of the nasion, at eye height", () => {
    expect(DEFAULT_BRIDGE_ANCHOR_CM[0]).toBe(0);
    expect(DEFAULT_BRIDGE_ANCHOR_CM[2]).toBeGreaterThan(CANONICAL_LANDMARKS_CM.nasion[2]);
    expect(DEFAULT_BRIDGE_ANCHOR_CM[1]).toBeGreaterThan(2.5);
    expect(DEFAULT_BRIDGE_ANCHOR_CM[1]).toBeLessThan(CANONICAL_LANDMARKS_CM.nasion[1]);
  });
});

describe("mat4 helpers", () => {
  it("multiply applies the right-hand matrix first", () => {
    const m = multiply(translation([1, 0, 0]), uniformScale(2));
    close(transformPoint(m, [1, 1, 1]), [3, 2, 2]);
  });

  it("identity is neutral", () => {
    const t = translation([1, 2, 3]);
    close(multiply(identity(), t), t);
  });
});

describe("asset (m) -> face (cm) placement", () => {
  it("lands the asset origin exactly on the default bridge anchor", () => {
    close(transformPoint(assetToFaceMatrix(), [0, 0, 0]), DEFAULT_BRIDGE_ANCHOR_CM);
  });

  it("converts a 70 mm half-width in metres to 7 cm in face space, keeping axis direction", () => {
    const p = transformPoint(assetToFaceMatrix({ faceAnchorCm: [0, 0, 0] }), [0.07, 0, 0]);
    close(p, [7, 0, 0]);
  });

  it("respects a custom bridge point inside the asset", () => {
    const m = assetToFaceMatrix({ assetBridgeM: [0, 0.01, -0.002], faceAnchorCm: [0, 0, 0] });
    close(transformPoint(m, [0, 0.01, -0.002]), [0, 0, 0]);
    close(transformPoint(m, [0, 0.02, -0.002]), [0, 1, 0]);
  });

  it("puts a 140 mm frame's hinges about where the canonical temples are", () => {
    const m = assetToFaceMatrix();
    const leftHinge = transformPoint(m, [0.07, 0, 0]);
    // Hinges must be outside the eye corners and inside the face edge.
    expect(leftHinge[0]).toBeGreaterThan(CANONICAL_LANDMARKS_CM.leftEyeOuter[0]);
    expect(leftHinge[0]).toBeLessThan(CANONICAL_LANDMARKS_CM.leftFaceEdge[0]);
  });

  it("chains through MediaPipe's face->camera matrix", () => {
    // A face 50 cm in front of the camera, unrotated.
    const faceToCamera = translation([0, 0, -50]);
    const p = transformPoint(assetToCameraMatrix(faceToCamera), [0, 0, 0]);
    close(p, [DEFAULT_BRIDGE_ANCHOR_CM[0], DEFAULT_BRIDGE_ANCHOR_CM[1], DEFAULT_BRIDGE_ANCHOR_CM[2] - 50]);
  });
});
