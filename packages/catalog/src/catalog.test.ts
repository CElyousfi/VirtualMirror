import { describe, expect, it } from "vitest";
import { classifyEyewear } from "./eyewear";
import { parseFrameDimensions } from "./dimensions";
import { groupVariantsForAssets } from "./variant-groups";
import { mapProductNode, type ProductNode } from "./mapping";
import { MIXED_CATALOG } from "./fixtures/mixed-catalog";

describe("classifyEyewear on a labelled 32-product mixed catalog", () => {
  const results = MIXED_CATALOG.map((p) => ({ ...p, predicted: classifyEyewear(p).likely }));
  const tp = results.filter((r) => r.predicted && r.eyewear).length;
  const fp = results.filter((r) => r.predicted && !r.eyewear);
  const fn = results.filter((r) => !r.predicted && r.eyewear);
  const precision = tp / (tp + fp.length);
  const recall = tp / (tp + fn.length);

  it("reaches precision >= 0.9 (task 1.5 acceptance)", () => {
    expect(fp.map((r) => r.title)).toEqual([]);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });

  it("reaches recall >= 0.85; misses are listed for the merchant override", () => {
    // Recall is reported, not hidden: merchants include anything the heuristic misses.
    console.info(
      `[classifier] precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} misses=${JSON.stringify(fn.map((r) => r.title))}`,
    );
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });

  it("explains every positive decision", () => {
    const c = classifyEyewear(MIXED_CATALOG[1]!);
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(c.reasons[0]).toContain("Sunglasses");
  });
});

describe("parseFrameDimensions", () => {
  it.each([
    ["Wayfarer 52-18-145", [52, 18, 145]],
    ["Size 52□18 140", [52, 18, 140]],
    ["Size: 50 [] 20-145", [50, 20, 145]],
    ["49/21/140 tortoise", [49, 21, 140]],
  ])("reads the arm print in %s", (text, [l, b, t]) => {
    const d = parseFrameDimensions(text);
    expect([d.lensWidthMm, d.bridgeWidthMm, d.templeLengthMm]).toEqual([l, b, t]);
    expect(d.evidence.length).toBe(1);
  });

  it("reads labelled values from descriptions", () => {
    const d = parseFrameDimensions(null, "Lens width: 51 mm. Lens height: 42mm. Bridge 19 mm. Frame width 138 mm.");
    expect(d).toMatchObject({ lensWidthMm: 51, lensHeightMm: 42, bridgeWidthMm: 19, totalWidthMm: 138 });
  });

  it("rejects implausible numbers instead of trusting them", () => {
    expect(parseFrameDimensions("Order 12-34-567").lensWidthMm).toBeUndefined();
    expect(parseFrameDimensions("Lens width: 99 mm").lensWidthMm).toBeUndefined();
  });
});

describe("groupVariantsForAssets", () => {
  const v = (id: string, options: [string, string][]) => ({
    gid: `gid://shopify/ProductVariant/${id}`,
    legacyId: id,
    title: options.map((o) => o[1]).join(" / "),
    options: options.map(([name, value]) => ({ name, value })),
    imageUrl: null,
  });

  it("gives each colour its own asset but shares across prescription options", () => {
    const groups = groupVariantsForAssets({
      images: [],
      variants: [
        v("1", [["Color", "Black"], ["Prescription", "None"]]),
        v("2", [["Color", "Black"], ["Prescription", "Single vision"]]),
        v("3", [["Color", "Tortoise"], ["Prescription", "None"]]),
      ],
    });
    expect(groups.map((g) => [g.label, g.variantLegacyIds])).toEqual([
      ["Black", ["1", "2"]],
      ["Tortoise", ["3"]],
    ]);
  });

  it("treats Shopify's Default Title variant as one group using the main image", () => {
    const groups = groupVariantsForAssets({
      images: [{ url: "https://cdn/x.jpg", altText: null, width: 1, height: 1 }],
      variants: [v("9", [["Title", "Default Title"]])],
    });
    expect(groups).toEqual([{ key: "default", label: "All variants", variantLegacyIds: ["9"], imageUrl: "https://cdn/x.jpg" }]);
  });
});

describe("mapProductNode", () => {
  it("maps an Admin API product node to a snapshot", () => {
    const node: ProductNode = {
      id: "gid://shopify/Product/1",
      legacyResourceId: "1",
      title: "Milo",
      handle: "milo",
      productType: "Optical Frames",
      vendor: "Acme",
      tags: ["optical"],
      status: "ACTIVE",
      description: "52-18-145",
      updatedAt: "2026-11-03T00:00:00Z",
      category: null,
      media: {
        nodes: [
          { __typename: "MediaImage", image: { url: "https://cdn/a.jpg", altText: null, width: 2048, height: 1024 } },
          { __typename: "Model3d", sources: [{ url: "https://cdn/m.glb", format: "glb" }, { url: "https://cdn/m.usdz", format: "usdz" }] },
          { __typename: "Video" },
        ],
      },
      variants: {
        nodes: [
          { id: "gid://shopify/ProductVariant/11", legacyResourceId: 11, title: "Black", selectedOptions: [{ name: "Color", value: "Black" }], media: { nodes: [] } },
        ],
      },
    };
    const s = mapProductNode(node);
    expect(s.images).toHaveLength(1);
    expect(s.existingModels).toEqual([{ url: "https://cdn/m.glb", format: "glb" }]);
    expect(s.variants[0]).toMatchObject({ legacyId: "11", imageUrl: null });
  });
});
