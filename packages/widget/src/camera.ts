export type CameraError = "denied" | "noCamera" | "insecure" | "unsupported";

export class CameraStartError extends Error {
  constructor(readonly kind: CameraError, cause?: unknown) {
    super(kind);
    this.name = "CameraStartError";
    this.cause = cause;
  }
}

/** Ask for the front camera. Only ever called after the shopper opens the mirror. */
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraStartError("insecure");
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraStartError("unsupported");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    const name = (err as DOMException).name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new CameraStartError("denied", err);
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError")
      throw new CameraStartError("noCamera", err);
    throw new CameraStartError("unsupported", err);
  }
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  return stream;
}

/**
 * Play a local or same-origin video file through the same pipeline as the
 * camera (QA replay). Never uploaded anywhere.
 */
export async function startVideoFile(video: HTMLVideoElement, url: string, loop = true): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.loop = loop;
  video.crossOrigin = "anonymous";
  video.srcObject = null;
  video.src = url;
  if (video.readyState < 1) await new Promise((r, j) => {
    video.addEventListener("loadedmetadata", r, { once: true });
    video.addEventListener("error", () => j(new Error("Video could not be loaded")), { once: true });
  });
  await video.play();
}

export function stopCamera(stream: MediaStream | null, video?: HTMLVideoElement): void {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
    if (video.getAttribute("src")) {
      video.removeAttribute("src");
      video.load();
    }
  }
}
