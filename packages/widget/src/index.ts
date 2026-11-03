/**
 * Virtual Mirror storefront widget. Loaded on demand by the theme block when a
 * shopper clicks "Try On Live"; nothing here runs before that click.
 *
 * Exposes window.VirtualMirror.open(config).
 */
import { CANONICAL_LANDMARKS_CM, DEFAULT_BRIDGE_ANCHOR_CM, type StorefrontAsset } from "@vm/contracts";
import { CameraStartError, startCamera, stopCamera } from "./camera";
import { assetForVariant, parseManifest } from "./core/assets";
import { PoseSmoother, compose, decompose, toColumnMajor } from "./core/pose";
import { MSG } from "./messages";
import { MirrorRenderer } from "./renderer";
import { createTracker, type Tracker } from "./tracker";
import { createUi } from "./ui";

export const VERSION = "0.1.0";

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
}

/** Measured per session; never estimated. Read from window.VirtualMirror.lastSession. */
export interface SessionStats {
  version: string;
  userAgent: string;
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
}

let active: { close: () => void } | null = null;
let lastSession: SessionStats | null = null;

export function open(cfg: OpenConfig): void {
  if (active) return;
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  const stats: SessionStats = {
    version: VERSION,
    userAgent: navigator.userAgent,
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
  lastSession = stats;

  const ui = createUi({ productTitle: cfg.productTitle, accentColor: cfg.accentColor, accentTextColor: cfg.accentTextColor });
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

  const fail = (text: string, code: string) => {
    stats.error = code;
    ui.showError(text);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    stopCamera(stream, ui.video);
    tracker?.close();
    renderer?.dispose();
    ui.destroy();
    active = null;
    finaliseStats();
    if (cfg.debug) console.info("[VirtualMirror] session", JSON.stringify(stats));
    cfg.returnFocusTo?.focus();
  };
  active = { close };
  ui.onClose(close);

  function finaliseStats() {
    const elapsed = (performance.now() - t0) / 1000;
    stats.avgFps = elapsed > 0 ? Math.round((stats.frames / elapsed) * 10) / 10 : 0;
    if (detectTimes.length) {
      const sorted = [...detectTimes].sort((a, b) => a - b);
      stats.avgDetectMs = Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10;
      stats.p95DetectMs = Math.round(sorted[Math.floor(sorted.length * 0.95)]! * 10) / 10;
    }
  }

  if (!manifest) return fail(MSG.errors.unavailable, "no-manifest");

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
  ui.setCart(variantId ? "idle" : "hidden");

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
      stream = await startCamera(ui.video);
      stats.cameraReadyMs = since();
      stats.videoSize = `${ui.video.videoWidth}x${ui.video.videoHeight}`;
    } catch (err) {
      const kind = err instanceof CameraStartError ? err.kind : "unsupported";
      return fail(MSG.errors[kind], `camera-${kind}`);
    }
    if (closed) return close();

    try {
      renderer = new MirrorRenderer(ui.canvas, {
        showOccluder: cfg.debug,
        onContextLost: () => fail(MSG.errors.trackerFailed, "webgl-context-lost"),
      });
      renderer.resize(ui.video.videoWidth, ui.video.videoHeight);
      stats.pixelRatio = renderer.pixelRatio;
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

    const d0 = performance.now();
    const obs = tracker.detect(video, now);
    detectTimes.push(performance.now() - d0);
    if (detectTimes.length > 600) detectTimes.shift();

    stats.frames++;
    fpsWindowFrames++;
    if (obs) {
      stats.trackedFrames++;
      stats.firstTrackedMs ??= since();
      const pose = smoother.update(decompose(toColumnMajor(obs.matrix)), now);
      renderer.setFacePose(compose(pose));
      if (frameLoaded) {
        if (obs.faceWidth < 0.18) ui.setStatus(MSG.moveCloser);
        else if (obs.faceWidth > 0.85) ui.setStatus(MSG.tooClose);
        else ui.setStatus("");
      }
    } else {
      const held = smoother.miss(now);
      renderer.setFacePose(held ? compose(held) : null);
      if (!held && frameLoaded) ui.setStatus(stats.trackedFrames ? MSG.trackingLost : MSG.lookAtCamera);
    }
    renderer.render();

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
            `camera ${stats.cameraReadyMs}ms  tracker ${stats.trackerReadyMs}ms  frame ${stats.frameReadyMs}ms`,
        );
      }
      fpsWindowStart = now;
      fpsWindowFrames = 0;
    }

    if (cfg.debug && obs) drawDebug(obs.nasion);
  }

  /** Debug overlay: green = MediaPipe's 2D nasion landmark, magenta = our projected anchor. */
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

declare global {
  interface Window {
    VirtualMirror?: { version: string; open: typeof open; close: typeof close; readonly lastSession: SessionStats | null };
  }
}

window.VirtualMirror = {
  version: VERSION,
  open,
  close,
  get lastSession() {
    return lastSession;
  },
};
