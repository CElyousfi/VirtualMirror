import { describe, expect, it } from "vitest";
import { fakeAdmin } from "../test/fake-admin";
import { deleteShopifyFile, uploadGlbToShopifyFiles } from "./asset-storage";
import { buildManifest, writeManifest, type PublishableAsset } from "./manifest";

const stagedOk = () => ({
  stagedUploadsCreate: {
    stagedTargets: [{ url: "https://upload.example/bucket", resourceUrl: "https://upload.example/bucket/key", parameters: [{ name: "key", value: "k1" }, { name: "policy", value: "p" }] }],
    userErrors: [],
  },
});

describe("uploadGlbToShopifyFiles", () => {
  it("stages, uploads multipart, creates a GENERIC file and polls until READY", async () => {
    const statuses = ["UPLOADED", "PROCESSING", "READY"];
    const { admin, calls } = fakeAdmin({
      VmStagedUploadsCreate: stagedOk,
      VmFileCreate: () => ({ fileCreate: { files: [{ id: "gid://shopify/GenericFile/1", fileStatus: "UPLOADED" }], userErrors: [] } }),
      VmFileStatus: (_v, n) => ({
        node: {
          __typename: "GenericFile",
          id: "gid://shopify/GenericFile/1",
          fileStatus: statuses[n - 1],
          url: statuses[n - 1] === "READY" ? "https://cdn.shopify.com/s/files/1/demo-frame.glb?v=1" : null,
          mimeType: "model/gltf-binary",
          originalFileSize: 4,
          fileErrors: [],
        },
      }),
    });
    const posted: { url: string; fields: string[]; fileType: string | undefined }[] = [];
    const fetchImpl = (async (url: string, init: { body: FormData }) => {
      const file = init.body.get("file") as Blob | null;
      posted.push({ url, fields: [...init.body.keys()], fileType: file?.type });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const out = await uploadGlbToShopifyFiles(admin, new Uint8Array([1, 2, 3, 4]), "milo.glb", "Milo 3D", {
      fetchImpl,
      sleep: async () => {},
    });

    expect(out).toMatchObject({ fileGid: "gid://shopify/GenericFile/1", status: "READY", url: expect.stringContaining("cdn.shopify.com") });
    const stagedInput = (calls[0]!.variables.input as Record<string, unknown>[])[0]!;
    expect(stagedInput).toMatchObject({ resource: "FILE", mimeType: "model/gltf-binary", httpMethod: "POST", fileSize: "4" });
    // Signed parameters must precede the file in the multipart body.
    expect(posted[0]).toEqual({ url: "https://upload.example/bucket", fields: ["key", "policy", "file"], fileType: "model/gltf-binary" });
    const fileInput = (calls[1]!.variables.files as Record<string, unknown>[])[0]!;
    expect(fileInput).toMatchObject({ contentType: "FILE", originalSource: "https://upload.example/bucket/key" });
    expect(calls.filter((c) => c.op === "VmFileStatus")).toHaveLength(3);
  });

  it("fails loudly if Shopify turns the GLB into a Model3d instead of a generic file", async () => {
    const { admin } = fakeAdmin({
      VmStagedUploadsCreate: stagedOk,
      VmFileCreate: () => ({ fileCreate: { files: [{ id: "gid://shopify/Model3d/1", fileStatus: "UPLOADED" }], userErrors: [] } }),
      VmFileStatus: () => ({ node: { __typename: "Model3d", id: "gid://shopify/Model3d/1", fileStatus: "PROCESSING" } }),
    });
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await expect(uploadGlbToShopifyFiles(admin, new Uint8Array([1]), "x.glb", "x", { fetchImpl, sleep: async () => {} })).rejects.toThrow(
      "Expected a GenericFile",
    );
  });

  it("surfaces staged upload HTTP failures and fileCreate user errors", async () => {
    const bad = fakeAdmin({ VmStagedUploadsCreate: stagedOk });
    const fail = (async () => new Response("AccessDenied", { status: 403 })) as unknown as typeof fetch;
    await expect(uploadGlbToShopifyFiles(bad.admin, new Uint8Array([1]), "x.glb", "x", { fetchImpl: fail })).rejects.toThrow("HTTP 403");

    const ue = fakeAdmin({
      VmStagedUploadsCreate: stagedOk,
      VmFileCreate: () => ({ fileCreate: { files: [], userErrors: [{ field: ["files"], message: "Invalid file type", code: "INVALID" }] } }),
    });
    const ok = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    await expect(uploadGlbToShopifyFiles(ue.admin, new Uint8Array([1]), "x.glb", "x", { fetchImpl: ok })).rejects.toThrow("Invalid file type");
  });

  it("times out instead of polling forever", async () => {
    const { admin } = fakeAdmin({
      VmStagedUploadsCreate: stagedOk,
      VmFileCreate: () => ({ fileCreate: { files: [{ id: "gid://shopify/GenericFile/2", fileStatus: "UPLOADED" }], userErrors: [] } }),
      VmFileStatus: () => ({ node: { __typename: "GenericFile", id: "gid://shopify/GenericFile/2", fileStatus: "PROCESSING", url: null, mimeType: null, originalFileSize: null, fileErrors: [] } }),
    });
    const ok = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    await expect(
      uploadGlbToShopifyFiles(admin, new Uint8Array([1]), "x.glb", "x", { fetchImpl: ok, timeoutMs: -1, sleep: async () => {} }),
    ).rejects.toThrow("still PROCESSING");
  });

  it("treats deleting a missing file as success", async () => {
    const { admin } = fakeAdmin({
      VmFileDelete: () => ({ fileDelete: { deletedFileIds: [], userErrors: [{ field: null, message: "gone", code: "FILE_DOES_NOT_EXIST" }] } }),
    });
    await expect(deleteShopifyFile(admin, "gid://shopify/GenericFile/9")).resolves.toBeUndefined();
  });
});

describe("buildManifest", () => {
  const asset = (over: Partial<PublishableAsset>): PublishableAsset => ({
    state: "ready",
    merchantApprovedAt: new Date(),
    fileUrl: "https://cdn.shopify.com/a.glb",
    variantIds: ["*"],
    bridgeM: [0, 0, 0],
    frameWidthM: 0.138,
    hasScaleSource: true,
    ...over,
  });

  it("includes only Ready, approved, stored assets", () => {
    const m = buildManifest([
      asset({ variantIds: ["1"] }),
      asset({ variantIds: ["2"], merchantApprovedAt: null }),
      asset({ variantIds: ["3"], state: "needs_review" }),
      asset({ variantIds: ["4"], fileUrl: null }),
    ]);
    expect(m!.assets.map((a) => a.variantIds[0])).toEqual(["1"]);
  });

  it("returns null when nothing is publishable", () => {
    expect(buildManifest([asset({ merchantApprovedAt: null })])).toBeNull();
  });

  it("labels template-sized assets as estimated", () => {
    expect(buildManifest([asset({ hasScaleSource: false })])!.assets[0]!.scale).toBe("estimated");
  });

  it("writes the manifest to the app-owned metafield", async () => {
    const { admin, calls } = fakeAdmin({ VmMetafieldsSet: () => ({ metafieldsSet: { metafields: [{ id: "m1" }], userErrors: [] } }) });
    await writeManifest(admin, "gid://shopify/Product/1", buildManifest([asset({})])!);
    const mf = (calls[0]!.variables.metafields as Record<string, unknown>[])[0]!;
    expect(mf).toMatchObject({ ownerId: "gid://shopify/Product/1", namespace: "$app", key: "vm_manifest", type: "json" });
    expect(JSON.parse(mf.value as string).v).toBe(1);
  });
});
