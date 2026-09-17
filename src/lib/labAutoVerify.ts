// Lab auto-verification (auto-release) rule engine.
// Lab AI features, Phase 12 — a deterministic, explainable rule set (CLSI AUTO10-A
// style), not an LLM call: a decision to release a patient result unattended must be
// reproducible and auditable, which an LLM call is not. Every rule here maps to a
// concrete, named reason so a failed/passed decision can be shown to the user and
// logged as NABH evidence.

export interface AutoVerifyItemInput {
  test_name: string;
  autoverify_eligible: boolean;
  result_value: string | null;
  result_flag: string | null;
  delta_flag: boolean | null;
}

export interface AutoVerifyContext {
  /** True if this test's category requires pathologist dual sign-off — dual-validation
   *  categories never auto-verify, full stop. */
  requiresDualValidation: boolean;
  /** Test names whose latest QC run is in a Westgard reject state (Phase 11). */
  qcRejectTestNames: Set<string>;
}

export interface AutoVerifyDecision {
  eligible: boolean;
  /** Human-readable reason, used both for the UI badge and the audit trail. */
  reason: string;
}

/**
 * Evaluate whether a single result can be auto-verified (auto-released without a
 * human clicking Validate & Release). Conservative by design: only fully-normal
 * (unflagged), non-delta, QC-clean results on an opt-in test ever qualify. Abnormal
 * (H/L), critical (CH/CL), and delta-flagged results always require a human.
 */
export function evaluateAutoVerify(item: AutoVerifyItemInput, ctx: AutoVerifyContext): AutoVerifyDecision {
  if (!item.autoverify_eligible) {
    return { eligible: false, reason: "Test is not enabled for auto-verification" };
  }
  if (!item.result_value) {
    return { eligible: false, reason: "No result value" };
  }
  if (ctx.requiresDualValidation) {
    return { eligible: false, reason: "Category requires pathologist dual sign-off" };
  }
  if (item.result_flag === "CH" || item.result_flag === "CL") {
    return { eligible: false, reason: "Critical value — requires human review" };
  }
  if (item.result_flag && item.result_flag !== "N") {
    return { eligible: false, reason: `Abnormal flag (${item.result_flag}) — requires human review` };
  }
  if (item.delta_flag) {
    return { eligible: false, reason: "Delta check flagged — requires human review" };
  }
  if (ctx.qcRejectTestNames.has(item.test_name)) {
    return { eligible: false, reason: "QC is in reject state for this test" };
  }
  return { eligible: true, reason: "Within range, no delta, QC pass — auto-verified" };
}

/** Convenience: does every item in the set pass? Used to decide whether the whole
 *  order can auto-complete (all-or-nothing at order level; a mixed panel still
 *  requires a human to close the remaining items). */
export function allAutoVerified(decisions: AutoVerifyDecision[]): boolean {
  return decisions.length > 0 && decisions.every(d => d.eligible);
}
