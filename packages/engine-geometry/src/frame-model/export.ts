import { Document, type Material } from "@gltf-transform/core";
import { KHRMaterialsClearcoat, KHRMaterialsSpecular } from "@gltf-transform/extensions";
import { mmToM, type FrameMaterial, type FrameModelInput } from "@vm/contracts";
import type { MeshData, P3 } from "../mesh";
import { glbIO } from "../glb-inspect";
import { buildFrameParts, type FrameParts } from "./build";

export interface FrameModelGlb {
  glb: Uint8Array;
  parts: FrameParts;
  frameWidthM: number;
  triangleCount: number;
  anchorsM: Record<keyof FrameParts["anchorsMm"], [number, number, number]>;
}

const toM = (p: P3): [number, number, number] => [mmToM(p[0]), mmToM(p[1]), mmToM(p[2])];

/** Build a FrameModel into a GLB in ASSET space (metres), with anchors and the model embedded. */
export async function buildFrameModelGlb(input: FrameModelInput): Promise<FrameModelGlb> {
  const parts = buildFrameParts(input);
  const model = parts.model;
  const doc = new Document();
  doc.getRoot().getAsset().generator = "Virtual Mirror engine-geometry (FrameModel v1)";
  const buffer = doc.createBuffer();
  const clearcoat = doc.createExtension(KHRMaterialsClearcoat);
  const specular = doc.createExtension(KHRMaterialsSpecular);

  const material = (name: string, m: FrameMaterial): Material => {
    const mat = doc
      .createMaterial(name)
      .setBaseColorFactor([m.color[0], m.color[1], m.color[2], 1])
      .setRoughnessFactor(m.roughness)
      .setMetallicFactor(m.kind === "metal" ? 1 : 0);
    if (m.clearcoat > 0) {
      mat.setExtension("KHR_materials_clearcoat", clearcoat.createClearcoat().setClearcoatFactor(m.clearcoat).setClearcoatRoughnessFactor(m.clearcoatRoughness));
      // Acetate has ONE reflecting interface. With a clear coat that interface
      // is the coat, so the body underneath must not add a second specular
      // lobe (measured: base specular + coat lifted generic black acetate's
      // median from 55 to 76 sRGB in studio-v1; REALISM_PLAN §1.6).
      if (m.kind === "acetate") mat.setExtension("KHR_materials_specular", specular.createSpecular().setSpecularFactor(0));
    }
    return mat;
  };

  const frontMat = material("VM_Front", model.materials.front);
  const templeMat = model.materials.temples ? material("VM_Temples", model.materials.temples) : frontMat;
  const hingeMat = material("VM_Hinge", model.materials.hinge);
  const lensMat = doc
    .createMaterial("VM_Lens")
    .setBaseColorFactor([...model.lens.tint, model.lens.opacity] as [number, number, number, number])
    .setRoughnessFactor(0.02)
    .setMetallicFactor(0)
    .setAlphaMode("BLEND");

  const prim = (data: MeshData, mat: Material) => {
    const pos = new Float32Array(data.positions.length);
    for (let i = 0; i < pos.length; i++) pos[i] = mmToM(data.positions[i]!);
    const idx = pos.length / 3 < 65536 ? new Uint16Array(data.indices) : new Uint32Array(data.indices);
    return doc
      .createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(data.normals).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buffer))
      .setMaterial(mat);
  };

  const root = doc.createNode("VM_Frame");
  const part = (name: string, data: MeshData, mat: Material) => {
    if (data.indices.length) root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim(data, mat))));
  };
  part("VM_FrontPart", parts.front, frontMat);
  part("VM_TemplesPart", parts.temples, templeMat);
  part("VM_HingesPart", parts.hinges, hingeMat);
  part("VM_LensesPart", parts.lenses, lensMat);

  const anchorsM = Object.fromEntries(Object.entries(parts.anchorsMm).map(([k, v]) => [k, toM(v)])) as FrameModelGlb["anchorsM"];
  const anchorNames: Record<string, string> = {
    bridge: "VM_Bridge",
    noseContact: "VM_NoseContact",
    hingeL: "VM_Hinge_L",
    hingeR: "VM_Hinge_R",
    templeTipL: "VM_TempleTip_L",
    templeTipR: "VM_TempleTip_R",
  };
  for (const [k, v] of Object.entries(anchorsM)) root.addChild(doc.createNode(anchorNames[k]!).setTranslation(v));

  root.setExtras({
    vm: {
      kind: "frame-model",
      provenance: model.provenance,
      name: model.name,
      source: model.source,
      measuredMm: parts.measured,
      // The exact numbers this file was built from, for traceability.
      frameModel: model,
    },
  });
  doc.getRoot().setDefaultScene(doc.createScene("VM").addChild(root));
  const glb = await glbIO().writeBinary(doc);
  return { glb, parts, frameWidthM: mmToM(parts.measured.frontWidth), triangleCount: parts.triangleCount, anchorsM };
}
