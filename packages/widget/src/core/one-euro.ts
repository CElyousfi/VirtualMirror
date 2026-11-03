/**
 * One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass filter whose
 * cutoff rises with speed. Slow movement is smoothed heavily (no jitter), fast
 * movement passes through (low lag). Pure TypeScript, no DOM.
 */

const alpha = (cutoffHz: number, dtS: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

export interface OneEuroParams {
  /** Cutoff at rest. Lower = smoother at rest, more lag. */
  minCutoff: number;
  /** How quickly the cutoff rises with speed. Higher = less lag on fast moves. */
  beta: number;
  /** Cutoff for the derivative estimate. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.2, beta: 0.02, dCutoff: 1.0 };

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;

  constructor(private readonly p: OneEuroParams = DEFAULT_ONE_EURO) {}

  /** @param value sample  @param timeMs monotonic timestamp in milliseconds */
  filter(value: number, timeMs: number): number {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.t = timeMs;
      return value;
    }
    const dt = Math.max((timeMs - this.t) / 1000, 1e-3);
    this.t = timeMs;
    const rawDx = (value - this.x) / dt;
    this.dx = this.dx + alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x = this.x + alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  /** Smoothing factor that would be applied for a given speed (used for rotations). */
  alphaFor(speed: number, dtS: number): number {
    return alpha(this.p.minCutoff + this.p.beta * Math.abs(speed), Math.max(dtS, 1e-3));
  }

  reset(): void {
    this.x = null;
    this.t = null;
    this.dx = 0;
  }
}
