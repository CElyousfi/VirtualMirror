import { Document, WebIO, type Material } from "@gltf-transform/core";
import { mmToM, type FrameSpec } from "@vm/contracts";
import { MeshBuilder, addFilledLoop, addRing, roundedRectLoop, type MeshData } from "./mesh";

/**
 * Parametric demo frame: a generic rectangular full-rim frame built from a
 * FrameSpec. It is NOT a reproduction of any product. It exists so the full
 * Shopify -> storage -> storefront -> renderer chain can be tested before the
 * 2.5D generator exists, and as the template geometry that generator will fit.
 *
 * Output follows the ASSET-space contract (packages/contracts/coordinate-spaces):
 * metres, +Y up, +Z forward, +X toward the wearer's left, origin at the bridge
 * reference point (centre, lens-centre height, back plane of the front).
 */

export const TEMPLATE_DEFAULTS_MM = {
  lensWidth: 52,
  lensHeight: 40,
  bridgeWidth: 18,
  templeLength: 145,
  rim: 4,
  frontDepth: 4.5,
  cornerRadius: 10,
  endpiece: 4,
  templeWidth: 3,
  templeHeight: 5,
} as const;

/** Outward angle of each temple from straight back, in degrees. */
export const TEMPLE_SPLAY_DEG = 8;

export interface DemoFrameOptions {
  spec?: Partial<FrameSpec>;
  frameColor?: [number, number, number];
  lensTint?: [number, number, number, number];
}

export interface DemoFrameResult {
  glb: Uint8Array;
  frameWidthM: number;
  triangleCount: number;
  anchors: {
    bridge: [number, number, number];
    leftTempleTip: [number, number, number];
    rightTempleTip: [number, number, number];
  };
  /** Dimensions actually used, in mm, with their source. */
  used: Record<"lensWidth" | "lensHeight" | "bridgeWidth" | "templeLength", { mm: number; fromSpec: boolean }>;
}

function dim(spec: Partial<FrameSpec> | undefined, key: "lensWidth" | "lensHeight" | "bridgeWidth" | "templeLength") {
  const d = spec?.[key];
  return d ? { mm: d.valueMm, fromSpec: true } : { mm: TEMPLATE_DEFAULTS_MM[key], fromSpec: false };
}

export function buildDemoFrameMeshes(opts: DemoFrameOptions = {}) {
  const used = {
    lensWidth: dim(opts.spec, "lensWidth"),
    lensHeight: dim(opts.spec, "lensHeight"),
    bridgeWidth: dim(opts.spec, "bridgeWidth"),
    templeLength: dim(opts.spec, "templeLength"),
  };
  const T = TEMPLATE_DEFAULTS_MM;
  const m = mmToM;
  const lw = m(used.lensWidth.mm);
  const lh = m(used.lensHeight.mm);
  const bw = m(used.bridgeWidth.mm);
  const rim = m(T.rim);
  const depth = m(T.frontDepth);
  const r = m(T.cornerRadius);
  const lensCx = bw / 2 + lw / 2;

  const frame = new MeshBuilder();
  const lenses = new MeshBuilder();

  for (const side of [-1, 1]) {
    const cx = side * lensCx;
    const inner = roundedRectLoop(cx, 0, lw, lh, r, 10);
    const outer = roundedRectLoop(cx, 0, lw + 2 * rim, lh + 2 * rim, r + rim, 10);
    addRing(frame, outer, inner, 0, depth);
    addFilledLoop(lenses, inner, depth * 0.5);
  }

  // Bridge: a bar joining the two rims across the top third.
  const bridgeY = lh * 0.22;
  frame.addBox([-bw / 2 - rim / 2, bridgeY - rim / 2, 0], [bw / 2 + rim / 2, bridgeY + rim / 2, depth]);

  // End pieces and temples.
  const halfFront = lensCx + lw / 2 + rim;
  const endW = m(T.endpiece);
  const tw = m(T.templeWidth);
  const th = m(T.templeHeight);
  const templeY = lh * 0.25;
  const templeLen = m(used.templeLength.mm);
  const straight = templeLen * 0.72;
  const bendDrop = m(18);
  const tips: [number, number, number][] = [];

  for (const side of [-1, 1]) {
    // End piece overlaps the rim by one rim thickness and extends `endW` past it.
    const outerX = side * (halfFront + endW);
    const innerX = side * (halfFront - rim);
    frame.addBox([Math.min(innerX, outerX), templeY - th / 2, 0], [Math.max(innerX, outerX), templeY + th / 2, depth]);
    // Temples splay outward so they clear the head: the canonical face is
    // ~153 mm wide at the ears, wider than most frame fronts.
    const hingeX = side * (halfFront + endW - tw / 2);
    const splay = Math.tan((TEMPLE_SPLAY_DEG * Math.PI) / 180);
    const p0: [number, number, number] = [hingeX, templeY, 0];
    const p1: [number, number, number] = [hingeX + side * straight * splay, templeY, -straight];
    frame.addBeam(p0, p1, tw, th);
    // Ear bend: angled down and back behind the ear.
    const bendLen = templeLen - straight;
    const p2: [number, number, number] = [p1[0] + side * bendLen * 0.3 * splay, templeY - bendDrop, -straight - bendLen * 0.8];
    frame.addBeam(p1, p2, tw, th);
    tips.push(p2);
  }

  return {
    frame: frame.build(),
    lenses: lenses.build(),
    triangleCount: frame.triangleCount + lenses.triangleCount,
    frameWidthM: 2 * (halfFront + endW),
    used,
    tips: { left: tips[1]!, right: tips[0]! },
  };
}

