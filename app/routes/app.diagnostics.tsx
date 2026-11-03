import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * Development-store diagnostics. Each check runs against the real store and
 * reports what was measured. Answers, with evidence:
 *  1. Can a GLB be stored as a generic Shopify file, read back, and deleted?
 *  2. Does Shopify's CDN serve it with CORS so a storefront can load it?
 *  3. Can the embedded admin read raw pixels of product images (for the
 *     future photo-based preparation), on the main thread and in a Worker?
 */

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const withImage = await prisma.product.findFirst({
    where: { shop: session.shop, featuredImageUrl: { not: null } },
    select: { title: true, featuredImageUrl: true },
  });
  return { shop: session.shop, sampleImage: withImage };
};

type Row = { check: string; result: "pass" | "fail" | "info"; detail: string };

async function post(body: Record<string, string>) {
  const fd = new FormData();
  Object.entries(body).forEach(([k, v]) => fd.set(k, v));
  // Resource route: returns plain JSON. App Bridge adds the session token to same-origin fetches.
  const res = await fetch("/app/diagnostics-api", { method: "POST", body: fd });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `Unexpected response (${res.status})` };
  }
}

const WORKER_SRC = `self.onmessage = async (e) => {
  try {
    const bmp = e.data;
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, Math.min(8, bmp.width), 1).data;
    self.postMessage({ ok: true, w: bmp.width, h: bmp.height, firstPixel: [d[0], d[1], d[2], d[3]] });
  } catch (err) { self.postMessage({ ok: false, error: String(err) }); }
};`;

async function imageChecks(url: string): Promise<Row[]> {
  const rows: Row[] = [];
  // A: <img crossOrigin> + canvas.getImageData on the main thread.
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url + (url.includes("?") ? "&" : "?") + "width=512";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, 1, 1).data;
    rows.push({ check: "Image pixels via <img crossOrigin> + canvas", result: "pass", detail: `${c.width}x${c.height}, first pixel rgba(${d[0]},${d[1]},${d[2]},${d[3]})` });
  } catch (err) {
    rows.push({ check: "Image pixels via <img crossOrigin> + canvas", result: "fail", detail: String(err) });
  }
  // B: fetch (CORS) -> createImageBitmap -> transfer to a Worker -> OffscreenCanvas pixels.
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "width=512", { mode: "cors" });
    rows.push({ check: "Image fetch (CORS) from admin iframe", result: res.ok ? "pass" : "fail", detail: `HTTP ${res.status}, access-control-allow-origin: ${res.headers.get("access-control-allow-origin") ?? "(none)"}` });
    const bmp = await createImageBitmap(await res.blob());
    const worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })));
    const out = await new Promise<{ ok: boolean; w?: number; h?: number; firstPixel?: number[]; error?: string }>((resolve) => {
      worker.onmessage = (e) => resolve(e.data);
      worker.onerror = (e) => resolve({ ok: false, error: e.message });
      worker.postMessage(bmp, [bmp]);
    });
    worker.terminate();
    rows.push({ check: "Image pixels inside a Web Worker (OffscreenCanvas)", result: out.ok ? "pass" : "fail", detail: out.ok ? `${out.w}x${out.h}, first pixel rgba(${out.firstPixel!.join(",")})` : out.error! });
  } catch (err) {
    rows.push({ check: "Image fetch / Worker pixel path", result: "fail", detail: String(err) });
  }
  return rows;
}

export default function Diagnostics() {
  const { shop, sampleImage } = useLoaderData<typeof loader>();
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out: Row[] = [{ check: "Environment", result: "info", detail: `${shop} · ${navigator.userAgent}` }];
    setRows([...out]);

    const stored = await post({ intent: "store" });
    if (!stored.ok) {
      out.push({ check: "Store GLB as a generic Shopify file", result: "fail", detail: stored.error });
    } else {
      out.push({ check: "Store GLB as a generic Shopify file", result: "pass", detail: `${stored.fileGid} ${stored.status} in ${stored.uploadMs} ms, mime ${stored.mimeType}` });
      out.push({ check: "File is not product media (no product attachment)", result: "info", detail: "Uploaded with fileCreate only; it is never attached to a product, so it cannot appear in the theme gallery." });
      out.push({ check: "CDN serves the GLB (server-side fetch)", result: stored.cdn.isGlb ? "pass" : "fail", detail: `HTTP ${stored.cdn.httpStatus}, ${stored.cdn.contentType}, ${stored.cdn.bytes} bytes (sent ${stored.uploadedBytes})` });
      out.push({ check: "CDN CORS header for storefronts", result: stored.cdn.accessControlAllowOrigin ? "pass" : "fail", detail: `access-control-allow-origin: ${stored.cdn.accessControlAllowOrigin ?? "(none)"}; cache-control: ${stored.cdn.cacheControl ?? "(none)"}` });
      try {
        const r = await fetch(stored.url, { mode: "cors" });
        const b = new Uint8Array(await r.arrayBuffer());
        out.push({ check: "Browser cross-origin GLB fetch (as the widget does)", result: r.ok && b.length > 0 ? "pass" : "fail", detail: `HTTP ${r.status}, ${b.length} bytes` });
      } catch (err) {
        out.push({ check: "Browser cross-origin GLB fetch (as the widget does)", result: "fail", detail: String(err) });
      }
      const cleaned = await post({ intent: "cleanup", fileGid: stored.fileGid });
      out.push({ check: "Delete the file", result: cleaned.ok ? "pass" : "fail", detail: cleaned.ok ? `node after delete: ${cleaned.nodeAfterDelete}` : cleaned.error });
    }
    setRows([...out]);

    if (sampleImage?.featuredImageUrl) {
      out.push({ check: "Sample product image", result: "info", detail: `${sampleImage.title}: ${sampleImage.featuredImageUrl}` });
      out.push(...(await imageChecks(sampleImage.featuredImageUrl)));
    } else {
      out.push({ check: "Product image pixel access", result: "info", detail: "No synced product with an image. Sync the catalog first." });
    }
    setRows([...out]);
    setRunning(false);
  };

  return (
    <s-page heading="Diagnostics">
      <s-button slot="primary-action" onClick={run} {...(running ? { loading: true } : {})}>
        Run checks
      </s-button>
      <s-section>
        <s-paragraph>
          Runs real checks against this store: uploads a small test frame to Files, checks the CDN and CORS, deletes it,
          and tests whether product image pixels can be read in this browser. Copy the results into
          docs/IMPLEMENTATION_STATUS.md.
        </s-paragraph>
      </s-section>
      {rows.length > 0 && (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header>Check</s-table-header>
              <s-table-header>Result</s-table-header>
              <s-table-header>Detail</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r, i) => (
                <s-table-row key={i}>
                  <s-table-cell>{r.check}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.result === "pass" ? "success" : r.result === "fail" ? "critical" : "neutral"}>{r.result}</s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-text>{r.detail}</s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
      {rows.length > 0 && !running && (
        <s-section heading="Copy as text">
          <s-text-area label="Results" value={rows.map((r) => `${r.result.toUpperCase()}\t${r.check}\t${r.detail}`).join("\n")} rows={8} />
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
