/**
 * Virtual Mirror storefront widget. Loaded on demand by the theme block when a
 * shopper clicks "Try On Live"; nothing here runs before that click.
 *
 * Exposes window.VirtualMirror.open(config). The `source`, `qa` and `mirror`
 * options exist for the internal QA Lab; the storefront loader never sets them.
 */
import { CANONICAL_LANDMARKS_CM, DEFAULT_BRIDGE_ANCHOR_CM, type StorefrontAsset } from "@vm/contracts";
import { CameraStartError, startCamera, startVideoFile, stopCamera } from "./camera";
import { LocalRecorder, compositeFrame, downloadBlob } from "./capture";
import { assetForVariant, parseManifest } from "./core/assets";
import { summariseTrace, type TraceFrame, type TraceSummary } from "./core/metrics";
import { PoseSmoother } from "./core/pose";
import { MSG } from "./messages";
import { stepPipeline, toTraceFrame } from "./pipeline";
import { MirrorRenderer } from "./renderer";
import { createTracker, type Tracker } from "./tracker";
import { createUi } from "./ui";

declare const __VM_COMMIT__: string;
export const VERSION = "0.2.0";
export const COMMIT = typeof __VM_COMMIT__ === "string" ? __VM_COMMIT__ : "dev";

export type FrameSourceConfig = { kind: "camera" } | { kind: "video"; url: string; loop?: boolean };

export interface QaConfig {
  /** Shown on screen and stamped on every capture, e.g. "Generic frame (not the product) · demo-frame.glb". */
  label: string;
  /** Keep a per-frame trace (no images) in lastSession.trace. */
  trace?: boolean;
  /** Called with each capture (PNG data URL of the composited renderer output). */
  onCapture?: (dataUrl: string, meta: { frame: number; tMs: number }) => void;
  /** Called with the session stats when the mirror closes. */
  onClose?: (stats: SessionStats) => void;
}

export interface OpenConfig {
  manifest: unknown;
  productTitle: string;
  variantId: string | null;
  /** e.g. "/cart/add.js" with the shop's locale root. */
  cartAddUrl: string;
  cartUrl: string;
  accentColor?: string;
  accentTextColor?: string;
  wasmBaseUrl?: string;
  modelUrl?: string;
  debug?: boolean;
  /** Element to return focus to on close. */
  returnFocusTo?: HTMLElement | null;
  /** Default: the front camera. */
  source?: FrameSourceConfig;
  /** Mirror the image like a mirror. Default true. */
  mirror?: boolean;
  qa?: QaConfig;
}

/** Measured per session; never estimated. Read from window.VirtualMirror.lastSession. */
export interface SessionStats {
  version: string;
  commit: string;
  userAgent: string;
  gpu: string | null;
  source: "camera" | "video";
  startedAt: string;
  cameraReadyMs: number | null;
  trackerReadyMs: number | null;
  frameReadyMs: number | null;
  firstTrackedMs: number | null;
  delegate: "GPU" | "CPU" | null;
  videoSize: string | null;
  frames: number;
  trackedFrames: number;
  avgFps: number;
  avgDetectMs: number;
  p95DetectMs: number;
  pixelRatio: number | null;
  adaptiveDowngrades: number;
  error: string | null;
  summary?: TraceSummary;
  trace?: TraceFrame[];
}

const MAX_TRACE = 18_000; // ~10 minutes at 30 fps

let active: { close: () => void; capture: () => Promise<string | null> } | null = null;
let lastSession: SessionStats | null = null;

