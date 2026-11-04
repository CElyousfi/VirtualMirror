import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FACE_GEOMETRY_CAMERA, assetToFaceMatrix, type Vec3 } from "@vm/contracts";
import { CANONICAL_FACE_INDICES, CANONICAL_FACE_POSITIONS_CM } from "./canonical-face";
import { STUDIO_V1, exposureFor } from "./core/lighting";
import { buildStudioScene, disposeScene } from "./studio-environment";

/**
 * Depth-only occluders, in FACE space (centimetres):
 * - the MediaPipe canonical face mesh, moved back slightly so it never clips
 *   the frame front against the nose (hides the far temple behind the face);
 * - an ellipsoid head proxy behind it (hides temples behind the head).
 * Both are rigid approximations of the shopper's head; a per-frame
 * landmark-deformed mesh is a Milestone 2 improvement.
 */
const FACE_OCCLUDER_OFFSET_CM = -0.4;
const OCCLUDER = { centreCm: [0, 1.0, -3.0] as Vec3, radiiCm: [7.0, 9.5, 8.0] as Vec3 };

/**
 * Lighting environments. "studio-v1" is calibrated (core/lighting.ts): exposure
 * normalised so an 18 % grey card facing the camera reads 0.18, and nothing
 * bright on the camera axis. "room-legacy" is three.js RoomEnvironment, kept
 * only so diagnostics can compare against the old look (it renders black
 * frames grey: docs/REALISM_PLAN.md §1.2).
 */
export type EnvironmentId = "studio-v1" | "room-legacy";

/** Material treatment applied to every loaded frame. Shared with the QA studio viewer. */
export function prepareGlassesMaterials(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // Note: material.envMapIntensity is ignored by three.js when lighting comes
    // from scene.environment (it uses scene.environmentIntensity), so exposure
    // is controlled in configureRenderer, not per material.
    mesh.renderOrder = 1;
  });
}

/** Renderer settings shared by the mirror and the QA studio viewer. */
export function configureRenderer(r: WebGLRenderer, scene: Scene, environment: EnvironmentId = "studio-v1"): PMREMGenerator {
  r.setClearColor(0x000000, 0);
  r.outputColorSpace = SRGBColorSpace;
  // No tone mapping. Measured (dev/diagnose-materials.html, REALISM_PLAN §1.2):
  // with exposure normalised, untone-mapped output reproduces base colours
  // 0.03-0.7 within +-2 %, while Khronos PBR Neutral darkens them by 81 % (black)
  // to 5 % (light) because of its toe. The camera video we composite over is
  // not tone-mapped either. Specular highlights clip to white, as in a photo.
  r.toneMapping = NoToneMapping;
  const pmrem = new PMREMGenerator(r);
  if (environment === "room-legacy") {
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 1;
  } else {
    const studio = buildStudioScene(STUDIO_V1);
    scene.environment = pmrem.fromScene(studio, 0.01).texture;
    disposeScene(studio);
    scene.environmentIntensity = exposureFor(STUDIO_V1);
  }
  return pmrem;
}

export interface RendererStats {
  pixelRatio: number;
}

