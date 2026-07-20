import { supabase } from "@/integrations/supabase/client";
import { calcGST } from "@/lib/currency";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { buildOTChargeLineItems, recordOTServiceCharges, recordServiceCharge } from "@/lib/serviceBilling";
import { getRoomChargeGSTRate, DEFAULT_PHARMACY_GST_PERCENT } from "@/lib/gstRules";
import { checkBillWritable } from "@/lib/lockedDay";

// service_charges.service_module for sweep-added item_types that don't already
// match a canonical MODULE_ string (lab/radiology/pharmacy already do).
const SWEEP_SERVICE_MODULE_MAP: Record<string, string> = {
  nursing_procedure: "nursing",
  room_charge: "ipd_room",
  consultation: "ipd_consultation",
};

export interface AutoPullResult {
  ok: boolean;
  insertedCount: number;
  usedFallbackRate: boolean;
  error?: string;
}

/**
 * Static per-category bed-rate fallbacks used ONLY for the live IPD ledger ESTIMATE
 * shown before a bill exists. Kept here (next to the authoritative bill logic) so the
 * UI no longer hardcodes rates. Once a real bill exists the ledger reads bill_line_items.
 */
export const IPD_FALLBACK_BED_RATES: Record<string, number> = {
  icu: 5000, sicu: 5000, picu: 4500, nicu: 4500,
  hdu: 3000, isolation: 2500,
  private: 2000, semi_private: 1200, general: 600,
};

/**
 * Excludes bill_types that already have dedicated, correctly-deduped handling
 * earlier in autoPullAdmissionCharges (lab: lab_order_items pull, keyed
 * lab:{id}; radiology: radiology_orders pull, keyed radiology:{id};
 * pharmacy: pharmacy_dispensing_items pull, keyed
 * pharmacy:dispense-item:{id}) from the generic sibling-bill-copy sweep.
 * Those sibling bills' own line items were never given a matching
 * source_dedupe_key, so copying them too would double-charge the discharge
 * bill for the same lab test, scan or drug. Extracted as a pure function so the
 * exact double-charge regression can be unit tested directly.
 *
 * 'radiology' was missing from this list, and the omission was live: the
 * sibling copy fell back to `bill-line:{item.id}` (the modal sets no
 * source_dedupe_key) while the dedicated pull wrote `radiology:{order.id}`.
 * Two different keys for one scan meant addUniqueItem inserted both, so every
 * IPD radiology order placed through NewRadiologyOrderModal was billed TWICE
 * at discharge. The comment at the call site claimed radiology "has no
 * dedicated pull above" — it does, and has since the pull was written.
 */
export function filterSiblingBillsForSweep<T extends { bill_type: string | null }>(bills: T[]): T[] {
  return bills.filter(
    (rb) => rb.bill_type !== "lab" && rb.bill_type !== "pharmacy" && rb.bill_type !== "radiology"
  );
}

/**
 * The dedupe identity of a bill line, as the discharge sweep computes it.
 *
 * This is a CONTRACT, not an implementation detail. lib/ancillaryCharges.ts posts
 * lab/radiology/pharmacy charges at order time under keys like `lab:{lab_order_items.id}`;
 * this function is what the sweep uses to recognise those already-posted lines and skip them.
 * If the two disagree by a single byte, every pre-paid order is billed twice at discharge —
 * the exact bug this whole area has a history of. Exported so that contract can be unit-tested
 * directly against the keys ancillaryCharges writes.
 */
export function buildDedupeKey(item: {
  description?: string | null;
  item_type?: string | null;
  source_module?: string | null;
  source_dedupe_key?: string | null;
  source_record_id?: string | null;
}): string {
  if (item.source_dedupe_key) {
    return `${item.source_module || "manual"}::${item.source_dedupe_key}::${item.item_type || "other"}`;
  }
  // Backward-compat for rows that never got a dedupe key.
  return `${item.source_module || "manual"}::${item.source_record_id || (item.description || "").trim().toLowerCase()}::${item.item_type || "other"}`;
}

/**
 * Resolve the room rate/day for the ledger estimate: prefer the ward's configured
 * Rate Per Day (Settings → Wards & Beds); otherwise fall back to the category default.
 * Mirrors the precedence the UI ledger used previously (no amount change).
 */
export function resolveRoomRateFallback(
  wardRatePerDay: number | null | undefined,
  bedCategory: string | null | undefined
): number {
  const wardRate = Number(wardRatePerDay) || 0;
  if (wardRate > 0) return wardRate;
  return IPD_FALLBACK_BED_RATES[bedCategory || "general"] ?? 600;
}

