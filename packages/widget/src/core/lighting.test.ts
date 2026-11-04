import { describe, expect, it } from "vitest";
import { STUDIO_V1, angleFromCameraAxisDeg, expectedFlatDielectric, exposureFor, irradiance, radianceAt, type StudioLighting } from "./lighting";

const uniform = (L: number): StudioLighting => ({ id: "uniform", surroundUp: [L, L, L], surroundDown: [L, L, L], lights: [] });

describe("analytic irradiance", () => {
  it("equals the radiance of a uniform environment (three.js IBL convention)", () => {
    const E = irradiance(uniform(0.7), [0, 0, 1], 120);
    E.forEach((c) => expect(c).toBeCloseTo(0.7, 6));
  });

  it("is the average of the two hemispheres for a vertical surface", () => {
    const env: StudioLighting = { id: "split", surroundUp: [1, 1, 1], surroundDown: [0, 0, 0], lights: [] };
    expect(irradiance(env, [0, 0, 1], 200)[0]).toBeCloseTo(0.5, 2);
    expect(irradiance(env, [0, 1, 0], 200)[0]).toBeCloseTo(1, 6);
  });

  it("adds a small light as radiance x solid angle x cos / pi", () => {
    const L = 10;
    const size = 10; // degrees square
    const env: StudioLighting = { id: "one", surroundUp: [0, 0, 0], surroundDown: [0, 0, 0], lights: [{ name: "l", dir: [0, 0, 1], widthDeg: size, heightDeg: size, radiance: [L, L, L] }] };
    const omega = (size * Math.PI / 180) ** 2; // small-angle approximation
    expect(irradiance(env, [0, 0, 1], 600)[0]).toBeCloseTo((L * omega) / Math.PI, 2);
  });
});

describe("studio v1", () => {
  it("keeps every light at least 30 degrees off the camera axis (the grey-front cause)", () => {
    for (const l of STUDIO_V1.lights) expect(angleFromCameraAxisDeg(l) - Math.max(l.widthDeg, l.heightDeg) / 2).toBeGreaterThanOrEqual(30);
    // Straight along the camera axis sees the dark flag, never a light.
    expect(radianceAt(STUDIO_V1, [0, 0, 1])).toEqual(STUDIO_V1.flags![0]!.radiance);
  });

  it("is neutral white (no colour cast on products)", () => {
    for (const l of STUDIO_V1.lights) expect(new Set(l.radiance).size).toBe(1);
  });

  it("normalises exposure so a grey card facing the camera reads 0.18", () => {
    const k = exposureFor(STUDIO_V1);
    expect(0.18 * irradiance(STUDIO_V1, [0, 0, 1])[0] * k).toBeCloseTo(0.18, 6);
  });

  it("keeps reflection a small share of a black acetate front at normal incidence", () => {
    const e = expectedFlatDielectric(STUDIO_V1, 0.03);
    // Reflection must not dominate the body colour the way the old environment did (63 %).
    expect(e.specular / (e.diffuse + e.specular)).toBeLessThan(0.25);
  });
});