export class MirrorRenderer {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private face = new Group();
  private holder = new Group();
  private glasses: Object3D | null = null;
  private pmrem: PMREMGenerator;
  private loader = new GLTFLoader();
  private occluder: Mesh;
  private faceOccluder: Mesh;
  private debugOccluder = false;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { onContextLost?: () => void; showOccluder?: boolean } = {},
  ) {
    this.renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.pmrem = configureRenderer(this.renderer, this.scene);

    this.camera = new PerspectiveCamera(FACE_GEOMETRY_CAMERA.verticalFovDeg, 4 / 3, FACE_GEOMETRY_CAMERA.near, FACE_GEOMETRY_CAMERA.far);
    this.face.matrixAutoUpdate = false;
    this.holder.matrixAutoUpdate = false;
    this.face.visible = false;
    this.face.add(this.holder);
    this.scene.add(this.face);

    this.debugOccluder = !!opts.showOccluder;
    this.occluder = new Mesh(
      new SphereGeometry(1, 32, 24),
      new MeshBasicMaterial({ colorWrite: this.debugOccluder, color: 0xff00ff, transparent: this.debugOccluder, opacity: 0.25 }),
    );
    this.occluder.position.set(...OCCLUDER.centreCm);
    this.occluder.scale.set(...OCCLUDER.radiiCm);
    this.occluder.renderOrder = -1;
    this.face.add(this.occluder);

    const faceGeo = new BufferGeometry();
    faceGeo.setAttribute("position", new BufferAttribute(CANONICAL_FACE_POSITIONS_CM, 3));
    faceGeo.setIndex(new BufferAttribute(CANONICAL_FACE_INDICES, 1));
    this.faceOccluder = new Mesh(
      faceGeo,
      new MeshBasicMaterial({ colorWrite: this.debugOccluder, color: 0x00ffff, transparent: this.debugOccluder, opacity: 0.25, side: DoubleSide }),
    );
    this.faceOccluder.position.z = FACE_OCCLUDER_OFFSET_CM;
    this.faceOccluder.renderOrder = -1;
    this.face.add(this.faceOccluder);

    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      opts.onContextLost?.();
    });
  }

  /** Match the drawing buffer to the video's intrinsic size; CSS handles cropping identically for both. */
  resize(videoWidth: number, videoHeight: number): void {
    this.renderer.setSize(videoWidth, videoHeight, false);
    this.camera.aspect = videoWidth / videoHeight;
    this.camera.updateProjectionMatrix();
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  async loadFrame(url: string, bridgeM: Vec3): Promise<void> {
    const gltf = await this.loader.loadAsync(url);
    if (this.glasses) {
      this.holder.remove(this.glasses);
      disposeObject(this.glasses);
    }
    this.glasses = gltf.scene;
    prepareGlassesMaterials(this.glasses);
    // ASSET (metres) -> FACE (cm): one documented conversion, see @vm/contracts.
    this.holder.matrix.fromArray(assetToFaceMatrix({ assetBridgeM: bridgeM }));
    this.holder.matrixWorldNeedsUpdate = true;
    this.holder.add(this.glasses);
  }

  /** FACE -> CAMERA matrix (column-major), or null to hide. */
  setFacePose(matrix: number[] | null): void {
    if (!matrix) {
      this.face.visible = false;
      return;
    }
    this.face.matrix.copy(new Matrix4().fromArray(matrix));
    this.face.matrixWorldNeedsUpdate = true;
    this.face.visible = true;
  }

  setGlassesVisible(visible: boolean): void {
    this.holder.visible = visible;
  }

  /** Project a FACE-space point (cm) to normalised image coords, for debugging alignment. */
  projectFacePoint(p: Vec3): { x: number; y: number } | null {
    if (!this.face.visible) return null;
    this.face.updateMatrixWorld(true);
    const v = new Matrix4().copy(this.face.matrixWorld);
    const e = v.elements;
    const x = e[0]! * p[0] + e[4]! * p[1] + e[8]! * p[2] + e[12]!;
    const y = e[1]! * p[0] + e[5]! * p[1] + e[9]! * p[2] + e[13]!;
    const z = e[2]! * p[0] + e[6]! * p[1] + e[10]! * p[2] + e[14]!;
    const f = 1 / Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const ndcX = (f / this.camera.aspect) * (x / -z);
    const ndcY = f * (y / -z);
    return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** GPU name for reports, when the browser exposes it. */
  gpuDescription(): string | null {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  }

  dispose(): void {
    if (this.glasses) disposeObject(this.glasses);
    disposeObject(this.occluder);
    disposeObject(this.faceOccluder);
    this.scene.environment?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      for (const value of Object.values(m)) {
        if (value && typeof value === "object" && "isTexture" in value) (value as { dispose(): void }).dispose();
      }
      m.dispose();
    });
  });
}
