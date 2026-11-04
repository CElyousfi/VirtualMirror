/**
 * Builds a three.js scene from a StudioLighting description (core/lighting.ts)
 * for PMREM pre-filtering. The same data drives the analytic exposure, so the
 * render can be checked against the maths (dev/diagnose-materials.html).
 */
import {
  BackSide,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  type Side,
} from "three";
import type { AreaLight, RGB, StudioLighting } from "./core/lighting";

const R = 50;

function basic(c: RGB, side: Side = DoubleSide) {
  const m = new MeshBasicMaterial({ side, toneMapped: false });
  // Linear radiance; values above 1 are intended (light sources).
  m.color.setRGB(c[0], c[1], c[2]);
  return m;
}

function panel(l: AreaLight, distance: number): Mesh {
  const c = new Vector3(...l.dir).normalize();
  const up = Math.abs(c.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(up, c).normalize();
  const v = new Vector3().crossVectors(c, u);
  const w = 2 * distance * Math.tan(((l.widthDeg / 2) * Math.PI) / 180);
  const h = 2 * distance * Math.tan(((l.heightDeg / 2) * Math.PI) / 180);
  const mesh = new Mesh(new PlaneGeometry(w, h), basic(l.radiance));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.copy(new Matrix4().makeBasis(u, v, c).setPosition(c.clone().multiplyScalar(distance)));
  mesh.name = l.name;
  return mesh;
}

export function buildStudioScene(env: StudioLighting): Scene {
  const scene = new Scene();
  const upper = new Mesh(new SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), basic(env.surroundUp, BackSide));
  const lower = new Mesh(new SphereGeometry(R, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), basic(env.surroundDown, BackSide));
  scene.add(upper, lower);
  // Lights nearer than flags so they take precedence, matching radianceAt().
  for (const f of env.flags ?? []) scene.add(panel(f, R * 0.95));
  for (const l of env.lights) scene.add(panel(l, R * 0.9));
  scene.updateMatrixWorld(true);
  return scene;
}

export function disposeScene(scene: Scene): void {
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
  });
}
