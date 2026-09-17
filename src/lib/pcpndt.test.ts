import { describe, it, expect } from "vitest";
import { buildFormFRow, requiresPcpndtFormF, hasObstetricName } from "./pcpndt";

/**
 * Phase 5 settings sweep — KNOWN-BUG-142.
 *
 * Settings → Radiology's PCPNDT card captures a hospital's registered ultrasound machine and
 * doctor registration numbers — real Form F register data — but `pcpndt_form_f` had no columns
 * to receive them, so every completed Form F was missing this information regardless of what a
 * hospital entered in settings. buildFormFRow() is the one place both call sites
 * (NewRadiologyOrderModal.tsx, investigationSync.ts) build the row, so this is the one test that
 * has to prove the fix for both.
 */
describe("buildFormFRow — registration fields (KNOWN-BUG-142)", () => {
  it("includes machine and doctor registration when the hospital has configured PCPNDT settings", () => {
    const row = buildFormFRow({
      hospitalId: "h1",
      orderId: "o1",
      patientName: "Test Patient",
      signedBy: "u1",
      machineName: "GE Voluson E10",
      machineRegistrationNumber: "PCPNDT/TS/2024/001",
      doctorPcpndtRegistration: "PCPNDT/DOC/2024/042",
    });
    expect(row.machine_name).toBe("GE Voluson E10");
    expect(row.machine_registration_number).toBe("PCPNDT/TS/2024/001");
    expect(row.doctor_pcpndt_registration).toBe("PCPNDT/DOC/2024/042");
  });

  it("writes null rather than throwing when the hospital hasn't configured PCPNDT settings yet", () => {
    const row = buildFormFRow({
      hospitalId: "h1",
      orderId: "o1",
      patientName: "Test Patient",
      signedBy: "u1",
    });
    expect(row.machine_name).toBeNull();
    expect(row.machine_registration_number).toBeNull();
    expect(row.doctor_pcpndt_registration).toBeNull();
  });
});

describe("requiresPcpndtFormF / hasObstetricName — pinning the existing determination unchanged", () => {
  it("still flags a study whose name reads as obstetric on an ultrasound modality", () => {
    expect(requiresPcpndtFormF({ studyName: "USG Pregnancy Profile", modalityType: "usg" })).toBe(true);
    expect(hasObstetricName("Anomaly Scan")).toBe(true);
    expect(hasObstetricName("TIFFA")).toBe(true);
  });

  it("still does not flag a non-ultrasound modality on an obstetric-sounding name", () => {
    expect(requiresPcpndtFormF({ studyName: "Obstetric History X-ray", modalityType: "xray" })).toBe(false);
  });

  it("an explicit requires_form_f flag still wins regardless of name", () => {
    expect(requiresPcpndtFormF({ studyName: "Routine Abdomen Scan", modalityType: "usg", requiresFormF: true })).toBe(true);
  });
});
