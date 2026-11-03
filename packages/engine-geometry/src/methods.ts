import {
  buildReport,
  mToMm,
  type FrameSpec,
  type PreparationMethod,
  type PreparedAsset,
  type ProductInput,
  type ReadinessCheck,
} from "@vm/contracts";
import { buildDemoFrameGlb } from "./demo-frame";
import { GLB_LIMITS, inspectDocument, readGlb, rescaleToMetres } from "./glb-inspect";

const hasSource = (spec: Partial<FrameSpec> | undefined, key: keyof FrameSpec) => {
  const d = spec?.[key];
  return !!d && typeof d === "object" && "source" in d && d.source !== "template";
};

/**
 * existing-glb: the merchant (or their frame vendor) already has a GLB.
 * We validate it, fix units when the intent is unambiguous, locate the bridge,
 * and report what the merchant must review.
 */
export const existingGlbMethod: PreparationMethod = {
  id: "existing-glb",

  async canHandle(input) {
    return input.glb
      ? { eligible: true }
      : { eligible: false, reason: "Upload a .glb file for this product to use this method." };
  },

  async prepare(input, onProgress): Promise<PreparedAsset> {
    if (!input.glb) throw new Error("existing-glb requires input.glb");
    const checks: ReadinessCheck[] = [];
    onProgress?.({ stage: "Reading file", fraction: 0.1 });

    let doc;
    try {
      doc = await readGlb(input.glb);
    } catch (err) {
      checks.push({ id: "parse", passed: false, severity: "blocker", message: `This is not a readable GLB file (${(err as Error).message}).` });
      return failed(input, checks);
    }

    let glb = input.glb;
    let info = inspectDocument(doc, glb.byteLength);
    checks.push({ id: "parse", passed: true, severity: "blocker", message: "File is a valid GLB." });
    checks.push({
      id: "has-mesh",
      passed: info.meshCount > 0 && info.triangleCount > 0,
      severity: "blocker",
      message: info.meshCount > 0 ? `Contains ${info.meshCount} mesh(es).` : "The file contains no 3D geometry.",
    });

    onProgress?.({ stage: "Checking size and units", fraction: 0.4 });
    if (info.unit === "unknown") {
      checks.push({
        id: "units",
        passed: false,
        severity: "blocker",
        message: `The model is ${info.size[0].toFixed(3)} units wide, which does not match glasses in metres, centimetres or millimetres. Re-export the model at real-world size.`,
        measured: info.size[0],
      });
    } else if (info.unit !== "metres") {
      glb = await rescaleToMetres(doc, info.toMetres);
      doc = await readGlb(glb);
      info = inspectDocument(doc, glb.byteLength);
      checks.push({ id: "units", passed: true, severity: "info", message: "The model was exported in a smaller unit; we converted it to metres automatically." });
    } else {
      checks.push({ id: "units", passed: true, severity: "blocker", message: "Model is in metres." });
    }

    const widthMm = mToMm(info.frontWidth);
    checks.push({
      id: "orientation",
      passed: info.size[0] >= info.size[1],
      severity: "review",
      message:
        info.size[0] >= info.size[1]
          ? "Frame is wider than it is tall, as expected."
          : "The model is taller than it is wide. It may be rotated; check the preview.",
    });

    checks.push({
      id: "file-size",
      passed: info.byteSize <= GLB_LIMITS.reviewBytes,
      severity: info.byteSize > GLB_LIMITS.maxBytes ? "blocker" : "review",
      message: `File is ${(info.byteSize / 1024 / 1024).toFixed(2)} MB${info.byteSize > GLB_LIMITS.reviewBytes ? "; large files load slowly on phones" : ""}.`,
      measured: info.byteSize,
    });
    checks.push({
      id: "triangles",
      passed: info.triangleCount <= GLB_LIMITS.reviewTriangles,
      severity: info.triangleCount > GLB_LIMITS.maxTriangles ? "blocker" : "review",
      message: `${info.triangleCount.toLocaleString("en")} triangles${info.triangleCount > GLB_LIMITS.reviewTriangles ? "; heavy for phones" : ""}.`,
      measured: info.triangleCount,
    });

    // Bridge: explicit node, else estimate at the front-centre of the bounds.
    let bridge: [number, number, number];
    if (info.bridgeNode) {
      bridge = info.bridgeNode;
      checks.push({ id: "bridge-anchor", passed: true, severity: "review", message: "Bridge position read from the model's VM_Bridge marker." });
    } else {
      const { min, max } = info.bounds;
      bridge = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2] - 0.004];
      checks.push({
        id: "bridge-anchor",
        passed: false,
        severity: "review",
        message: "Bridge position was estimated from the model's shape. Check alignment in the live preview before approving.",
      });
    }

    const spec: FrameSpec = {
      family: "unknown",
      material: "unknown",
      ...input.knownSpec,
      totalWidth: { valueMm: Math.round(widthMm * 10) / 10, source: "measured" },
    };

    onProgress?.({ stage: "Done", fraction: 1 });
    return {
      method: "existing-glb",
      variantKey: input.variantKey,
      glb,
      anchors: { bridge },
      spec,
      frameWidthM: info.frontWidth,
      triangleCount: info.triangleCount,
      // A measured, plausibly sized model is its own scale source.
      readiness: buildReport(checks, info.unit !== "unknown"),
    };
  },
};

