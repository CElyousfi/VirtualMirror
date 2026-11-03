import { describe, expect, it } from "vitest";
import { WebIO } from "@gltf-transform/core";
import type { ProductInput } from "@vm/contracts";
import { buildDemoFrameGlb } from "./demo-frame";
import { inspectDocument, readGlb } from "./glb-inspect";
import { demoTemplateMethod, existingGlbMethod } from "./methods";

const input = (over: Partial<ProductInput> = {}): ProductInput => ({
  shopifyProductId: "gid://shopify/Product/1",
  variantKey: "default",
  variantIds: ["*"],
  title: "Milo",
  images: [],
  ...over,
});

/** Re-export a GLB with every root node scaled, to simulate wrong-unit exports. */
async function scaled(glb: Uint8Array, factor: number) {
  const doc = await readGlb(glb);
  const scene = doc.getRoot().getDefaultScene()!;
  const wrap = doc.createNode("export-scale").setScale([factor, factor, factor]);
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    wrap.addChild(c);
  }
  scene.addChild(wrap);
  return new WebIO().writeBinary(doc);
}

async function rotatedZ90(glb: Uint8Array) {
  const doc = await readGlb(glb);
  const scene = doc.getRoot().getDefaultScene()!;
  const s = Math.SQRT1_2;
  const wrap = doc.createNode("rot").setRotation([0, 0, s, s]);
  for (const c of scene.listChildren()) {
    scene.removeChild(c);
    wrap.addChild(c);
  }
  scene.addChild(wrap);
  return new WebIO().writeBinary(doc);
}

describe("buildDemoFrameGlb", () => {
  it("produces a valid GLB in metres at the expected real-world width", async () => {
    const res = await buildDemoFrameGlb();
    const info = inspectDocument(await readGlb(res.glb), res.glb.byteLength);
    // 2 x 52 lens + 18 bridge + 2 x 4 rim + 2 x end piece = 138 mm with template defaults.
    expect(res.frameWidthM).toBeCloseTo(0.138, 3);
    expect(info.size[0]).toBeCloseTo(res.frameWidthM, 4);
    expect(info.unit).toBe("metres");
    expect(info.bridgeNode).toEqual([0, 0, 0]);
    expect(info.triangleCount).toBe(res.triangleCount);
    expect(info.hasTransparentMaterial).toBe(true);
    expect(res.glb.byteLength).toBeLessThan(200_000);
  });

  it("is symmetric about x = 0 and its temples run backwards (-Z)", async () => {
    const res = await buildDemoFrameGlb();
    const info = inspectDocument(await readGlb(res.glb), res.glb.byteLength);
    expect(info.bounds.min[0]).toBeCloseTo(-info.bounds.max[0], 6);
    expect(info.bounds.min[2]).toBeLessThan(-0.1);
    expect(res.anchors.leftTempleTip[0]).toBeGreaterThan(0);
    expect(res.anchors.rightTempleTip[0]).toBeLessThan(0);
  });

  it("sizes the frame from published dimensions", async () => {
    const res = await buildDemoFrameGlb({
      spec: {
        lensWidth: { valueMm: 49, source: "manufacturer" },
        bridgeWidth: { valueMm: 21, source: "manufacturer" },
      },
    });
    expect(res.frameWidthM).toBeCloseTo((2 * 49 + 21 + 8 + 8) / 1000, 4);
    expect(res.used.lensWidth).toEqual({ mm: 49, fromSpec: true });
  });
});

describe("existingGlbMethod", () => {
  it("accepts a well-formed metre-scale GLB with a bridge marker", async () => {
    const { glb } = await buildDemoFrameGlb();
    const out = await existingGlbMethod.prepare(input({ glb }));
    expect(out.readiness.state).toBe("ready");
    expect(out.anchors.bridge).toEqual([0, 0, 0]);
    expect(out.spec.totalWidth?.source).toBe("measured");
  });

  it.each([
    [100, "centimetres"],
    [1000, "millimetres"],
  ])("converts a model exported x%i (%s) back to metres", async (factor) => {
    const { glb, frameWidthM } = await buildDemoFrameGlb();
    const out = await existingGlbMethod.prepare(input({ glb: await scaled(glb, factor) }));
    expect(out.frameWidthM).toBeCloseTo(frameWidthM, 4);
    expect(out.readiness.checks.find((c) => c.id === "units")?.message).toContain("converted");
    expect(out.readiness.state).toBe("ready");
  });

  it("blocks a model whose size matches no unit", async () => {
    const { glb } = await buildDemoFrameGlb();
    const out = await existingGlbMethod.prepare(input({ glb: await scaled(glb, 7) }));
    expect(out.readiness.state).toBe("failed");
  });

  it("flags a rotated model for review", async () => {
    const { glb } = await buildDemoFrameGlb();
    const out = await existingGlbMethod.prepare(input({ glb: await rotatedZ90(glb) }));
    expect(out.readiness.checks.find((c) => c.id === "orientation")?.passed).toBe(false);
    expect(out.readiness.state).toBe("needs_review");
  });

  it("fails cleanly on bytes that are not a GLB", async () => {
    const out = await existingGlbMethod.prepare(input({ glb: new TextEncoder().encode("not a model") }));
    expect(out.readiness.state).toBe("failed");
    expect(out.readiness.checks[0]!.message).toContain("not a readable GLB");
  });
});

describe("demoTemplateMethod", () => {
  it("always needs review: it does not depict the real product", async () => {
    const out = await demoTemplateMethod.prepare(
      input({
        knownSpec: {
          lensWidth: { valueMm: 52, source: "manufacturer" },
          bridgeWidth: { valueMm: 18, source: "manufacturer" },
        },
      }),
    );
    expect(out.readiness.hasScaleSource).toBe(true);
    expect(out.readiness.state).toBe("needs_review");
    expect(out.readiness.checks.find((c) => c.id === "generic-geometry")?.passed).toBe(false);
  });

  it("marks template-only sizing as having no scale source", async () => {
    const out = await demoTemplateMethod.prepare(input());
    expect(out.readiness.hasScaleSource).toBe(false);
    expect(out.spec.totalWidth?.source).toBe("template");
  });
});
