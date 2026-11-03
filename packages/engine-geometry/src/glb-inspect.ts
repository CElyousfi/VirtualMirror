import { WebIO, type Document, type Node } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import { guessUnitFromFrameWidth, type UnitGuess } from "@vm/contracts";

export const GLB_LIMITS = {
  /** Above this, mobile load time suffers; merchant must accept. */
  reviewBytes: 4 * 1024 * 1024,
  /** Hard ceiling for the storefront. */
  maxBytes: 15 * 1024 * 1024,
  reviewTriangles: 50_000,
  maxTriangles: 150_000,
} as const;

export interface GlbInspection {
  byteSize: number;
  triangleCount: number;
  meshCount: number;
  /** World-space bounds in the file's own units. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  size: [number, number, number];
  unit: UnitGuess;
  toMetres: number;
  /** Bridge position from a `VM_Bridge` node, in file units, if present. */
  bridgeNode: [number, number, number] | null;
  hasTransparentMaterial: boolean;
}

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  return new WebIO().readBinary(bytes);
}

function findNode(doc: Document, name: string): Node | undefined {
  return doc.getRoot().listNodes().find((n) => n.getName() === name);
}

export function inspectDocument(doc: Document, byteSize: number): GlbInspection {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("The file contains no scene.");

  let triangles = 0;
  let meshCount = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    meshCount++;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // TRIANGLES only
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      triangles += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }

  const { min, max } = getBounds(scene);
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  // Use the larger of width and height so a rotated model is reported as
  // rotated (orientation check) rather than as the wrong unit.
  const { unit, toMetres } = guessUnitFromFrameWidth(Math.max(size[0], size[1]));
  const bridge = findNode(doc, "VM_Bridge");

  return {
    byteSize,
    triangleCount: triangles,
    meshCount,
    bounds: { min: [...min] as [number, number, number], max: [...max] as [number, number, number] },
    size,
    unit,
    toMetres,
    bridgeNode: bridge ? ([...bridge.getWorldTranslation()] as [number, number, number]) : null,
    hasTransparentMaterial: doc
      .getRoot()
      .listMaterials()
      .some((m) => m.getAlphaMode() === "BLEND" || m.getBaseColorFactor()[3]! < 1),
  };
}

/**
 * Rescale every root node so the file is in metres. Returns new GLB bytes.
 * Used when a merchant's GLB was exported in centimetres or millimetres.
 */
export async function rescaleToMetres(doc: Document, toMetres: number): Promise<Uint8Array> {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const wrapper = doc.createNode("VM_UnitFix").setScale([toMetres, toMetres, toMetres]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);
  return new WebIO().writeBinary(doc);
}
