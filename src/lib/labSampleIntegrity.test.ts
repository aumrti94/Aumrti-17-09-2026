// Lab AI features, Phase 13 — unit tests for the deterministic mix-up indicators.
// Only these gate release; the AI layer (runAiMixupAssessment) is advisory-only and
// not unit-tested here since it's a live AI call (exercised via smoke test instead).
import { describe, it, expect } from "vitest";
import { checkDeterministicMixupIndicators } from "./labSampleIntegrity";

describe("checkDeterministicMixupIndicators", () => {
  it("returns no indicators for a clean, consistent panel", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: "O+",
      items: [
        { test_name: "Haemoglobin", result_value: "14", result_numeric: 14 },
        { test_name: "Haematocrit", result_value: "42", result_numeric: 42 },
        { test_name: "Blood Group", result_value: "O+", result_numeric: null },
      ],
    });
    expect(result).toEqual([]);
  });

  it("flags a female-specific test (beta-hCG) positive on a male patient", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: null,
      items: [{ test_name: "Beta hCG", result_value: "positive", result_numeric: null }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("high");
    expect(result[0].rule).toBe("sex_specific_test");
  });

  it("does not flag a negative beta-hCG on a male patient", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: null,
      items: [{ test_name: "Beta hCG", result_value: "Negative", result_numeric: null }],
    });
    expect(result).toEqual([]);
  });

  it("flags a male-specific test (PSA) positive on a female patient", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "female",
      patientRecordedBloodGroup: null,
      items: [{ test_name: "PSA", result_value: "8.2", result_numeric: 8.2 }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("sex_specific_test");
  });

  it("flags a blood group result that conflicts with the patient's recorded group", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: "A+",
      items: [{ test_name: "Blood Group", result_value: "O-", result_numeric: null }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("blood_group_conflict");
    expect(result[0].severity).toBe("high");
  });

  it("does not flag a matching blood group (case/space insensitive)", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: "AB -",
      items: [{ test_name: "Blood Group", result_value: "ab-", result_numeric: null }],
    });
    expect(result).toEqual([]);
  });

  it("flags an Hb/Hct ratio that violates the rule-of-three by >25%", () => {
    // Hb 14 -> expected Hct ~42; actual 20 is far below
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: null,
      items: [
        { test_name: "Haemoglobin", result_value: "14", result_numeric: 14 },
        { test_name: "Hematocrit", result_value: "20", result_numeric: 20 },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("hb_hct_ratio");
    expect(result[0].severity).toBe("moderate");
  });

  it("does not flag an Hb/Hct ratio within 25% of expected", () => {
    // Hb 14 -> expected 42; actual 38 is within 25%
    const result = checkDeterministicMixupIndicators({
      patientGender: "male",
      patientRecordedBloodGroup: null,
      items: [
        { test_name: "Haemoglobin", result_value: "14", result_numeric: 14 },
        { test_name: "Hematocrit", result_value: "38", result_numeric: 38 },
      ],
    });
    expect(result).toEqual([]);
  });

  it("can return multiple indicators at once", () => {
    const result = checkDeterministicMixupIndicators({
      patientGender: "female",
      patientRecordedBloodGroup: "B+",
      items: [
        { test_name: "PSA", result_value: "5", result_numeric: 5 },
        { test_name: "Blood Group", result_value: "O+", result_numeric: null },
      ],
    });
    expect(result).toHaveLength(2);
  });
});
