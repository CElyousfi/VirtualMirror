import { describe, expect, it } from "vitest";
import { quatToYawPitchRoll, summariseTrace, type TraceFrame } from "./metrics";

const axisQuat = (axis: [number, number, number], deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h), Math.cos(h)];
};

describe("quatToYawPitchRoll", () => {
  it.each([
    [[0, 1, 0] as [number, number, number], 30, "yaw"],
    [[1, 0, 0] as [number, number, number], -15, "pitch"],
    [[0, 0, 1] as [number, number, number], 10, "roll"],
  ])("recovers a pure rotation about %j of %i degrees as %s", (axis, deg, key) => {
    const e = quatToYawPitchRoll(axisQuat(axis, deg));
    expect(e[key as "yaw" | "pitch" | "roll"]).toBeCloseTo(deg, 6);
  });
});

const frame = (i: number, over: Partial<TraceFrame> = {}): TraceFrame => ({
  i,
  tMs: i * 33.3,
  tracked: true,
  held: false,
  detectMs: 10,
  anchorPx: { x: 640, y: 360 },
  faceWidth: 0.3,
  ...over,
});

describe("summariseTrace", () => {
  it("reports zero jitter for constant-velocity motion", () => {
    const trace = Array.from({ length: 30 }, (_, i) => frame(i, { anchorPx: { x: 600 + i * 3, y: 360 } }));
    expect(summariseTrace(trace, 1280).jitterRmsPx).toBe(0);
  });

  it("measures alternating 1 px noise as 4 px RMS second difference", () => {
    // x alternates +1/-1: second difference is +-4 every frame.
    const trace = Array.from({ length: 40 }, (_, i) => frame(i, { anchorPx: { x: 640 + (i % 2 ? 1 : -1), y: 360 } }));
    const s = summariseTrace(trace, 1280);
    expect(s.jitterRmsPx).toBe(4);
    // 4 px of a 0.3 x 1280 = 384 px face.
    expect(s.jitterPctFaceWidth).toBeCloseTo((4 / 384) * 100, 2);
  });

  it("does not compute jitter across dropouts", () => {
    // The face reappears 260 px away after a dropout; that jump is not jitter.
    const at = (x: number) => ({ anchorPx: { x, y: 360 } });
    const trace = [frame(0, at(640)), frame(1, at(640)), frame(2, at(640)), frame(3, { tracked: false, anchorPx: undefined }), frame(4, at(900)), frame(5, at(900)), frame(6, at(900))];
    expect(summariseTrace(trace, 1280).jitterRmsPx).toBe(0);
    // With no three consecutive tracked frames there is nothing to measure.
    expect(summariseTrace([frame(0), frame(1, { tracked: false })], 1280).jitterRmsPx).toBeNull();
  });

  it("counts tracking rate, held frames and the longest dropout", () => {
    const trace = [
      frame(0),
      frame(1, { tracked: false, held: true }),
      frame(2, { tracked: false }),
      frame(3, { tracked: false }),
      frame(4, { tracked: false }),
      frame(5),
    ];
    const s = summariseTrace(trace, 1280);
    expect(s).toMatchObject({ frames: 6, trackedFrames: 2, trackedPct: 33.3, heldFrames: 1, longestDropoutFrames: 3 });
  });

  it("reports head-angle coverage", () => {
    const trace = [frame(0, { yaw: -20 }), frame(1, { yaw: 5 }), frame(2, { yaw: 31.24 })];
    expect(summariseTrace(trace, 1280).yawRange).toEqual([-20, 31.2]);
  });
});
