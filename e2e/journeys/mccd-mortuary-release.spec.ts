/**
 * Phase 8 — MCCD → mortuary release (docs/testing/PHASED_TEST_PLAN.md §Phase 8). The one area
 * of this phase's five that is genuinely feature-complete as-is (MLC/police-intimation, ANC→
 * delivery, and neonatal CCHD/ROP screening are mostly missing features, not missing tests —
 * written up separately for engineering, not covered here).
 *
 * Segment 1 is the happy path: admit a body (non-MLC) → issue an MCCD certificate → release it,
 * asserting the real billing side effect (`autoChargeService` on release). Getting this far
 * enough to even assert that found two further, previously-unknown, silent defects (see
 * KNOWN_BUGS.md): KNOWN-BUG-222 — `bills_bill_type_check` was missing the transformed
 * `bill_type` value for `autoChargeService`'s standalone branch on `mortuary` (and, by the same
 * mechanism, at least seven other modules) — meaning **no mortuary release had ever actually
 * billed, on any tenant, ever**, silently, since the call site wraps the whole thing in
 * `.catch(() => {})`; and KNOWN-BUG-223 — `mortuary_admissions` never had the
 * `billing_status`/`bill_id`/`billed_at` columns `autoChargeService`'s own idempotency guard
 * reads and writes, so nothing could ever have stopped a repeated release from double-charging
 * once the first bug was fixed. Both are fixed by new migrations (`20261106000030`,
 * `20261106000031`); Segment 1 is the regression test for both.
 *
 * Segment 2 is the negative fork the plan calls for: an MLC body cannot be released without
 * police clearance. This was, until this pass, enforced ONLY client-side
 * (`MortuaryPage.tsx`'s `handleRelease`: `if (mort?.is_mlc && !releaseForm.police_clearance)`) —
 * found live while researching this phase. A direct insert into `body_releases` (a batch script,
 * a future screen, a bug in the client) had nothing in the schema to stop it. Fixed with
 * `supabase/migrations/20261106000029_mlc_police_clearance_release_gate.sql`, a trigger that
 * rejects the insert/update server-side regardless of caller. Segment 2 proves BOTH layers: the
 * existing client-side toast (driven through the real UI), and the new server-side trigger
 * (driven directly via the service-role client, since the client-side check makes the UI path
 * structurally unable to reach the server in the first place — the whole point of the fix is
 * that a caller who bypasses the UI is what it protects against).
 */
