/**
 * Tracking metrics computed from a per-frame trace. Pure functions, no DOM.
 * Everything here is a measurement; nothing is a quality score.
 */
import type { Quat } from "./pose";

export interface TraceFrame {
  /** Frame index within the session or replay. */
  i: number;
  /** Media time (replay) or session time (live), milliseconds. */
  tMs: number;
  tracked: boolean;
  /** True when the pose shown is a held pose after a dropout. */
  held: boolean;
  detectMs: number;
  /** Projected bridge anchor in video pixels (unmirrored), when tracked. */
  anchorPx?: { x: number; y: number };
  /** Face width as a fraction of image width (MediaPipe landmarks 234-454). */
  faceWidth?: number;
  /** Head angles in degrees, from the smoothed pose. */
  yaw?: number;
  pitch?: number;
  roll?: number;
}

/** Intrinsic Tait-Bryan angles (degrees). Yaw about +Y, pitch about +X, roll about +Z. */
export function quatToYawPitchRoll([x, y, z, w]: Quat): { yaw: number; pitch: number; roll: number } {
  const deg = 180 / Math.PI;
  const sinp = 2 * (w * x - y * z);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * 90 : Math.asin(sinp) * deg;
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * deg;
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * deg;
  return { yaw, pitch, roll };
}

export interface TraceSummary {
  frames: number;
  trackedFrames: number;
  trackedPct: number;
  heldFrames: number;
  /** Longest run of frames with no face tracked (and no held pose). */
  longestDropoutFrames: number;
  avgDetectMs: number;
  p95DetectMs: number;
  /**
   * Jitter: RMS of the second difference of the anchor position over runs of
   * consecutive tracked frames, in pixels. Constant velocity contributes zero,
   * so smooth head motion is not counted as jitter. Meaningful mainly on
   * footage with a still or slowly moving head.
   */
  jitterRmsPx: number | null;
  /** Same, as a percentage of the mean face width in pixels. */
  jitterPctFaceWidth: number | null;
  yawRange: [number, number] | null;
  pitchRange: [number, number] | null;
  rollRange: [number, number] | null;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function summariseTrace(trace: TraceFrame[], videoWidthPx: number): TraceSummary {
  const tracked = trace.filter((f) => f.tracked);
  const detect = trace.map((f) => f.detectMs).sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  for (const f of trace) {
    run = !f.tracked && !f.held ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  const acc: number[] = [];
  for (let k = 2; k < trace.length; k++) {
    const [a, b, c] = [trace[k - 2]!, trace[k - 1]!, trace[k]!];
    if (!(a.tracked && b.tracked && c.tracked && a.anchorPx && b.anchorPx && c.anchorPx)) continue;
    if (c.i - a.i !== 2) continue;
    const ax = c.anchorPx.x - 2 * b.anchorPx.x + a.anchorPx.x;
    const ay = c.anchorPx.y - 2 * b.anchorPx.y + a.anchorPx.y;
    acc.push(ax * ax + ay * ay);
  }
  const jitter = acc.length ? Math.sqrt(acc.reduce((s, v) => s + v, 0) / acc.length) : null;
  const widths = tracked.map((f) => f.faceWidth).filter((v): v is number => typeof v === "number");
  const meanFacePx = widths.length ? (widths.reduce((s, v) => s + v, 0) / widths.length) * videoWidthPx : null;

  const range = (key: "yaw" | "pitch" | "roll"): [number, number] | null => {
    const vals = tracked.map((f) => f[key]).filter((v): v is number => typeof v === "number");
    return vals.length ? [round(Math.min(...vals), 1), round(Math.max(...vals), 1)] : null;
  };

  return {
    frames: trace.length,
    trackedFrames: tracked.length,
    trackedPct: trace.length ? round((tracked.length / trace.length) * 100, 1) : 0,
    heldFrames: trace.filter((f) => f.held).length,
    longestDropoutFrames: longest,
    avgDetectMs: detect.length ? round(detect.reduce((s, v) => s + v, 0) / detect.length, 1) : 0,
    p95DetectMs: detect.length ? round(detect[Math.min(detect.length - 1, Math.floor(detect.length * 0.95))]!, 1) : 0,
    jitterRmsPx: jitter === null ? null : round(jitter),
    jitterPctFaceWidth: jitter !== null && meanFacePx ? round((jitter / meanFacePx) * 100) : null,
    yawRange: range("yaw"),
    pitchRange: range("pitch"),
    rollRange: range("roll"),
  };
}
