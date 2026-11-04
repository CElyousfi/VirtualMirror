/**
 * Studio lighting as data, with analytic irradiance so exposure is set by
 * maths, not by eye. Pure TypeScript (no three.js), unit-tested.
 *
 * Conventions match three.js image-based lighting: for a uniform environment
 * of radiance L, a white Lambertian surface renders as L. So "normalised
 * irradiance" here is E = (1/pi) * integral(L * cos) over the hemisphere, and
 * an 18 % grey card renders as 0.18 * E.
 *
 * Directions are in camera / ASSET space: +Z points from the glasses towards
 * the viewer (the camera), +Y up, +X to the wearer's left.
 */

export type RGB = [number, number, number];
export type Dir = [number, number, number];

export interface AreaLight {
  name: string;
  /** Unit direction from the subject towards the light's centre. */
  dir: Dir;
  /** Light size as seen from the subject, in degrees (width along the horizontal tangent, height along the other). */
  widthDeg: number;
  heightDeg: number;
  radiance: RGB;
}

export interface StudioLighting {
  id: string;
  /** Radiance of the upper and lower hemispheres of the surround. */
  surroundUp: RGB;
  surroundDown: RGB;
  lights: AreaLight[];
  /**
   * Dark "flags" (black boards), as product photographers place around the
   * camera so glossy fronts reflect darkness. Same shape as lights.
   */
  flags?: AreaLight[];
}

const norm = (v: Dir): Dir => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const deg = Math.PI / 180;
const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Studio v1: a product-photography studio, used by the QA studio viewer and
 * as the default before camera-based lighting exists. Design rules:
 * - Nothing bright within 30 degrees of the camera axis, and a dark flag
 *   around the camera: a flat glossy front facing the camera mirrors whatever
 *   sits there (the grey-frame cause). This is a studio convention, not a
 *   model of a shopper's room; live lighting comes from the camera (S2).
 * - Key light overhead, strip lights to the sides and slightly forward, so
 *   curved rims and temples catch highlights the way product photos do.
 * - Neutral white (no colour cast) so product colours are preserved.
 */
export const STUDIO_V1: StudioLighting = {
  id: "studio-v1",
  surroundUp: [0.35, 0.35, 0.35],
  surroundDown: [0.12, 0.12, 0.12],
  lights: [
    { name: "overhead-key", dir: norm([0, 1, 0.35]), widthDeg: 50, heightDeg: 30, radiance: [3.2, 3.2, 3.2] },
    { name: "strip-left", dir: norm([1, 0.25, 0.55]), widthDeg: 8, heightDeg: 45, radiance: [6, 6, 6] },
    { name: "strip-right", dir: norm([-1, 0.25, 0.55]), widthDeg: 8, heightDeg: 45, radiance: [6, 6, 6] },
    { name: "rim-back", dir: norm([0, 0.4, -1]), widthDeg: 40, heightDeg: 15, radiance: [2, 2, 2] },
  ],
  flags: [{ name: "camera-flag", dir: [0, 0, 1], widthDeg: 60, heightDeg: 60, radiance: [0.06, 0.06, 0.06] }],
};

/** Angle in degrees between a light's direction and the camera axis (+Z). */
export function angleFromCameraAxisDeg(l: AreaLight): number {
  return Math.acos(Math.max(-1, Math.min(1, l.dir[2]))) / deg;
}

/**
 * Radiance in a given direction (lights override the surround). Lights are
 * treated as rectangles in angular coordinates around their centre direction.
 */
export function radianceAt(env: StudioLighting, d: Dir): RGB {
  for (const l of [...env.lights, ...(env.flags ?? [])]) {
    const c = l.dir;
    const cosA = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
    if (cosA <= 0) continue;
    // Tangent frame at the light centre: u horizontal, v perpendicular.
    const up: Dir = Math.abs(c[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const u = norm([up[1] * c[2] - up[2] * c[1], up[2] * c[0] - up[0] * c[2], up[0] * c[1] - up[1] * c[0]]);
    const v: Dir = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
    const du = Math.atan2(d[0] * u[0] + d[1] * u[1] + d[2] * u[2], cosA) / deg;
    const dv = Math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], cosA) / deg;
    if (Math.abs(du) <= l.widthDeg / 2 && Math.abs(dv) <= l.heightDeg / 2) return l.radiance;
  }
  return d[1] >= 0 ? env.surroundUp : env.surroundDown;
}

/**
 * Normalised irradiance on a surface with normal n, by numerical integration
 * over the hemisphere (stratified, deterministic).
 */
export function irradiance(env: StudioLighting, n: Dir, steps = 360): RGB {
  const nn = norm(n);
  // Basis around n.
  const t = norm(Math.abs(nn[1]) > 0.9 ? [1, 0, 0] : [nn[2], 0, -nn[0]]);
  const b: Dir = [nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]];
  const acc: RGB = [0, 0, 0];
  let weight = 0;
  // Cosine-weighted stratified sampling: uniform in (sin^2 theta, phi).
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const s = (i + 0.5) / steps;
      const phi = ((j + 0.5) / steps) * 2 * Math.PI;
      const sinT = Math.sqrt(s);
      const cosT = Math.sqrt(1 - s);
      const d: Dir = [
        t[0] * sinT * Math.cos(phi) + b[0] * sinT * Math.sin(phi) + nn[0] * cosT,
        t[1] * sinT * Math.cos(phi) + b[1] * sinT * Math.sin(phi) + nn[1] * cosT,
        t[2] * sinT * Math.cos(phi) + b[2] * sinT * Math.sin(phi) + nn[2] * cosT,
      ];
      const L = radianceAt(env, d);
      acc[0] += L[0];
      acc[1] += L[1];
      acc[2] += L[2];
      weight++;
    }
  }
  // With cosine-weighted samples, (1/pi) * integral(L cos) = mean(L).
  return [acc[0] / weight, acc[1] / weight, acc[2] / weight];
}

/**
 * Exposure that makes a surface facing the camera (+Z) receive normalised
 * irradiance 1, so an 18 % grey card renders 0.18.
 */
export function exposureFor(env: StudioLighting): number {
  return 1 / lum(irradiance(env, [0, 0, 1]));
}

/** Expected linear value of a flat dielectric facing the camera: diffuse + Fresnel reflection of the axis. */
export function expectedFlatDielectric(env: StudioLighting, albedo: number, f0 = 0.04): { diffuse: number; specular: number } {
  const k = exposureFor(env);
  const axis = lum(radianceAt(env, [0, 0, 1]));
  return { diffuse: albedo * (1 - f0) * 1, specular: f0 * axis * k };
}
