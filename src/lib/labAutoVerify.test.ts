// Lab AI features, Phase 12 — unit tests for the auto-verification rule engine.
import { describe, it, expect } from "vitest";
import { evaluateAutoVerify, allAutoVerified, type AutoVerifyContext } from "./labAutoVerify";

const ctx = (overrides: Partial<AutoVerifyContext> = {}): AutoVerifyContext => ({
  requiresDualValidation: false,
  qcRejectTestNames: new Set<string>(),
  ...overrides,
});

const item = (overrides: Partial<Parameters<typeof evaluateAutoVerify>[0]> = {}) => ({
  test_name: "Glucose",
  autoverify_eligible: true,
  result_value: "95",
  result_flag: "N",
  delta_flag: null,
  ...overrides,
});

describe("evaluateAutoVerify", () => {
  it("auto-verifies a normal, non-delta, QC-clean, opt-in test", () => {
    const d = evaluateAutoVerify(item(), ctx());
    expect(d.eligible).toBe(true);
  });

  it("rejects when the test is not opted in", () => {
    const d = evaluateAutoVerify(item({ autoverify_eligible: false }), ctx());
    expect(d.eligible).toBe(false);
    expect(d.reason).toMatch(/not enabled/i);
  });

  it("rejects when there is no result value", () => {
    const d = evaluateAutoVerify(item({ result_value: null }), ctx());
    expect(d.eligible).toBe(false);
  });

  it("rejects when the category requires dual validation, regardless of flags", () => {
    const d = evaluateAutoVerify(item(), ctx({ requiresDualValidation: true }));
    expect(d.eligible).toBe(false);
    expect(d.reason).toMatch(/dual sign-off/i);
  });

  it("rejects critical flags CH and CL", () => {
    expect(evaluateAutoVerify(item({ result_flag: "CH" }), ctx()).eligible).toBe(false);
    expect(evaluateAutoVerify(item({ result_flag: "CL" }), ctx()).eligible).toBe(false);
  });

  it("rejects abnormal (non-critical) flags H and L", () => {
    expect(evaluateAutoVerify(item({ result_flag: "H" }), ctx()).eligible).toBe(false);
    expect(evaluateAutoVerify(item({ result_flag: "L" }), ctx()).eligible).toBe(false);
  });

  it("rejects a delta-flagged result", () => {
    const d = evaluateAutoVerify(item({ delta_flag: "delta" }), ctx());
    expect(d.eligible).toBe(false);
    expect(d.reason).toMatch(/delta/i);
  });

  it("rejects when QC is in reject state for that test name", () => {
    const d = evaluateAutoVerify(item(), ctx({ qcRejectTestNames: new Set(["Glucose"]) }));
    expect(d.eligible).toBe(false);
    expect(d.reason).toMatch(/QC/);
  });

  it("QC reject only blocks the matching test name, not others", () => {
    const d = evaluateAutoVerify(item({ test_name: "Sodium" }), ctx({ qcRejectTestNames: new Set(["Glucose"]) }));
    expect(d.eligible).toBe(true);
  });
});

describe("allAutoVerified", () => {
  it("is false for an empty list", () => {
    expect(allAutoVerified([])).toBe(false);
  });

  it("is true only when every decision is eligible", () => {
    expect(allAutoVerified([{ eligible: true, reason: "" }, { eligible: true, reason: "" }])).toBe(true);
    expect(allAutoVerified([{ eligible: true, reason: "" }, { eligible: false, reason: "" }])).toBe(false);
  });
});