export function open(cfg: OpenConfig): void {
  if (active) return;
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const source = cfg.source ?? { kind: "camera" };
  const mirror = cfg.mirror ?? true;
  const stats: SessionStats = {
    version: VERSION,
    commit: COMMIT,
    userAgent: navigator.userAgent,
    gpu: null,
    source: source.kind,
    startedAt: new Date().toISOString(),
    cameraReadyMs: null,
    trackerReadyMs: null,
    frameReadyMs: null,
    firstTrackedMs: null,
    delegate: null,
    videoSize: null,
    frames: 0,
    trackedFrames: 0,
    avgFps: 0,
    avgDetectMs: 0,
    p95DetectMs: 0,
    pixelRatio: null,
    adaptiveDowngrades: 0,
    error: null,
  };
  const trace: TraceFrame[] = [];
  if (cfg.qa?.trace) stats.trace = trace;
  lastSession = stats;

  const ui = createUi({ productTitle: cfg.productTitle, accentColor: cfg.accentColor, accentTextColor: cfg.accentTextColor });
  ui.setMirrored(mirror);
  const manifest = parseManifest(cfg.manifest);
  let variantId = cfg.variantId;
  let stream: MediaStream | null = null;
  let tracker: Tracker | null = null;
  let renderer: MirrorRenderer | null = null;
  let raf = 0;
  let closed = false;
  let glassesVisible = true;
  let frameLoaded = false;
  const smoother = new PoseSmoother();
  const detectTimes: number[] = [];
  let fpsWindowStart = performance.now();
  let fpsWindowFrames = 0;
  const pendingCaptures: ((url: string | null) => void)[] = [];
  const recorder = cfg.qa && LocalRecorder.supported() ? new LocalRecorder() : null;

  const fail = (text: string, code: string) => {
    stats.error = code;
    ui.showError(text);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    pendingCaptures.splice(0).forEach((r) => r(null));
    if (recorder?.active) downloadBlob(await recorder.stop(), `virtual-mirror-session-${Date.now()}.webm`);
    stopCamera(stream, ui.video);
    tracker?.close();
    renderer?.dispose();
    ui.destroy();
    active = null;
    finaliseStats();
    if (cfg.debug) console.info("[VirtualMirror] session", JSON.stringify({ ...stats, trace: undefined }));
    cfg.qa?.onClose?.(stats);
    cfg.returnFocusTo?.focus();
  };

  const capture = () =>
    new Promise<string | null>((resolve) => {
      if (closed || !renderer) return resolve(null);
      pendingCaptures.push(resolve);
    });

  active = { close: () => void close(), capture };
  ui.onClose(() => void close());

  function finaliseStats() {
    const elapsed = (performance.now() - t0) / 1000;
    stats.avgFps = elapsed > 0 ? Math.round((stats.frames / elapsed) * 10) / 10 : 0;
    if (detectTimes.length) {
      const sorted = [...detectTimes].sort((a, b) => a - b);
      stats.avgDetectMs = Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10;
      stats.p95DetectMs = Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10;
    }
    if (cfg.qa?.trace && ui.video.videoWidth) stats.summary = summariseTrace(trace, ui.video.videoWidth);
  }

  if (!manifest) return fail(MSG.errors.unavailable, "no-manifest");

  if (cfg.qa) {
    ui.setQaBanner(cfg.qa.label);
    ui.setQaControls({
      capture: async () => {
        const url = await capture();
        if (url) cfg.qa?.onCapture?.(url, { frame: stats.frames, tMs: since() });
      },
      toggleRecording: recorder
        ? async () => {
            if (recorder.active) {
              downloadBlob(await recorder.stop(), `virtual-mirror-session-${Date.now()}.webm`);
              return false;
            }
            recorder.start();
            return true;
          }
        : null,
    });
  }

  // Variant chips: only assets that represent concrete variants with a label.
  const labelled = manifest.assets.filter((a) => a.label && !a.variantIds.includes("*"));
  const renderChips = () =>
    ui.setVariants(
      labelled.map((a) => ({ key: a.variantIds[0]!, label: a.label!, selected: !!variantId && a.variantIds.includes(variantId) })),
      (key) => {
        variantId = key;
        renderChips();
        void showAsset(assetForVariant(manifest, variantId));
      },
    );
  renderChips();
  ui.setCart(variantId && !cfg.qa ? "idle" : "hidden");

  ui.onToggleGlasses(() => {
    glassesVisible = !glassesVisible;
    renderer?.setGlassesVisible(glassesVisible);
    ui.setGlassesToggle(glassesVisible);
  });

  ui.onAddToCart(async () => {
    if (!variantId) return;
    ui.setCart("busy");
    try {
      const res = await fetch(cfg.cartAddUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      ui.setCart("done", cfg.cartUrl);
      document.dispatchEvent(new CustomEvent("virtual-mirror:cart-added", { detail: { variantId } }));
    } catch {
      ui.setCart("error");
    }
  });

  async function showAsset(asset: StorefrontAsset | null) {
    if (!renderer) return;
    if (!asset) {
      renderer.setGlassesVisible(false);
      ui.setStatus(MSG.variantUnavailable);
      return;
    }
    ui.setStatus(MSG.loadingFrame);
    try {
      await renderer.loadFrame(asset.glbUrl, asset.bridgeM);
      renderer.setGlassesVisible(glassesVisible);
      frameLoaded = true;
      stats.frameReadyMs ??= since();
      ui.setStatus("");
    } catch (err) {
      console.error("[VirtualMirror] frame load failed", err);
      fail(MSG.errors.frameFailed, "frame-load");
    }
  }

  void (async () => {
    ui.setStatus(MSG.starting);
    try {
      if (source.kind === "video") await startVideoFile(ui.video, source.url, source.loop ?? true);
      else stream = await startCamera(ui.video);
      stats.cameraReadyMs = since();
      stats.videoSize = `${ui.video.videoWidth}x${ui.video.videoHeight}`;
    } catch (err) {
      if (source.kind === "video") return fail(String((err as Error).message), "video-load");
      const kind = err instanceof CameraStartError ? err.kind : "unsupported";
      return fail(MSG.errors[kind], `camera-${kind}`);
    }
    if (closed) return close();

    try {
      renderer = new MirrorRenderer(ui.canvas, {
        showOccluder: cfg.debug,
        // dispose() releases the context on purpose when the session closes; only a loss
        // while the session is still open is an error.
        onContextLost: () => {
          if (!closed) fail(MSG.errors.trackerFailed, "webgl-context-lost");
        },
      });
      renderer.resize(ui.video.videoWidth, ui.video.videoHeight);
      stats.pixelRatio = renderer.pixelRatio;
      stats.gpu = renderer.gpuDescription();
    } catch {
      return fail(MSG.errors.unsupported, "webgl-unavailable");
    }

    ui.setStatus(MSG.loadingTracker);
    const assetPromise = showAsset(assetForVariant(manifest, variantId));
    try {
      tracker = await createTracker({ wasmBase: cfg.wasmBaseUrl, modelUrl: cfg.modelUrl });
      stats.trackerReadyMs = since();
      stats.delegate = tracker.delegate;
    } catch (err) {
      console.error("[VirtualMirror] tracker failed", err);
      return fail(MSG.errors.trackerFailed, "tracker-init");
    }
    await assetPromise;
    if (closed) return close();
    loop();
  })();

  function loop() {
    if (closed || !tracker || !renderer) return;
    raf = requestAnimationFrame(loop);
    const video = ui.video;
    if (video.readyState < 2) return;
    const now = performance.now();

    const r = stepPipeline(tracker, smoother, renderer, video, now);
    detectTimes.push(r.detectMs);
    if (detectTimes.length > 600) detectTimes.shift();
    stats.frames++;
    fpsWindowFrames++;
    if (cfg.qa?.trace && trace.length < MAX_TRACE) {
      trace.push(toTraceFrame(stats.frames - 1, now - t0, r, renderer, video.videoWidth, video.videoHeight));
    }

    // Captures and recording read the drawing buffer right after render, in the same task.
    if (pendingCaptures.length || recorder?.active) {
      const label = cfg.qa ? `${cfg.qa.label}\n${COMMIT} · frame ${stats.frames} · ${new Date().toISOString()}` : undefined;
      if (pendingCaptures.length) {
        const url = compositeFrame(video, ui.canvas, { mirror, label }).toDataURL("image/png");
        pendingCaptures.splice(0).forEach((res) => res(url));
      }
      if (recorder?.active) compositeFrame(video, ui.canvas, { mirror, label, target: recorder.canvas });
    }

    if (r.obs) {
      stats.trackedFrames++;
      stats.firstTrackedMs ??= since();
      if (frameLoaded) {
        if (r.obs.faceWidth < 0.18) ui.setStatus(MSG.moveCloser);
        else if (r.obs.faceWidth > 0.85) ui.setStatus(MSG.tooClose);
        else ui.setStatus("");
      }
    } else if (!r.held && frameLoaded) {
      ui.setStatus(stats.trackedFrames ? MSG.trackingLost : MSG.lookAtCamera);
    }

    // Adaptive quality: if we stay under 20 fps, lower the render resolution once or twice.
    if (now - fpsWindowStart > 2000) {
      const fps = (fpsWindowFrames * 1000) / (now - fpsWindowStart);
      if (fps < 20 && renderer.pixelRatio > 1 && stats.adaptiveDowngrades < 2) {
        renderer.setPixelRatio(Math.max(1, renderer.pixelRatio - 0.5));
        stats.adaptiveDowngrades++;
        stats.pixelRatio = renderer.pixelRatio;
      } else if (fps < 12 && stats.adaptiveDowngrades >= 2) {
        ui.setStatus(MSG.slowDevice);
      }
      if (cfg.debug) {
        finaliseStats();
        ui.setStats(
          `fps ${fps.toFixed(1)}  detect ${stats.avgDetectMs}ms (p95 ${stats.p95DetectMs})\n` +
            `${stats.delegate}  video ${stats.videoSize}  px ${stats.pixelRatio}\n` +
            `camera ${stats.cameraReadyMs}ms  tracker ${stats.trackerReadyMs}ms  frame ${stats.frameReadyMs}ms\n` +
            `tracked ${stats.trackedFrames}/${stats.frames}  ${COMMIT}`,
        );
      }
      fpsWindowStart = now;
      fpsWindowFrames = 0;
    }

    if (cfg.debug && r.obs) drawDebug(r.obs.nasion);
  }

  /** Debug overlay: green = MediaPipe's 2D nasion landmark, magenta = our projected nasion, blue = bridge anchor. */
  function drawDebug(nasion: { x: number; y: number }) {
    const c = ui.debugCanvas;
    c.hidden = false;
    if (c.width !== ui.video.videoWidth) {
      c.width = ui.video.videoWidth;
      c.height = ui.video.videoHeight;
    }
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    const dot = (p: { x: number; y: number } | null, color: string) => {
      if (!p) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(p.x * c.width, p.y * c.height, 6, 0, Math.PI * 2);
      g.fill();
    };
    dot(nasion, "#22c55e");
    dot(renderer!.projectFacePoint(CANONICAL_LANDMARKS_CM.nasion), "#d946ef");
    dot(renderer!.projectFacePoint(DEFAULT_BRIDGE_ANCHOR_CM), "#38bdf8");
  }
}

export function close(): void {
  active?.close();
}

/** Capture the current composited renderer output (PNG data URL), or null if no session. */
export function capture(): Promise<string | null> {
  return active ? active.capture() : Promise.resolve(null);
}

declare global {
  interface Window {
    VirtualMirror?: {
      version: string;
      commit: string;
      open: typeof open;
      close: typeof close;
      capture: typeof capture;
      readonly lastSession: SessionStats | null;
    };
  }
}

window.VirtualMirror = {
  version: VERSION,
  commit: COMMIT,
  open,
  close,
  capture,
  get lastSession() {
    return lastSession;
  },
};
