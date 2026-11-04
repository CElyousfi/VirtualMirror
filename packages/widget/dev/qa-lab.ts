/**
 * Virtual Mirror QA Lab: internal development page. Everything rendered here
 * comes from the real widget code (src/index.ts, src/qa.ts). Nothing is
 * uploaded; files stay in the browser until downloaded.
 */
import { PROVENANCE_LABEL, mToMm, type AssetProvenance } from "@vm/contracts";
import { inspectDocument, readGlb } from "@vm/engine-geometry";
import { COMMIT, type SessionStats } from "../src/index";
import { StudioViewer, compareTraces, replayVideo, type RenderMode, type StudioView } from "../src/qa";
import { downloadBlob, downloadDataUrl, stampLabel } from "../src/capture";
import {
  CRITERIA,
  dimensionChecks,
  toMarkdown,
  validateReport,
  verdict,
  type CriterionId,
  type CriterionResult,
  type QaReport,
  type SessionRecord,
  type TestKind,
} from "../src/core/qa-report";
import type { TraceFrame } from "../src/core/metrics";

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
// Optional local copies of MediaPipe assets (offline testing). Defaults are the public CDNs.
const wasmBaseUrl = params.get("wasm") ?? undefined;
const modelUrl = params.get("model") ?? undefined;

$<HTMLElement>("buildInfo").textContent = `commit ${COMMIT} · ${navigator.userAgent}`;

// ---------------------------------------------------------------- state

interface Capture { fileName: string; dataUrl: string; kind: "studio" | "live" | "replay"; view?: string }
const state = {
  asset: null as null | { fileName: string; url: string; bytes: number; sha256: string; frontWidthMm: number; heightMm: number; depthMm: number; triangles: number; bridgeM: [number, number, number] },
  photos: {} as Partial<Record<StudioView, { url: string; fileName: string }>>,
  overlay: {} as Partial<Record<StudioView, { scale: number; x: number; y: number; rot: number }>>,
  sessions: [] as SessionRecord[],
  traces: [] as { kind: string; trace: TraceFrame[] }[],
  captures: [] as Capture[],
  criteria: Object.fromEntries(CRITERIA.map((c) => [c.id, { result: "not-tested" as CriterionResult, note: "" }])) as Record<CriterionId, { result: CriterionResult; note: string }>,
};

const viewer = new StudioViewer($<HTMLDivElement>("stage"));
viewer.setProjection("orthographic");

const provenance = () => $<HTMLSelectElement>("provenance").value as AssetProvenance | "";
const provLabel = () => (provenance() ? PROVENANCE_LABEL[provenance() as AssetProvenance] : "PROVENANCE NOT SET");
const assetLabel = () => `${provLabel()} · ${state.asset?.fileName ?? "no asset"} · ${$<HTMLSelectElement>("method").value}`;
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

function refreshProvenance() {
  const p = provenance();
  const b = $<HTMLSpanElement>("provBanner");
  b.className = `badge ${p || "unset"}`;
  b.textContent = p ? PROVENANCE_LABEL[p] : "Provenance not set";
  refreshReport();
}
$("provenance").addEventListener("change", refreshProvenance);
$("method").addEventListener("change", refreshReport);

