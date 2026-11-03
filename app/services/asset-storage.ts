import { assertNoUserErrors, gql, type AdminGraphql } from "../lib/admin-client";
import { FILE_CREATE, FILE_DELETE, FILE_STATUS_QUERY, STAGED_UPLOADS_CREATE } from "../graphql/files";

export const GLB_MIME = "model/gltf-binary";

export interface StoredFile {
  fileGid: string;
  url: string;
  status: string;
  mimeType: string | null;
  byteSize: number | null;
}

export interface StorageOptions {
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The asset-store abstraction from the architecture: Shopify Files today,
 * swappable for R2/S3 later without touching callers.
 */
export interface AssetStore {
  putGlb(bytes: Uint8Array, filename: string, alt: string): Promise<StoredFile>;
  delete(fileGid: string): Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Upload a GLB to Shopify Files as a GENERIC file:
 * 1. stagedUploadsCreate (resource FILE) -> signed upload target
 * 2. multipart POST of the bytes to that target
 * 3. fileCreate (contentType FILE) from the staged resourceUrl
 * 4. poll until fileStatus is READY (processing is asynchronous)
 */
export async function uploadGlbToShopifyFiles(
  admin: AdminGraphql,
  bytes: Uint8Array,
  filename: string,
  alt: string,
  { fetchImpl = fetch, pollIntervalMs = 1000, timeoutMs = 60_000, sleep = defaultSleep }: StorageOptions = {},
): Promise<StoredFile> {
  const staged = await gql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(admin, STAGED_UPLOADS_CREATE, {
    input: [
      {
        resource: "FILE",
        filename,
        mimeType: GLB_MIME,
        httpMethod: "POST",
        fileSize: String(bytes.byteLength),
      },
    ],
  });
  assertNoUserErrors("stagedUploadsCreate", staged.stagedUploadsCreate.userErrors);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("stagedUploadsCreate returned no target");

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(bytes)], { type: GLB_MIME }), filename);
  const uploadRes = await fetchImpl(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(`Staged upload failed: HTTP ${uploadRes.status} ${text.slice(0, 300)}`);
  }

  const created = await gql<{
    fileCreate: {
      files: { id: string; fileStatus: string }[];
      userErrors: { field: string[] | null; message: string; code: string | null }[];
    };
  }>(admin, FILE_CREATE, {
    files: [
      {
        originalSource: target.resourceUrl,
        contentType: "FILE",
        filename,
        alt,
        duplicateResolutionMode: "APPEND_UUID",
      },
    ],
  });
  assertNoUserErrors("fileCreate", created.fileCreate.userErrors);
  const file = created.fileCreate.files[0];
  if (!file) throw new Error("fileCreate returned no file");

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await gql<{
      node:
        | {
            __typename: "GenericFile";
            id: string;
            fileStatus: string;
            url: string | null;
            mimeType: string | null;
            originalFileSize: number | null;
            fileErrors: { code: string; message: string }[];
          }
        | { __typename: string; id: string; fileStatus: string }
        | null;
    }>(admin, FILE_STATUS_QUERY, { id: file.id });
    const node = s.node;
    if (!node) throw new Error(`File ${file.id} disappeared while processing`);
    if (node.__typename !== "GenericFile") {
      // Shopify classified our GLB as something else (e.g. Model3d). The
      // storage proof exists to catch exactly this.
      throw new Error(`Expected a GenericFile, Shopify created a ${node.__typename}`);
    }
    const g = node as Extract<typeof node, { __typename: "GenericFile" }>;
    if (g.fileStatus === "READY" && g.url) {
      return { fileGid: g.id, url: g.url, status: g.fileStatus, mimeType: g.mimeType, byteSize: g.originalFileSize };
    }
    if (g.fileStatus === "FAILED") {
      throw new Error(`Shopify could not process the file: ${g.fileErrors.map((e) => e.message).join("; ") || "unknown error"}`);
    }
    if (Date.now() > deadline) throw new Error(`File still ${g.fileStatus} after ${timeoutMs} ms`);
    await sleep(pollIntervalMs);
  }
}

export async function deleteShopifyFile(admin: AdminGraphql, fileGid: string): Promise<void> {
  const res = await gql<{
    fileDelete: { deletedFileIds: string[] | null; userErrors: { field: string[] | null; message: string; code: string | null }[] };
  }>(admin, FILE_DELETE, { fileIds: [fileGid] });
  // Deleting an already-deleted file is not an error for our purposes.
  const errors = res.fileDelete.userErrors.filter((e) => e.code !== "FILE_DOES_NOT_EXIST");
  assertNoUserErrors("fileDelete", errors);
}

export function shopifyFilesStore(admin: AdminGraphql, opts: StorageOptions = {}): AssetStore {
  return {
    putGlb: (bytes, filename, alt) => uploadGlbToShopifyFiles(admin, bytes, filename, alt, opts),
    delete: (gid) => deleteShopifyFile(admin, gid),
  };
}
