/**
 * Coordinate-space contract.
 *
 * Four spaces exist. Their axes are chosen so that only scale and translation
 * separate ASSET and FACE space: no rotation, no axis flip.
 *
 * 1. ASSET space (every GLB we store)
 *    - Units: metres.
 *    - +Y up, +Z forward (out of the frame front, toward a viewer facing the wearer),
 *      +X toward the WEARER'S LEFT. This is a right-handed glTF frame.
 *    - Origin: the bridge reference point = horizontal centre of the frame,
 *      vertically at the centre of the lens openings, on the back plane of the frame front.
 *    - The asset may override the origin with a node named `VM_Bridge`.
 *
 * 2. FACE space (MediaPipe canonical face model)
 *    - Units: centimetres.
 *    - +Y up, +Z out of the face toward the camera, +X toward the SUBJECT'S LEFT
 *      (canonical landmark 263, the left eye's outer corner, has x = +4.45).
 *    - Values below are copied from mediapipe/modules/face_geometry/data/canonical_face_model.obj
 *      (Apache-2.0), vertex index = landmark index.
 *
 * 3. CAMERA space (MediaPipe face-geometry metric camera)
 *    - Units: centimetres. Right-handed, camera at origin looking down -Z, +Y up.
 *    - The facial transformation matrix maps FACE space -> CAMERA space.
 *    - Projection: perspective, vertical FOV = FACE_GEOMETRY_CAMERA.verticalFovDeg.
 *      This value is MediaPipe's documented face-geometry environment default and
 *      MUST be confirmed on device (see docs/IMPLEMENTATION_STATUS.md).
 *
 * 4. SCREEN space: the rendered canvas. Mirroring for the "mirror" experience is
 *    applied as a CSS transform on the video and canvas together, never in 3D math.
 *
 * Matrices are 4x4, column-major, as flat arrays of 16 numbers (the same layout
 * MediaPipe returns in `facialTransformationMatrixes[i].data` and three.js
 * `Matrix4.fromArray` reads).
 */

import { ASSET_TO_FACE_SCALE } from "./units";

export type Vec3 = readonly [number, number, number];
export type Mat4 = readonly number[]; // length 16, column-major

/** Canonical face landmarks used for eyewear placement, in FACE space (cm). */
export const CANONICAL_LANDMARKS_CM = {
  /** 168: nasion, between the eyes on the nose bridge. */
  nasion: [0, 3.271027, 5.236015],
  /** 6: upper nose dorsum, just below the nasion. */
  noseDorsum: [0, 2.473255, 5.788627],
  /** 33: right eye outer corner (subject's right, so -X). */
  rightEyeOuter: [-4.445859, 2.663991, 3.173422],
  /** 263: left eye outer corner. */
  leftEyeOuter: [4.445859, 2.663991, 3.173422],
  /** 133: right eye inner corner. */
  rightEyeInner: [-1.856432, 2.585245, 3.757904],
  /** 362: left eye inner corner. */
  leftEyeInner: [1.856432, 2.585245, 3.757904],
  /** 234: right face edge near the ear. */
  rightFaceEdge: [-7.664182, 0.673132, -2.435867],
  /** 454: left face edge near the ear. */
  leftFaceEdge: [7.664182, 0.673132, -2.435867],
} as const satisfies Record<string, Vec3>;

export const FACE_GEOMETRY_CAMERA = {
  verticalFovDeg: 63,
  near: 1,
  far: 10000,
} as const;

/**
 * Where the asset's bridge reference point sits in FACE space.
 *
 * x: centred. y: eye-corner height (lens centres align with the eyes).
 * z: 0.8 cm in front of the nasion surface (frame front sits off the nose).
 *
 * These are INITIAL ESTIMATES derived from the canonical model, not measured
 * fits. Milestone 2 tunes them against physical frames on real faces.
 */
export const DEFAULT_BRIDGE_ANCHOR_CM: Vec3 = [
  0,
  (CANONICAL_LANDMARKS_CM.rightEyeOuter[1] + CANONICAL_LANDMARKS_CM.rightEyeInner[1]) / 2,
  CANONICAL_LANDMARKS_CM.nasion[2] + 0.8,
];

// ---------------------------------------------------------------- mat4 helpers

export const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function translation([x, y, z]: Vec3): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function uniformScale(s: number): number[] {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

/** Column-major product a * b (apply b first, then a). */
export function multiply(a: Mat4, b: Mat4): number[] {
  if (a.length !== 16 || b.length !== 16) throw new Error("mat4 must have 16 elements");
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function transformPoint(m: Mat4, [x, y, z]: Vec3): [number, number, number] {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}

export interface PlacementOptions {
  /** Asset-space position (metres) of the bridge reference point. Default origin. */
  assetBridgeM?: Vec3;
  /** Face-space position (cm) where the bridge reference point should land. */
  faceAnchorCm?: Vec3;
  /**
   * Extra uniform scale on top of unit conversion. 1 = physical size relative
   * to the canonical (average) face. Never a claim of physical fit.
   */
  fitScale?: number;
}

/**
 * ASSET (m) -> FACE (cm). Moves the bridge reference point to the origin,
 * converts metres to centimetres, then places it at the face anchor.
 */
export function assetToFaceMatrix(opts: PlacementOptions = {}): number[] {
  const bridge = opts.assetBridgeM ?? [0, 0, 0];
  const anchor = opts.faceAnchorCm ?? DEFAULT_BRIDGE_ANCHOR_CM;
  const s = ASSET_TO_FACE_SCALE * (opts.fitScale ?? 1);
  return multiply(
    translation(anchor),
    multiply(uniformScale(s), translation([-bridge[0], -bridge[1], -bridge[2]])),
  );
}

/** ASSET (m) -> CAMERA (cm), given MediaPipe's FACE -> CAMERA matrix. */
export function assetToCameraMatrix(faceToCamera: Mat4, opts: PlacementOptions = {}): number[] {
  return multiply(faceToCamera, assetToFaceMatrix(opts));
}
