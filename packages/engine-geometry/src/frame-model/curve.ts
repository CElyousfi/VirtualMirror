/** 2D closed-curve utilities for lens contours (mm). Pure functions. */

export type V2 = [number, number];

export function signedArea(pts: readonly V2[]): number {
  let a = 0;
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x * y2 - x2 * y;
  });
  return a / 2;
}

export const ensureCCW = (pts: readonly V2[]): V2[] => (signedArea(pts) < 0 ? [...pts].reverse() : [...pts]);

/** Closed Catmull-Rom interpolation through the input points. */
export function catmullRomClosed(pts: readonly V2[], perSegment = 8): V2[] {
  const n = pts.length;
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map(
        (c) => 0.5 * (2 * p1[c]! + (-p0[c]! + p2[c]!) * t + (2 * p0[c]! - 5 * p1[c]! + 4 * p2[c]! - p3[c]!) * t2 + (-p0[c]! + 3 * p1[c]! - 3 * p2[c]! + p3[c]!) * t3),
      ) as V2);
    }
  }
  return out;
}

/** Resample a closed polyline to `count` points evenly spaced by arc length. */
export function resampleClosed(pts: readonly V2[], count: number): V2[] {
  const n = pts.length;
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg.push(l);
    total += l;
  }
  const out: V2[] = [];
  let i = 0;
  let acc = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (acc + seg[i]! < target && i < n - 1) acc += seg[i++]!;
    const t = seg[i]! > 0 ? (target - acc) / seg[i]! : 0;
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Outward unit normals of a CCW closed curve (central differences). */
export function outwardNormals(pts: readonly V2[]): V2[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[(i + 1) % n]!;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    // For a counter-clockwise curve, rotating the tangent by -90 degrees points outward.
    return [ty / l, -tx / l] as V2;
  });
}

/** Prepare a contour for building: CCW, smooth, evenly resampled. */
export function prepareContour(raw: readonly V2[], count = 128): V2[] {
  return resampleClosed(catmullRomClosed(ensureCCW(raw), 8), count);
}

/**
 * Width at a contour point by region: blends top / bottom / temporal / nasal
 * widths by the point's direction from the lens centre (+x temporal).
 */
export function regionalWidth(p: V2, w: { top: number; bottom: number; temporal: number; nasal: number }): number {
  const ang = Math.atan2(p[1], p[0]);
  const s = Math.sin(ang);
  const c = Math.cos(ang);
  return w.top * Math.max(0, s) ** 2 + w.bottom * Math.max(0, -s) ** 2 + w.temporal * Math.max(0, c) ** 2 + w.nasal * Math.max(0, -c) ** 2;
}

/** A soft rectangle (superellipse) lens contour, for generic fixtures and tests. */
export function superellipse(a: number, b: number, exponent = 4, count = 64): V2[] {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / count) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return [(a / 2) * Math.sign(c) * Math.abs(c) ** (2 / exponent), (b / 2) * Math.sign(s) * Math.abs(s) ** (2 / exponent)] as V2;
  });
}