function addPrimitive(doc: Document, data: MeshData, material: Material) {
  const buffer = doc.getRoot().listBuffers()[0]!;
  const vertexCount = data.positions.length / 3;
  const indices = vertexCount < 65536 ? new Uint16Array(data.indices) : data.indices;
  return doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(data.positions).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(data.normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer))
    .setMaterial(material);
}

export async function buildDemoFrameGlb(opts: DemoFrameOptions = {}): Promise<DemoFrameResult> {
  const built = buildDemoFrameMeshes(opts);
  const doc = new Document();
  doc.getRoot().getAsset().generator = "Virtual Mirror engine-geometry (demo template)";
  doc.createBuffer();

  const [fr, fg, fb] = opts.frameColor ?? [0.03, 0.03, 0.035];
  const frameMat = doc
    .createMaterial("VM_FrameAcetate")
    .setBaseColorFactor([fr, fg, fb, 1])
    .setRoughnessFactor(0.32)
    .setMetallicFactor(0);
  const lensMat = doc
    .createMaterial("VM_Lens")
    .setBaseColorFactor(opts.lensTint ?? [0.9, 0.92, 0.95, 0.12])
    .setRoughnessFactor(0.05)
    .setMetallicFactor(0)
    .setAlphaMode("BLEND")
    .setDoubleSided(true);

  const mesh = doc
    .createMesh("VM_Frame")
    .addPrimitive(addPrimitive(doc, built.frame, frameMat))
    .addPrimitive(addPrimitive(doc, built.lenses, lensMat));

  const root = doc.createNode("VM_Frame").setMesh(mesh);
  root.addChild(doc.createNode("VM_Bridge").setTranslation([0, 0, 0]));
  root.addChild(doc.createNode("VM_TempleTip_L").setTranslation(built.tips.left));
  root.addChild(doc.createNode("VM_TempleTip_R").setTranslation(built.tips.right));
  root.setExtras({ vm: { kind: "demo-template", note: "Generic frame. Not a reproduction of any product." } });
  doc.getRoot().setDefaultScene(doc.createScene("VM").addChild(root));

  const glb = await new WebIO().writeBinary(doc);
  return {
    glb,
    frameWidthM: built.frameWidthM,
    triangleCount: built.triangleCount,
    anchors: { bridge: [0, 0, 0], leftTempleTip: built.tips.left, rightTempleTip: built.tips.right },
    used: built.used,
  };
}
