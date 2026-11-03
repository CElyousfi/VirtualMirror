/**
 * Face pose handling: matrix layout detection, decomposition into
 * translation / rotation / uniform scale, and temporal smoothing.
 * Pure TypeScript (no three.js) so it is unit-testable in Node.
 */

import { OneEuroFilter, type OneEuroParams } from "./one-euro";

export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface Pose {
  position: V3;
  rotation: Quat;
  scale: number;
}

/**
 * Return the matrix in column-major order. MediaPipe's JS type does not
 * document the layout, so detect it: in a rigid (+scale) transform the
 * translation sits at indices 12-14 in column-major and 3,7,11 in row-major,
 * and the face is always tens of centimetres in front of the camera (|tz| > 1).
 */
export function toColumnMajor(data: readonly number[]): number[] {
  if (data.length !== 16) throw new Error(`Expected 16 matrix values, got ${data.length}`);
  const colMajorTranslation = Math.abs(data[12]!) + Math.abs(data[13]!) + Math.abs(data[14]!);
  const rowMajorTranslation = Math.abs(data[3]!) + Math.abs(data[7]!) + Math.abs(data[11]!);
  if (rowMajorTranslation > 1 && colMajorTranslation < 1e-6) {
    const t: number[] = new Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) t[c * 4 + r] = data[r * 4 + c]!;
    return t;
  }
  return [...data];
}

export function decompose(m: readonly number[]): Pose {
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!);
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const s = (sx + sy + sz) / 3;
  // Rotation matrix elements (column-major, scale removed).
  const r00 = m[0]! / sx, r10 = m[1]! / sx, r20 = m[2]! / sx;
  const r01 = m[4]! / sy, r11 = m[5]! / sy, r21 = m[6]! / sy;
  const r02 = m[8]! / sz, r12 = m[9]! / sz, r22 = m[10]! / sz;
  const trace = r00 + r11 + r22;
  let q: Quat;
  if (trace > 0) {
    const k = 0.5 / Math.sqrt(trace + 1);
    q = [(r21 - r12) * k, (r02 - r20) * k, (r10 - r01) * k, 0.25 / k];
  } else if (r00 > r11 && r00 > r22) {
    const k = 2 * Math.sqrt(1 + r00 - r11 - r22);
    q = [0.25 * k, (r01 + r10) / k, (r02 + r20) / k, (r21 - r12) / k];
  } else if (r11 > r22) {
    const k = 2 * Math.sqrt(1 + r11 - r00 - r22);
    q = [(r01 + r10) / k, 0.25 * k, (r12 + r21) / k, (r02 - r20) / k];
  } else {
    const k = 2 * Math.sqrt(1 + r22 - r00 - r11);
    q = [(r02 + r20) / k, (r12 + r21) / k, 0.25 * k, (r10 - r01) / k];
  }
  return { position: [m[12]!, m[13]!, m[14]!], rotation: normalise(q), scale: s };
}

export function compose(p: Pose): number[] {
  const [x, y, z, w] = p.rotation;
  const s = p.scale;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s, 2 * (xy + wz) * s, 2 * (xz - wy) * s, 0,
    2 * (xy - wz) * s, (1 - 2 * (xx + zz)) * s, 2 * (yz + wx) * s, 0,
    2 * (xz + wy) * s, 2 * (yz - wx) * s, (1 - 2 * (xx + yy)) * s, 0,
    p.position[0], p.position[1], p.position[2], 1,
  ];
}

function normalise(q: Quat): Quat {
  const n = Math.hypot(...q) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    return normalise([a[0] + t * (bx - a[0]), a[1] + t * (by - a[1]), a[2] + t * (bz - a[2]), a[3] + t * (bw - a[3])]);
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

export const angleBetween = (a: Quat, b: Quat) =>
  2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));

export interface SmootherParams {
  position: OneEuroParams;
  rotation: OneEuroParams;
  scale: OneEuroParams;
  /** Keep showing the last pose for this long after tracking is lost. */
  holdMs: number;
}

export const DEFAULT_SMOOTHER: SmootherParams = {
  position: { minCutoff: 1.5, beta: 0.05, dCutoff: 1 },
  rotation: { minCutoff: 1.5, beta: 0.5, dCutoff: 1 },
  scale: { minCutoff: 0.5, beta: 0.01, dCutoff: 1 },
  holdMs: 250,
};

/**
 * Smooths face poses. Position and scale use per-axis One Euro filters;
 * rotation uses slerp with a One Euro speed-adaptive factor.
 */
export class PoseSmoother {
  private pos: OneEuroFilter[];
  private scl: OneEuroFilter;
  private rotFilter: OneEuroFilter;
  private rot: Quat | null = null;
  private lastT: number | null = null;
  private last: Pose | null = null;
  private lastSeenT = -Infinity;

  constructor(private readonly p: SmootherParams = DEFAULT_SMOOTHER) {
    this.pos = [0, 1, 2].map(() => new OneEuroFilter(p.position));
    this.scl = new OneEuroFilter(p.scale);
    this.rotFilter = new OneEuroFilter(p.rotation);
  }

  update(raw: Pose, timeMs: number): Pose {
    const position = raw.position.map((v, i) => this.pos[i]!.filter(v, timeMs)) as V3;
    const scale = this.scl.filter(raw.scale, timeMs);
    let rotation: Quat;
    if (!this.rot || this.lastT === null) {
      rotation = raw.rotation;
    } else {
      const dt = Math.max((timeMs - this.lastT) / 1000, 1e-3);
      const speed = angleBetween(this.rot, raw.rotation) / dt;
      rotation = slerp(this.rot, raw.rotation, this.rotFilter.alphaFor(speed, dt));
    }
    this.rot = rotation;
    this.lastT = timeMs;
    this.lastSeenT = timeMs;
    this.last = { position, rotation, scale };
    return this.last;
  }

  /** Call when no face was found. Returns the held pose, or null once the hold expires. */
  miss(timeMs: number): Pose | null {
    if (timeMs - this.lastSeenT <= this.p.holdMs) return this.last;
    this.reset();
    return null;
  }

  reset(): void {
    this.pos.forEach((f) => f.reset());
    this.scl.reset();
    this.rotFilter.reset();
    this.rot = null;
    this.lastT = null;
    this.last = null;
  }
}
