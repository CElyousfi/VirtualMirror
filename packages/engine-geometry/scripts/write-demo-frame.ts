// Writes fixtures/demo-frame.glb: the generic parametric frame used to test the
// end-to-end chain before real product reconstruction exists.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoFrameGlb } from "../src/demo-frame";

const out = join(import.meta.dirname, "..", "..", "..", "fixtures", "demo-frame.glb");
const res = await buildDemoFrameGlb();
writeFileSync(out, res.glb);
console.log(
  JSON.stringify({ file: "fixtures/demo-frame.glb", bytes: res.glb.byteLength, triangles: res.triangleCount, frameWidthMm: +(res.frameWidthM * 1000).toFixed(1) }),
);