// ---------------------------------------------------------------- asset

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadAsset(bytes: Uint8Array, fileName: string) {
  const doc = await readGlb(bytes);
  const info = inspectDocument(doc, bytes.byteLength);
  const extras = doc.getRoot().listNodes().map((n) => n.getExtras() as { vm?: { kind?: string } }).find((e) => e?.vm?.kind);
  if (extras?.vm?.kind === "demo-template") {
    $<HTMLSelectElement>("provenance").value = "generic";
    $<HTMLSelectElement>("method").value = "demo-template";
  } else {
    // Never guess: the tester must say where this model came from.
    $<HTMLSelectElement>("provenance").value = "";
  }
  if (state.asset) URL.revokeObjectURL(state.asset.url);
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "model/gltf-binary" }));
  state.asset = {
    fileName,
    url,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    frontWidthMm: Math.round(mToMm(info.frontWidth * info.toMetres) * 10) / 10,
    heightMm: Math.round(mToMm(info.size[1] * info.toMetres) * 10) / 10,
    depthMm: Math.round(mToMm(info.size[2] * info.toMetres) * 10) / 10,
    triangles: info.triangleCount,
    bridgeM: (info.bridgeNode?.map((v) => v * info.toMetres) as [number, number, number]) ?? [0, 0, 0],
  };
  await viewer.load(url);
  const a = state.asset;
  $<HTMLElement>("assetInfo").innerHTML = `
    <dt>File</dt><dd>${a.fileName} (${(a.bytes / 1024).toFixed(1)} KB)</dd>
    <dt>SHA-256</dt><dd><code>${a.sha256.slice(0, 24)}…</code></dd>
    <dt>Units</dt><dd>${info.unit}${info.unit !== "metres" ? " (converted for measurement)" : ""}</dd>
    <dt>Front width</dt><dd>${a.frontWidthMm} mm</dd>
    <dt>Height</dt><dd>${a.heightMm} mm</dd>
    <dt>Depth (Z)</dt><dd>${a.depthMm} mm</dd>
    <dt>Triangles</dt><dd>${a.triangles.toLocaleString("en")}</dd>
    <dt>Bridge anchor</dt><dd>${info.bridgeNode ? "VM_Bridge node" : "origin (no VM_Bridge node)"}</dd>`;
  refreshProvenance();
  refreshDims();
}

$("glbFile").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) await loadAsset(new Uint8Array(await f.arrayBuffer()), f.name);
});
$("useDemo").addEventListener("click", async () => {
  const res = await fetch("/demo-frame.glb");
  await loadAsset(new Uint8Array(await res.arrayBuffer()), "demo-frame.glb");
});

// ---------------------------------------------------------------- product

const dims = () => {
  const n = (id: string) => (Number($(id).value) > 0 ? Number($(id).value) : undefined);
  return { lensWidth: n("dimLensWidth"), lensHeight: n("dimLensHeight"), bridgeWidth: n("dimBridgeWidth"), templeLength: n("dimTempleLength"), totalWidth: n("dimTotalWidth") };
};

function refreshDims() {
  const t = $<HTMLTableElement>("dimChecks");
  if (!state.asset) return (t.innerHTML = "");
  const checks = dimensionChecks(dims(), state.asset);
  t.innerHTML = checks.length
    ? `<tr><th>Dimension</th><th>Product</th><th>Asset</th><th>Δ mm</th></tr>` +
      checks.map((c) => `<tr><td>${c.name}</td><td>${c.productMm}</td><td>${c.assetMm}</td><td>${c.deltaMm > 0 ? "+" : ""}${c.deltaMm}</td></tr>`).join("")
    : `<tr><td class="muted">Enter the product's total front width or temple length to compare with the asset. Lens and bridge widths are recorded but cannot be measured from an arbitrary mesh yet.</td></tr>`;
  refreshReport();
}
["dimLensWidth", "dimBridgeWidth", "dimTempleLength", "dimLensHeight", "dimTotalWidth", "productName", "productSource", "tester", "device", "testKind", "failures"].forEach((id) =>
  $(id).addEventListener("input", () => (id.startsWith("dim") ? refreshDims() : refreshReport())),
);

const photoInputs: [string, StudioView][] = [["photoFront", "front"], ["photoThreeQuarter", "threeQuarter"], ["photoSide", "side"]];
for (const [id, view] of photoInputs) {
  $(id).addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    state.photos[view] = { url: URL.createObjectURL(f), fileName: f.name };
    $<HTMLDivElement>("thumbs").innerHTML = Object.entries(state.photos).map(([v, p]) => `<img src="${p!.url}" title="${v}: ${p!.fileName}" alt="${v}">`).join("");
    if (viewer.view === view) applyOverlay();
    refreshReport();
  });
}

