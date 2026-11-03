import { describe, expect, it } from "vitest";
import { MeshBuilder, addFilledLoop, addRing, roundedRectLoop } from "./mesh";

/** Unit normal of each triangle, computed from winding (not from stored normals). */
function triangleNormals(m: ReturnType<MeshBuilder["build"]>) {
  const out: { n: [number, number, number]; c: [number, number, number] }[] = [];
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = m.indices[t + k]! * 3;
      return [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!] as const;
    });
    const u = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]];
    const v = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
    const n: [number, number, number] = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    out.push({
      n: [n[0] / len, n[1] / len, n[2] / len],
      c: [(p[0]![0] + p[1]![0] + p[2]![0]) / 3, (p[0]![1] + p[1]![1] + p[2]![1]) / 3, (p[0]![2] + p[1]![2] + p[2]![2]) / 3],
    });
  }
  return out;
}

describe("roundedRectLoop", () => {
  it("is counter-clockwise seen from +Z (positive signed area)", () => {
    const loop = roundedRectLoop(0, 0, 0.05, 0.04, 0.01);
    let area = 0;
    loop.forEach(([x, y], i) => {
      const [x2, y2] = loop[(i + 1) % loop.length]!;
      area += x * y2 - x2 * y;
    });
    expect(area).toBeGreaterThan(0);
  });
});

describe("addRing winding", () => {
  const outer = roundedRectLoop(0, 0, 0.06, 0.05, 0.012);
  const inner = roundedRectLoop(0, 0, 0.05, 0.04, 0.008);
  const mb = new MeshBuilder();
  addRing(mb, outer, inner, 0, 0.004);
  const tris = triangleNormals(mb.build());

  it("front face points +Z and back face points -Z", () => {
    const front = tris.filter((t) => Math.abs(t.c[2] - 0.004) < 1e-9);
    const back = tris.filter((t) => Math.abs(t.c[2]) < 1e-9);
    expect(front.length).toBeGreaterThan(0);
    expect(front.every((t) => t.n[2] > 0.99)).toBe(true);
    expect(back.every((t) => t.n[2] < -0.99)).toBe(true);
  });

  it("outer wall faces away from the centre, inner wall faces into the opening", () => {
    const walls = tris.filter((t) => Math.abs(t.n[2]) < 0.01);
    const radial = (t: (typeof walls)[number]) => t.n[0] * t.c[0] + t.n[1] * t.c[1];
    const outerWall = walls.filter((t) => Math.abs(t.c[0]) > 0.0275 || Math.abs(t.c[1]) > 0.0225);
    const innerWall = walls.filter((t) => Math.abs(t.c[0]) < 0.0255 && Math.abs(t.c[1]) < 0.0205);
    expect(outerWall.length).toBeGreaterThan(0);
    expect(innerWall.length).toBeGreaterThan(0);
    expect(outerWall.every((t) => radial(t) > 0)).toBe(true);
    expect(innerWall.every((t) => radial(t) < 0)).toBe(true);
  });
});

describe("addBox and addFilledLoop winding", () => {
  it("box faces point outward", () => {
    const mb = new MeshBuilder();
    mb.addBox([-1, -1, -1], [1, 1, 1]);
    const tris = triangleNormals(mb.build());
    expect(tris).toHaveLength(12);
    expect(tris.every((t) => t.n[0] * t.c[0] + t.n[1] * t.c[1] + t.n[2] * t.c[2] > 0)).toBe(true);
  });

  it("a filled lens faces +Z", () => {
    const mb = new MeshBuilder();
    addFilledLoop(mb, roundedRectLoop(0, 0, 0.05, 0.04, 0.01), 0.002);
    expect(triangleNormals(mb.build()).every((t) => t.n[2] > 0.99)).toBe(true);
  });
});
