import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/** Public, free CDNs. Pinned to the bundled tasks-vision version. Override via config. */
export const DEFAULT_WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
export const DEFAULT_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Canonical landmark indices used by the widget.
export const LM = { nasion: 168, rightFaceEdge: 234, leftFaceEdge: 454 } as const;

export interface FaceObservation {
  /** FACE -> CAMERA matrix as returned by MediaPipe (layout normalised later). */
  matrix: number[];
  /** Normalised image coordinates (0..1) of a few landmarks, for UI hints and debugging. */
  nasion: { x: number; y: number };
  /** Face width as a fraction of image width. */
  faceWidth: number;
}

export interface Tracker {
  delegate: "GPU" | "CPU";
  detect(video: HTMLVideoElement, timestampMs: number): FaceObservation | null;
  close(): void;
}

export async function createTracker(opts: { wasmBase?: string; modelUrl?: string } = {}): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase ?? DEFAULT_WASM_BASE);
  const make = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.modelUrl ?? DEFAULT_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let delegate: "GPU" | "CPU" = "GPU";
  let landmarker: FaceLandmarker;
  try {
    landmarker = await make("GPU");
  } catch {
    delegate = "CPU";
    landmarker = await make("CPU");
  }

  let lastTs = -1;
  return {
    delegate,
    detect(video, timestampMs) {
      // MediaPipe requires strictly increasing timestamps in VIDEO mode.
      const ts = timestampMs <= lastTs ? lastTs + 1 : timestampMs;
      lastTs = ts;
      const res = landmarker.detectForVideo(video, ts);
      const m = res.facialTransformationMatrixes?.[0];
      const lms = res.faceLandmarks?.[0];
      if (!m || !lms) return null;
      const n = lms[LM.nasion]!;
      const l = lms[LM.leftFaceEdge]!;
      const r = lms[LM.rightFaceEdge]!;
      return { matrix: Array.from(m.data), nasion: { x: n.x, y: n.y }, faceWidth: Math.hypot(l.x - r.x, l.y - r.y) };
    },
    close() {
      landmarker.close();
    },
  };
}
