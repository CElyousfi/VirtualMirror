/**
 * GLB storage in Shopify Files.
 *
 * We store GLBs as GENERIC files (resource FILE, contentType FILE), not as
 * product media / Model3d, so they never appear in the theme's product gallery
 * and Shopify's own 3D viewer is not triggered. Whether Shopify accepts a .glb
 * as a generic file and serves it with CORS headers is exactly what
 * `pnpm proof:storage` verifies against a development store.
 */

export const STAGED_UPLOADS_CREATE = `#graphql
  mutation VmStagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

export const FILE_CREATE = `#graphql
  mutation VmFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus alt createdAt }
      userErrors { field message code }
    }
  }
`;

export const FILE_STATUS_QUERY = `#graphql
  query VmFileStatus($id: ID!) {
    node(id: $id) {
      __typename
      ... on GenericFile { id fileStatus url mimeType originalFileSize fileErrors { code message } }
      ... on Model3d { id fileStatus }
    }
  }
`;

export const FILE_DELETE = `#graphql
  mutation VmFileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors { field message code }
    }
  }
`;

export const METAFIELDS_SET = `#graphql
  mutation VmMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

export const METAFIELDS_DELETE = `#graphql
  mutation VmMetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }
`;
