import type { AssetAnchors, FrameSpec, ReadinessReport } from "./schemas";

/**
 * The single contract every asset-preparation strategy implements.
 *
 * The merchant UI, storage and storefront renderer depend only on
 * `PreparedAsset`, never on how it was produced. New strategies
 * (2.5D silhouette, guided capture, vendor import, a paid neural method)
 * plug in here without changing anything downstream.
 *
 * Implementations must be runtime-neutral: no DOM, no Shopify client,
 * no filesystem. Inputs arrive as bytes and plain data.
 */

export type PreparationMethodId =
  | "existing-glb"
  | "silhouette-2.5d"
  | "manual-dimensions"
  | "demo-template"
  | (string & {});

export interface ProductImageInput {
  url: string;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  /** Pixels, when the host was able to read them. */
  bytes?: Uint8Array;
}

export interface ProductInput {
  shopifyProductId: string;
  /** Stable key for the variant group this asset represents (one asset per colour/material). */
  variantKey: string;
  variantIds: string[];
  title: string;
  images: ProductImageInput[];
  /** A GLB the merchant already has, if any. */
  glb?: Uint8Array;
  /** Dimensions known before preparation (metafields, parsed title, merchant input). */
  knownSpec?: Partial<FrameSpec>;
}

export interface Eligibility {
  eligible: boolean;
  /** Merchant-facing reason when not eligible. */
  reason?: string;
}

export interface PreparationProgress {
  stage: string;
  /** 0..1 */
  fraction: number;
}

export interface PreparedAsset {
  method: PreparationMethodId;
  variantKey: string;
  /** Binary glTF in ASSET space (metres, +Y up, +Z forward, +X wearer's left). */
  glb: Uint8Array;
  anchors: AssetAnchors;
  spec: FrameSpec;
  frameWidthM: number;
  triangleCount: number;
  readiness: ReadinessReport;
}

export interface PreparationMethod {
  readonly id: PreparationMethodId;
  /** Cheap pre-check; must not do heavy work. */
  canHandle(input: ProductInput): Promise<Eligibility>;
  prepare(
    input: ProductInput,
    onProgress?: (p: PreparationProgress) => void,
  ): Promise<PreparedAsset>;
}
