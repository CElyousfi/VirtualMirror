/**
 * QA-only tooling. Imported by the QA Lab dev page, never by the storefront
 * bundle (src/index.ts does not import this file).
 *
 * - replayVideo: deterministic, frame-stepped replay of a prerecorded video
 *   through the exact storefront pipeline (tracker, smoother, renderer).
 * - StudioViewer: orbit/preset views of a GLB rendered with the mirror's own
 *   materials, tone mapping and lighting, for comparison with product photos.
 */
import {
  Box3,
  GridHelper,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { compositeFrame, stampLabel } from "./capture";
import { summariseTrace, type TraceFrame, type TraceSummary } from "./core/metrics";
import { PoseSmoother } from "./core/pose";
import { stepPipeline, toTraceFrame } from "./pipeline";
import { MirrorRenderer, configureRenderer, disposeObject, prepareGlassesMaterials } from "./renderer";
import { createTracker } from "./tracker";
import { COMMIT } from "./index";

// ------------------------------------------------------------------ replay

export interface ReplayOptions {
  videoUrl: string;
  glbUrl: string;
  bridgeM?: [number, number, number];
  /** Frames per second to step at. Default 30. */
  fps?: number;
  /** Stop after this many frames. Default: whole video. */
  maxFrames?: number;
  /** Capture the composited output every N frames (0 = never). */
  captureEvery?: number;
  label: string;
  mirror?: boolean;
  wasmBaseUrl?: string;
  modelUrl?: string;
  onProgress?: (frame: number, total: number) => void;
}

export interface ReplayResult {
  commit: string;
  label: string;
  video: { width: number; height: number; durationS: number };
  fps: number;
  trackerReadyMs: number;
  delegate: "GPU" | "CPU";
  gpu: string | null;
  wallClockMs: number;
  trace: TraceFrame[];
  summary: TraceSummary;
  captures: { frame: number; tMs: number; dataUrl: string }[];
}

function waitFor(el: HTMLMediaElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => (cleanup(), resolve());
    const bad = () => (cleanup(), reject(new Error(`Video error while waiting for ${event}`)));
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", bad);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

/**
 * Seek to each frame time, run the storefront pipeline on it, record a trace.
 * Media timestamps (not wall-clock) drive MediaPipe and the smoother, so two
 * runs over the same file see the same inputs.
 */
export async function replayVideo(opts: ReplayOptions): Promise<ReplayResult> {
  const t0 = performance.now();
  const fps = opts.fps ?? 30;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden";
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  host.append(video, canvas);
  document.body.append(host);

  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = opts.videoUrl;
  await waitFor(video, "loadeddata");
  video.pause();

  const renderer = new MirrorRenderer(canvas);
  renderer.resize(video.videoWidth, video.videoHeight);
  await renderer.loadFrame(opts.glbUrl, opts.bridgeM ?? [0, 0, 0]);
  const tracker = await createTracker({ wasmBase: opts.wasmBaseUrl, modelUrl: opts.modelUrl });
  const trackerReadyMs = Math.round(performance.now() - t0);
  const smoother = new PoseSmoother();

  const total = Math.min(opts.maxFrames ?? Infinity, Math.floor(video.duration * fps));
  const trace: TraceFrame[] = [];
  const captures: ReplayResult["captures"] = [];
  try {
    for (let i = 0; i < total; i++) {
      const tMs = (i * 1000) / fps;
      video.currentTime = tMs / 1000;
      await waitFor(video, "seeked");
      const r = stepPipeline(tracker, smoother, renderer, video, tMs);
      trace.push(toTraceFrame(i, tMs, r, renderer, video.videoWidth, video.videoHeight));
      if (opts.captureEvery && i % opts.captureEvery === 0) {
        const label = `${opts.label}\n${COMMIT} · replay frame ${i} · t=${(tMs / 1000).toFixed(2)}s · ${r.obs ? "tracked" : r.held ? "held" : "no face"}`;
        captures.push({ frame: i, tMs, dataUrl: compositeFrame(video, canvas, { mirror: opts.mirror ?? true, label }).toDataURL("image/png") });
      }
      opts.onProgress?.(i + 1, total);
    }
  } catch (err) {
    renderer.dispose();
    host.remove();
    throw err;
  } finally {
    tracker.close();
  }
  const gpu = renderer.gpuDescription();
  renderer.dispose();
  host.remove();
  return {
    commit: COMMIT,
    label: opts.label,
    video: { width: video.videoWidth, height: video.videoHeight, durationS: Math.round(video.duration * 100) / 100 },
    fps,
    trackerReadyMs,
    delegate: tracker.delegate,
    gpu,
    wallClockMs: Math.round(performance.now() - t0),
    trace,
    summary: summariseTrace(trace, video.videoWidth),
    captures,
  };
}

/** Largest anchor difference between two replays of the same video (determinism check). */
export function compareTraces(a: TraceFrame[], b: TraceFrame[]): { frames: number; trackedMismatches: number; maxAnchorDiffPx: number } {
  let mism = 0;
  let maxDiff = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.tracked !== y.tracked) mism++;
    if (x.anchorPx && y.anchorPx) maxDiff = Math.max(maxDiff, Math.hypot(x.anchorPx.x - y.anchorPx.x, x.anchorPx.y - y.anchorPx.y));
  }
  return { frames: n, trackedMismatches: mism, maxAnchorDiffPx: Math.round(maxDiff * 100) / 100 };
}

