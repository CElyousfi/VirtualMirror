import type { ProductSnapshot } from "./types";

/**
 * Shape of a product node returned by PRODUCT_FIELDS in app/graphql/products.ts.
 * Kept structural (not generated) so this package stays independent of the app.
 */
export interface ProductNode {
  id: string;
  legacyResourceId: string | number;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  description: string;
  updatedAt: string;
  category: { fullName: string } | null;
  media: { nodes: MediaNode[] };
  variants: {
    nodes: {
      id: string;
      legacyResourceId: string | number;
      title: string;
      selectedOptions: { name: string; value: string }[];
      /** Present on the detail query only. */
      media?: { nodes: MediaNode[] };
    }[];
  };
}

export type MediaNode =
  | {
      __typename: "MediaImage";
      image: { url: string; altText: string | null; width: number | null; height: number | null } | null;
    }
  | { __typename: "Model3d"; sources: { url: string; format: string }[] }
  | { __typename: string };

const isImage = (
  m: MediaNode,
): m is Extract<MediaNode, { __typename: "MediaImage" }> => m.__typename === "MediaImage";
const isModel = (m: MediaNode): m is Extract<MediaNode, { __typename: "Model3d" }> =>
  m.__typename === "Model3d";

const DESCRIPTION_LIMIT = 2000;

export function mapProductNode(node: ProductNode): ProductSnapshot {
  const images = node.media.nodes
    .filter(isImage)
    .flatMap((m) => (m.image ? [{ ...m.image }] : []));

  const existingModels = node.media.nodes
    .filter(isModel)
    .flatMap((m) => m.sources.filter((s) => s.format.toLowerCase() === "glb"));

  return {
    gid: node.id,
    legacyId: String(node.legacyResourceId),
    title: node.title,
    handle: node.handle,
    productType: node.productType ?? "",
    vendor: node.vendor ?? "",
    tags: node.tags ?? [],
    status: node.status,
    category: node.category?.fullName ?? null,
    description: (node.description ?? "").slice(0, DESCRIPTION_LIMIT),
    updatedAt: node.updatedAt,
    images,
    existingModels,
    variants: node.variants.nodes.map((v) => {
      const img = v.media?.nodes.find(isImage);
      return {
        gid: v.id,
        legacyId: String(v.legacyResourceId),
        title: v.title,
        options: v.selectedOptions,
        imageUrl: img && img.image ? img.image.url : null,
      };
    }),
  };
}
