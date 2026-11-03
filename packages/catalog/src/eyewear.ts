import type { ProductSnapshot } from "./types";

/**
 * Eyewear detection from catalog text.
 *
 * This only proposes which products are probably eyewear; the merchant always
 * has the final include/exclude decision. Signals combine as independent
 * evidence: score = 1 - product(1 - weight). Accessory words then dampen it.
 */

export interface EyewearClassification {
  score: number;
  likely: boolean;
  reasons: string[];
}

export const EYEWEAR_THRESHOLD = 0.5;

// English, French, Spanish, German, Italian, Portuguese, Arabic (Morocco-based founder; EU/MENA merchants).
const EYEWEAR_WORDS = [
  "glasses",
  "sunglasses",
  "sunglass",
  "eyeglasses",
  "eyeglass",
  "eyewear",
  "spectacles",
  "optical frame",
  "optical frames",
  "reading glasses",
  "blue light",
  "aviator",
  "wayfarer",
  "lunettes",
  "lunette",
  "monture",
  "gafas",
  "anteojos",
  "brille",
  "sonnenbrille",
  "occhiali",
  "óculos",
  "oculos",
  "نظارات",
  "نظارة",
];

const PRODUCT_TYPE_WORDS = [...EYEWEAR_WORDS, "frames", "frame", "optical", "optique"];

// Products that mention glasses but are not wearable frames.
const ACCESSORY_WORDS = [
  "case",
  "étui",
  "etui",
  "pouch",
  "cleaning",
  "cleaner",
  "cloth",
  "chain",
  "cord",
  "strap",
  "lanyard",
  "spray",
  "contact lens",
  "contact lenses",
  "gift card",
  "screwdriver",
  "repair kit",
  "replacement lens",
  "replacement lenses",
  "nose pad",
  "nose pads",
];

// "Glasses" that are not worn at all. These zero the score.
const NOT_WEARABLE_WORDS = [
  "wine",
  "wine glasses",
  "glassware",
  "drinking",
  "tumbler",
  "tumblers",
  "shot glass",
  "champagne",
  "cocktail",
  "beer",
  "magnifying",
  "magnifier",
];

const TAXONOMY_PATTERN = /\b(eyewear|eyeglasses|sunglasses|eyeglass frames)\b/i;

function normalise(text: string): string {
  return text.toLowerCase().normalize("NFC");
}

function containsWord(text: string, words: readonly string[]): string | null {
  const t = ` ${normalise(text)} `;
  for (const w of words) {
    // Arabic script has no ASCII word boundaries; plain substring for non-Latin words.
    const isLatin = /^[\p{Script=Latin}\s-]+$/u.test(w);
    if (isLatin) {
      const re = new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u");
      if (re.test(t)) return w;
    } else if (t.includes(w)) return w;
  }
  return null;
}

export function classifyEyewear(p: Pick<ProductSnapshot, "title" | "productType" | "tags" | "category">): EyewearClassification {
  const reasons: string[] = [];
  const weights: number[] = [];

  if (p.category && TAXONOMY_PATTERN.test(p.category)) {
    weights.push(0.9);
    reasons.push(`Shopify category is "${p.category.split(">").pop()!.trim()}"`);
  }
  const typeHit = p.productType ? containsWord(p.productType, PRODUCT_TYPE_WORDS) : null;
  if (typeHit) {
    weights.push(0.7);
    reasons.push(`Product type mentions "${typeHit}"`);
  }
  const titleHit = containsWord(p.title, EYEWEAR_WORDS);
  if (titleHit) {
    weights.push(0.6);
    reasons.push(`Title mentions "${titleHit}"`);
  }
  const tagHit = p.tags.map((t) => containsWord(t, PRODUCT_TYPE_WORDS)).find(Boolean);
  if (tagHit) {
    weights.push(0.4);
    reasons.push(`Tagged "${tagHit}"`);
  }

  let score = 1 - weights.reduce((acc, w) => acc * (1 - w), 1);

  const accessoryHit =
    containsWord(p.title, ACCESSORY_WORDS) ?? containsWord(p.productType, ACCESSORY_WORDS);
  if (accessoryHit && score > 0) {
    score *= 0.3;
    reasons.push(`Looks like an accessory ("${accessoryHit}")`);
  }

  const notWearableHit =
    containsWord(p.title, NOT_WEARABLE_WORDS) ?? containsWord(p.productType, NOT_WEARABLE_WORDS);
  if (notWearableHit && score > 0) {
    score = 0;
    reasons.push(`Not wearable eyewear ("${notWearableHit}")`);
  }

  score = Math.round(score * 1000) / 1000;
  return { score, likely: score >= EYEWEAR_THRESHOLD, reasons };
}