// ---------------------------------------------------------------- viewer + overlay

const overlayEl = $<HTMLImageElement>("overlay");
const ov = () => state.overlay[viewer.view] ?? { scale: 1, x: 0, y: 0, rot: 0 };

function applyOverlay() {
  const photo = state.photos[viewer.view];
  const on = $("overlayOn").checked && !!photo;
  overlayEl.hidden = !on;
  const o = ov();
  $("ovScale").value = String(o.scale);
  $("ovX").value = String(o.x);
  $("ovY").value = String(o.y);
  $("ovRot").value = String(o.rot);
  if (on && photo) {
    overlayEl.src = photo.url;
    overlayEl.style.opacity = $("ovOpacity").value;
    overlayEl.style.mixBlendMode = $<HTMLSelectElement>("ovBlend").value;
    overlayEl.style.transform = `translate(-50%, -50%) translate(${o.x}px, ${o.y}px) rotate(${o.rot}deg) scale(${o.scale})`;
  }
  const mpp = viewer.metresPerPixel();
  $<HTMLElement>("scaleInfo").textContent = mpp ? `Orthographic: 1 screen px = ${(mpp * 1000).toFixed(3)} mm at the model. Align the photo's frame edges with the render, then read the scale.` : "Perspective view: use orthographic for measurements.";
}

for (const id of ["ovScale", "ovX", "ovY", "ovRot"]) {
  $(id).addEventListener("input", () => {
    state.overlay[viewer.view] = { scale: Number($("ovScale").value) || 1, x: Number($("ovX").value) || 0, y: Number($("ovY").value) || 0, rot: Number($("ovRot").value) || 0 };
    applyOverlay();
  });
}
["ovOpacity", "ovBlend", "overlayOn"].forEach((id) => $(id).addEventListener("input", applyOverlay));

function setView(view: StudioView) {
  viewer.setView(view, Number($("elevation").value) || 0);
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  $<HTMLSpanElement>("viewName").textContent = view;
  applyOverlay();
}
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view as StudioView)));
$("elevation").addEventListener("change", () => setView(viewer.view));
$("projection").addEventListener("change", () => {
  viewer.setProjection($<HTMLSelectElement>("projection").value as "orthographic" | "perspective");
  applyOverlay();
});
$("renderMode").addEventListener("change", () => viewer.setRenderMode($<HTMLSelectElement>("renderMode").value as RenderMode));
$("background").addEventListener("change", () => {
  const v = $<HTMLSelectElement>("background").value;
  viewer.setBackground(v ? parseInt(v, 16) : null);
});
$("grid").addEventListener("change", () => viewer.setGrid($("grid").checked));

function addCapture(c: Capture) {
  state.captures.push(c);
  const fig = document.createElement("figure");
  fig.innerHTML = `<img src="${c.dataUrl}" alt="${c.fileName}"><figcaption>${c.fileName}</figcaption>`;
  fig.querySelector("img")!.addEventListener("click", () => downloadDataUrl(c.dataUrl, c.fileName));
  $<HTMLDivElement>("gallery").append(fig);
  refreshReport();
}

const viewLabel = (extra = "") =>
  `${assetLabel()}\n${COMMIT} · studio ${viewer.view} · elev ${viewer.elevationDeg}° · ${$<HTMLSelectElement>("projection").value} · ${$<HTMLSelectElement>("renderMode").value}${extra}`;

function captureRender() {
  if (!state.asset) return alert("Load an asset first.");
  const bg = $<HTMLSelectElement>("background").value;
  addCapture({ fileName: `studio-${viewer.view}-${stamp()}.png`, dataUrl: viewer.capture(viewLabel(), bg ? `#${bg}` : "#ffffff"), kind: "studio", view: viewer.view });
}

