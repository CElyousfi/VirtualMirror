/** Merchant-facing labels and badge tones, shared by admin pages. */

export const STATE_LABEL: Record<string, string> = {
  imported: "Imported",
  analyzing: "Analyzing",
  generated: "Generated",
  needs_review: "Needs review",
  ready: "Ready",
  published: "Live",
  failed: "Failed",
  unsupported: "Unsupported",
};

export type BadgeTone = "auto" | "neutral" | "info" | "success" | "caution" | "warning" | "critical";

export const STATE_TONE: Record<string, BadgeTone> = {
  imported: "neutral",
  analyzing: "info",
  generated: "info",
  needs_review: "warning",
  ready: "info",
  published: "success",
  failed: "critical",
  unsupported: "critical",
};

export const METHOD_LABEL: Record<string, string> = {
  "existing-glb": "Uploaded 3D model",
  "demo-template": "Generic demo frame",
  "silhouette-2.5d": "Generated from photos",
  "manual-dimensions": "Built from dimensions",
};

/** Theme editor deep link that adds our app block to the product template. */
export function themeEditorLink(apiKey: string): string {
  return `shopify://admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/try-on-button&target=mainSection`;
}
