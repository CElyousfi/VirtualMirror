import type { AssetState, ReadinessCheck, ReadinessReport } from "./schemas";

/**
 * Derive an asset state from its checks.
 *
 * - any failed blocker            -> failed (or unsupported if the blocker says so)
 * - any failed review check       -> needs_review
 * - no scale source               -> needs_review (a guessed size never goes live unreviewed)
 * - otherwise                     -> ready
 *
 * The state is the MINIMUM across checks, never an average.
 */
export function deriveState(
  checks: ReadinessCheck[],
  hasScaleSource: boolean,
  unsupportedCheckIds: readonly string[] = [],
): AssetState {
  const failedBlockers = checks.filter((c) => c.severity === "blocker" && !c.passed);
  if (failedBlockers.some((c) => unsupportedCheckIds.includes(c.id))) return "unsupported";
  if (failedBlockers.length > 0) return "failed";
  if (checks.some((c) => c.severity === "review" && !c.passed)) return "needs_review";
  if (!hasScaleSource) return "needs_review";
  return "ready";
}

export function buildReport(
  checks: ReadinessCheck[],
  hasScaleSource: boolean,
  unsupportedCheckIds: readonly string[] = [],
  now: Date = new Date(),
): ReadinessReport {
  return {
    state: deriveState(checks, hasScaleSource, unsupportedCheckIds),
    checks,
    hasScaleSource,
    evaluatedAt: now.toISOString(),
  };
}

/**
 * Publication rule (agreed with the founder): an asset reaches shoppers only if
 * it is Ready AND a merchant explicitly approved it. Generating an asset never
 * implies it is accurate enough to publish.
 */
export function canPublish(state: AssetState, merchantApprovedAt: Date | string | null | undefined): {
  allowed: boolean;
  reason?: string;
} {
  if (state !== "ready" && state !== "published")
    return { allowed: false, reason: `Asset is ${state.replace("_", " ")}, not ready.` };
  if (!merchantApprovedAt)
    return { allowed: false, reason: "A merchant must review and approve the asset first." };
  return { allowed: true };
}

/**
 * Review-severity checks the merchant has explicitly accepted are treated as
 * passed. Blockers can never be overridden.
 */
export function applyMerchantOverrides(
  checks: ReadinessCheck[],
  acceptedCheckIds: readonly string[],
): ReadinessCheck[] {
  return checks.map((c) =>
    c.severity === "review" && !c.passed && acceptedCheckIds.includes(c.id)
      ? { ...c, passed: true, message: `${c.message} (accepted by merchant)` }
      : c,
  );
}
