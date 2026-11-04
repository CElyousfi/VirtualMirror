import { describe, expect, it } from "vitest";
import { applyMerchantOverrides, canPublish, deriveState } from "./readiness";
import { StorefrontManifestSchema } from "./schemas";
import type { ReadinessCheck } from "./schemas";

const check = (id: string, passed: boolean, severity: ReadinessCheck["severity"]): ReadinessCheck => ({
  id,
  passed,
  severity,
  message: id,
});

describe("deriveState", () => {
  it("is ready only when everything passes and a scale source exists", () => {
    expect(deriveState([check("a", true, "blocker")], true)).toBe("ready");
  });

  it("never lets a guessed size go straight to ready", () => {
    expect(deriveState([check("a", true, "blocker")], false)).toBe("needs_review");
  });

  it("takes the minimum across checks, not an average", () => {
    const checks = [check("a", true, "blocker"), check("b", true, "review"), check("c", false, "blocker")];
    expect(deriveState(checks, true)).toBe("failed");
  });

  it("marks configured blockers as unsupported rather than failed", () => {
    expect(deriveState([check("rimless", false, "blocker")], true, ["rimless"])).toBe("unsupported");
  });

  it("sends failed review checks to needs_review", () => {
    expect(deriveState([check("material", false, "review")], true)).toBe("needs_review");
  });
});

describe("merchant overrides", () => {
  it("can accept review checks but never blockers", () => {
    const out = applyMerchantOverrides(
      [check("material", false, "review"), check("units", false, "blocker")],
      ["material", "units"],
    );
    expect(out[0]!.passed).toBe(true);
    expect(out[1]!.passed).toBe(false);
  });
});

describe("canPublish", () => {
  it("requires Ready and explicit approval", () => {
    expect(canPublish("ready", null).allowed).toBe(false);
    expect(canPublish("needs_review", new Date()).allowed).toBe(false);
    expect(canPublish("ready", new Date()).allowed).toBe(true);
  });
});

describe("StorefrontManifestSchema", () => {
  it("accepts a valid manifest and rejects a non-URL asset", () => {
    const ok = {
      v: 1,
      enabled: true,
      updatedAt: new Date().toISOString(),
      assets: [
        { variantIds: ["*"], glbUrl: "https://cdn.shopify.com/x.glb", bridgeM: [0, 0, 0], frameWidthM: 0.14, scale: "estimated" },
      ],
    };
    expect(StorefrontManifestSchema.safeParse(ok).success).toBe(true);
    const bad = { ...ok, assets: [{ ...ok.assets[0], glbUrl: "not a url" }] };
    expect(StorefrontManifestSchema.safeParse(bad).success).toBe(false);
  });
});

describe("provenance", () => {
  it("labels each method so generic frames are never mistaken for products", async () => {
    const { provenanceForMethod, PROVENANCE_LABEL } = await import("./preparation");
    expect(provenanceForMethod("demo-template")).toBe("generic");
    expect(provenanceForMethod("existing-glb")).toBe("manual");
    expect(provenanceForMethod("silhouette-2.5d")).toBe("automatic");
    expect(PROVENANCE_LABEL.generic).toContain("not the product");
  });
});
