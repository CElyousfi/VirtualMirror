import { z } from "zod";

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

/** Where a dimension came from. Only the first three count as a scale source. */
export const DimensionSourceSchema = z.enum([
  "manufacturer", // product metafield or parsed arm print, e.g. 52-18-145
  "merchant", // typed in by the merchant
  "measured", // read from an existing validated 3D asset
  "template", // default for the frame family: an estimate
]);
export type DimensionSource = z.infer<typeof DimensionSourceSchema>;

export const DimensionSchema = z.object({
  valueMm: z.number().positive(),
  source: DimensionSourceSchema,
});
export type Dimension = z.infer<typeof DimensionSchema>;

export const FrameFamilySchema = z.enum([
  "rectangular",
  "square",
  "round",
  "oval",
  "aviator",
  "cat-eye",
  "browline",
  "unknown",
]);

export const FrameSpecSchema = z.object({
  family: FrameFamilySchema,
  lensWidth: DimensionSchema.optional(),
  lensHeight: DimensionSchema.optional(),
  bridgeWidth: DimensionSchema.optional(),
  totalWidth: DimensionSchema.optional(),
  templeLength: DimensionSchema.optional(),
  material: z.enum(["acetate", "metal", "mixed", "unknown"]).default("unknown"),
});
export type FrameSpec = z.infer<typeof FrameSpecSchema>;

/** Named points on the asset, in ASSET space (metres). */
export const AssetAnchorsSchema = z.object({
  bridge: Vec3Schema,
  leftTempleTip: Vec3Schema.optional(),
  rightTempleTip: Vec3Schema.optional(),
});
export type AssetAnchors = z.infer<typeof AssetAnchorsSchema>;

/** Lifecycle of one prepared asset. Only Ready can be approved and published. */
export const AssetStateSchema = z.enum([
  "imported",
  "analyzing",
  "generated",
  "needs_review",
  "ready",
  "published",
  "failed",
  "unsupported",
]);
export type AssetState = z.infer<typeof AssetStateSchema>;

export const CheckSeveritySchema = z.enum(["blocker", "review", "info"]);

export const ReadinessCheckSchema = z.object({
  id: z.string(),
  passed: z.boolean(),
  /** blocker: cannot be Ready. review: Ready only after merchant confirms. */
  severity: CheckSeveritySchema,
  /** Merchant-facing, plain language, actionable. */
  message: z.string(),
  measured: z.union([z.number(), z.string()]).optional(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const ReadinessReportSchema = z.object({
  state: AssetStateSchema,
  checks: z.array(ReadinessCheckSchema),
  /** True when every dimension used for scale has a non-template source. */
  hasScaleSource: z.boolean(),
  evaluatedAt: z.string(),
});
export type ReadinessReport = z.infer<typeof ReadinessReportSchema>;

/**
 * The storefront manifest, stored in the app-owned product metafield
 * `$app.vm_manifest`. This is everything the theme block and widget need,
 * and nothing else: it is public on the storefront.
 */
export const StorefrontAssetSchema = z.object({
  /** Shopify variant numeric IDs this asset represents, or ["*"] for all. */
  variantIds: z.array(z.string()).min(1),
  /** Shopper-facing variant label, e.g. "Black" or "Tortoise / 52". */
  label: z.string().max(80).optional(),
  glbUrl: z.string().url(),
  bridgeM: Vec3Schema,
  frameWidthM: z.number().positive(),
  /** "estimated" when any dimension came from a template default. */
  scale: z.enum(["source-backed", "estimated"]),
});
export type StorefrontAsset = z.infer<typeof StorefrontAssetSchema>;

export const StorefrontManifestSchema = z.object({
  v: z.literal(1),
  enabled: z.boolean(),
  assets: z.array(StorefrontAssetSchema),
  updatedAt: z.string(),
});
export type StorefrontManifest = z.infer<typeof StorefrontManifestSchema>;
