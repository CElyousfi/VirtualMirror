/**
 * Tiny runtime-neutral mesh builder. Surfaces are added separately so that
 * normals are smooth within a surface and hard between surfaces (e.g. the
 * flat front face of a rim vs its curved outer wall).
 */

export type P3 = [number, number, number];

export interface MeshData {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private idx: number[] = [];

  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /** Add an indexed surface; normals are accumulated per vertex then normalised. */
  addSurface(points: P3[], triangles: [number, number, number][]): void {
    const base = this.pos.length / 3;
    const acc: P3[] = points.map(() => [0, 0, 0]);
    for (const [a, b, c] of triangles) {
      const pa = points[a]!, pb = points[b]!, pc = points[c]!;
      const u: P3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v: P3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n: P3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (const i of [a, b, c]) {
        acc[i]![0] += n[0];
        acc[i]![1] += n[1];
        acc[i]![2] += n[2];
      }
      this.idx.push(base + a, base + b, base + c);
    }
    points.forEach((p, i) => {
      const n = acc[i]!;
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0] / len, n[1] / len, n[2] / len);
    });
  }

  /** Axis-aligned box from min to max corners, hard edges. */
  addBox(min: P3, max: P3): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const faces: P3[][] = [
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // +X
      [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]], // -X
      [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], // +Y
      [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], // -Y
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // +Z
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], // -Z
    ];
    for (const f of faces) this.addSurface(f, [[0, 1, 2], [0, 2, 3]]);
  }

  /**
   * Box with arbitrary orientation. `axes` must be a right-handed orthonormal
   * basis (x cross y = z) so face winding stays outward.
   */
  addOrientedBox(center: P3, axes: [P3, P3, P3], half: P3): void {
    const at = (sx: number, sy: number, sz: number): P3 => [0, 1, 2].map(
      (k) => center[k]! + sx * half[0] * axes[0][k]! + sy * half[1] * axes[1][k]! + sz * half[2] * axes[2][k]!,
    ) as P3;
    const faces: P3[][] = [
      [at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1)],
      [at(-1, -1, 1), at(-1, 1, 1), at(-1, 1, -1), at(-1, -1, -1)],
      [at(-1, 1, -1), at(-1, 1, 1), at(1, 1, 1), at(1, 1, -1)],
      [at(-1, -1, 1), at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1)],
      [at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)],
      [at(1, -1, -1), at(-1, -1, -1), at(-1, 1, -1), at(1, 1, -1)],
    ];
    for (const f of faces) this.addSurface(f, [[0, 1, 2], [0, 2, 3]]);
  }

  /** A beam of rectangular section from p0 to p1, keeping its height axis near world +Y. */
  addBeam(p0: P3, p1: P3, width: number, height: number): void {
    const d = normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const up0: P3 = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const x = normalize(cross(up0, d));
    const y = cross(d, x);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const c: P3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    this.addOrientedBox(c, [x, y, d], [width / 2, height / 2, len / 2]);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      indices: new Uint32Array(this.idx),
    };
  }
}

/** Closed rounded-rectangle loop, counter-clockwise seen from +Z, `perCorner` points per corner. */
export function roundedRectLoop(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
  perCorner = 8,
): [number, number][] {
  const rr = Math.min(r, w / 2, h / 2);
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
    [cx + w / 2 - rr, cy - h / 2 + rr, (3 * Math.PI) / 2],
  ];
  const out: [number, number][] = [];
  for (const [ox, oy, start] of corners) {
    for (let i = 0; i < perCorner; i++) {
      const a = start + (i / (perCorner - 1)) * (Math.PI / 2);
      out.push([ox + rr * Math.cos(a), oy + rr * Math.sin(a)]);
    }
  }
  return out;
}

/**
 * Extrude the region between an outer and inner loop (same point count) from
 * z0 to z1: a rim. Produces front, back, outer wall and inner wall surfaces.
 */
export function addRing(
  mb: MeshBuilder,
  outer: [number, number][],
  inner: [number, number][],
  z0: number,
  z1: number,
): void {
  const n = outer.length;
  if (inner.length !== n) throw new Error("ring loops must have equal point counts");
  const quadStrip = (a: P3[], b: P3[], flip: boolean) => {
    const pts = [...a, ...b];
    const tris: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const t1: [number, number, number] = [i, j, n + j];
      const t2: [number, number, number] = [i, n + j, n + i];
      tris.push(flip ? [t1[0], t1[2], t1[1]] : t1, flip ? [t2[0], t2[2], t2[1]] : t2);
    }
    mb.addSurface(pts, tris);
  };
  const at = (loop: [number, number][], z: number): P3[] => loop.map(([x, y]) => [x, y, z]);
  // Loops are counter-clockwise seen from +Z, so (outer_i, outer_i+1, inner_i+1)
  // winds counter-clockwise and faces +Z. Verified by mesh.test.ts.
  quadStrip(at(outer, z1), at(inner, z1), false); // front face (+Z)
  quadStrip(at(outer, z0), at(inner, z0), true); // back face (-Z)
  quadStrip(at(outer, z0), at(outer, z1), false); // outer wall, faces outward
  quadStrip(at(inner, z0), at(inner, z1), true); // inner wall, faces into the lens opening
}

/** Flat filled loop at depth z (a lens), facing +Z. Fan triangulation; loop must be convex. */
export function addFilledLoop(mb: MeshBuilder, loop: [number, number][], z: number): void {
  const pts: P3[] = [[0, 0, z], ...loop.map(([x, y]) => [x, y, z] as P3)];
  const cx = loop.reduce((s, p) => s + p[0], 0) / loop.length;
  const cy = loop.reduce((s, p) => s + p[1], 0) / loop.length;
  pts[0] = [cx, cy, z];
  const tris: [number, number, number][] = [];
  for (let i = 0; i < loop.length; i++) tris.push([0, 1 + i, 1 + ((i + 1) % loop.length)]);
  mb.addSurface(pts, tris);
}

export function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: P3): P3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