/**
 * Room charges apply only to an admission that actually occupies a bed.
 *
 * Day care holds none — 20261008000137 made bed_id/ward_id nullable for it. Without this
 * guard the room block still runs (the admission row is truthy, just with null joins),
 * falls through every rate lookup to its ₹500/"general"/1-day fallback, and invents a
 * "Room: Ward - Bed  (1 days)" charge for a bed the patient never lay in.
 */
export function shouldChargeRoom(
  admissionType: string | null | undefined,
  bedId: string | null | undefined
): boolean {
  if ((admissionType || "").toLowerCase() === "daycare") return false;
  return !!bedId;
}

/**
 * Auto-pull all admission-linked charges into a draft IPD bill.
 * Idempotent: uses dedupe keys based on source_module + source_dedupe_key so
 * repeated calls do not create duplicates. Room charges are recomputed each call
 * to reflect current length-of-stay.
 *
 * Note: `source_record_id` is a UUID column, so it must always receive a real
 * UUID (or null). Composite logical keys live in `source_dedupe_key` (text).
 */

// Prevents concurrent calls for the same bill from racing on the delete-then-reinsert
// pattern used for consultation and room charges, which causes charges to disappear.
const _inFlightPulls = new Set<string>();

export async function autoPullAdmissionCharges(
  billId: string,
  admissionId: string,
  hospitalId: string
): Promise<AutoPullResult> {
  const _guardKey = `${billId}:${admissionId}`;
  if (_inFlightPulls.has(_guardKey)) {
    return { ok: true, insertedCount: 0, usedFallbackRate: false };
  }
  _inFlightPulls.add(_guardKey);
  try {
  // ----- Locked-day pre-flight (BEFORE any delete or insert) -----
  // This sweep writes line items, flags source records as billed, and only then
  // updates bills.total_amount. If that last write is refused by the day-closure
  // trigger we would be left with line items whose sum no longer matches the
  // bill and source rows already marked billed. Fail here instead, while the
  // bill is still untouched. Mirrors the SQL predicate — see lib/lockedDay.ts.
  const { data: lockBill } = await (supabase as any)
    .from("bills")
    .select("bill_date, bill_status, admission_id")
    .eq("id", billId)
    .maybeSingle();
  if (lockBill) {
    const lockError = await checkBillWritable(hospitalId, {
      billDate: (lockBill as any).bill_date ?? null,
      billStatus: (lockBill as any).bill_status ?? null,
      admissionId: (lockBill as any).admission_id ?? null,
    });
    if (lockError) {
      return { ok: false, insertedCount: 0, usedFallbackRate: false, error: lockError };
    }
  }

  const items: any[] = [];
  // Deletes are DEFERRED until the replacement rows are safely inserted.
  // Previously the consultation and room-charge lines were deleted up front and
  // re-inserted at the end, so any insert failure silently wiped those charges
  // off the bill with nothing to restore them. Collected as row ids (not dedupe
  // keys) so the delete cannot also take out the rows we just inserted, which
  // share the same key.
  const pendingDeleteIds: string[] = [];
  const nursingProcedureIdsToMark: string[] = [];
  const implantIdsToMark: string[] = [];
  const otServiceChargeItems: any[] = [];
  let usedFallbackRate = false;

  // ----- Existing items for dedupe (scoped to this bill only) -----
  const { data: scopedExisting } = await (supabase as any)
    .from("bill_line_items")
    .select("id, description, item_type, source_module, source_record_id, source_dedupe_key")
    .eq("bill_id", billId);

  const buildKey = buildDedupeKey;

  const existingKeys = new Set<string>(
    (scopedExisting || []).map((item: any) => buildKey(item))
  );

  /** Queue the existing rows carrying `dedupeKey` for deletion after the insert lands. */
  const queueDeleteByDedupeKey = (dedupeKey: string) => {
    (scopedExisting || []).forEach((row: any) => {
      if (row.source_dedupe_key === dedupeKey && row.id) pendingDeleteIds.push(row.id);
    });
  };

  /** Retire the superseded rows. Only ever called once the replacements are in. */
  const flushPendingDeletes = async () => {
    if (pendingDeleteIds.length === 0) return;
    await (supabase as any)
      .from("bill_line_items")
      .delete()
      .eq("bill_id", billId)
      .in("id", pendingDeleteIds);
  };

  const addUniqueItem = (item: any, nursingProcedureId?: string) => {
    const key = buildKey(item);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    items.push(item);
    if (nursingProcedureId) nursingProcedureIdsToMark.push(nursingProcedureId);
    return true;
  };

  // ----- Existing lab/radiology/pharmacy charges ANYWHERE on this admission -----
  //
  // Charges are now posted at ORDER time (lib/ancillaryCharges.ts). Under the 'separate'
  // receipt setting they land on their own paid receipt bill, not this one — so a bill-scoped
  // dedupe would not see them and the sweep would bill the same test/scan/drug again here.
  //
  // This is deliberately a SECOND set rather than a widening of existingKeys above. The
  // generic sibling-bill-copy sweep further down depends on the bill-scoped view: its whole
  // job is to copy sibling lines (OT implants, day care procedures) onto this bill, and those
  // lines DO carry real dedupe keys like ot:{id}:implant:{x}. Widening the shared set would
  // make that copy see its own source rows as "already present" and skip them — silently
  // dropping OT revenue from the discharge bill. Only the three dedicated pulls consult this.
  const { data: admissionWideExisting } = await (supabase as any)
    .from("bill_line_items")
    .select("id, description, item_type, source_module, source_record_id, source_dedupe_key, bills!inner(admission_id)")
    .eq("hospital_id", hospitalId)
    .eq("bills.admission_id", admissionId)
    .in("source_module", ["lab", "radiology", "pharmacy"]);

  const admissionWideKeys = new Set<string>(
    (admissionWideExisting || []).map((item: any) => buildKey(item))
  );

  /** Dedupe for the lab/radiology/pharmacy pulls: this bill OR any receipt on this admission. */
  const addUniqueAncillaryItem = (item: any) => {
    const key = buildKey(item);
    if (admissionWideKeys.has(key)) return false;
    admissionWideKeys.add(key);
    return addUniqueItem(item);
  };

  // Pre-fetch admission metadata for patient-based fallback lookup
  const { data: admissionMeta } = await supabase
    .from("admissions")
    .select("patient_id, admitted_at, discharged_at")
    .eq("id", admissionId)
    .maybeSingle();

  const admPatientId = admissionMeta?.patient_id || null;
  const admittedAt = admissionMeta?.admitted_at || new Date(0).toISOString();
  const dischargedOrNow = admissionMeta?.discharged_at || new Date().toISOString();

  // ----- Helper: rate lookup with fallback -----
  const getServiceRate = async (itemType: string, fallback: number) => {
    const { data } = await supabase
      .from("service_master")
      .select("fee, gst_percent, gst_applicable, hsn_code")
      .eq("hospital_id", hospitalId)
      .eq("item_type", itemType)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!data) {
      usedFallbackRate = true;
      return { fee: fallback, gst: 0, gstPct: 0, hsn: "" };
    }
    const fee = Number(data.fee) || fallback;
    const gstPct = data.gst_applicable ? Number(data.gst_percent) || 0 : 0;
    return {
      fee,
      gst: calcGST(fee, gstPct),
      gstPct,
      hsn: data.hsn_code || "",
    };
  };

  // ----- Lab charges -----
  // Primary: orders explicitly linked to this admission
  const { data: labByAdmission } = await supabase
    .from("lab_orders").select("id")
    .eq("hospital_id", hospitalId).eq("admission_id", admissionId);

  // Fallback: orphaned orders (admission_id = null) for this patient during the admission window
  const { data: labByPatient } = admPatientId ? await supabase
    .from("lab_orders").select("id")
    .eq("hospital_id", hospitalId)
    .eq("patient_id", admPatientId)
    .is("admission_id", null)
    .gte("order_time", admittedAt)
    .lte("order_time", dischargedOrNow) : { data: [] };

  const labOrderIdSet = new Set<string>();
  [...(labByAdmission || []), ...(labByPatient || [])].forEach((o) => labOrderIdSet.add(o.id));
  const mergedLabOrderIds = Array.from(labOrderIdSet);

  if (mergedLabOrderIds.length) {
    const { data: labItems } = await supabase
      .from("lab_order_items")
      .select("*, lab_test_master(test_name)")
      .in("lab_order_id", mergedLabOrderIds);

    const labItemsArr = labItems || [];
    const [labRate, ...labItemRates] = await Promise.all([
      getServiceRate("lab_test", 200),
      ...labItemsArr.map((li: any) =>
        supabase
          .from("service_master")
          .select("fee")
          .eq("hospital_id", hospitalId)
          .ilike("name", `%${li.lab_test_master?.test_name || ""}%`)
          .eq("item_type", "lab_test")
          .maybeSingle()
      ),
    ]);

    labItemsArr.forEach((li: any, i: number) => {
      const finalRate = (labItemRates[i] as any)?.data?.fee
        ? Number((labItemRates[i] as any).data.fee)
        : labRate.fee;
      const labGst = calcGST(finalRate, labRate.gstPct);
      addUniqueAncillaryItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "lab",
        description: `Lab: ${li.lab_test_master?.test_name || "Test"}`,
        quantity: 1,
        unit_rate: finalRate,
        taxable_amount: finalRate,
        gst_percent: labRate.gstPct,
        gst_amount: labGst,
        total_amount: finalRate + labGst,
        hsn_code: labRate.hsn || "998931",
        source_module: "lab",
        source_record_id: li.id,
        source_dedupe_key: `lab:${li.id}`,
        // Anything the sweep pulls is by definition carried by the admission and settled at
        // discharge. Without this the row took the column default 'pending_payment', which is
        // why the cashier's worklist needed a bill-level filter to hide IPD noise.
        payment_status: "advance_covered",
      });
    });
  }

  // ----- Radiology charges -----
  // Primary: orders explicitly linked to this admission
  const { data: radByAdmission } = await supabase
    .from("radiology_orders").select("id, study_name, accession_number")
    .eq("hospital_id", hospitalId).eq("admission_id", admissionId);

  // Fallback: orphaned orders (admission_id = null) for this patient during the admission window
  const { data: radByPatient } = admPatientId ? await supabase
    .from("radiology_orders").select("id, study_name, accession_number")
    .eq("hospital_id", hospitalId)
    .eq("patient_id", admPatientId)
    .is("admission_id", null)
    .gte("order_time", admittedAt)
    .lte("order_time", dischargedOrNow) : { data: [] };

  const radOrderMap = new Map<string, any>();
  [...(radByAdmission || []), ...(radByPatient || [])].forEach((o) => radOrderMap.set(o.id, o));
  const radOrders = Array.from(radOrderMap.values());

  const radOrdersArr = radOrders || [];
  const [radRate, ...radStudyRates] = await Promise.all([
    getServiceRate("radiology", 500),
    ...radOrdersArr.map((ro: any) =>
      supabase
        .from("service_master")
        .select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId)
        .ilike("name", `%${ro.study_name || ""}%`)
        .maybeSingle()
    ),
  ]);

  radOrdersArr.forEach((ro: any, i: number) => {
    const studyRate = (radStudyRates[i] as any)?.data;
    const radFee = studyRate?.fee ? Number(studyRate.fee) : radRate.fee;
    const radGstPct = studyRate?.gst_applicable
      ? Number(studyRate.gst_percent) || 0
      : radRate.gstPct;
    const radGst = calcGST(radFee, radGstPct);
    addUniqueAncillaryItem({
      hospital_id: hospitalId,
      bill_id: billId,
      item_type: "radiology",
      description: `Radiology: ${ro.study_name}`,
      quantity: 1,
      unit_rate: radFee,
      taxable_amount: radFee,
      gst_percent: radGstPct,
      gst_amount: radGst,
      total_amount: radFee + radGst,
      hsn_code: "998921",
      source_module: "radiology",
      source_record_id: ro.id,
      source_dedupe_key: `radiology:${ro.id}`,
      payment_status: "advance_covered",
    });
  });

  // ----- Pharmacy IP dispenses -----
  const { data: pharma } = await supabase
    .from("pharmacy_dispensing")
    .select("*, pharmacy_dispensing_items(*)")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .eq("dispensing_type", "ip");

  (pharma || []).forEach((pd: any) => {
    ((pd as any).pharmacy_dispensing_items || []).forEach((item: any) => {
      const total = Number(item.unit_price) * Number(item.quantity_dispensed);
      const dedupe = item.id
        ? `pharmacy:dispense-item:${item.id}`
        : `pharmacy:dispense:${pd.id}:${item.drug_name}:${item.quantity_dispensed}`;
      // The dispense captured the batch's own gst_percent — use it rather than assuming 12%,
      // which silently mispriced any drug taxed at another rate. Falls back to 12% only when
      // the row genuinely has no rate recorded.
      const pharmGstPct = Number(item.gst_percent ?? DEFAULT_PHARMACY_GST_PERCENT);
      const pharmGst = calcGST(total, pharmGstPct);
      addUniqueAncillaryItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "pharmacy",
        description: `Pharmacy: ${item.drug_name}`,
        quantity: Number(item.quantity_dispensed),
        unit_rate: Number(item.unit_price),
        taxable_amount: total,
        gst_percent: pharmGstPct,
        gst_amount: pharmGst,
        total_amount: total + pharmGst,
        source_module: "pharmacy",
        source_record_id: item.id || pd.id, // real UUID
        source_dedupe_key: dedupe,
        payment_status: "advance_covered",
      });
    });
  });

  // ----- Nursing procedures -----
  const { data: nursingProcs } = await (supabase as any)
    .from("nursing_procedures")
    .select("*")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .eq("billed", false);

  if (nursingProcs?.length) {
    const [nursingRate, ...procRates] = await Promise.all([
      getServiceRate("nursing_procedure", 150),
      ...nursingProcs.map((np: any) =>
        supabase
          .from("service_master")
          .select("fee, gst_percent, gst_applicable")
          .eq("hospital_id", hospitalId)
          .ilike("name", `%${(np.procedure_name || "").split(" ").slice(0, 2).join("%")}%`)
          .eq("item_type", "nursing_procedure")
          .eq("is_active", true)
          .limit(1)
          .maybeSingle()
      ),
    ]);

    nursingProcs.forEach((np: any, i: number) => {
      const procRate = (procRates[i] as any)?.data;
      const fee = procRate?.fee ? Number(procRate.fee) : nursingRate.fee;
      const qty = Number(np.quantity) || 1;
      const total = fee * qty;
      const gstPct = procRate?.gst_applicable
        ? Number(procRate.gst_percent) || 0
        : nursingRate.gstPct;
      const gst = calcGST(total, gstPct);
      addUniqueItem(
        {
          hospital_id: hospitalId,
          bill_id: billId,
          item_type: "nursing_procedure",
          description: `Nursing: ${np.procedure_name}`,
          quantity: qty,
          unit_rate: fee,
          taxable_amount: total,
          gst_percent: gstPct,
          gst_amount: gst,
          total_amount: total + gst,
          source_module: "nursing",
          source_record_id: np.id,
          source_dedupe_key: `nursing:${np.id}`,
        },
        np.id
      );
    });
  }

  // ----- Doctor visit / consultation charges -----
  // One chargeable consultation per doctor per day, derived from ward_round_notes.
  const { data: visits } = await (supabase as any)
    .from("ward_round_notes")
    .select("doctor_id, created_at")
    .eq("admission_id", admissionId);

  if (visits?.length) {
    // Group visits: count per (doctor_id, date)
    const visitMap = new Map<string, { doctorId: string; date: string; count: number }>();
    for (const v of visits) {
      if (!v?.doctor_id || !v?.created_at) continue;
      const date = new Date(v.created_at).toISOString().slice(0, 10);
      const key = `${v.doctor_id}:${date}`;
      const existing = visitMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        visitMap.set(key, { doctorId: v.doctor_id, date, count: 1 });
      }
    }

    // Look up each doctor's name and specific fee once
    const uniqueDoctorIds = [...new Set([...visitMap.values()].map((v) => v.doctorId))];
    const doctorNameById = new Map<string, string>();
    const doctorFeeById = new Map<string, { fee: number, gstPct: number, hsn: string }>();
    
    if (uniqueDoctorIds.length > 0) {
      const { data: doctors } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", uniqueDoctorIds);
      (doctors || []).forEach((d: any) =>
        doctorNameById.set(d.id, d.full_name || "Doctor")
      );
      
      const { data: docServices } = await supabase
        .from("service_master")
        .select("doctor_id, fee, ipd_consultation_fee, gst_percent, gst_applicable, hsn_code")
        .eq("hospital_id", hospitalId)
        .in("doctor_id", uniqueDoctorIds)
        .ilike("item_type", "consultation%");
        
      (docServices || []).forEach((s: any) => {
        if (!s.doctor_id) return;
        let consultFee = 0;
        if (s.ipd_consultation_fee !== null && s.ipd_consultation_fee !== undefined) {
          consultFee = Number(s.ipd_consultation_fee);
        } else if (s.fee) {
          consultFee = Number(s.fee);
        }
        
        if (!doctorFeeById.has(s.doctor_id)) {
          doctorFeeById.set(s.doctor_id, {
            fee: consultFee,
            gstPct: s.gst_applicable ? (Number(s.gst_percent) || 0) : 0,
            hsn: s.hsn_code || "999312"
          });
        }
      });
    }

    for (const { doctorId, date, count } of visitMap.values()) {
      const doctorName = doctorNameById.get(doctorId) || "Doctor";
      
      // If doctor has a specific rate, use it. Otherwise fallback to generic consultation rate.
      let unitFee = 300;
      let gstPct = 0;
      let hsn = "999312";
      
      if (doctorFeeById.has(doctorId)) {
        const docRate = doctorFeeById.get(doctorId)!;
        unitFee = docRate.fee;
        gstPct = docRate.gstPct;
        hsn = docRate.hsn;
      } else {
        const genericRate = await getServiceRate("consultation", 300);
        unitFee = genericRate.fee;
        gstPct = genericRate.gstPct;
        hsn = genericRate.hsn || "999312";
      }
      
      const totalFee = unitFee * count;
      const totalGst = calcGST(totalFee, gstPct);
      const visitDedupeKey = `ipd_visit:${doctorId}:${date}`;
      
      // Queue removal of the old lines for this doctor so the newly pulled one
      // replaces them without duplicating. Deferred until after the insert
      // succeeds — see pendingDeleteIds.
      queueDeleteByDedupeKey(visitDedupeKey);

      existingKeys.delete(
        buildKey({ source_module: "ipd_visit", source_dedupe_key: visitDedupeKey, item_type: "consultation" })
      );
      
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "consultation",
        description: count > 1 ? `Consultation: Dr. ${doctorName} (${date}) — ${count} visits` : `Consultation: Dr. ${doctorName} (${date})`,
        quantity: count,
        unit_rate: unitFee,
        taxable_amount: totalFee,
        gst_percent: gstPct,
        gst_amount: totalGst,
        total_amount: totalFee + totalGst,
        hsn_code: hsn,
        source_module: "ipd_visit",
        source_record_id: doctorId, // real UUID
        source_dedupe_key: visitDedupeKey,
        ordered_by: doctorId,
        service_date: date,
      });
    }
  }

  // ----- OT charges (completed surgeries) -----
  const { data: otSchedules } = await (supabase as any)
    .from("ot_schedules")
    .select("id, surgery_name, anaesthesia_type, anaesthetist_id, surgeon_id, actual_start_time, actual_end_time, estimated_duration_minutes")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .eq("status", "completed");

  if ((otSchedules as any[])?.length) {
    for (const ot of otSchedules as any[]) {
      const { items: otItems, implantIds } = await buildOTChargeLineItems(hospitalId, billId, ot);
      otItems.forEach((item) => {
        const added = addUniqueItem(item);
        if (added) {
          otServiceChargeItems.push(item);
          if (item.item_type === "implant") {
            const implantId = implantIds.find((id) => item.source_dedupe_key === `ot:${ot.id}:implant:${id}`);
            if (implantId) implantIdsToMark.push(implantId);
          }
        }
      });
    }
  }

  // ----- Room charges (always recompute on re-pull) -----
  const { data: admission } = await supabase
    .from("admissions")
    .select(
      "admitted_at, discharged_at, admission_type, ward_id, bed_id, wards(name, type, rate_per_day), beds(bed_number, bed_category)"
    )
    .eq("id", admissionId)
    .maybeSingle();

  if (admission) {
    // Queue unconditionally, before deciding whether to re-add: this keeps the day-count
    // current for inpatients AND retro-cleans a phantom room charge previously written onto
    // a bed-less (day care) bill, which would otherwise survive every re-pull.
    // Deferred until after the insert succeeds — see pendingDeleteIds.
    const roomDedupeKey = `ipd:room:${admissionId}`;
    queueDeleteByDedupeKey(roomDedupeKey);
    existingKeys.delete(
      buildKey({
        source_module: "ipd",
        source_dedupe_key: roomDedupeKey,
        item_type: "room_charge",
      })
    );
  }

  if (admission && shouldChargeRoom((admission as any).admission_type, (admission as any).bed_id)) {
    const roomDedupeKey = `ipd:room:${admissionId}`;
    const admitDate = new Date(admission.admitted_at || Date.now());
    const dischDate = admission.discharged_at
      ? new Date(admission.discharged_at)
      : new Date();
    const days = Math.max(
      1,
      Math.ceil((dischDate.getTime() - admitDate.getTime()) / 86400000)
    );
    const wardName = (admission as any).wards?.name || "Ward";
    const wardType = (admission as any).wards?.type || "general";
    const bedNum = (admission as any).beds?.bed_number || "";
    // bed_category (e.g. "icu", "private") takes precedence over ward type for rate lookup
    const bedCategory: string = (admission as any).beds?.bed_category || wardType;

    // Priority 1: service_rates table with bed_category match (most specific)
    const { data: categoryRateRaw } = await (supabase as any)
      .from("service_rates")
      .select("default_rate, gst_rate")
      .eq("hospital_id", hospitalId)
      .eq("bed_category", bedCategory)
      .eq("is_active", true)
      .ilike("item_type", "%room%")
      .limit(1)
      .maybeSingle();
      
    const categoryRate = categoryRateRaw ? {
      rate: categoryRateRaw.default_rate,
      gst_percent: categoryRateRaw.gst_rate,
      gst_applicable: !!categoryRateRaw.gst_rate
    } : null;

    // Priority 2: service_master by ward name / ward type
    const { data: roomRate } = categoryRate ? { data: null } : await supabase
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", `%${bedCategory}%`)
      .ilike("item_type", "%room%")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const wardDbRate = Number((admission as any).wards?.rate_per_day) || 0;
    // Priority: ward.rate_per_day (configured in Settings) → payer-specific service_rates → service_master → hardcoded fallback
    const ratePerDay =
      wardDbRate > 0
        ? wardDbRate
        : categoryRate?.rate
        ? Number(categoryRate.rate)
        : roomRate?.fee
        ? Number(roomRate.fee)
        : 500;
    if (wardDbRate <= 0 && !categoryRate?.rate && !roomRate?.fee) usedFallbackRate = true;
    // GST on room charges is a matter of law (ICU-exempt; >₹5000/day non-ICU = 5%), not
    // hospital-configurable pricing — deterministic from bed category + rate, independent of
    // whether a matching service_rates/service_master row happens to exist.
    const roomGstPct = getRoomChargeGSTRate(bedCategory, ratePerDay);
    const roomTotal = ratePerDay * days;
    const roomGst = calcGST(roomTotal, roomGstPct);

    addUniqueItem({
      hospital_id: hospitalId,
      bill_id: billId,
      item_type: "room_charge",
      description: `Room: ${wardName} - Bed ${bedNum} (${days} days)`,
      quantity: days,
      unit_rate: ratePerDay,
      taxable_amount: roomTotal,
      gst_percent: roomGstPct,
      gst_amount: roomGst,
      total_amount: roomTotal + roomGst,
      hsn_code: "999272",
      source_module: "ipd",
      source_record_id: admissionId, // real UUID
      source_dedupe_key: roomDedupeKey,
    });
  }

  // ----- Sibling bills linked to the admission -----
  const { data: relatedBillsRaw } = await supabase
    .from("bills")
    .select("id, bill_number, bill_type, subtotal, gst_amount, total_amount, notes")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .neq("id", billId);

  // Every other bill_type (ot, daycare, etc.) still needs this generic sweep,
  // since they have no dedicated pull above — lab/radiology/pharmacy do have
  // one and are excluded (see filterSiblingBillsForSweep).
  const relatedBills = filterSiblingBillsForSweep(relatedBillsRaw || []);

  if (relatedBills?.length) {
    const relatedBillMap = new Map(relatedBills.map((rb) => [rb.id, rb]));
    const relatedBillIds = relatedBills.map((rb) => rb.id);
    const lineItemCountByBill = new Map<string, number>();

    const { data: relatedBillItems } = await (supabase as any)
      .from("bill_line_items")
      .select(
        "id, bill_id, description, item_type, quantity, unit_rate, taxable_amount, gst_percent, gst_amount, total_amount, hsn_code, service_id, service_date, ordered_by, source_module, source_record_id, source_dedupe_key"
      )
      .in("bill_id", relatedBillIds);

    (relatedBillItems || []).forEach((item: any) => {
      lineItemCountByBill.set(
        item.bill_id,
        (lineItemCountByBill.get(item.bill_id) || 0) + 1
      );
      const sourceBill = relatedBillMap.get(item.bill_id);
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        description: item.description,
        item_type: item.item_type,
        quantity: item.quantity,
        unit_rate: item.unit_rate,
        taxable_amount: item.taxable_amount,
        gst_percent: item.gst_percent,
        gst_amount: item.gst_amount,
        total_amount: item.total_amount,
        hsn_code: item.hsn_code,
        service_id: item.service_id,
        service_date: item.service_date,
        ordered_by: item.ordered_by,
        source_module: item.source_module || sourceBill?.bill_type || "billing",
        source_record_id: item.source_record_id || item.id, // always a UUID
        source_dedupe_key: item.source_dedupe_key || `bill-line:${item.id}`,
      });
    });

    relatedBills.forEach((rb) => {
      if ((lineItemCountByBill.get(rb.id) || 0) > 0) return;
      const subtotal = Number(rb.subtotal || rb.total_amount || 0);
      const gstAmount = Number(rb.gst_amount || 0);
      const totalAmount = Number(rb.total_amount || subtotal + gstAmount);
      if (totalAmount <= 0) return;
      const derivedGstPercent =
        subtotal > 0 ? Number(((gstAmount / subtotal) * 100).toFixed(2)) : 0;
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type:
          rb.bill_type === "daycare" ? "procedure" : rb.bill_type || "other",
        description: `${(rb.bill_type || "service").toUpperCase()} Charges — ${rb.bill_number}`,
        quantity: 1,
        unit_rate: subtotal || totalAmount,
        taxable_amount: subtotal || totalAmount,
        gst_percent: derivedGstPercent,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        source_module: rb.bill_type || "billing",
        source_record_id: rb.id, // real UUID
        source_dedupe_key: `bill-summary:${rb.id}`,
        hsn_code: null,
      });
    });
  }

  // ----- Insert + recalc -----
  let insertedCount = 0;
  if (items.length > 0) {
    // Probe the bills row before writing anything. The pre-flight above models
    // the day-closure rule, but RLS or another trigger could still refuse the
    // final totals update — and by then the line items would already be in.
    // A no-op update surfaces that refusal while the bill is still untouched.
    const { error: probeError } = await (supabase as any)
      .from("bills")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", billId);
    if (probeError) {
      console.error("IPD auto-pull probe write failed:", probeError.message);
      return { ok: false, insertedCount: 0, usedFallbackRate, error: probeError.message };
    }

    const { error: insertError } = await supabase
      .from("bill_line_items")
      .insert(items);
    if (insertError) {
      console.error("IPD auto-pull insert failed:", insertError.message);
      return { ok: false, insertedCount: 0, usedFallbackRate, error: insertError.message };
    }
    insertedCount = items.length;

    // Replacement rows are in — now retire the superseded ones.
    await flushPendingDeletes();

    if (nursingProcedureIdsToMark.length > 0) {
      await (supabase as any)
        .from("nursing_procedures")
        .update({ billed: true, bill_id: billId })
        .in("id", nursingProcedureIdsToMark);
    }

    if (implantIdsToMark.length > 0) {
      await (supabase as any)
        .from("ot_implants")
        .update({ billed: true })
        .in("id", implantIdsToMark);
    }

    if (otServiceChargeItems.length > 0 && admPatientId) {
      const byCase = new Map<string, any[]>();
      otServiceChargeItems.forEach((item) => {
        const arr = byCase.get(item.source_record_id) || [];
        arr.push(item);
        byCase.set(item.source_record_id, arr);
      });
      for (const [scheduleId, caseItems] of byCase) {
        await recordOTServiceCharges({
          hospitalId, patientId: admPatientId, admissionId,
          scheduleId, billId, items: caseItems,
        });
      }
    }

    // Record every other newly-pulled charge into service_charges too, so
    // LeakageDashboard.tsx can see lab/radiology/pharmacy/nursing/room/
    // consultation revenue billed via this sweep — previously invisible.
    // OT items are skipped: recordOTServiceCharges above already covers them.
    const otItemsSet = new Set(otServiceChargeItems);
    for (const item of items) {
      if (otItemsSet.has(item)) continue;
      recordServiceCharge({
        hospitalId,
        patientId: admPatientId || "",
        admissionId,
        serviceModule: SWEEP_SERVICE_MODULE_MAP[item.item_type] || item.item_type,
        serviceRefId: item.source_record_id ?? null,
        serviceName: item.description,
        quantity: item.quantity,
        unitRate: item.unit_rate,
        gstPercent: item.gst_percent,
        gstAmount: item.gst_amount,
        totalAmount: item.total_amount,
        billId,
        performedBy: item.ordered_by ?? null,
      });
    }
  } else {
    // Nothing new to insert, but there may still be rows queued purely as
    // cleanup (e.g. a phantom room charge on a bed-less day care bill, which is
    // deleted with no replacement). Safe to run — there is no insert to protect.
    await flushPendingDeletes();
  }

  const result = await recalculateBillTotalsSafe(billId);
  if (!result.ok) {
    console.error("IPD auto-pull recalc failed:", result.error);
    return {
      ok: false,
      insertedCount,
      usedFallbackRate,
      error: result.error || "Bill totals could not be updated",
    };
  }

  return { ok: true, insertedCount, usedFallbackRate };
  } finally {
    _inFlightPulls.delete(_guardKey);
  }
}
