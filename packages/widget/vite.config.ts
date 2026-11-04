import { execSync } from "node:child_process";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig, type Plugin } from "vite";

/** Commit SHA baked into every build so reports and captures name the exact code tested. */
function commitSha(): string {
  try {
    const sha = execSync("git rev-parse --short=10 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

/**
 * `vite build`: one self-contained IIFE bundle written into the theme app
 * extension's assets, loaded only when a shopper opens the mirror.
 * `vite` (dev): serves dev/index.html, a local harness with the demo frame.
 * MediaPipe's WASM and model are fetched at runtime from public CDNs, not bundled.
 */
/**
 * MediaPipe Tasks (Apache-2.0) creates a usage logger for every task that POSTs
 * ~140 bytes of protobuf metrics (task type, library version, timings; no image
 * data) to https://odml.pa.googleapis.com/v1/log, with no option to turn it
 * off. Observed in the QA Lab network log, 2026-11-04 (docs/DECISIONS.md D-016).
 *
 * This rewrites that single send so it reports success without any request.
 * The build fails if the call site is not found exactly once, so a MediaPipe
 * upgrade can never silently re-enable it.
 */
export const TELEMETRY_MARKER = "/*vm:mediapipe-telemetry-disabled*/";
function disableMediapipeTelemetry(): Plugin {
  const site = /this\.(\w+)\.send\(\{url:"https:\/\/odml\.pa\.googleapis\.com\/v1\/log"/g;
  return {
    name: "vm-disable-mediapipe-telemetry",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@mediapipe") || !code.includes("odml.pa.googleapis.com")) return null;
      const hits = code.match(site)?.length ?? 0;
      if (hits !== 1) this.error(`Expected exactly 1 MediaPipe telemetry call site in ${id}, found ${hits}. Review before upgrading.`);
      return { code: code.replace(site, `${TELEMETRY_MARKER}((_request,done)=>done())({url:"https://odml.pa.googleapis.com/v1/log"`), map: null };
    },
  };
}

export default defineConfig({
  // VM_HTTPS=1 serves the dev pages over HTTPS with a self-signed certificate,
  // so a phone on the same Wi-Fi can open the QA Lab with camera access.
  plugins: [disableMediapipeTelemetry(), ...(process.env.VM_HTTPS ? [basicSsl()] : [])],
  // Excluded from dev pre-bundling so the plugin above also applies in the QA Lab.
  optimizeDeps: { exclude: ["@mediapipe/tasks-vision"] },
  define: { __VM_COMMIT__: JSON.stringify(commitSha()) },
  // Dev server serves fixtures/ (e.g. /demo-frame.glb) directly, so it is never a stale copy.
  publicDir: resolve(__dirname, "../../fixtures"),
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "VirtualMirrorWidget",
      formats: ["iife"],
      fileName: () => "virtual-mirror.js",
    },
    outDir: resolve(__dirname, "../../extensions/virtual-mirror/assets"),
    emptyOutDir: false,
    copyPublicDir: false,
    target: "es2020",
    sourcemap: false,
    reportCompressedSize: true,
  },
  server: { host: true },
});
