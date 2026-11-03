import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * `vite build`: one self-contained IIFE bundle written into the theme app
 * extension's assets, loaded only when a shopper opens the mirror.
 * `vite` (dev): serves dev/index.html, a local harness with the demo frame.
 * MediaPipe's WASM and model are fetched at runtime from public CDNs, not bundled.
 */
export default defineConfig({
  publicDir: resolve(__dirname, "dev/public"),
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
