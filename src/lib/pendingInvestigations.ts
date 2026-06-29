import { supabase } from "@/integrations/supabase/client";

export interface PendingInvestigationRow {
  patientId: string;
  patientName: string;
  uhid: string;
  phone: string | null;
  encounterId: string;
  encounterDate: string;    // YYYY-MM-DD
  encounterTime: string;    // HH:MM en-IN
  doctorName: string;
  pendingLabTests: string[];
  pendingRadiologyStudies: string[];
  estimatedRevenue: number; // sum of lab_test_master.fee + radiology_study_master.fee for pending names
}

/**
 * Returns one row per OPD encounter that has prescribed investigations
 * (in prescriptions.lab_orders / .radiology_orders) which have NOT yet been
 * converted to real lab_orders / radiology_orders rows.
 *
 * Comparison is case-insensitive name matching.
 */
export async function getPendingInvestigations(
  hospitalId: string,
  dateRange: { start: string; end: string }
): Promise<PendingInvestigationRow[]> {
  // 1. Fetch encounters in the date range with patient info
  const { data: encounters } = await (supabase as any)
    .from("opd_encounters")
    .select("id, visit_date, created_at, patient_id, doctor_id, patients(id, full_name, uhid, phone)")
    .eq("hospital_id", hospitalId)
    .gte("visit_date", dateRange.start)
    .lte("visit_date", dateRange.end);

  if (!encounters?.length) return [];

  const encounterIds: string[] = encounters.map((e: any) => e.id);

  // 2. Doctor names in one round-trip
  const doctorIds: string[] = [...new Set<string>(
    encounters.map((e: any) => e.doctor_id).filter(Boolean)
  )];
  const doctorMap: Record<string, string> = {};
  if (doctorIds.length > 0) {
    const { data: doctors } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", doctorIds);
    for (const d of doctors || []) doctorMap[d.id] = d.full_name;
  }

  // 3. Prescriptions for those encounters
  const { data: prescriptions } = await (supabase as any)
    .from("prescriptions")
    .select("id, encounter_id, patient_id, lab_orders, radiology_orders")
    .in("encounter_id", encounterIds)
    .eq("hospital_id", hospitalId);

  // Only keep prescriptions that have at least one ordered test/study
  const activePrescriptions = (prescriptions || []).filter(
    (rx: any) =>
      ((rx.lab_orders as any[]) || []).length > 0 ||
      ((rx.radiology_orders as any[]) || []).length > 0
  );
  if (!activePrescriptions.length) return [];

  const activeEncIds: string[] = [...new Set<string>(
    activePrescriptions.map((rx: any) => rx.encounter_id as string)
  )];

  // 4. Real lab orders for these encounters (with test names via join)
  const { data: realLabOrders } = await (supabase as any)
    .from("lab_orders")
    .select("encounter_id, lab_order_items(lab_test_master:test_id(test_name))")
    .in("encounter_id", activeEncIds)
    .neq("status", "cancelled");

  // encounter_id → Set<lowercase test_name>
  const orderedLabByEnc: Record<string, Set<string>> = {};
  for (const lo of realLabOrders || []) {
    if (!orderedLabByEnc[lo.encounter_id]) orderedLabByEnc[lo.encounter_id] = new Set();
    for (const item of lo.lab_order_items || []) {
      const name: string = item.lab_test_master?.test_name;
      if (name) orderedLabByEnc[lo.encounter_id].add(name.toLowerCase().trim());
    }
  }

  // 5. Real radiology orders for these encounters
  const { data: realRadOrders } = await (supabase as any)
    .from("radiology_orders")
    .select("encounter_id, study_name")
    .in("encounter_id", activeEncIds)
    .neq("status", "cancelled");

  // encounter_id → Set<lowercase study_name>
  const orderedRadByEnc: Record<string, Set<string>> = {};
  for (const ro of realRadOrders || []) {
    if (!orderedRadByEnc[ro.encounter_id]) orderedRadByEnc[ro.encounter_id] = new Set();
    if (ro.study_name) orderedRadByEnc[ro.encounter_id].add((ro.study_name as string).toLowerCase().trim());
  }

  // 6. Fee maps for revenue estimation (best-effort — 0 if not configured)
  const [{ data: labMaster }, { data: radMaster }] = await Promise.all([
    (supabase as any)
      .from("lab_test_master")
      .select("test_name, fee")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true),
    (supabase as any)
      .from("radiology_study_master")
      .select("study_name, fee")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true),
  ]);

  const labFeeMap: Record<string, number> = {};
  for (const t of labMaster || []) labFeeMap[t.test_name.toLowerCase().trim()] = Number(t.fee) || 0;

  const radFeeMap: Record<string, number> = {};
  for (const s of radMaster || []) radFeeMap[s.study_name.toLowerCase().trim()] = Number(s.fee) || 0;

  // 7. Encounter map for O(1) lookup
  const encMap: Record<string, any> = {};
  for (const enc of encounters) encMap[enc.id] = enc;

  // 8. Build result rows — one per prescription with at least one pending item
  const results: PendingInvestigationRow[] = [];

  for (const rx of activePrescriptions) {
    const enc = encMap[rx.encounter_id as string];
    if (!enc) continue;

    const prescribedLab: string[] = ((rx.lab_orders as any[]) || [])
      .map((l: any) => l.test_name as string)
      .filter(Boolean);
    const prescribedRad: string[] = ((rx.radiology_orders as any[]) || [])
      .map((r: any) => r.study_name as string)
      .filter(Boolean);

    const orderedLab = orderedLabByEnc[rx.encounter_id as string] ?? new Set<string>();
    const orderedRad = orderedRadByEnc[rx.encounter_id as string] ?? new Set<string>();

    const pendingLabTests = prescribedLab.filter(n => !orderedLab.has(n.toLowerCase().trim()));
    const pendingRadiologyStudies = prescribedRad.filter(n => !orderedRad.has(n.toLowerCase().trim()));

    if (!pendingLabTests.length && !pendingRadiologyStudies.length) continue;

    const estimatedRevenue =
      pendingLabTests.reduce((s, n) => s + (labFeeMap[n.toLowerCase().trim()] || 0), 0) +
      pendingRadiologyStudies.reduce((s, n) => s + (radFeeMap[n.toLowerCase().trim()] || 0), 0);

    const patient = enc.patients as any;
    const createdAt: string = enc.created_at || enc.visit_date;
    const encounterTime = createdAt
      ? new Date(createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
      : "";

    results.push({
      patientId: enc.patient_id as string,
      patientName: patient?.full_name || "Unknown",
      uhid: patient?.uhid || "",
      phone: patient?.phone || null,
      encounterId: rx.encounter_id as string,
      encounterDate: enc.visit_date as string,
      encounterTime,
      doctorName: doctorMap[enc.doctor_id as string] || "—",
      pendingLabTests,
      pendingRadiologyStudies,
      estimatedRevenue,
    });
  }

  // Sort newest encounter date first, then by time
  results.sort((a, b) => {
    const dc = b.encounterDate.localeCompare(a.encounterDate);
    return dc !== 0 ? dc : b.encounterTime.localeCompare(a.encounterTime);
  });

  return results;
}