function failed(input: ProductInput, checks: ReadinessCheck[]): PreparedAsset {
  return {
    method: "existing-glb",
    variantKey: input.variantKey,
    glb: new Uint8Array(),
    anchors: { bridge: [0, 0, 0] },
    spec: { family: "unknown", material: "unknown" },
    frameWidthM: 0,
    triangleCount: 0,
    readiness: buildReport(checks, false),
  };
}

/**
 * demo-template: a generic parametric frame sized from whatever dimensions the
 * product publishes. For testing the end-to-end chain only. It always needs
 * merchant review because it does not depict the actual product.
 */
export const demoTemplateMethod: PreparationMethod = {
  id: "demo-template",

  async canHandle() {
    return { eligible: true };
  },

  async prepare(input, onProgress): Promise<PreparedAsset> {
    onProgress?.({ stage: "Generating demo frame", fraction: 0.3 });
    const res = await buildDemoFrameGlb({ spec: input.knownSpec });
    const scaleKeys = ["lensWidth", "bridgeWidth"] as const;
    const hasScaleSource = scaleKeys.every((k) => hasSource(input.knownSpec, k));

    const checks: ReadinessCheck[] = [
      {
        id: "generic-geometry",
        passed: false,
        severity: "review",
        message: "This is a generic demo frame, not a 3D copy of this product. Approve only for testing.",
      },
      {
        id: "dimensions",
        passed: hasScaleSource,
        severity: "review",
        message: hasScaleSource
          ? `Sized from the product's published dimensions (${res.used.lensWidth.mm}-${res.used.bridgeWidth.mm}-${res.used.templeLength.mm}).`
          : "No lens and bridge sizes were found for this product, so typical sizes were used.",
      },
    ];

    const spec: FrameSpec = {
      family: "rectangular",
      material: "acetate",
      ...input.knownSpec,
      totalWidth: { valueMm: Math.round(mToMm(res.frameWidthM) * 10) / 10, source: hasScaleSource ? "measured" : "template" },
    };

    onProgress?.({ stage: "Done", fraction: 1 });
    return {
      method: "demo-template",
      variantKey: input.variantKey,
      glb: res.glb,
      anchors: res.anchors,
      spec,
      frameWidthM: res.frameWidthM,
      triangleCount: res.triangleCount,
      readiness: buildReport(checks, hasScaleSource),
    };
  },
};

export const PREPARATION_METHODS: Record<string, PreparationMethod> = {
  [existingGlbMethod.id]: existingGlbMethod,
  [demoTemplateMethod.id]: demoTemplateMethod,
};
