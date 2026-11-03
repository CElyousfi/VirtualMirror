import type { ProductSnapshot } from "./types";

/**
 * One 3D asset per visually distinct variant group.
 *
 * Variants that differ only in non-visual options (prescription, lens coating
 * package, warranty) share an asset. Variants that differ in colour, material,
 * size or lens tint each get their own, because those change what the shopper
 * sees. Never auto-recolour one asset to stand in for another variant.
 */

const NON_VISUAL_OPTION = /\b(prescription|rx|power|strength|package|warranty|insurance|gift|coating)\b/i;

export interface VariantGroup {
  key: string;
  label: string;
  variantLegacyIds: string[];
  imageUrl: string | null;
}

export function groupVariantsForAssets(p: Pick<ProductSnapshot, "variants" | "images">): VariantGroup[] {
  const groups = new Map<string, VariantGroup>();
  for (const v of p.variants) {
    const visual = v.options.filter(
      (o) => !NON_VISUAL_OPTION.test(o.name) && !(o.name === "Title" && o.value === "Default Title"),
    );
    const key = visual.length ? visual.map((o) => `${o.name}=${o.value}`).join("|") : "default";
    const label = visual.length ? visual.map((o) => o.value).join(" / ") : "All variants";
    const g = groups.get(key);
    if (g) {
      g.variantLegacyIds.push(v.legacyId);
      g.imageUrl ??= v.imageUrl;
    } else {
      groups.set(key, { key, label, variantLegacyIds: [v.legacyId], imageUrl: v.imageUrl });
    }
  }
  const out = [...groups.values()];
  // A product with one group uses its main image when the variant has none.
  if (out.length === 1 && !out[0]!.imageUrl) out[0]!.imageUrl = p.images[0]?.url ?? null;
  return out;
}