// ------------------------------------------------------------------ studio viewer

export type StudioView = "front" | "side" | "threeQuarter" | "top";
export type RenderMode = "shaded" | "silhouette" | "wireframe";

export class StudioViewer {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private persp = new PerspectiveCamera(20, 1, 0.001, 10);
  private ortho = new OrthographicCamera(-1, 1, 1, -1, 0.001, 10);
  private camera: PerspectiveCamera | OrthographicCamera = this.persp;
  private controls: OrbitControls;
  private model: Object3D | null = null;
  private grid: GridHelper;
  private bounds = new Box3();
  private mode: RenderMode = "shaded";
  private raf = 0;
  view: StudioView = "front";
  elevationDeg = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    configureRenderer(this.renderer, this.scene);
    container.append(this.renderer.domElement);
    this.renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // 10 mm grid in the frame-front plane, for scale.
    this.grid = new GridHelper(0.3, 30, 0x888888, 0xcccccc);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.visible = false;
    this.scene.add(this.grid);
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }
    this.model = gltf.scene;
    prepareGlassesMaterials(this.model);
    this.scene.add(this.model);
    this.bounds.setFromObject(this.model);
    this.setRenderMode(this.mode);
    this.setView(this.view);
  }

  setGrid(on: boolean): void {
    this.grid.visible = on;
  }

  setBackground(color: number | null): void {
    this.renderer.setClearColor(color ?? 0x000000, color === null ? 0 : 1);
  }

  setRenderMode(mode: RenderMode): void {
    this.mode = mode;
    this.scene.overrideMaterial =
      mode === "silhouette" ? new MeshBasicMaterial({ color: 0x000000 }) : mode === "wireframe" ? new MeshBasicMaterial({ color: 0x1d4ed8, wireframe: true }) : null;
  }

  setProjection(kind: "perspective" | "orthographic"): void {
    this.camera = kind === "orthographic" ? this.ortho : this.persp;
    this.controls.object = this.camera;
    this.resize();
    this.setView(this.view);
  }

  /**
   * Preset cameras in ASSET space (+Z = frame front, +X = wearer's left):
   * front looks at the front (wearer's left on screen right, like a product photo),
   * side looks at the wearer's left side, threeQuarter is 45 degrees between them.
   */
  setView(view: StudioView, elevationDeg = this.elevationDeg): void {
    this.view = view;
    this.elevationDeg = elevationDeg;
    const centre = this.bounds.isEmpty() ? new Vector3() : this.bounds.getCenter(new Vector3());
    const size = this.bounds.isEmpty() ? new Vector3(0.14, 0.05, 0.15) : this.bounds.getSize(new Vector3());
    const az = { front: 0, threeQuarter: 45, side: 90, top: 0 }[view];
    const el = view === "top" ? 89 : elevationDeg;
    const radius = Math.max(size.x, size.y, size.z) * 4;
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    this.camera.position.set(centre.x + radius * Math.sin(a) * Math.cos(e), centre.y + radius * Math.sin(e), centre.z + radius * Math.cos(a) * Math.cos(e));
    this.controls.target.copy(centre);
    this.camera.lookAt(centre);
    this.fitOrtho(size);
    this.controls.update();
  }

  private fitOrtho(size: Vector3): void {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const half = (Math.max(size.x, size.z) * 1.15) / 2;
    this.ortho.left = -half;
    this.ortho.right = half;
    this.ortho.top = half / aspect;
    this.ortho.bottom = -half / aspect;
    this.ortho.updateProjectionMatrix();
  }

  /** Metres per CSS pixel in orthographic mode (for overlay scale readouts). */
  metresPerPixel(): number | null {
    if (this.camera !== this.ortho) return null;
    return (this.ortho.right - this.ortho.left) / this.ortho.zoom / Math.max(1, this.container.clientWidth);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    if (!this.bounds.isEmpty()) this.fitOrtho(this.bounds.getSize(new Vector3()));
  }

  /** PNG of exactly what the renderer drew, with an identifying label strip. */
  capture(label: string, background = "#ffffff"): string {
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext("2d")!;
    g.fillStyle = background;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0);
    stampLabel(g, out.width, out.height, label);
    return out.toDataURL("image/png");
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    if (this.model) disposeObject(this.model);
    this.renderer.dispose();
  }
}
