export * from "./units";
export * from "./coordinate-spaces";
export * from "./schemas";
export * from "./preparation";
export * from "./readiness";

/** App-owned metafield that carries the storefront manifest. */
export const MANIFEST_METAFIELD = { namespace: "$app", key: "vm_manifest", type: "json" } as const;
export * from "./frame-model";