/** Render + reference photo, composited with the same transform as on screen. */
async function captureComparison() {
  const photo = state.photos[viewer.view];
  if (!state.asset || !photo) return alert("Load an asset and a photo for this view first.");
  const src = viewer.renderer.domElement;
  const stage = $<HTMLDivElement>("stage");
  const dpr = src.width / stage.clientWidth;
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, out.width, out.height);
  const img = new Image();
  img.src = photo.url;
  await img.decode();
  const o = ov();
  const fit = Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight, 1);
  const w = img.naturalWidth * fit * dpr;
  const h = img.naturalHeight * fit * dpr;
  // The studio renderer preserves its drawing buffer: this is the frame on screen.
  g.drawImage(src, 0, 0);
  g.save();
  g.globalAlpha = Number($("ovOpacity").value);
  g.globalCompositeOperation = $<HTMLSelectElement>("ovBlend").value === "difference" ? "difference" : "source-over";
  g.translate(out.width / 2 + o.x * dpr, out.height / 2 + o.y * dpr);
  g.rotate((o.rot * Math.PI) / 180);
  g.scale(o.scale, o.scale);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
  stampLabel(g, out.width, out.height, viewLabel(` · overlay ${photo.fileName} opacity ${$("ovOpacity").value} scale ${o.scale} offset ${o.x},${o.y} rot ${o.rot}°`));
  addCapture({ fileName: `compare-${viewer.view}-${stamp()}.png`, dataUrl: out.toDataURL("image/png"), kind: "studio", view: `${viewer.view} vs ${photo.fileName}` });
}

$("captureView").addEventListener("click", captureRender);
$("captureCompare").addEventListener("click", () => void captureComparison());
$("captureSet").addEventListener("click", async () => {
  for (const v of ["front", "threeQuarter", "side"] as StudioView[]) {
    setView(v);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    captureRender();
  }
  setView("front");
});
$("downloadCaptures").addEventListener("click", () => state.captures.forEach((c, i) => setTimeout(() => downloadDataUrl(c.dataUrl, c.fileName), i * 250)));

// ---------------------------------------------------------------- live + replay

function requireReady(needConsent: boolean): boolean {
  if (!state.asset) return alert("Load the asset under test first."), false;
  if (!provenance()) return alert("Set the asset's provenance first."), false;
  if (needConsent && !$("consent").value.trim()) return alert("Record the consent / permission basis for this video first."), false;
  return true;
}

function sessionFromStats(s: SessionStats, kind: SessionRecord["kind"], source: string): SessionRecord {
  return {
    kind,
    source,
    consent: kind === "live-camera" ? undefined : $("consent").value.trim(),
    device: $("device").value.trim(),
    browser: navigator.userAgent,
    gpu: s.gpu,
    delegate: s.delegate,
    videoSize: s.videoSize,
    avgFps: s.avgFps,
    trackerReadyMs: s.trackerReadyMs,
    frameReadyMs: s.frameReadyMs,
    summary: s.summary ?? null,
  };
}

function openLive(source: { kind: "camera" } | { kind: "video"; url: string }, sourceName: string) {
  const a = state.asset!;
  window.VirtualMirror!.open({
    manifest: { v: 1, enabled: true, updatedAt: new Date().toISOString(), assets: [{ variantIds: ["*"], glbUrl: a.url, bridgeM: a.bridgeM, frameWidthM: a.frontWidthMm / 1000, scale: "estimated" }] },
    productTitle: $("productName").value || a.fileName,
    variantId: null,
    cartAddUrl: "/cart/add.js",
    cartUrl: "/cart",
    debug: $("debugOn").checked,
    mirror: $("mirrorOn").checked,
    source,
    wasmBaseUrl,
    modelUrl,
    qa: {
      label: assetLabel(),
      trace: true,
      onCapture: (dataUrl, meta) => addCapture({ fileName: `live-${source.kind}-f${meta.frame}-${stamp()}.png`, dataUrl, kind: "live" }),
      onClose: (stats) => {
        if (stats.error) alert(`Session ended with error: ${stats.error}`);
        state.sessions.push(sessionFromStats(stats, source.kind === "camera" ? "live-camera" : "live-video", sourceName));
        state.traces.push({ kind: `${source.kind}:${sourceName}`, trace: stats.trace ?? [] });
        renderSessions();
      },
    },
  });
}

