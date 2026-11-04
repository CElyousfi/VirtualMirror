import { describe, expect, it } from "vitest";
import type { Clearcoat, Specular } from "@gltf-transform/extensions";
import { CANONICAL_LANDMARKS_CM, DEFAULT_BRIDGE_ANCHOR_CM, contourBox, type FrameModelInput } from "@vm/contracts";
import type { MeshData } from "../mesh";
import { inspectDocument, readGlb, rescaleToMetres } from "../glb-inspect";
import { buildFrameParts } from "./build";
import { buildFrameModelGlb } from "./export";
import { GENERIC_ACETATE_FRAME } from "./fixtures";
import { prepareContour, signedArea, superellipse } from "./curve";

/**
 * Split a mesh into shells (triangles connected through vertices at the same
 * position) and report, per shell, its signed volume and how many edges are
 * not shared by exactly two triangles with opposite directions (open or
 * inconsistently wound). A closed, consistently wound shell with outward
 * normals has zero such edges and positive volume.
 */
function shells(m: MeshData) {
  const key = (i: number) => `${Math.round(m.positions[3 * i]! * 1e4)},${Math.round(m.positions[3 * i + 1]! * 1e4)},${Math.round(m.positions[3 * i + 2]! * 1e4)}`;
  const weld = new Map<string, number>();
  const vid: number[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const k = key(i);
    if (!weld.has(k)) weld.set(k, weld.size);
    vid.push(weld.get(k)!);
  }
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const tris: [number, number, number, number][] = []; // welded a,b,c + original first index
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [vid[m.indices[t]!]!, vid[m.indices[t + 1]!]!, vid[m.indices[t + 2]!]!];
    if (a === b || b === c || a === c) continue; // degenerate
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
    tris.push([a, b, c, t]);
  }
  const out = new Map<number, { volume: number; edges: Map<string, number>; tris: number }>();
  for (const [a, b, c, t] of tris) {
    const r = find(a);
    if (!out.has(r)) out.set(r, { volume: 0, edges: new Map(), tris: 0 });
    const s = out.get(r)!;
    const P = (k: number) => [m.positions[3 * m.indices[t + k]!]!, m.positions[3 * m.indices[t + k]! + 1]!, m.positions[3 * m.indices[t + k]! + 2]!];
    const [p, q, w] = [P(0), P(1), P(2)];
    s.volume += (p[0]! * (q[1]! * w[2]! - q[2]! * w[1]!) - p[1]! * (q[0]! * w[2]! - q[2]! * w[0]!) + p[2]! * (q[0]! * w[1]! - q[1]! * w[0]!)) / 6;
    s.tris++;
    // Directed edges: in a closed, consistently wound shell each edge u->v
    // appears exactly once and is matched by exactly one v->u.
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const e = u < v ? `${u}-${v}` : `${v}-${u}`;
      s.edges.set(e, (s.edges.get(e) ?? 0) + (u < v ? 1 : 1000));
    }
  }
  return [...out.values()].map((s) => ({ volume: s.volume, tris: s.tris, openEdges: [...s.edges.values()].filter((n) => n !== 1001).length }));
}

const flat = (over: Partial<FrameModelInput> = {}): FrameModelInput => ({
  ...GENERIC_ACETATE_FRAME,
  wrapDeg: 0,
  lens: { ...GENERIC_ACETATE_FRAME.lens, baseCurve: 0 },
  ...over,
});

function extent(m: MeshData, axis: 0 | 1 | 2, filter: (x: number, y: number, z: number) => boolean = () => true) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    const [x, y, z] = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
    if (!filter(x, y, z)) continue;
    const v = m.positions[i + axis]!;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { lo, hi, size: hi - lo };
}

describe("contour preparation", () => {
  it("makes contours counter-clockwise and evenly resampled", () => {
    const cw = [...superellipse(50, 40, 4, 40)].reverse();
    const c = prepareContour(cw, 64);
    expect(c).toHaveLength(64);
    expect(signedArea(c)).toBeGreaterThan(0);
    const box = contourBox(c);
    expect(box.a).toBeCloseTo(50, 0);
    expect(box.b).toBeCloseTo(40, 0);
  });
});

describe("buildFrameParts: closed, outward-facing shells", () => {
  const parts = buildFrameParts(GENERIC_ACETATE_FRAME);
  for (const name of ["front", "temples", "hinges", "lenses"] as const) {
    it(`${name}: every shell is closed and has positive volume`, () => {
      const list = shells(parts[name]);
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) {
        expect(s.openEdges, `${name} shell with ${s.tris} tris`).toBe(0);
        expect(s.volume, `${name} shell with ${s.tris} tris`).toBeGreaterThan(0);
      }
    });
  }

  it("has the expected number of shells per part", () => {
    expect(shells(parts.front)).toHaveLength(2 /* rims */ + 2 /* end pieces */ + 1 /* bridge */);
    expect(shells(parts.temples)).toHaveLength(2);
    expect(shells(parts.hinges)).toHaveLength(2 * 3);
    expect(shells(parts.lenses)).toHaveLength(2);
  });

  it("is left/right symmetric when no right contour is given", () => {
    for (const name of ["front", "temples", "lenses"] as const) {
      const x = extent(parts[name], 0);
      expect(x.lo).toBeCloseTo(-x.hi, 6);
    }
  });
});

