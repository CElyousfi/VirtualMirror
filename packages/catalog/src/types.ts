/** A product as Virtual Mirror sees it: a plain, Shopify-API-independent snapshot. */
export interface ProductImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductVariantSnapshot {
  gid: string;
  legacyId: string;
  title: string;
  options: { name: string; value: string }[];
  imageUrl: string | null;
}

export interface ExistingModel {
  url: string;
  format: string;
}

export interface ProductSnapshot {
  gid: string;
  legacyId: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  tags: string[];
  status: string;
  /** Shopify Standard Product Taxonomy full name, e.g. "Apparel & Accessories > ... > Sunglasses". */
  category: string | null;
  description: string;
  images: ProductImage[];
  variants: ProductVariantSnapshot[];
  existingModels: ExistingModel[];
  updatedAt: string;
}
