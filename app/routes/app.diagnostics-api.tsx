import type { ActionFunctionArgs } from "react-router";
import { buildDemoFrameGlb } from "@vm/engine-geometry";
import { authenticate } from "../shopify.server";
import { gql } from "../lib/admin-client";
import { FILE_STATUS_QUERY } from "../graphql/files";
import { deleteShopifyFile, uploadGlbToShopifyFiles } from "../services/asset-storage";

/** Resource route (no UI) backing app.diagnostics.tsx. Returns plain JSON. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "store") {
    const t0 = Date.now();
    const demo = await buildDemoFrameGlb();
    try {
      const stored = await uploadGlbToShopifyFiles(admin, demo.glb, "virtual-mirror-diagnostic.glb", "Virtual Mirror diagnostic file (safe to delete)");
      const serverFetch = await fetch(stored.url, { headers: { Origin: "https://example-storefront.test" } });
      const bytes = new Uint8Array(await serverFetch.arrayBuffer());
      return Response.json({
        ok: true,
        fileGid: stored.fileGid,
        url: stored.url,
        status: stored.status,
        mimeType: stored.mimeType,
        uploadMs: Date.now() - t0,
        uploadedBytes: demo.glb.byteLength,
        cdn: {
          httpStatus: serverFetch.status,
          contentType: serverFetch.headers.get("content-type"),
          accessControlAllowOrigin: serverFetch.headers.get("access-control-allow-origin"),
          cacheControl: serverFetch.headers.get("cache-control"),
          bytes: bytes.byteLength,
          isGlb: bytes.byteLength >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === "glTF",
        },
      });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err), uploadMs: Date.now() - t0 });
    }
  }

  if (intent === "cleanup") {
    const fileGid = String(form.get("fileGid"));
    try {
      await deleteShopifyFile(admin, fileGid);
      // Deletion is asynchronous on Shopify's side; report what the API says now.
      const after = await gql<{ node: { fileStatus?: string } | null }>(admin, FILE_STATUS_QUERY, { id: fileGid });
      return Response.json({ ok: true, deleted: true, nodeAfterDelete: after.node ? `still present (${after.node.fileStatus})` : "gone" });
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ ok: false, error: `Unknown intent ${intent}` });
};

