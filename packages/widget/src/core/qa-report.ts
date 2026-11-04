/**
 * Visual QA report model. Pure TypeScript, no DOM.
 *
 * The rules here exist so a report cannot overstate a result:
 * - every pass or fail needs a written note;
 * - a generic frame can never pass product fidelity;
 * - anything not tested makes the verdict INCOMPLETE, never PASS;
 * - live-renderer tests and automatic-reconstruction tests are different kinds
 *   and are reported separately.
 */
import type { AssetProvenance } from "@vm/contracts";
import type { TraceSummary } from "./metrics";

export type TestKind = "live-renderer" | "automatic-reconstruction";
export type CriterionResult = "pass" | "fail" | "not-tested" | "not-applicable";

export const CRITERIA = [
  { id: "front-alignment", name: "Front alignment", examines: "Glasses centred on the face and nose" },
  { id: "scale", name: "Scale", examines: "Product proportions, no arbitrary stretching" },
  { id: "head-rotation", name: "Head rotation", examines: "Frame stays anchored during turns and tilts" },
  { id: "occlusion", name: "Occlusion", examines: "Temples pass naturally behind the face and head" },
  { id: "materials", name: "Materials", examines: "Lenses, reflections, colours, textures" },
  { id: "tracking-stability", name: "Tracking stability", examines: "Jitter, frame drops, delayed movement" },
  { id: "product-fidelity", name: "Product fidelity", examines: "Rendered frame vs photographs of the real pair" },
  { id: "automation", name: "Automation", examines: "Whether preparation needed manual geometry work" },
] as const;

export type CriterionId = (typeof CRITERIA)[number]["id"];

export interface DimensionsMm {
  lensWidth?: number;
  lensHeight?: number;
  bridgeWidth?: number;
  templeLength?: number;
  totalWidth?: number;
}

export interface SessionRecord {
  kind: "live-camera" | "live-video" | "replay";
  source: string;
  consent?: string;
  device: string;
  browser: string;
  gpu: string | null;
  delegate: string | null;
  videoSize: string | null;
  avgFps: number | null;
  trackerReadyMs: number | null;
  frameReadyMs: number | null;
  summary: TraceSummary | null;
  determinism?: { frames: number; trackedMismatches: number; maxAnchorDiffPx: number };
}

export interface QaReport {
  schema: "vm-qa-report/1";
  createdAt: string;
  commit: string;
  testKind: TestKind;
  tester: string;
  product: { name: string; source: string; dimensionsMm: DimensionsMm; photos: { view: string; fileName: string }[] };
  asset: {
    fileName: string;
    sha256: string;
    bytes: number;
    provenance: AssetProvenance;
    method: string;
    triangles: number;
    frontWidthMm: number;
    heightMm: number;
    depthMm: number;
  };
  sessions: SessionRecord[];
  captures: { fileName: string; kind: "studio" | "live" | "replay"; view?: string }[];
  criteria: { id: CriterionId; result: CriterionResult; note: string }[];
  knownFailures: string;
}

export interface DimensionCheck {
  name: string;
  productMm: number;
  assetMm: number;
  deltaMm: number;
}

/** Compare what the asset measures against what the product sheet says. */
export function dimensionChecks(product: DimensionsMm, asset: { frontWidthMm: number; depthMm: number }): DimensionCheck[] {
  const out: DimensionCheck[] = [];
  const add = (name: string, p: number | undefined, a: number) => {
    if (p) out.push({ name, productMm: p, assetMm: Math.round(a * 10) / 10, deltaMm: Math.round((a - p) * 10) / 10 });
  };
  add("Total front width", product.totalWidth, asset.frontWidthMm);
  // Temple length is measured along the temple, depth along Z: comparable only roughly.
  add("Depth (front to temple tip, along Z) vs temple length", product.templeLength, asset.depthMm);
  return out;
}

export function validateReport(r: QaReport): string[] {
  const errors: string[] = [];
  if (!r.product.name.trim()) errors.push("Product name is required.");
  if (!r.asset.fileName) errors.push("Load the asset that was tested.");
  if (!r.tester.trim()) errors.push("Tester name is required.");
  for (const c of r.criteria) {
    const name = CRITERIA.find((x) => x.id === c.id)!.name;
    if ((c.result === "pass" || c.result === "fail") && !c.note.trim()) errors.push(`${name}: a ${c.result} needs a note saying what was observed.`);
    if (c.result === "not-applicable" && !(c.id === "automation" && r.testKind === "live-renderer"))
      errors.push(`${name}: only Automation may be marked not applicable, and only in a live-renderer test.`);
  }
  const fidelity = r.criteria.find((c) => c.id === "product-fidelity");
  if (r.asset.provenance === "generic" && fidelity?.result === "pass")
    errors.push("Product fidelity cannot pass with a generic frame: it is not the product.");
  const automation = r.criteria.find((c) => c.id === "automation");
  if (r.testKind === "automatic-reconstruction" && r.asset.provenance !== "automatic")
    errors.push("An automatic-reconstruction test must use an automatically generated asset.");
  if (r.testKind === "automatic-reconstruction" && automation?.result === "not-applicable")
    errors.push("Automation must be evaluated in an automatic-reconstruction test.");
  if (r.sessions.some((s) => s.kind !== "replay" && !s.device.trim())) errors.push("Name the device for every live session.");
  if (r.sessions.some((s) => s.kind !== "live-camera" && !s.consent?.trim()))
    errors.push("Record the consent / permission basis for every prerecorded video.");
  return errors;
}