$("openCamera").addEventListener("click", () => requireReady(false) && openLive({ kind: "camera" }, "front camera"));
$("openVideo").addEventListener("click", () => {
  const f = $("videoFile").files?.[0];
  if (!f) return alert("Choose a test video first.");
  if (requireReady(true)) openLive({ kind: "video", url: URL.createObjectURL(f) }, f.name);
});

async function runReplay(times: 1 | 2) {
  const f = $("videoFile").files?.[0];
  if (!f) return alert("Choose a test video first.");
  if (!requireReady(true)) return;
  const progress = $<HTMLProgressElement>("replayProgress");
  progress.hidden = false;
  const url = URL.createObjectURL(f);
  const runs = [];
  for (let k = 0; k < times; k++) {
    runs.push(
      await replayVideo({
        videoUrl: url,
        glbUrl: state.asset!.url,
        bridgeM: state.asset!.bridgeM,
        fps: Number($("replayFps").value) || 30,
        maxFrames: Number($("replayMax").value) || undefined,
        captureEvery: k === 0 ? Number($("replayEvery").value) || 0 : 0,
        label: assetLabel(),
        mirror: $("mirrorOn").checked,
        wasmBaseUrl,
        modelUrl,
        onProgress: (i, n) => ((progress.max = n * times), (progress.value = k * n + i)),
      }),
    );
  }
  progress.hidden = true;
  const r = runs[0]!;
  r.captures.forEach((c) => addCapture({ fileName: `replay-f${String(c.frame).padStart(5, "0")}-${stamp()}.png`, dataUrl: c.dataUrl, kind: "replay" }));
  state.sessions.push({
    kind: "replay",
    source: f.name,
    consent: $("consent").value.trim(),
    device: $("device").value.trim(),
    browser: navigator.userAgent,
    gpu: r.gpu,
    delegate: r.delegate,
    videoSize: `${r.video.width}x${r.video.height}`,
    avgFps: null,
    trackerReadyMs: r.trackerReadyMs,
    frameReadyMs: null,
    summary: r.summary,
    determinism: runs[1] ? compareTraces(r.trace, runs[1].trace) : undefined,
  });
  state.traces.push({ kind: `replay:${f.name}`, trace: r.trace });
  renderSessions();
  // Exposed for automated checks.
  (window as unknown as { __vmLastReplay: unknown }).__vmLastReplay = { summary: r.summary, determinism: state.sessions.at(-1)!.determinism, frames: r.trace.length };
}
$("runReplay").addEventListener("click", () => void runReplay(1));
$("runReplayTwice").addEventListener("click", () => void runReplay(2));

function renderSessions() {
  const t = $<HTMLTableElement>("sessions");
  if (!state.sessions.length) return;
  t.innerHTML =
    "<tr><th>Kind</th><th>Source</th><th>FPS</th><th>Tracked</th><th>Detect avg/p95</th><th>Jitter</th><th>Yaw</th><th>Delegate</th></tr>" +
    state.sessions
      .map((s) => {
        const m = s.summary;
        return `<tr><td>${s.kind}</td><td>${s.source}</td><td>${s.avgFps ?? "n/a"}</td><td>${m ? m.trackedPct + "%" : "—"}</td><td>${m ? `${m.avgDetectMs}/${m.p95DetectMs} ms` : "—"}</td><td>${m?.jitterRmsPx != null ? `${m.jitterRmsPx}px` : "—"}</td><td>${m?.yawRange ? m.yawRange.join("…") + "°" : "—"}</td><td>${s.delegate ?? "—"}</td></tr>${s.determinism ? `<tr><td></td><td colspan="7" class="muted">Determinism: ${s.determinism.trackedMismatches} tracked mismatches, max anchor Δ ${s.determinism.maxAnchorDiffPx}px over ${s.determinism.frames} frames</td></tr>` : ""}`;
      })
      .join("");
  refreshReport();
}

