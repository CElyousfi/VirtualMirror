import { StorefrontManifestSchema, type StorefrontAsset, type StorefrontManifest } from "@vm/contracts";

/** Parse the manifest the theme block embeds. Never throws; returns null if unusable. */
export function parseManifest(raw: unknown): StorefrontManifest | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const res = StorefrontManifestSchema.safeParse(value);
  return res.success && res.data.enabled && res.data.assets.length > 0 ? res.data : null;
}

/**
 * Asset for the shopper's selected variant. Exact match first, then a
 * product-wide asset ("*"). Never substitutes another variant's frame:
 * returns null instead, and the UI says the colour is not available.
 */
export function assetForVariant(manifest: StorefrontManifest, variantId: string | null): StorefrontAsset | null {
  if (variantId) {
    const exact = manifest.assets.find((a) => a.variantIds.includes(variantId));
    if (exact) return exact;
  }
  return manifest.assets.find((a) => a.variantIds.includes("*")) ?? (variantId ? null : manifest.assets[0] ?? null);
}
