// Renderer calibration check (REALISM_PLAN.md S0.1). Starts the widget's Vite
// dev server, renders dev/diagnose-materials.html in headless Chromium and
// asserts the lighting and colour pipeline. Exit code 1 on any failure.
//   NODE_PATH=$(npm root -g) node scripts/calibration/run.cjs
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ root: path.resolve(__dirname, "../../packages/widget"), configFile: path.resolve(__dirname, "../../packages/widget/vite.config.ts"), server: { port: 0 }, logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(`${url}dev/diagnose-materials.html?env=studio-v1`);
  await page.waitForFunction(() => window.__diag, null, { timeout: 120000 });
  const d = await page.evaluate(() => window.__diag);
  await browser.close();
  await server.close();

  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
  const card = d.plate.I_greyCard18_noTone.linear;
  check("18 % grey card facing camera reads 0.18 +- 0.01 (linear)", Math.abs(card - 0.18) <= 0.01, card);
  const ratio = card / 0.18;
  for (const c of [0.03, 0.1, 0.18, 0.4, 0.7]) {
    const got = d.colourFidelity[`base_${c}_noTone`].linear;
    const err = got / (c * ratio) - 1;
    check(`matte base colour ${c} reproduced within 5 %`, Math.abs(err) <= 0.05, `${(err * 100).toFixed(1)} %`);
  }
  const total = d.plate.D_noToneMapping.linear;
  const diffuse = d.plate.B2_diffuseOnly_noTone.linear;
  check("reflection is < 25 % of a flat black acetate front at normal incidence", (total - diffuse) / total < 0.25, `${(((total - diffuse) / total) * 100).toFixed(1)} %`);
  check("material.envMapIntensity is not relied upon (three.js ignores it with scene.environment)", d.plate.F_materialEnvMapIntensity0_1_ignored.linear === d.plate.A_current.linear, "documented behaviour still holds");
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  [${r.detail}]`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
