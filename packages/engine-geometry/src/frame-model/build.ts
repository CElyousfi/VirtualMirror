/**
 * FrameModel -> geometry. Works in millimetres in frame space (ASSET axes:
 * +X wearer's left, +Y up, +Z forward; origin at the bridge reference point),
 * converted to metres only when exporting.
 */
import { FrameModelSchema, contourBox, type FrameModel, type FrameModelInput } from "@vm/contracts";
import { MeshBuilder, type MeshData, type P3 } from "../mesh";
import { outwardNormals, prepareContour, regionalWidth, type V2 } from "./curve";
import { addCap, addGrid, addTube, smoothPath } from "./sweep";

const CONTOUR_SAMPLES = 144;
const LENS_RINGS = 8;
const GROOVE_MM = 0.7; // how far the lens edge sits inside the rim

/** Rounded rectangle with a radius per corner: [outer-front, inner-front, inner-back, outer-back]. CCW. */
export function rimProfile(width: number, depth: number, rFront: number, rBack: number, perCorner = 5): V2[] {
  const clamp = (r: number) => Math.max(0, Math.min(r, width / 2 - 1e-3, depth / 2 - 1e-3));
  const rf = clamp(rFront);
  const rb = clamp(rBack);
  const hw = width / 2;
  const hd = depth / 2;
  const corners: [number, number, number, number][] = [
    [hw - rf, hd - rf, rf, 0],
    [-hw + rf, hd - rf, rf, Math.PI / 2],
    [-hw + rb, -hd + rb, rb, Math.PI],
    [hw - rb, -hd + rb, rb, (3 * Math.PI) / 2],
  ];
  const out: V2[] = [];
  for (const [cx, cy, r, a0] of corners) {
    for (let k = 0; k <= perCorner; k++) {
      const a = a0 + (k / perCorner) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

export interface FrameParts {
  front: MeshData;
  temples: MeshData;
  hinges: MeshData;
  lenses: MeshData;
  anchorsMm: {
    bridge: P3;
    noseContact: P3;
    hingeL: P3;
    hingeR: P3;
    templeTipL: P3;
    templeTipR: P3;
  };
  /** Measured from the built geometry, mm. */
  measured: { lensWidth: number; lensHeight: number; bridgeWidth: number; frontWidth: number; templeLength: number };
  triangleCount: number;
  model: FrameModel;
}

export function buildFrameParts(input: FrameModelInput): FrameParts {
  const model = FrameModelSchema.parse(input);
  const raw = prepareContour(model.lens.contour as V2[], CONTOUR_SAMPLES);
  const box = contourBox(raw);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const contour: V2[] = raw.map(([x, y]) => [x - cx, y - cy]);
  const normals = outwardNormals(contour);
  const A = box.a;
  const B = box.b;
  const DBL = model.bridgeWidth;
  const D = model.rim.depth;
  const wrap = (model.wrapDeg * Math.PI) / 180;
  const R = model.lens.baseCurve > 0 ? 530 / model.lens.baseCurve : Infinity;
  const sag = (x: number, y: number) => (Number.isFinite(R) ? (x * x + y * y) / (2 * R) : 0);

  /** Lens-local (mm) -> frame space (mm) for side s: +1 wearer's left, -1 right. */
  const toFrame = (s: 1 | -1, [x, y, z]: P3): P3 => {
    const zc = z - sag(x, y);
    const d = A / 2 + x; // distance from the nasal pivot along the lens plane
    const d2 = d * Math.cos(wrap) + zc * Math.sin(wrap);
    const z2 = -d * Math.sin(wrap) + zc * Math.cos(wrap);
    return [s * (DBL / 2 + d2), y, z2];
  };

  const front = new MeshBuilder();
  const templesMb = new MeshBuilder();
  const hingesMb = new MeshBuilder();
  const lensesMb = new MeshBuilder();

  const widths = contour.map((p) => regionalWidth(p, model.rim.faceWidth));
  const rightRaw = model.lens.rightContour ? prepareContour(model.lens.rightContour as V2[], CONTOUR_SAMPLES) : null;

  const anchors: Partial<FrameParts["anchorsMm"]> = {};
  let templeLengthMeasured = 0;
  let openingMinAbsX = Infinity; // nasal edge of the lens opening

  for (const s of [1, -1] as const) {
    // Right lens: mirror of the left unless its own contour is given (then in the same lens-local convention).
    const C: V2[] = s === -1 && rightRaw ? rightRaw.map(([x, y]) => [x - cx, y - cy]) : contour;
    const N = s === -1 && rightRaw ? outwardNormals(C) : normals;
    const W = s === -1 && rightRaw ? C.map((p) => regionalWidth(p, model.rim.faceWidth)) : widths;
    const flip = s === -1; // mirroring reverses handedness

    // ---- Rim: rounded profile swept around the lens opening.
    const rows: P3[][] = C.map((p, i) => {
      const prof = rimProfile(W[i]!, D, model.rim.frontEdgeRadius, model.rim.backEdgeRadius);
      return prof.map(([u, v]) => {
        const sOff = u + W[i]! / 2; // 0 at the lens opening, W at the outer edge
        const q = toFrame(s, [p[0] + sOff * N[i]![0], p[1] + sOff * N[i]![1], v + D / 2]);
        if (sOff < 1e-9) openingMinAbsX = Math.min(openingMinAbsX, Math.abs(q[0]));
        return q;
      });
    });
    addGrid(front, rows, true, flip);

    // ---- Lens: curved shell, edge tucked into the rim groove.
    const zFront = D * 0.62;
    const t = model.lens.centerThickness;
    const edge = C.map((p, i) => [p[0] + GROOVE_MM * N[i]![0], p[1] + GROOVE_MM * N[i]![1]] as V2);
    const ring = (k: number, z: number) => edge.map(([x, y]) => toFrame(s, [(x * k) / LENS_RINGS, (y * k) / LENS_RINGS, z]));
    const frontRings = Array.from({ length: LENS_RINGS }, (_, k) => ring(k + 1, zFront));
    const backRings = Array.from({ length: LENS_RINGS }, (_, k) => ring(k + 1, zFront - t));
    addGrid(lensesMb, frontRings, false, flip);
    addCap(lensesMb, frontRings[0]!, flip);
    addGrid(lensesMb, backRings, false, !flip);
    addCap(lensesMb, backRings[0]!, !flip);
    addGrid(lensesMb, [frontRings[LENS_RINGS - 1]!, backRings[LENS_RINGS - 1]!], false, flip);

    // ---- End piece: from inside the rim at hinge height, out and back to the hinge.
    const hy = model.endpiece.hingeHeight;
    let ti = 0;
    let best = Infinity;
    C.forEach((p, i) => {
      if (p[0] <= A / 4) return;
      const d = Math.abs(p[1] - hy);
      if (d < best) (best = d), (ti = i);
    });
    const tp = C[ti]!;
    const tn = N[ti]!;
    const wT = W[ti]!;
    const e0 = toFrame(s, [tp[0] + (wT - 1.2) * tn[0], hy, D / 2]);
    const e1 = toFrame(s, [tp[0] + wT + model.endpiece.length * 0.7, hy, D / 2]);
    const e1b = toFrame(s, [tp[0] + wT + model.endpiece.length, hy, D * 0.1]);
    const hinge: P3 = [e1b[0], hy, e1b[2] - model.endpiece.hingeBack + D * 0.1];
    const endPath = smoothPath([e0, e1, e1b, hinge], 0.8);
    const endDepth = D * 0.95;
    addTube(front, endPath, () => rimProfile(endDepth, model.endpiece.height, model.rim.frontEdgeRadius, model.rim.backEdgeRadius, 3), [0, 1, 0]);

    // ---- Hinge knuckles: short vertical metal cylinders at the hinge.
    const kn = model.hinge.knuckles;
    const r = model.hinge.barrelRadius;
    const span = model.endpiece.height * 0.85;
    const gap = 0.35;
    const kLen = (span - gap * (kn - 1)) / kn;
    const hingeAxis: P3 = [hinge[0] + s * r * 0.6, hinge[1], hinge[2] - r * 0.5];
    for (let k = 0; k < kn; k++) {
      const y0 = hy - span / 2 + k * (kLen + gap);
      const kPath: P3[] = [0, 0.5, 1].map((q) => [hingeAxis[0], y0 + q * kLen, hingeAxis[2]]);
      addTube(hingesMb, kPath, () => rimProfile(2 * r, 2 * r, r, r, 4), [1, 0, 0]);
    }

    // ---- Temple: straight, then an ear bend, then the tip, tapering.
    const T = model.temples;
    const sp = (T.splayDeg * Math.PI) / 180;
    const dir: P3 = [s * Math.sin(sp), 0, -Math.cos(sp)];
    const start: P3 = [hingeAxis[0] + s * r * 0.4, hy, hingeAxis[2]];
    const bendStart: P3 = [start[0] + dir[0] * T.bendAt, start[1], start[2] + dir[2] * T.bendAt];
    const BR = 22; // ear-bend radius, mm
    const drop = (T.dropDeg * Math.PI) / 180;
    const arcPts: P3[] = [];
    const steps = 12;
    for (let k = 1; k <= steps; k++) {
      const phi = (k / steps) * drop;
      arcPts.push([
        bendStart[0] + dir[0] * BR * Math.sin(phi),
        bendStart[1] - BR * (1 - Math.cos(phi)),
        bendStart[2] + dir[2] * BR * Math.sin(phi),
      ]);
    }
    const arcLen = BR * drop;
    const rest = Math.max(0, T.length - T.bendAt - arcLen);
    const dFinal: P3 = [dir[0] * Math.cos(drop), -Math.sin(drop), dir[2] * Math.cos(drop)];
    const last = arcPts[arcPts.length - 1] ?? bendStart;
    const tip: P3 = [last[0] + dFinal[0] * rest, last[1] + dFinal[1] * rest, last[2] + dFinal[2] * rest];
    const templePath = smoothPath([start, [start[0] + dir[0] * T.bendAt * 0.5, start[1], start[2] + dir[2] * T.bendAt * 0.5], bendStart, ...arcPts, tip], 1.5);
    const lerp = (a: number, b: number, q: number) => a + (b - a) * q;
    addTube(templesMb, templePath, (q) => {
      const bulb = q > 0.85 ? 1 + 0.15 * Math.sin(((q - 0.85) / 0.15) * Math.PI * 0.5) : 1;
      const w = lerp(T.width.hinge, T.width.tip, q) * bulb;
      const h = lerp(T.height.hinge, T.height.tip, q) * bulb;
      return rimProfile(w, h, Math.min(w, h) * 0.45, Math.min(w, h) * 0.45, 3);
    }, [0, 1, 0]);
    templeLengthMeasured = templePath.slice(1).reduce((acc, p, i) => acc + Math.hypot(p[0] - templePath[i]![0], p[1] - templePath[i]![1], p[2] - templePath[i]![2]), 0);

    if (s === 1) {
      anchors.hingeL = hingeAxis;
      anchors.templeTipL = tip;
    } else {
      anchors.hingeR = hingeAxis;
      anchors.templeTipR = tip;
    }
  }

  // ---- Bridge: arched rounded bar joining the two rims at bridge height.
  const bh = model.bridge.height;
  let ni = 0;
  let nbest = Infinity;
  contour.forEach((p, i) => {
    if (p[0] >= -A / 4) return;
    const d = Math.abs(p[1] - bh);
    if (d < nbest) (nbest = d), (ni = i);
  });
  const np = contour[ni]!;
  const nn = normals[ni]!;
  const wN = widths[ni]!;
  const attachL = toFrame(1, [np[0] + (wN * 0.5) * nn[0], bh, D / 2]);
  const attachR: P3 = [-attachL[0], attachL[1], attachL[2]];
  const top: P3 = [0, bh + model.bridge.arch, D / 2];
  const bridgePath = smoothPath([attachR, [attachR[0] * 0.5, bh + model.bridge.arch * 0.85, D / 2], top, [attachL[0] * 0.5, bh + model.bridge.arch * 0.85, D / 2], attachL], 0.8);
  addTube(front, bridgePath, () => rimProfile(D * 0.92, model.bridge.thickness, model.rim.frontEdgeRadius, model.rim.backEdgeRadius, 3), [0, 1, 0]);

  // ---- Measurements from what was built.
  const frontData = front.build();
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < frontData.positions.length; i += 3) {
    minX = Math.min(minX, frontData.positions[i]!);
    maxX = Math.max(maxX, frontData.positions[i]!);
  }

  return {
    front: frontData,
    temples: templesMb.build(),
    hinges: hingesMb.build(),
    lenses: lensesMb.build(),
    anchorsMm: {
      bridge: [0, 0, 0],
      noseContact: [0, bh + model.bridge.arch - model.bridge.thickness / 2, D / 2],
      hingeL: anchors.hingeL!,
      hingeR: anchors.hingeR!,
      templeTipL: anchors.templeTipL!,
      templeTipR: anchors.templeTipR!,
    },
    // lensWidth/Height are the contour's box (the opening by construction);
    // bridgeWidth (DBL) is measured between the two openings' nasal edges as built.
    measured: { lensWidth: A, lensHeight: B, bridgeWidth: 2 * openingMinAbsX, frontWidth: maxX - minX, templeLength: templeLengthMeasured },
    triangleCount: front.triangleCount + templesMb.triangleCount + hingesMb.triangleCount + lensesMb.triangleCount,
    model,
  };
}