describe("buildFrameParts: dimensions (flat lenses, no wrap)", () => {
  const p = buildFrameParts(flat());
  const box = contourBox(prepareContour(GENERIC_ACETATE_FRAME.lens.contour as [number, number][], 144));

  it("puts the rims exactly DBL apart", () => {
    expect(Math.abs(p.measured.bridgeWidth - 18)).toBeLessThan(0.1);
  });

  it("sizes the lens to the opening plus the groove on each side", () => {
    const left = (x: number) => x > 0;
    const w = extent(p.lenses, 0, left).size;
    const h = extent(p.lenses, 1, left).size;
    expect(Math.abs(w - (box.a + 1.4))).toBeLessThan(0.1);
    expect(Math.abs(h - (box.b + 1.4))).toBeLessThan(0.1);
  });

  it("keeps the lens inside the rim's depth and inside the rim's outer edge", () => {
    const lz = extent(p.lenses, 2);
    const fz = extent(p.front, 2, (x) => Math.abs(x) > 12 && Math.abs(x) < 60);
    expect(lz.lo).toBeGreaterThan(fz.lo);
    expect(lz.hi).toBeLessThan(fz.hi);
    const lensLeft = extent(p.lenses, 0, (x) => x > 0);
    const rimLeft = extent(p.front, 0, (x, _y, z) => x > 0 && z > 0.5);
    expect(lensLeft.hi).toBeLessThan(rimLeft.hi);
  });

  it("measures the lens box, DBL and temple length from the build", () => {
    expect(p.measured.lensWidth).toBeCloseTo(box.a, 6);
    expect(p.measured.lensHeight).toBeCloseTo(box.b, 6);
    expect(Math.abs(p.measured.templeLength - 145)).toBeLessThan(3);
  });
});

describe("buildFrameParts: fit on the canonical head", () => {
  const p = buildFrameParts(GENERIC_ACETATE_FRAME);
  // Canonical landmarks relative to the bridge anchor, in mm.
  const edge = CANONICAL_LANDMARKS_CM.leftFaceEdge.map((v, i) => (v - DEFAULT_BRIDGE_ANCHOR_CM[i]!) * 10);

  it("keeps the left temple outside the face edge from the face-edge depth backwards", () => {
    const inner = extent(p.temples, 0, (x, _y, z) => x > 0 && z < edge[2]! && z > edge[2]! - 40);
    expect(inner.lo).toBeGreaterThan(edge[0]!);
  });

  it("reaches back past the face edge", () => {
    expect(p.anchorsMm.templeTipL[2]).toBeLessThan(edge[2]! - 50);
  });
});

describe("buildFrameModelGlb", () => {
  it("exports metres, anchors, clear coat and stays within budget", async () => {
    const res = await buildFrameModelGlb(GENERIC_ACETATE_FRAME);
    expect(res.triangleCount).toBeLessThanOrEqual(60_000);
    expect(res.glb.byteLength).toBeLessThanOrEqual(1.5 * 1024 * 1024);
    const doc = await readGlb(res.glb);
    const info = inspectDocument(doc, res.glb.byteLength);
    expect(info.unit).toBe("metres");
    // The generic inspector only looks at a 12 mm slab behind the frontmost
    // point, so on a wrapped frame it misses the swept-back end pieces. For
    // FrameModel assets the builder's own measurement is authoritative.
    expect(info.frontWidth).toBeLessThanOrEqual(res.frameWidthM + 1e-6);
    expect(res.frameWidthM - info.frontWidth).toBeLessThan(0.006);
    expect(res.frameWidthM).toBeGreaterThan(0.13);
    expect(res.frameWidthM).toBeLessThan(0.16);
    const names = doc.getRoot().listNodes().map((n) => n.getName());
    for (const n of ["VM_Bridge", "VM_NoseContact", "VM_Hinge_L", "VM_Hinge_R", "VM_TempleTip_L", "VM_TempleTip_R"]) expect(names).toContain(n);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain("KHR_materials_clearcoat");
    const extras = doc.getRoot().listNodes().find((n) => n.getName() === "VM_Frame")!.getExtras() as { vm: { provenance: string } };
    expect(extras.vm.provenance).toBe("generic");
  });
});

describe("acetate materials have a single reflecting interface", () => {
  it("turns off the base specular lobe under an acetate clear coat", async () => {
    const res = await buildFrameModelGlb(GENERIC_ACETATE_FRAME);
    const doc = await readGlb(res.glb);
    const front = doc.getRoot().listMaterials().find((m) => m.getName() === "VM_Front")!;
    expect(front.getExtension<Clearcoat>("KHR_materials_clearcoat")?.getClearcoatFactor()).toBe(1);
    expect(front.getExtension<Specular>("KHR_materials_specular")?.getSpecularFactor()).toBe(0);
  });

  it("leaves metal hinges as plain metal", async () => {
    const doc = await readGlb((await buildFrameModelGlb(GENERIC_ACETATE_FRAME)).glb);
    const hinge = doc.getRoot().listMaterials().find((m) => m.getName() === "VM_Hinge")!;
    expect(hinge.getMetallicFactor()).toBe(1);
    expect(hinge.getExtension("KHR_materials_specular")).toBeNull();
  });
});

describe("merchant GLB round trip keeps material extensions", () => {
  it("keeps KHR_materials_clearcoat through a unit fix", async () => {
    const res = await buildFrameModelGlb(GENERIC_ACETATE_FRAME);
    const fixed = await rescaleToMetres(await readGlb(res.glb), 1);
    const doc = await readGlb(fixed);
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain("KHR_materials_clearcoat");
  });
});
