/**
 * Material diagnostics: why does a black frame render grey?
 *
 * Renders a flat plate facing the camera (+Z) and the demo frame, with the
 * renderer setup the product uses (configureRenderer + prepareGlassesMaterials),
 * then switches one factor off at a time and reads back pixel values.
 * Results are written to window.__diag as JSON. Open /dev/diagnose-materials.html.
 */
import {
  ACESFilmicToneMapping,
  Mesh,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
  type Material,
  type ToneMapping,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { configureRenderer, prepareGlassesMaterials, type EnvironmentId } from "../src/renderer";
import { STUDIO_V1, expectedFlatDielectric, exposureFor } from "../src/core/lighting";

const SIZE = 256;
const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const renderer = new WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
document.body.append(renderer.domElement);
const envId = (new URLSearchParams(location.search).get("env") ?? "studio-v1") as EnvironmentId;
const scene = new Scene();
configureRenderer(renderer, scene, envId);
const baseIntensity = scene.environmentIntensity;
const camera = new OrthographicCamera(-0.08, 0.08, 0.08, -0.08, 0.001, 10);
camera.position.set(0, 0, 1);
camera.lookAt(0, 0, 0);

function read(): Uint8Array {
  const gl = renderer.getContext();
  const px = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

/** Mean sRGB value (0-255) of pixels where the mask is set. */
function mean(px: Uint8Array, mask: Uint8Array | null): { srgb: number; linear: number; n: number } {
  let s = 0;
  let n = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (mask ? !mask[i] : px[i * 4 + 3]! < 250) continue;
    s += (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]!) / 3;
    n++;
  }
  const srgb = n ? s / n : 0;
  return { srgb: Math.round(srgb * 10) / 10, linear: Math.round(srgbToLinear(srgb) * 10000) / 10000, n };
}

function plate(mat: MeshPhysicalMaterial, tone: ToneMapping, opts: { tiltXDeg?: number; envIntensity?: number } = {}) {
  renderer.toneMapping = tone;
  scene.environmentIntensity = baseIntensity * (opts.envIntensity ?? 1);
  const m = new Mesh(new PlaneGeometry(0.1, 0.1), mat);
  m.rotation.x = ((opts.tiltXDeg ?? 0) * Math.PI) / 180;
  scene.add(m);
  renderer.render(scene, camera);
  const r = mean(read(), null);
  scene.remove(m);
  scene.environmentIntensity = baseIntensity;
  m.geometry.dispose();
  mat.dispose();
  return r;
}

const acetate = (over: Partial<MeshPhysicalMaterial> = {}) =>
  Object.assign(
    new MeshPhysicalMaterial({ color: 0x000000, roughness: 0.32, metalness: 0 }),
    over,
  );

async function run() {
  // glTF baseColorFactor 0.03 is LINEAR. Three colours set via setRGB in linear working space.
  const base = (m: MeshPhysicalMaterial, v: number) => (m.color.setRGB(v, v, v), m);
  const out: Record<string, unknown> = {
    environment: envId,
    environmentIntensity: baseIntensity,
    predicted_studio_v1_flatBlack: envId === "studio-v1" ? { ...expectedFlatDielectric(STUDIO_V1, 0.03), exposure: exposureFor(STUDIO_V1) } : null,
    plate: {
      A_current: plate(base(acetate(), 0.03), NeutralToneMapping),
      B_diffuseOnly: plate(base(acetate({ specularIntensity: 0 }), 0.03), NeutralToneMapping),
      B2_diffuseOnly_noTone: plate(base(acetate({ specularIntensity: 0 }), 0.03), NoToneMapping),
      C_specularOnly: plate(base(acetate(), 0), NeutralToneMapping),
      D_noToneMapping: plate(base(acetate(), 0.03), NoToneMapping),
      E_whiteDiffuse_irradiance_noTone: plate(base(acetate({ specularIntensity: 0 }), 1), NoToneMapping),
      F_materialEnvMapIntensity0_1_ignored: plate(base(acetate({ envMapIntensity: 0.1 }), 0.03), NeutralToneMapping),
      G_rough0_8: plate(base(acetate({ roughness: 0.8 }), 0.03), NeutralToneMapping),
      H_aces: plate(base(acetate(), 0.03), ACESFilmicToneMapping),
      // Unclipped irradiance: an 18% grey card, diffuse only, no tone mapping. irradiance = linear / 0.18.
      I_greyCard18_noTone: plate(base(acetate({ specularIntensity: 0 }), 0.18), NoToneMapping),
      // The intensity control that three.js actually honours with scene.environment.
      J_sceneEnvIntensityHalf: plate(base(acetate(), 0.03), NeutralToneMapping, { envIntensity: 0.5 }),
      // Angle dependence: the same plate tilted away from the camera-side softbox.
      K_tilt20: plate(base(acetate(), 0.03), NeutralToneMapping, { tiltXDeg: 20 }),
      K_tilt40: plate(base(acetate(), 0.03), NeutralToneMapping, { tiltXDeg: 40 }),
      K_tiltMinus20: plate(base(acetate(), 0.03), NeutralToneMapping, { tiltXDeg: -20 }),
    },
    // Colour fidelity: a matte (diffuse-only) plate of base colour c, exposure
    // normalised, should render as c * (grey-card ratio). Compare tone mappings.
    colourFidelity: Object.fromEntries(
      [0.03, 0.1, 0.18, 0.4, 0.7].flatMap((c) => [
        [`base_${c}_noTone`, plate(base(acetate({ specularIntensity: 0 }), c), NoToneMapping)],
        [`base_${c}_neutral`, plate(base(acetate({ specularIntensity: 0 }), c), NeutralToneMapping)],
      ]),
    ),
    _: {
    },
  };

  // The demo frame itself, front view, current setup. Mask = opaque pixels.
  renderer.toneMapping = NeutralToneMapping;
  const gltf = await new GLTFLoader().loadAsync("/demo-frame.glb");
  prepareGlassesMaterials(gltf.scene);
  scene.add(gltf.scene);
  renderer.render(scene, camera);
  const frameFront = mean(read(), null);
  // Same frame with specular switched off on every material.
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { specularIntensity?: number })[];
    mats.forEach((m) => {
      if (m.transparent) m.visible = false;
    });
  });
  renderer.render(scene, camera);
  const frameNoLens = mean(read(), null);
  out.frame = { front_current: frameFront, front_withoutLenses: frameNoLens };
  (window as unknown as { __diag: unknown }).__diag = out;
  document.body.append(Object.assign(document.createElement("pre"), { textContent: JSON.stringify(out, null, 2) }));
}
void run();
