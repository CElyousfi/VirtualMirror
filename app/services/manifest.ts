import {
  MANIFEST_METAFIELD,
  StorefrontManifestSchema,
  canPublish,
  type AssetState,
  type StorefrontManifest,
} from "@vm/contracts";
import { assertNoUserErrors, gql, type AdminGraphql } from "../lib/admin-client";
import { METAFIELDS_DELETE, METAFIELDS_SET } from "../graphql/files";

export interface PublishableAsset {
  state: AssetState;
  merchantApprovedAt: Date | string | null;
  fileUrl: string | null;
  variantIds: string[];
  bridgeM: [number, number, number];
  frameWidthM: number;
  hasScaleSource: boolean;
}

/**
 * Build the public storefront manifest from a product's assets. Only assets
 * that pass the publish rule (Ready + merchant approval + stored file) are
 * included. Returns null when nothing is publishable.
 */
export function buildManifest(assets: PublishableAsset[], now = new Date()): StorefrontManifest | null {
  const publishable = assets.filter((a) => canPublish(a.state, a.merchantApprovedAt).allowed && a.fileUrl);
  if (!publishable.length) return null;
  const manifest: StorefrontManifest = {
    v: 1,
    enabled: true,
    updatedAt: now.toISOString(),
    assets: publishable.map((a) => ({
      variantIds: a.variantIds,
      glbUrl: a.fileUrl!,
      bridgeM: a.bridgeM,
      frameWidthM: a.frameWidthM,
      scale: a.hasScaleSource ? "source-backed" : "estimated",
    })),
  };
  // Never write something the storefront cannot parse.
  return StorefrontManifestSchema.parse(manifest);
}

export async function writeManifest(admin: AdminGraphql, productGid: string, manifest: StorefrontManifest) {
  const res = await gql<{
    metafieldsSet: { metafields: { id: string }[] | null; userErrors: { field: string[] | null; message: string; code: string | null }[] };
  }>(admin, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: productGid,
        namespace: MANIFEST_METAFIELD.namespace,
        key: MANIFEST_METAFIELD.key,
        type: MANIFEST_METAFIELD.type,
        value: JSON.stringify(manifest),
      },
    ],
  });
  assertNoUserErrors("metafieldsSet", res.metafieldsSet.userErrors);
}

export async function deleteManifest(admin: AdminGraphql, productGid: string) {
  const res = await gql<{
    metafieldsDelete: { userErrors: { field: string[] | null; message: string }[] };
  }>(admin, METAFIELDS_DELETE, {
    metafields: [{ ownerId: productGid, namespace: MANIFEST_METAFIELD.namespace, key: MANIFEST_METAFIELD.key }],
  });
  assertNoUserErrors("metafieldsDelete", res.metafieldsDelete.userErrors);
}
