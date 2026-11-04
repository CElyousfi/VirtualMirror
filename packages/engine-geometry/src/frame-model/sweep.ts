/**
 * Sweeps: a cross-section profile carried along a path. Rounded profiles give
 * real edge highlights instead of the flat faces of the old demo frame.
 */
import { cross, normalize, type MeshBuilder, type P3 } from "../mesh";
import type { V2 } from "./curve";

/**
 * Closed rounded-rectangle profile (width along local u, height along local v),
 * counter-clockwise when u is right and v up, centred on the origin.
 */
export function roundedRectProfile(width: number, height: number, radius: number, perCorner = 4): V2[] {
  const r = Math.max(0, Math.min(radius, width / 2 - 1e-6, height / 2 - 1e-6));
  const hw = width / 2 - r;
  const hh = height / 2 - r;
  const corners: [number, number, number][] = [
    [hw, hh, 0],
    [-hw, hh, Math.PI / 2],
    [-hw, -hh, Math.PI],
    [hw, -hh, (3 * Math.PI) / 2],
  ];
  const out: V2[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= perCorner; k++) {
      const a = a0 + (k / perCorner) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

/**
 * Quad grid between rows of points, closed across columns. Rows may be closed
 * (torus, e.g. a rim around a lens) or open (tube with end caps).
 * Triangles (i,j)->(i+1,j)->(i+1,j+1); `flip` reverses them. Which setting
 * faces outward depends on the caller's profile and path direction, so every
 * caller is covered by the closed-shell tests in frame-model.test.ts.
 */
export function addGrid(mb: MeshBuilder, rows: P3[][], closedRows: boolean, flip = false): void {
  const R = rows.length;
  const C = rows[0]!.length;
  const pts = rows.flat();
  const tris: [number, number, number][] = [];
  const idx = (i: number, j: number) => (i % R) * C + (j % C);
  const lastRow = closedRows ? R : R - 1;
  for (let i = 0; i < lastRow; i++) {
    for (let j = 0; j < C; j++) {
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i + 1, j + 1);
      const d = idx(i, j + 1);
      if (flip) tris.push([a, c, b], [a, d, c]);
      else tris.push([a, b, c], [a, c, d]);
    }
  }
  mb.addSurface(pts, tris);
}

/** Flat cap over a ring of points (fan from the centroid). */
export function addCap(mb: MeshBuilder, ring: P3[], flip: boolean): void {
  const c: P3 = [0, 1, 2].map((k) => ring.reduce((s, p) => s + p[k]!, 0) / ring.length) as P3;
  const pts = [c, ...ring];
  const tris: [number, number, number][] = ring.map((_, i) => {
    const a = 1 + i;
    const b = 1 + ((i + 1) % ring.length);
    return flip ? [0, b, a] : [0, a, b];
  });
  mb.addSurface(pts, tris);
}

/**
 * Rotation-minimising frames along a polyline (double reflection, Wang et al. 2008).
 * Returns per-point [tangent, normal, binormal].
 */
export function rmf(path: P3[], upHint: P3): [P3, P3, P3][] {
  const tan = (i: number): P3 => {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    return normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  };
  const t0 = tan(0);
  let r0 = normalize(cross(upHint, t0));
  if (!Number.isFinite(r0[0]) || Math.hypot(...r0) < 0.5) r0 = normalize(cross([1, 0, 0], t0));
  const frames: [P3, P3, P3][] = [[t0, r0, cross(t0, r0)]];
  for (let i = 0; i < path.length - 1; i++) {
    const [ti, ri] = frames[i]!;
    const xi = path[i]!;
    const xj = path[i + 1]!;
    const v1: P3 = [xj[0] - xi[0], xj[1] - xi[1], xj[2] - xi[2]];
    const c1 = v1[0] ** 2 + v1[1] ** 2 + v1[2] ** 2 || 1;
    const dotR = (v1[0] * ri[0] + v1[1] * ri[1] + v1[2] * ri[2]) * (2 / c1);
    const rL: P3 = [ri[0] - dotR * v1[0], ri[1] - dotR * v1[1], ri[2] - dotR * v1[2]];
    const dotT = (v1[0] * ti[0] + v1[1] * ti[1] + v1[2] * ti[2]) * (2 / c1);
    const tL: P3 = [ti[0] - dotT * v1[0], ti[1] - dotT * v1[1], ti[2] - dotT * v1[2]];
    const tj = tan(i + 1);
    const v2: P3 = [tj[0] - tL[0], tj[1] - tL[1], tj[2] - tL[2]];
    const c2 = v2[0] ** 2 + v2[1] ** 2 + v2[2] ** 2;
    let rj: P3 = rL;
    if (c2 > 1e-12) {
      const d2 = (v2[0] * rL[0] + v2[1] * rL[1] + v2[2] * rL[2]) * (2 / c2);
      rj = [rL[0] - d2 * v2[0], rL[1] - d2 * v2[1], rL[2] - d2 * v2[2]];
    }
    rj = normalize(rj);
    frames.push([tj, rj, cross(tj, rj)]);
  }
  return frames;
}

/**
 * Tube: a profile (u along the frame's normal, v along its binormal) swept
 * along an open path, with end caps. `profileAt(t)` may vary along the path
 * (tapering) but must keep the same point count.
 */
export function addTube(mb: MeshBuilder, path: P3[], profileAt: (t: number) => V2[], upHint: P3 = [0, 1, 0]): void {
  const frames = rmf(path, upHint);
  const rows: P3[][] = path.map((p, i) => {
    const [, n, b] = frames[i]!;
    const prof = profileAt(path.length > 1 ? i / (path.length - 1) : 0);
    return prof.map(([u, v]) => [p[0] + u * n[0] + v * b[0], p[1] + u * n[1] + v * b[1], p[2] + u * n[2] + v * b[2]] as P3);
  });
  // Orientation fixed by the shell tests (frame-model.test.ts): outward normals, positive volume.
  addGrid(mb, rows, false, true);
  addCap(mb, rows[0]!, true);
  addCap(mb, rows[rows.length - 1]!, false);
}

/** Polyline through control points with Catmull-Rom smoothing, sampled every `step` units. */
export function smoothPath(ctrl: P3[], step: number): P3[] {
  if (ctrl.length < 2) return ctrl;
  const pts: P3[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)]!;
    const p1 = ctrl[i]!;
    const p2 = ctrl[i + 1]!;
    const p3 = ctrl[Math.min(n - 1, i + 2)]!;
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s < k; s++) {
      const t = s / k;
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push([0, 1, 2].map(
        (c) => 0.5 * (2 * p1[c]! + (-p0[c]! + p2[c]!) * t + (2 * p0[c]! - 5 * p1[c]! + 4 * p2[c]! - p3[c]!) * t2 + (-p0[c]! + 3 * p1[c]! - 3 * p2[c]! + p3[c]!) * t3),
      ) as P3);
    }
  }
  pts.push(ctrl[n - 1]!);
  return pts;
}
