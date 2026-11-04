/**
 * Capturing what the renderer actually produced: the video frame plus the
 * WebGL canvas, composited at the video's native resolution, mirrored as the
 * shopper sees it. Must be called right after renderer.render() in the same
 * task (the drawing buffer is not preserved between frames).
 *
 * Nothing here uploads anything. Captures and recordings stay in the browser
 * until the user downloads them.
 */

export function compositeFrame(
  video: HTMLVideoElement,
  glCanvas: HTMLCanvasElement,
  opts: { mirror: boolean; label?: string; target?: HTMLCanvasElement },
): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const out = opts.target ?? document.createElement("canvas");
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  const g = out.getContext("2d")!;
  g.save();
  if (opts.mirror) {
    g.translate(w, 0);
    g.scale(-1, 1);
  }
  g.drawImage(video, 0, 0, w, h);
  g.drawImage(glCanvas, 0, 0, w, h);
  g.restore();
  if (opts.label) stampLabel(g, w, h, opts.label);
  return out;
}

export function stampLabel(g: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  const size = Math.max(12, Math.round(h / 45));
  g.font = `${size}px ui-monospace, Menlo, monospace`;
  const pad = Math.round(size * 0.5);
  const lines = label.split("\n");
  const boxH = lines.length * (size + 4) + pad * 2;
  g.fillStyle = "rgba(0,0,0,0.65)";
  g.fillRect(0, h - boxH, w, boxH);
  g.fillStyle = "#fff";
  lines.forEach((line, k) => g.fillText(line, pad, h - boxH + pad + size + k * (size + 4) - 2));
}

/** Local-only session recorder fed by a compositor canvas. */
export class LocalRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  readonly canvas = document.createElement("canvas");

  static supported(): boolean {
    return typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
  }

  get active(): boolean {
    return this.recorder?.state === "recording";
  }

  start(fps = 30): void {
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
    this.chunks = [];
    this.recorder = new MediaRecorder(this.canvas.captureStream(fps), mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = this.recorder;
      if (!r) return resolve(new Blob());
      r.onstop = () => resolve(new Blob(this.chunks, { type: r.mimeType || "video/webm" }));
      r.stop();
      this.recorder = null;
    });
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function downloadDataUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
