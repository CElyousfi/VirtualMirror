// Headless smoke test of the built widget. See scripts/smoke/README.md.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const video = path.resolve(arg("--video") || "face.y4m");
const model = path.resolve(arg("--model") || "face_landmarker.task");
const root = path.resolve(__dirname, "../..");
const wasmDir = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
for (const f of [video, model, wasmDir]) if (!fs.existsSync(f)) { console.error(`Missing ${f}`); process.exit(2); }

const files = {
  "/virtual-mirror.js": path.join(root, "extensions/virtual-mirror/assets/virtual-mirror.js"),
  "/vm-loader.js": path.join(root, "extensions/virtual-mirror/assets/vm-loader.js"),
  "/demo-frame.glb": path.join(root, "fixtures/demo-frame.glb"),
};
const page = (port) => `<!doctype html><meta charset="utf-8"><script src="/vm-loader.js" defer></script>
<form action="/cart/add"><select name="id"><option value="13" selected>Tortoise</option><option value="99">Red</option></select></form>
<div><button data-vm-open data-product-title="Smoke" data-variant-id="11" data-widget-src="/virtual-mirror.js" data-cart-add-url="/cart/add.js" data-cart-url="/cart">Try On Live</button>
<script type="application/json" data-vm-manifest>${JSON.stringify({ v: 1, enabled: true, updatedAt: new Date().toISOString(), assets: [
  { variantIds: ["11"], label: "Black", glbUrl: `http://localhost:${port}/demo-frame.glb`, bridgeM: [0, 0, 0], frameWidthM: 0.138, scale: "estimated" },
  { variantIds: ["13"], label: "Tortoise", glbUrl: `http://localhost:${port}/demo-frame.glb`, bridgeM: [0, 0, 0], frameWidthM: 0.138, scale: "estimated" }] })}</script></div>`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/") return res.end(page(server.address().port));
  const f = files[p];
  if (!f) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", p.endsWith(".js") ? "text/javascript" : "model/gltf-binary");
  fs.createReadStream(f).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${video}`, "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  const tab = await browser.newPage();
  const requested = [];
  tab.on("request", (r) => requested.push(new URL(r.url()).pathname));
  await tab.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ path: path.join(wasmDir, r.request().url().split("/").pop()) }));
  await tab.route("https://storage.googleapis.com/**", (r) => r.fulfill({ path: model }));
  await tab.goto(`http://localhost:${port}/`);
  await tab.waitForTimeout(500);
  const results = {};
  const check = (name, ok, detail) => (results[name] = { ok: !!ok, detail });
  check("widget not loaded before click", !requested.includes("/virtual-mirror.js"));
  await tab.click("[data-vm-open]");
  await tab.waitForTimeout(10000);
  const sr = (sel) => tab.evaluate((s) => document.querySelector("[data-virtual-mirror]")?.shadowRoot.querySelector(s)?.textContent ?? null, sel);
  check("face tracked", stats.trackedFrames > 0, `${stats.trackedFrames}/${stats.frames} frames`);
  check("no session error", !stats.error, stats.error);
  check("selected variant from theme form", chipSelected === "Tortoise");
  check("overlay removed on close", !(await tab.evaluate(() => !!document.querySelector("[data-virtual-mirror]"))));
  await tab.selectOption("select[name=id]", "99");
  await tab.click("[data-vm-open]");
  await tab.waitForTimeout(6000);
  check("unprepared colour refused, not substituted", (await sr(".status")) === "This colour isn't available in the mirror yet.");
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(300);
  check("Escape closes and returns focus", await tab.evaluate(() => !document.querySelector("[data-virtual-mirror]") && document.activeElement?.hasAttribute("data-vm-open")));
  console.log(JSON.stringify({ results, stats }, null, 2));
  await browser.close();
  server.close();
  process.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
});
