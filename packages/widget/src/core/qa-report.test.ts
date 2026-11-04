import { describe, expect, it } from "vitest";
import { CRITERIA, dimensionChecks, toMarkdown, validateReport, verdict, type QaReport } from "./qa-report";

const base = (over: Partial<QaReport> = {}): QaReport => ({
  schema: "vm-qa-report/1",
  createdAt: "2026-11-04T00:00:00Z",
  commit: "abc1234567",
  testKind: "live-renderer",
  tester: "Founder",
  product: { name: "Milo Black", source: "Merchant photos", dimensionsMm: { lensWidth: 52, bridgeWidth: 18, templeLength: 145, totalWidth: 138 }, photos: [{ view: "front", fileName: "front.jpg" }] },
  asset: { fileName: "demo-frame.glb", sha256: "f".repeat(64), bytes: 28276, provenance: "generic", method: "demo-template", triangles: 804, frontWidthMm: 138, heightMm: 61, depthMm: 140 },
  sessions: [{ kind: "live-camera", source: "front camera", device: "iPhone 13", browser: "Safari 18", gpu: "Apple GPU", delegate: "GPU", videoSize: "1280x720", avgFps: 29.8, trackerReadyMs: 2100, frameReadyMs: 400, summary: null }],
  captures: [],
  criteria: CRITERIA.map((c) => ({ id: c.id, result: "pass" as const, note: "observed ok" })).map((c) =>
    c.id === "product-fidelity" ? { ...c, result: "fail" as const, note: "generic frame" } : c.id === "automation" ? { ...c, result: "not-applicable" as const, note: "" } : c,
  ),
  knownFailures: "",
  ...over,
});

describe("QA report rules", () => {
  it("never lets a generic frame pass product fidelity", () => {
    const r = base({ criteria: base().criteria.map((c) => (c.id === "product-fidelity" ? { ...c, result: "pass" as const } : c)) });
    expect(validateReport(r)).toContain("Product fidelity cannot pass with a generic frame: it is not the product.");
  });

  it("requires a note for every pass or fail", () => {
    const r = base({ criteria: base().criteria.map((c) => (c.id === "scale" ? { ...c, note: " " } : c)) });
    expect(validateReport(r).some((e) => e.startsWith("Scale:"))).toBe(true);
  });

  it("is INCOMPLETE, not PASS, when anything is untested", () => {
    const allPass = base({ criteria: base().criteria.map((c) => (c.id === "product-fidelity" ? { ...c, result: "pass" as const } : c)) });
    expect(verdict(allPass)).toBe("PASS");
    const untested = base({ criteria: allPass.criteria.map((c) => (c.id === "occlusion" ? { ...c, result: "not-tested" as const } : c)) });
    expect(verdict(untested)).toBe("INCOMPLETE");
  });

  it("is FAIL when any criterion fails", () => {
    expect(verdict(base())).toBe("FAIL");
  });

  it("keeps automatic-reconstruction tests separate from live-renderer tests", () => {
    const errors = validateReport(base({ testKind: "automatic-reconstruction" }));
    expect(errors).toContain("An automatic-reconstruction test must use an automatically generated asset.");
    expect(errors).toContain("Automation must be evaluated in an automatic-reconstruction test.");
  });

  it("requires consent for prerecorded video and a device name for live sessions", () => {
    const r = base({
      sessions: [
        { ...base().sessions[0]!, device: "" },
        { ...base().sessions[0]!, kind: "replay", source: "volunteer.webm", consent: "" },
      ],
    });
    const errors = validateReport(r);
    expect(errors).toContain("Name the device for every live session.");
    expect(errors).toContain("Record the consent / permission basis for every prerecorded video.");
  });
});

describe("dimensionChecks and markdown", () => {
  it("reports signed deltas against the product sheet", () => {
    expect(dimensionChecks({ totalWidth: 140 }, { frontWidthMm: 138, depthMm: 120 })).toEqual([
      { name: "Total front width", productMm: 140, assetMm: 138, deltaMm: -2 },
    ]);
  });

  it("includes every required field in the markdown", () => {
    const md = toMarkdown(base(), "Generic frame (not the product)");
    for (const needle of ["Verdict: FAIL", "abc1234567", "Generic frame (not the product)", "demo-template", "iPhone 13", "29.8", "Product fidelity", "Total front width"]) {
      expect(md).toContain(needle);
    }
  });
});
