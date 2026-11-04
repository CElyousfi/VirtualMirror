import { z } from "zod";

/**
 * FrameModel: a measurable description of one real eyewear frame.
 *
 * Authored by a person from measurements and photos (Stage 1, provenance
 * "manual"), fitted automatically from product images later (Stage 4,
 * provenance "automatic"), or used as a labelled generic fixture. One builder
 * (packages/engine-geometry/src/frame-model) turns it into a GLB in ASSET space.
 *
 * Units: MILLIMETRES (how frames are measured), converted to metres only in
 * the builder through @vm/contracts units.
 *
 * Lens-local coordinates for the contour: the wearer's LEFT lens (on the
 * viewer's right in a front photo), origin at the centre of the lens box,
 * +x away from the bridge (towards the temple), +y up. The right lens is the
 * mirror image unless `rightContour` is given.
 */

const Pt = z.tuple([z.number(), z.number()]);
const Linear = z.tuple([z.number().min(0), z.number().min(0), z.number().min(0)]);

export const FrameMaterialSchema = z.object({
  kind: z.enum(["acetate", "metal"]),
  /** Linear RGB base colour. */
  color: Linear,
  roughness: z.number().min(0).max(1),
  /** Polished acetate has a lacquer-like clear coat. 0..1. */
  clearcoat: z.number().min(0).max(1).default(0),
  clearcoatRoughness: z.number().min(0).max(1).default(0.05),
});
export type FrameMaterial = z.infer<typeof FrameMaterialSchema>;

export const FrameModelSchema = z.object({
  v: z.literal(1),
  name: z.string().min(1),
  provenance: z.enum(["generic", "manual", "automatic"]),
  /** Where the numbers came from: "calipers + tracing, 2026-11-05", "fitted from 3 photos", … */
  source: z.string(),
  lens: z.object({
    /** Closed outline of the lens opening, mm, lens-local (see above), at least 8 points. */
    contour: z.array(Pt).min(8),
    rightContour: z.array(Pt).min(8).optional(),
    /** Lens base curve in dioptres (front curvature). 0 = flat. */
    baseCurve: z.number().min(0).max(10).default(4),
    centerThickness: z.number().positive().default(2),
    /** Linear RGB tint and opacity (0 clear .. 1 opaque). */
    tint: Linear.default([0.92, 0.94, 0.96]),
    opacity: z.number().min(0).max(1).default(0.08),
  }),
  /** Distance between lenses (DBL), mm. */
  bridgeWidth: z.number().positive(),
  bridge: z.object({
    /** Height of the bridge centre above the lens-box centre, mm. */
    height: z.number(),
    /** Vertical thickness of the bridge, mm. */
    thickness: z.number().positive(),
    /** How far the bridge arches up at its centre, mm. */
    arch: z.number().min(0).default(2),
  }),
  rim: z.object({
    /** Visible rim width on the front, mm, by region. */
    faceWidth: z.object({ top: z.number().positive(), bottom: z.number().positive(), temporal: z.number().positive(), nasal: z.number().positive() }),
    /** Front-to-back thickness of the frame front, mm. */
    depth: z.number().positive(),
    /** Rounding radius of the front and back edges, mm. */
    frontEdgeRadius: z.number().min(0),
    backEdgeRadius: z.number().min(0),
  }),
  /** Face-form (wrap) angle of each lens plane, degrees: temporal side swept back. */
  wrapDeg: z.number().min(0).max(25).default(5),
  endpiece: z.object({
    /** How far the end piece extends beyond the rim, mm. */
    length: z.number().positive(),
    height: z.number().positive(),
    /** Height of the hinge above the lens-box centre, mm. */
    hingeHeight: z.number(),
    /** How far behind the front the hinge sits, mm. */
    hingeBack: z.number().positive(),
  }),
  hinge: z.object({ barrelRadius: z.number().positive(), knuckles: z.number().int().min(1).max(5).default(3) }),
  temples: z.object({
    /** Total temple length (arm print third number), mm. */
    length: z.number().positive(),
    /** Distance from hinge to the start of the ear bend, mm. */
    bendAt: z.number().positive(),
    /** Downward angle of the part behind the ear, degrees. */
    dropDeg: z.number().min(0).max(80),
    splayDeg: z.number().min(-5).max(20).default(6),
    width: z.object({ hinge: z.number().positive(), tip: z.number().positive() }),
    height: z.object({ hinge: z.number().positive(), tip: z.number().positive() }),
  }),
  materials: z.object({
    front: FrameMaterialSchema,
    temples: FrameMaterialSchema.optional(),
    hinge: FrameMaterialSchema.default({ kind: "metal", color: [0.62, 0.62, 0.62], roughness: 0.25, clearcoat: 0, clearcoatRoughness: 0.05 }),
  }),
});
export type FrameModel = z.infer<typeof FrameModelSchema>;
export type FrameModelInput = z.input<typeof FrameModelSchema>;

/** Width and height of the box around a contour (the "A" and "B" measurements). */
export function contourBox(contour: readonly (readonly [number, number])[]): { a: number; b: number; minX: number; maxX: number; minY: number; maxY: number } {
  const xs = contour.map((p) => p[0]);
  const ys = contour.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { a: maxX - minX, b: maxY - minY, minX, maxX, minY, maxY };
}
