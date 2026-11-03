/**
 * Units contract.
 *
 * There are exactly two length units in the system, and every boundary that
 * crosses between them goes through this file:
 *
 *  - ASSET units: metres. Every GLB we store or generate is authored in metres,
 *    matching glTF 2.0 and Shopify's 3D-model requirements.
 *  - FACE units: centimetres. MediaPipe's canonical face model and the metric
 *    space of its facial transformation matrix are in centimetres.
 *
 * Product dimensions from merchants and manufacturers arrive in millimetres
 * (e.g. "52-18-145") and are converted to metres at the edge with `mmToM`.
 */

export const CM_PER_M = 100;
export const MM_PER_M = 1000;
export const MM_PER_CM = 10;

/** Scale factor applied to an asset (metres) when it enters face space (centimetres). */
export const ASSET_TO_FACE_SCALE = CM_PER_M;

export const mToCm = (m: number): number => m * CM_PER_M;
export const cmToM = (cm: number): number => cm / CM_PER_M;
export const mmToM = (mm: number): number => mm / MM_PER_M;
export const mToMm = (m: number): number => m * MM_PER_M;
export const mmToCm = (mm: number): number => mm / MM_PER_CM;

/**
 * Plausible physical range for the overall width of adult eyewear (front,
 * or splayed temples, whichever is wider).
 * Used to detect GLBs authored in the wrong unit (a 140 mm frame exported as
 * "140" units is a 140 m object in glTF terms).
 */
export const PLAUSIBLE_FRAME_WIDTH_M = { min: 0.1, max: 0.2 } as const;

export type UnitGuess = "metres" | "centimetres" | "millimetres" | "unknown";

/**
 * Guess the authoring unit of a model from its bounding-box width, assuming it
 * represents adult eyewear. Returns the scale that converts it to metres.
 */
export function guessUnitFromFrameWidth(width: number): {
  unit: UnitGuess;
  toMetres: number;
} {
  const { min, max } = PLAUSIBLE_FRAME_WIDTH_M;
  if (width >= min && width <= max) return { unit: "metres", toMetres: 1 };
  if (width >= min * CM_PER_M && width <= max * CM_PER_M)
    return { unit: "centimetres", toMetres: 1 / CM_PER_M };
  if (width >= min * MM_PER_M && width <= max * MM_PER_M)
    return { unit: "millimetres", toMetres: 1 / MM_PER_M };
  return { unit: "unknown", toMetres: 1 };
}
