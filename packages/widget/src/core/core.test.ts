import { describe, expect, it } from "vitest";
import { OneEuroFilter } from "./one-euro";
import { PoseSmoother, angleBetween, compose, decompose, slerp, toColumnMajor, type Pose, type Quat } from "./pose";
import { assetForVariant, parseManifest } from "./assets";

// Deterministic pseudo-random noise so jitter tests are reproducible.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

describe("OneEuroFilter", () => {
  it("cuts jitter on a still signal by more than 3x", () => {
    const f = new OneEuroFilter({ minCutoff: 1.2, beta: 0.02, dCutoff: 1 });
    const rnd = noise(1);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = 50 + rnd() * 0.4;
      raw.push(v);
      out.push(f.filter(v, i * 33.3));
    }
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) / 3);
  });

  it("follows a fast move with small lag", () => {
    const f = new OneEuroFilter({ minCutoff: 1.2, beta: 0.05, dCutoff: 1 });
    let last = 0;
    // 10 cm move over ~200 ms at 30 fps, then hold.
    for (let i = 0; i <= 15; i++) last = f.filter(i <= 6 ? (i / 6) * 10 : 10, i * 33.3);
    expect(last).toBeGreaterThan(9.5);
  });
});

describe("matrix layout and decomposition", () => {
  const rotY = (deg: number): Quat => {
    const a = (deg * Math.PI) / 180 / 2;
    return [0, Math.sin(a), 0, Math.cos(a)];
  };

  it("round-trips compose/decompose", () => {
    const pose: Pose = { position: [2, -3, -45], rotation: rotY(25), scale: 1.07 };
    const back = decompose(compose(pose));
    back.position.forEach((v, i) => expect(v).toBeCloseTo(pose.position[i]!, 9));
    expect(back.scale).toBeCloseTo(1.07, 9);
    expect(angleBetween(back.rotation, pose.rotation)).toBeLessThan(1e-6);
  });

  it("leaves column-major data alone and transposes row-major data", () => {
    const m = compose({ position: [1, 2, -50], rotation: rotY(10), scale: 1 });
    expect(toColumnMajor(m)).toEqual(m);
    const rowMajor: number[] = new Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rowMajor[r * 4 + c] = m[c * 4 + r]!;
    toColumnMajor(rowMajor).forEach((v, i) => expect(v).toBeCloseTo(m[i]!, 12));
  });

  it("slerp interpolates angle linearly", () => {
    const q = slerp(rotY(0), rotY(40), 0.25);
    expect((angleBetween(q, rotY(0)) * 180) / Math.PI).toBeCloseTo(10, 6);
  });
});

describe("PoseSmoother", () => {
  it("reduces positional jitter of a still head and holds briefly through a dropout", () => {
    const s = new PoseSmoother();
    const rnd = noise(7);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 200; i++) {
      const x = 1 + rnd() * 0.3;
      raw.push(x);
      out.push(s.update({ position: [x, 0, -45], rotation: [0, 0, 0, 1], scale: 1 }, i * 33.3).position[0]);
    }
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) / 2);
    const t = 200 * 33.3;
    expect(s.miss(t + 100)).not.toBeNull();
    expect(s.miss(t + 400)).toBeNull();
  });
});

describe("manifest selection", () => {
  const manifest = parseManifest(
    JSON.stringify({
      v: 1,
      enabled: true,
      updatedAt: "2026-11-03T00:00:00Z",
      assets: [
        { variantIds: ["11", "12"], glbUrl: "https://cdn.shopify.com/black.glb", bridgeM: [0, 0, 0], frameWidthM: 0.138, scale: "source-backed" },
        { variantIds: ["13"], glbUrl: "https://cdn.shopify.com/tortoise.glb", bridgeM: [0, 0, 0], frameWidthM: 0.138, scale: "estimated" },
      ],
    }),
  )!;

  it("parses a valid manifest and rejects junk or disabled ones", () => {
    expect(manifest.assets).toHaveLength(2);
    expect(parseManifest("{not json")).toBeNull();
    expect(parseManifest({ ...manifest, enabled: false })).toBeNull();
  });

  it("picks the selected variant's own frame", () => {
    expect(assetForVariant(manifest, "13")!.glbUrl).toContain("tortoise");
  });

  it("never substitutes another variant's frame", () => {
    expect(assetForVariant(manifest, "99")).toBeNull();
  });
});
