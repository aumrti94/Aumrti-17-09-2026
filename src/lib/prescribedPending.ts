/**
 * prescribedPending — "what did a doctor order for this patient that hasn't been raised yet?"
 *
 * This is the lookup that makes the Lab / Radiology order modals open with the doctor's tests
 * already ticked, so the counter can go straight to payment.
 *
 * WHY IT EXISTS. Both modals grew their own copy of this, and both copies started from
 * `opd_encounters ... .eq("visit_date", today)` and then bailed with `if (!data?.length) return;`.
 * An admitted patient has no OPD encounter, so preselection never ran for them — the reported
 * bug. The two copies had also drifted (lab subtracted already-ordered tests by encounter_id,
 * radiology by patient+date), so fixing them separately would have preserved the divergence.
 *
 * A patient is looked up in one of two contexts, never both — mirroring the
 * `prescriptions_one_context` CHECK on the table:
 *   - today's OPD encounter(s), or
 *   - the current admission (via pickDefaultAdmission, the same rule AdmissionLinker uses).
 */

import { supabase } from "@/integrations/supabase/client";
import { pickDefaultAdmission, type ActiveAdmission } from "@/lib/pickDefaultAdmission";

export type PrescribedKind = "lab" | "radiology";

export interface PrescribedPending {
  /** Prescribed names not yet raised as an order. Empty when there is nothing to do. */
  names: string[];
  /** Today's OPD encounters, newest first. Empty for an admitted patient. */
  encounterIds: string[];
  /** The admission this patient is currently in, when they are not an OPD walk-in. */
  admissionId: string | null;
  /** Chip text for the modal, or null when the patient has neither context. */
  linkLabel: string | null;
}

const EMPTY: PrescribedPending = { names: [], encounterIds: [], admissionId: null, linkLabel: null };

const norm = (s: unknown): string => String(s ?? "").toLowerCase().trim();

/** Prescribed names for one kind, deduped, order preserved. */
function namesFromPrescriptions(rows: any[] | null, kind: PrescribedKind): string[] {
  const field = kind === "lab" ? "lab_orders" : "radiology_orders";
  const key = kind === "lab" ? "test_name" : "study_name";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rx of rows || []) {
    for (const item of (rx?.[field] as any[]) || []) {
      const name = item?.[key];
      if (!name || seen.has(norm(name))) continue;
      seen.add(norm(name));
      out.push(name);
    }
  }
  return out;
}

/** Names already raised as real orders for these OPD encounters. */
async function orderedForEncounters(encounterIds: string[], kind: PrescribedKind): Promise<Set<string>> {
  if (encounterIds.length === 0) return new Set();
  if (kind === "lab") {
    const { data } = await (supabase as any)
      .from("lab_orders")
      .select("lab_order_items(lab_test_master:test_id(test_name))")
      .in("encounter_id", encounterIds);
    return new Set(((data as any[]) || []).flatMap((o: any) =>
      (o.lab_order_items || []).map((i: any) => norm(i.lab_test_master?.test_name))).filter(Boolean));
  }
  const { data } = await (supabase as any)
    .from("radiology_orders").select("study_name").in("encounter_id", encounterIds);
  return new Set(((data as any[]) || []).map((r: any) => norm(r.study_name)).filter(Boolean));
}

/**
 * Names already raised for this admission.
 *
 * Scoped by admission_id, not encounter_id — the lab modal used to subtract by encounter_id,
 * which can never match a ward order, so an admitted patient's tests would have been offered
 * again after they were already ordered.
 */
async function orderedForAdmission(admissionId: string, kind: PrescribedKind): Promise<Set<string>> {
  if (kind === "lab") {
    const { data } = await (supabase as any)
      .from("lab_orders")
      .select("lab_order_items(lab_test_master:test_id(test_name))")
      .eq("admission_id", admissionId);
    return new Set(((data as any[]) || []).flatMap((o: any) =>
      (o.lab_order_items || []).map((i: any) => norm(i.lab_test_master?.test_name))).filter(Boolean));
  }
  const { data } = await (supabase as any)
    .from("radiology_orders").select("study_name").eq("admission_id", admissionId);
  return new Set(((data as any[]) || []).map((r: any) => norm(r.study_name)).filter(Boolean));
}

/** PURE. Prescribed minus already-ordered, compared case-insensitively. */
export function subtractOrdered(prescribed: string[], ordered: Set<string>): string[] {
  return prescribed.filter((n) => !ordered.has(norm(n)));
}

/**
 * Resolve the patient's context and the still-pending prescribed names.
 *
 * Never throws — a failure here must not stop a cashier raising an order by hand, so it
 * degrades to "nothing pending".
 */
export async function getPrescribedPending(
  hospitalId: string,
  patientId: string,
  kind: PrescribedKind,
  opts?: { preferredAdmissionId?: string | null }
): Promise<PrescribedPending> {
  if (!hospitalId || !patientId) return EMPTY;

  try {
    // ── OPD first: today's encounters ────────────────────────────────────────
    const today = new Date().toISOString().split("T")[0];
    const { data: encounters } = await (supabase as any)
      .from("opd_encounters")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", patientId)
      .eq("visit_date", today)
      .order("created_at", { ascending: false });

    const encounterIds: string[] = ((encounters as any[]) || []).map((e: any) => e.id);

    if (encounterIds.length > 0) {
      const [{ data: rxList }, ordered] = await Promise.all([
        (supabase as any).from("prescriptions")
          .select("lab_orders, radiology_orders").in("encounter_id", encounterIds),
        orderedForEncounters(encounterIds, kind),
      ]);
      return {
        names: subtractOrdered(namesFromPrescriptions(rxList as any[], kind), ordered),
        encounterIds,
        admissionId: null,
        linkLabel: encounterIds.length > 1
          ? `🔗 Linked to today's OPD encounters (${encounterIds.length} doctors)`
          : "🔗 Linked to today's OPD encounter",
      };
    }

    // ── IPD fallback: the current admission ──────────────────────────────────
    const { data: admissions } = await (supabase as any)
      .from("admissions")
      .select("id, admission_number, admission_type")
      .eq("hospital_id", hospitalId)
      .eq("patient_id", patientId)
      .eq("status", "active")
      .order("admitted_at", { ascending: false });

    const pick = pickDefaultAdmission(((admissions as ActiveAdmission[]) || []), opts?.preferredAdmissionId);
    if (!pick) return EMPTY;

    const [{ data: rxList }, ordered] = await Promise.all([
      (supabase as any).from("prescriptions")
        .select("lab_orders, radiology_orders").eq("admission_id", pick.id),
      orderedForAdmission(pick.id, kind),
    ]);

    return {
      names: subtractOrdered(namesFromPrescriptions(rxList as any[], kind), ordered),
      encounterIds: [],
      admissionId: pick.id,
      linkLabel: `🏥 Linked to current admission${pick.admission_number ? ` — ${pick.admission_number}` : ""}`,
    };
  } catch (err) {
    console.error("getPrescribedPending failed:", err);
    return EMPTY;
  }
}
