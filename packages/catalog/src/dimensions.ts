/**
 * Read frame dimensions that merchants commonly publish in titles or
 * descriptions. The industry "arm print" is lens width - bridge - temple
 * in millimetres, e.g. "52-18-145", "52□18 145", "52 [] 18-140".
 *
 * Values outside plausible adult ranges are rejected rather than trusted.
 */

export interface ParsedDimensions {
  lensWidthMm?: number;
  bridgeWidthMm?: number;
  templeLengthMm?: number;
  lensHeightMm?: number;
  totalWidthMm?: number;
  /** The text the values were read from, for showing the merchant. */
  evidence: string[];
}

export const PLAUSIBLE_MM = {
  lensWidth: [38, 65],
  bridgeWidth: [12, 26],
  templeLength: [120, 155],
  lensHeight: [25, 60],
  totalWidth: [110, 165],
} as const;

const inRange = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;

const ARM_PRINT =
  /\b(\d{2})\s*(?:[-–—x×/]|□|\[\s*\]|◻|▢|\s)\s*(\d{2})\s*(?:[-–—x×/]|\s)\s*(\d{3})\b/u;

const LABELLED: { key: keyof Omit<ParsedDimensions, "evidence">; re: RegExp; range: readonly [number, number] }[] = [
  { key: "lensWidthMm", re: /lens\s*width\s*[:=]?\s*(\d{2}(?:\.\d)?)\s*mm/i, range: PLAUSIBLE_MM.lensWidth },
  { key: "lensHeightMm", re: /lens\s*height\s*[:=]?\s*(\d{2}(?:\.\d)?)\s*mm/i, range: PLAUSIBLE_MM.lensHeight },
  { key: "bridgeWidthMm", re: /bridge(?:\s*width)?\s*[:=]?\s*(\d{2}(?:\.\d)?)\s*mm/i, range: PLAUSIBLE_MM.bridgeWidth },
  { key: "templeLengthMm", re: /(?:temple|arm)(?:\s*length)?\s*[:=]?\s*(\d{3}(?:\.\d)?)\s*mm/i, range: PLAUSIBLE_MM.templeLength },
  { key: "totalWidthMm", re: /(?:frame|total)\s*width\s*[:=]?\s*(\d{3}(?:\.\d)?)\s*mm/i, range: PLAUSIBLE_MM.totalWidth },
];

export function parseFrameDimensions(...texts: (string | null | undefined)[]): ParsedDimensions {
  const out: ParsedDimensions = { evidence: [] };
  const text = texts.filter(Boolean).join("\n");

  const m = ARM_PRINT.exec(text);
  if (m) {
    const [lens, bridge, temple] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (
      inRange(lens, PLAUSIBLE_MM.lensWidth) &&
      inRange(bridge, PLAUSIBLE_MM.bridgeWidth) &&
      inRange(temple, PLAUSIBLE_MM.templeLength)
    ) {
      out.lensWidthMm = lens;
      out.bridgeWidthMm = bridge;
      out.templeLengthMm = temple;
      out.evidence.push(m[0].trim());
    }
  }

  for (const { key, re, range } of LABELLED) {
    if (out[key] !== undefined) continue;
    const lm = re.exec(text);
    if (lm) {
      const v = Number(lm[1]);
      if (inRange(v, range)) {
        out[key] = v;
        out.evidence.push(lm[0].trim());
      }
    }
  }
  return out;
}