// ---------------------------------------------------------------- evaluation + export

const critTable = $<HTMLTableElement>("criteria");
critTable.innerHTML =
  "<tr><th>Test</th><th>Result</th><th>Observation</th></tr>" +
  CRITERIA.map(
    (c) => `<tr><td><b>${c.name}</b><div class="muted">${c.examines}</div></td>
    <td><select data-crit="${c.id}"><option value="not-tested">not tested</option><option value="pass">pass</option><option value="fail">fail</option>${c.id === "automation" ? '<option value="not-applicable">not applicable</option>' : ""}</select></td>
    <td><textarea data-note="${c.id}" rows="2"></textarea></td></tr>`,
  ).join("");
critTable.addEventListener("input", (e) => {
  const el = e.target as HTMLSelectElement | HTMLTextAreaElement;
  const id = (el.dataset.crit ?? el.dataset.note) as CriterionId;
  if (el.dataset.crit) state.criteria[id].result = el.value as CriterionResult;
  else state.criteria[id].note = el.value;
  refreshReport();
});

function buildReport(): QaReport {
  const a = state.asset;
  return {
    schema: "vm-qa-report/1",
    createdAt: new Date().toISOString(),
    commit: COMMIT,
    testKind: $<HTMLSelectElement>("testKind").value as TestKind,
    tester: $("tester").value,
    product: {
      name: $("productName").value,
      source: $("productSource").value,
      dimensionsMm: dims(),
      photos: Object.entries(state.photos).map(([view, p]) => ({ view, fileName: p!.fileName })),
    },
    asset: {
      fileName: a?.fileName ?? "",
      sha256: a?.sha256 ?? "",
      bytes: a?.bytes ?? 0,
      provenance: (provenance() || "generic") as AssetProvenance,
      method: $<HTMLSelectElement>("method").value,
      triangles: a?.triangles ?? 0,
      frontWidthMm: a?.frontWidthMm ?? 0,
      heightMm: a?.heightMm ?? 0,
      depthMm: a?.depthMm ?? 0,
    },
    sessions: state.sessions,
    captures: state.captures.map((c) => ({ fileName: c.fileName, kind: c.kind, view: c.view })),
    criteria: CRITERIA.map((c) => ({ id: c.id, ...state.criteria[c.id] })),
    knownFailures: $<HTMLTextAreaElement>("failures").value,
  };
}

function refreshReport() {
  const r = buildReport();
  const errors = validateReport(r);
  if (!provenance()) errors.unshift("Set the asset's provenance.");
  $<HTMLElement>("errors").innerHTML = errors.map((e) => `<div>• ${e}</div>`).join("");
  $<HTMLElement>("verdict").textContent = verdict(r);
}

$("exportMd").addEventListener("click", () => {
  const r = buildReport();
  const md = toMarkdown(r, provLabel());
  downloadBlob(new Blob([md], { type: "text/markdown" }), `qa-${(r.product.name || "untitled").replace(/\W+/g, "-").toLowerCase()}-${r.commit}-${stamp()}.md`);
});
$("exportJson").addEventListener("click", () => {
  const r = buildReport();
  downloadBlob(new Blob([JSON.stringify({ report: r, traces: state.traces }, null, 2)], { type: "application/json" }), `qa-${r.commit}-${stamp()}.json`);
});

setView("front");
refreshReport();
(window as unknown as { __vmQa: unknown }).__vmQa = { state, buildReport, loadAsset };
