import { WebIO, type Document, type Node, type Scene } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
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
  /**
   * Width of the frame FRONT (file units): x-extent of geometry within the
   * front 12 mm of the model. Splayed temples are excluded, so this matches
   * the published total frame width.
   */
  frontWidth: number;
  /** World-space bounds in the file's own units. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  size: [number, number, number];
  unit: UnitGuess;
  toMetres: number;
  /** Bridge position from a `VM_Bridge` node, in file units, if present. */
  bridgeNode: [number, number, number] | null;
  hasTransparentMaterial: boolean;
}

/**
 * glTF I/O that knows the Khronos material and texture extensions, so reading
 * and re-writing a merchant's GLB (e.g. unit fix) keeps clear coat,
 * transmission, IOR, specular, texture transforms … instead of dropping them.
 * Compressed geometry (Draco/meshopt) still needs decoders and is rejected.
 */
export const glbIO = (): WebIO => new WebIO().registerExtensions(ALL_EXTENSIONS);

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  return glbIO().readBinary(bytes);
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
  const slab = FRONT_SLAB_M / (unit === "unknown" ? 1 : toMetres);
  const frontWidth = frontSlabWidth(scene, max[2] - slab);
  const bridge = findNode(doc, "VM_Bridge");

  return {
    byteSize,
    triangleCount: triangles,
    meshCount,
    bounds: { min: [...min] as [number, number, number], max: [...max] as [number, number, number] },
    size,
    frontWidth,
    unit,
    toMetres,
    bridgeNode: bridge ? ([...bridge.getWorldTranslation()] as [number, number, number]) : null,
    hasTransparentMaterial: doc
      .getRoot()
      .listMaterials()
      .some((m) => m.getAlphaMode() === "BLEND" || m.getBaseColorFactor()[3]! < 1),
  };
}

const FRONT_SLAB_M = 0.012;

/** X-extent of all vertices (world space) whose z is at least `minZ`. */
function frontSlabWidth(scene: Scene, minZ: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = m[0] * v[0]! + m[4] * v[1]! + m[8] * v[2]! + m[12];
        const z = m[2] * v[0]! + m[6] * v[1]! + m[10] * v[2]! + m[14];
        if (z >= minZ) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
    }
  });
  return hi > lo ? hi - lo : 0;
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
  return glbIO().writeBinary(doc);
}
