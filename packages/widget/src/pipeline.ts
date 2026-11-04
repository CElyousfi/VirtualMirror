/**
 * The per-frame pipeline: detect -> smooth -> place -> render.
 * Shared by the storefront mirror (live camera) and QA replay (video file),
 * so QA measurements always come from the code shoppers run.
 */
import { DEFAULT_BRIDGE_ANCHOR_CM } from "@vm/contracts";
import { quatToYawPitchRoll, type TraceFrame } from "./core/metrics";
import { PoseSmoother, compose, decompose, toColumnMajor, type Pose } from "./core/pose";
import type { MirrorRenderer } from "./renderer";
import type { FaceObservation, Tracker } from "./tracker";

export interface FrameResult {
  obs: FaceObservation | null;
  pose: Pose | null;
  held: boolean;
  detectMs: number;
}

export function stepPipeline(
  tracker: Tracker,
  smoother: PoseSmoother,
  renderer: MirrorRenderer,
  video: HTMLVideoElement,
  tMs: number,
): FrameResult {
  const d0 = performance.now();
  const obs = tracker.detect(video, tMs);
  const detectMs = performance.now() - d0;
  let pose: Pose | null;
  let held = false;
  if (obs) {
    pose = smoother.update(decompose(toColumnMajor(obs.matrix)), tMs);
  } else {
    pose = smoother.miss(tMs);
    held = pose !== null;
  }
  renderer.setFacePose(pose ? compose(pose) : null);
  renderer.render();
  return { obs, pose, held, detectMs };
}

/** One trace row: what was measured for this frame. */
export function toTraceFrame(
  i: number,
  tMs: number,
  r: FrameResult,
  renderer: MirrorRenderer,
  videoWidth: number,
  videoHeight: number,
): TraceFrame {
  const f: TraceFrame = { i, tMs: Math.round(tMs * 10) / 10, tracked: !!r.obs, held: r.held, detectMs: Math.round(r.detectMs * 10) / 10 };
  if (r.obs) {
    const p = renderer.projectFacePoint(DEFAULT_BRIDGE_ANCHOR_CM);
    if (p) f.anchorPx = { x: Math.round(p.x * videoWidth * 10) / 10, y: Math.round(p.y * videoHeight * 10) / 10 };
    f.faceWidth = Math.round(r.obs.faceWidth * 1000) / 1000;
  }
  if (r.pose) {
    const e = quatToYawPitchRoll(r.pose.rotation);
    f.yaw = Math.round(e.yaw * 10) / 10;
    f.pitch = Math.round(e.pitch * 10) / 10;
    f.roll = Math.round(e.roll * 10) / 10;
  }
  return f;
}