export function verdict(r: QaReport): "PASS" | "FAIL" | "INCOMPLETE" {
  if (r.criteria.some((c) => c.result === "fail")) return "FAIL";
  if (r.criteria.some((c) => c.result === "not-tested")) return "INCOMPLETE";
  if (r.sessions.length === 0) return "INCOMPLETE";
  return "PASS";
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const range = (r: [number, number] | null | undefined) => (r ? `${r[0]}° to ${r[1]}°` : "—");

export function toMarkdown(r: QaReport, provenanceLabel: string): string {
  const v = verdict(r);
  const errors = validateReport(r);
  const dims = Object.entries(r.product.dimensionsMm).filter(([, x]) => x);
  const checks = dimensionChecks(r.product.dimensionsMm, r.asset);
  const lines: string[] = [];
  lines.push(`# Visual QA report: ${r.product.name}`, "");
  lines.push(`**Verdict: ${v}**${errors.length ? " (report has validation errors, see end)" : ""}`, "");
  lines.push("| Field | Value |", "| --- | --- |");
  lines.push(`| Test kind | ${r.testKind === "live-renderer" ? "Live renderer (existing pipeline)" : "Automatic reconstruction"} |`);
  lines.push(`| Tested commit | \`${r.commit}\` |`);
  lines.push(`| Date | ${r.createdAt} |`);
  lines.push(`| Tester | ${fmt(r.tester)} |`);
  lines.push(`| Product source | ${fmt(r.product.source)} |`);
  lines.push(`| Asset | ${r.asset.fileName} (${r.asset.bytes} bytes, sha256 \`${r.asset.sha256.slice(0, 16)}…\`) |`);
  lines.push(`| Asset provenance | **${provenanceLabel}** |`);
  lines.push(`| Preparation method | ${fmt(r.asset.method)} |`);
  lines.push(`| Asset geometry | front ${r.asset.frontWidthMm} mm, height ${r.asset.heightMm} mm, depth ${r.asset.depthMm} mm, ${r.asset.triangles} triangles |`, "");

  lines.push("## Product measurements", "");
  lines.push(dims.length ? dims.map(([k, x]) => `- ${k}: ${x} mm`).join("\n") : "- None supplied", "");
  if (checks.length) {
    lines.push("| Dimension | Product (mm) | Asset (mm) | Δ (mm) |", "| --- | --- | --- | --- |");
    checks.forEach((c) => lines.push(`| ${c.name} | ${c.productMm} | ${c.assetMm} | ${c.deltaMm > 0 ? "+" : ""}${c.deltaMm} |`));
    lines.push("");
  }
  lines.push("Reference photographs: " + (r.product.photos.length ? r.product.photos.map((p) => `${p.view} (${p.fileName})`).join(", ") : "none"), "");

  lines.push("## Sessions (measured)", "");
  if (!r.sessions.length) lines.push("No live or replay session recorded.", "");
  else {
    lines.push(
      "| Kind | Device | Browser / GPU | Video | FPS | Tracked | Avg / p95 detect | Jitter | Yaw range | Pitch range | Tracker ready |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const s of r.sessions) {
      const m = s.summary;
      lines.push(
        `| ${s.kind} | ${fmt(s.device)} | ${fmt(s.browser).slice(0, 60)} / ${fmt(s.gpu)} (${fmt(s.delegate)}) | ${fmt(s.videoSize)} | ${s.kind === "replay" ? "n/a (stepped)" : fmt(s.avgFps)} | ${m ? `${m.trackedPct}%` : "—"} | ${m ? `${m.avgDetectMs} / ${m.p95DetectMs} ms` : "—"} | ${m?.jitterRmsPx != null ? `${m.jitterRmsPx} px (${m.jitterPctFaceWidth}% face)` : "—"} | ${range(m?.yawRange)} | ${range(m?.pitchRange)} | ${fmt(s.trackerReadyMs)} ms |`,
      );
    }
    lines.push("");
    r.sessions.filter((s) => s.kind !== "live-camera").forEach((s) => lines.push(`- ${s.source}: consent / permission: ${fmt(s.consent)}`));
    r.sessions.filter((s) => s.determinism).forEach((s) => lines.push(`- Determinism (two replays): ${s.determinism!.trackedMismatches} tracked mismatches, max anchor difference ${s.determinism!.maxAnchorDiffPx} px over ${s.determinism!.frames} frames`));
    lines.push("");
  }

  lines.push("## Visual comparisons", "");
  lines.push(r.captures.length ? r.captures.map((c) => `- ${c.kind}${c.view ? ` / ${c.view}` : ""}: \`${c.fileName}\``).join("\n") : "- None captured", "");

  lines.push("## Evaluation", "", "| Test | What we examine | Result | Observation |", "| --- | --- | --- | --- |");
  for (const c of r.criteria) {
    const def = CRITERIA.find((x) => x.id === c.id)!;
    lines.push(`| ${def.name} | ${def.examines} | **${c.result.toUpperCase()}** | ${fmt(c.note).replace(/\n/g, " ")} |`);
  }
  lines.push("", "## Known alignment or material failures", "", r.knownFailures.trim() || "None recorded.", "");
  if (errors.length) lines.push("## Validation errors", "", ...errors.map((e) => `- ${e}`), "");
  return lines.join("\n");
}