import { test, expect } from "@playwright/test";
import { MortuaryPage } from "../pages/MortuaryPage";
import { HOSPITAL_A, HOSPITAL_B, staffUserId, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function mortuaryPatientName(tenant: TenantKey, suffix: string): string {
  return `Test Patient Mort${suffix}${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 8 — MCCD, mortuary release, and the MLC police-clearance gate", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const svc = serviceClient();

    for (const suffix of ["Std", "Mlc"]) {
      const patientName = mortuaryPatientName(tenant, suffix);
      const { data: patient } = await svc
        .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      if (!patient) continue;

      const { data: admissions } = await svc.from("mortuary_admissions").select("id").eq("patient_id", patient.id);
      const admissionIds = (admissions ?? []).map((a) => a.id);
      if (admissionIds.length) {
        await svc.from("body_releases").delete().in("mortuary_id", admissionIds);
        await svc.from("mccd_certificates").delete().in("mortuary_id", admissionIds);
        await svc.from("mortuary_admissions").delete().in("id", admissionIds);
      }
      const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id);
      if (bills?.length) {
        await svc.from("bill_line_items").delete().in("bill_id", bills.map((b) => b.id));
        await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
        await svc.from("bills").delete().in("id", bills.map((b) => b.id));
      }
      await svc.from("service_charges").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("patients").delete().eq("id", patient.id);
    }
  });

  test("Segment 1 — admit, issue MCCD, release: the real billing side effect posts", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = mortuaryPatientName(tenant, "Std");
    const svc = serviceClient();
    const mortuary = new MortuaryPage(page);

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id,
        full_name: patientName,
        uhid: `${hospital.uhidPrefix}MORTSTD${tenant.toUpperCase()}1`,
        phone: tenant === "a" ? "9000000041" : "9000000042",
        is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("admit to mortuary (non-MLC)", async () => {
      await mortuary.open();
      await mortuary.admitBody({
        patientQuery: patientName,
        timeOfDeath: "2026-09-14T08:00",
        doctorName: `doctor ${tenant.toUpperCase()}`,
        causeOfDeath: "Cardiac arrest — Phase 8 fixture",
      });
    });

    await test.step("issue the MCCD certificate", async () => {
      await mortuary.goToTab("📜 MCCD");
      await mortuary.selectPendingMccd(patientName);
      await mortuary.saveMccd({
        cause1a: "Cardiogenic shock",
        certifyingDoctorName: `doctor ${tenant.toUpperCase()}`,
      });
    });

    await test.step("release the body", async () => {
      await mortuary.goToTab("🔑 Release");
      await mortuary.openReleaseModal();
      await mortuary.fillReleaseForm({ bodyLabel: patientName, releasedTo: "Fixture Family", relation: "son" });
      await mortuary.confirmRelease();
      await expect(page.getByText("Body released — records updated")).toBeVisible({ timeout: 10_000 });
    });

    await test.step("assert the admission is released, the MCCD exists, and a bill line item posted", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: admission, error: admErr } = await svc
        .from("mortuary_admissions")
        .select("id, status")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(admErr).toBeNull();
      expect(admission).not.toBeNull();
      expect(admission!.status).toBe("released");

      const { data: mccd, error: mccdErr } = await svc
        .from("mccd_certificates")
        .select("id, mccd_number")
        .eq("mortuary_id", admission!.id)
        .maybeSingle();
      expect(mccdErr).toBeNull();
      expect(mccd).not.toBeNull();
      expect(mccd!.mccd_number).toBeTruthy();

      // autoChargeService is fire-and-forget from handleRelease (`.catch(() => {})`) — poll
      // rather than assume it has landed the instant confirmRelease() returns.
      await expect
        .poll(async () => {
          const { data } = await svc.from("bill_line_items").select("id").eq("hospital_id", hospital.id).eq("source_module", "mortuary");
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBeGreaterThan(0);
    });
  });

  test("Segment 2 — an MLC body cannot be released without police clearance, client-side or server-side", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = mortuaryPatientName(tenant, "Mlc");
    const svc = serviceClient();
    const mortuary = new MortuaryPage(page);

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id,
        full_name: patientName,
        uhid: `${hospital.uhidPrefix}MORTMLC${tenant.toUpperCase()}1`,
        phone: tenant === "a" ? "9000000043" : "9000000044",
        is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("admit to mortuary as an MLC case", async () => {
      await mortuary.open();
      await mortuary.admitBody({
        patientQuery: patientName,
        timeOfDeath: "2026-09-14T09:00",
        doctorName: `doctor ${tenant.toUpperCase()}`,
        causeOfDeath: "Road traffic accident — Phase 8 fixture",
        isMlc: true,
      });
    });

    let admissionId = "";
    await test.step("client-side: attempting release without toggling police clearance is blocked", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();
      const { data: admission } = await svc.from("mortuary_admissions").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient!.id).maybeSingle();
      expect(admission).not.toBeNull();
      admissionId = admission!.id;

      await mortuary.goToTab("🔑 Release");
      await mortuary.openReleaseModal();
      await mortuary.fillReleaseForm({ bodyLabel: patientName, releasedTo: "Fixture Family", relation: "daughter" });
      await mortuary.confirmRelease();
      await mortuary.expectClientSideClearanceError();

      const { data: releases } = await svc.from("body_releases").select("id").eq("mortuary_id", admissionId);
      expect(releases ?? []).toHaveLength(0);
    });

    await test.step("server-side: a direct insert bypassing the UI is rejected by the new trigger", async () => {
      const { error } = await svc.from("body_releases").insert({
        hospital_id: hospital.id,
        mortuary_id: admissionId,
        released_to: "Bypass Attempt",
        relation: "son",
        id_proof_type: "Aadhaar",
        released_by: staffUserId(tenant, "hospital_admin"),
        police_clearance: false,
      } as never);
      expect(error).not.toBeNull();
      expect(error!.message).toContain("Police clearance is required");

      const { data: releases } = await svc.from("body_releases").select("id").eq("mortuary_id", admissionId);
      expect(releases ?? []).toHaveLength(0);
    });

    await test.step("with clearance toggled on, the same release succeeds", async () => {
      // Continues in the same modal the client-side block left open, rather than
      // re-navigating and re-filling — see toggleClearanceOn's own comment for why.
      await mortuary.toggleClearanceOn();
      await mortuary.confirmRelease();

      await expect
        .poll(async () => {
          const { data } = await svc.from("mortuary_admissions").select("status").eq("id", admissionId).maybeSingle();
          return data?.status ?? null;
        }, { timeout: 5_000 })
        .toBe("released");

      const { data: releases, error } = await svc.from("body_releases").select("id, police_clearance").eq("mortuary_id", admissionId);
      expect(error).toBeNull();
      expect(releases).toHaveLength(1);
      expect(releases![0].police_clearance).toBe(true);
    });
  });
});
