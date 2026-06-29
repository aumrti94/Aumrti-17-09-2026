import { supabase } from "@/integrations/supabase/client";
import { calcGST } from "@/lib/currency";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";

export interface AutoPullResult {
  ok: boolean;
  insertedCount: number;
  usedFallbackRate: boolean;
  error?: string;
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
export async function autoPullAdmissionCharges(
  billId: string,
  admissionId: string,
  hospitalId: string
): Promise<AutoPullResult> {
  const items: any[] = [];
  const nursingProcedureIdsToMark: string[] = [];
  let usedFallbackRate = false;

  // ----- Existing items for dedupe (scoped to this bill only) -----
  const { data: scopedExisting } = await (supabase as any)
    .from("bill_line_items")
    .select("id, description, item_type, source_module, source_record_id, source_dedupe_key")
    .eq("bill_id", billId);

  const buildKey = (item: {
    description?: string | null;
    item_type?: string | null;
    source_module?: string | null;
    source_dedupe_key?: string | null;
    source_record_id?: string | null;
  }) => {
    if (item.source_dedupe_key) {
      return `${item.source_module || "manual"}::${item.source_dedupe_key}::${item.item_type || "other"}`;
    }
    // Backward-compat for rows that never got a dedupe key
    return `${item.source_module || "manual"}::${item.source_record_id || (item.description || "").trim().toLowerCase()}::${item.item_type || "other"}`;
  };

  const existingKeys = new Set<string>(
    (scopedExisting || []).map((item: any) => buildKey(item))
  );

  const addUniqueItem = (item: any, nursingProcedureId?: string) => {
    const key = buildKey(item);
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    items.push(item);
    if (nursingProcedureId) nursingProcedureIdsToMark.push(nursingProcedureId);
    return true;
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

    const labRate = await getServiceRate("lab_test", 200);

    for (const li of labItems || []) {
      const { data: testRate } = await supabase
        .from("service_master")
        .select("fee")
        .eq("hospital_id", hospitalId)
        .ilike("name", `%${(li as any).lab_test_master?.test_name || ""}%`)
        .eq("item_type", "lab_test")
        .maybeSingle();
      const finalRate = testRate?.fee ? Number(testRate.fee) : labRate.fee;
      const labGst = calcGST(finalRate, labRate.gstPct);
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "lab",
        description: `Lab: ${(li as any).lab_test_master?.test_name || "Test"}`,
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
      });
    }
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

  const radRate = await getServiceRate("radiology", 500);

  for (const ro of radOrders || []) {
    const { data: studyRate } = await supabase
      .from("service_master")
      .select("fee, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .ilike("name", `%${(ro as any).study_name || ""}%`)
      .maybeSingle();
    const radFee = studyRate?.fee ? Number(studyRate.fee) : radRate.fee;
    const radGstPct = studyRate?.gst_applicable
      ? Number(studyRate.gst_percent) || 0
      : radRate.gstPct;
    const radGst = calcGST(radFee, radGstPct);
    addUniqueItem({
      hospital_id: hospitalId,
      bill_id: billId,
      item_type: "radiology",
      description: `Radiology: ${(ro as any).study_name}`,
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
    });
  }

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
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "pharmacy",
        description: `Pharmacy: ${item.drug_name}`,
        quantity: Number(item.quantity_dispensed),
        unit_rate: Number(item.unit_price),
        taxable_amount: total,
        gst_percent: 12,
        gst_amount: total * 0.12,
        total_amount: total * 1.12,
        source_module: "pharmacy",
        source_record_id: item.id || pd.id, // real UUID
        source_dedupe_key: dedupe,
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
    const nursingRate = await getServiceRate("nursing_procedure", 150);
    for (const np of nursingProcs) {
      const { data: procRate } = await supabase
        .from("service_master")
        .select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId)
        .ilike(
          "name",
          `%${(np.procedure_name || "").split(" ").slice(0, 2).join("%")}%`
        )
        .eq("item_type", "nursing_procedure")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
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
    }
  }

  // ----- Doctor visit / consultation charges -----
  // One chargeable consultation per doctor per day, derived from ward_round_notes.
  const { data: visits } = await (supabase as any)
    .from("ward_round_notes")
    .select("doctor_id, created_at")
    .eq("admission_id", admissionId);

  if (visits?.length) {
    const visitRate = await getServiceRate("consultation", 300);

    // Group visits: one per (doctor_id, date)
    const visitMap = new Map<string, { doctorId: string; date: string }>();
    for (const v of visits) {
      if (!v?.doctor_id || !v?.created_at) continue;
      const date = new Date(v.created_at).toISOString().slice(0, 10);
      const key = `${v.doctor_id}:${date}`;
      if (!visitMap.has(key)) {
        visitMap.set(key, { doctorId: v.doctor_id, date });
      }
    }

    // Look up each doctor's name once
    const uniqueDoctorIds = [
      ...new Set([...visitMap.values()].map((v) => v.doctorId)),
    ];
    const doctorNameById = new Map<string, string>();
    if (uniqueDoctorIds.length > 0) {
      const { data: doctors } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", uniqueDoctorIds);
      (doctors || []).forEach((d: any) =>
        doctorNameById.set(d.id, d.full_name || "Doctor")
      );
    }

    for (const { doctorId, date } of visitMap.values()) {
      const doctorName = doctorNameById.get(doctorId) || "Doctor";
      const fee = visitRate.fee;
      const gst = calcGST(fee, visitRate.gstPct);
      addUniqueItem({
        hospital_id: hospitalId,
        bill_id: billId,
        item_type: "consultation",
        description: `Consultation: Dr. ${doctorName} (${date})`,
        quantity: 1,
        unit_rate: fee,
        taxable_amount: fee,
        gst_percent: visitRate.gstPct,
        gst_amount: gst,
        total_amount: fee + gst,
        hsn_code: visitRate.hsn || "999312",
        source_module: "ipd_visit",
        source_record_id: doctorId, // real UUID
        source_dedupe_key: `ipd_visit:${doctorId}:${date}`,
        ordered_by: doctorId,
        service_date: date,
      });
    }
  }

  // ----- OT charges (completed surgeries) -----
  const { data: otSchedules } = await (supabase as any)
    .from("ot_schedules")
    .select("id, surgery_name, anaesthesia_type, anaesthetist_id, surgeon_id, implants_consumables, actual_start_time, actual_end_time, estimated_duration_minutes")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .eq("status", "completed");

  if ((otSchedules as any[])?.length) {
    const otRate = await getServiceRate("ot_charge", 2000);
    const surgRate = await getServiceRate("surgeon_fee", 5000);
    const anaesRate = await getServiceRate("anaesthesia_fee", 1500);

    for (const ot of otSchedules as any[]) {
      const actualDuration =
        ot.actual_start_time && ot.actual_end_time
          ? Math.ceil((new Date(ot.actual_end_time).getTime() - new Date(ot.actual_start_time).getTime()) / 3600000)
          : Math.ceil((ot.estimated_duration_minutes || 60) / 60);
      const hours = Math.max(1, actualDuration);
      const otFee = hours * otRate.fee;
      const otGst = calcGST(otFee, otRate.gstPct);

      addUniqueItem({
        hospital_id: hospitalId, bill_id: billId,
        item_type: "ot_charge",
        description: `OT Charges: ${ot.surgery_name} (${hours} hr)`,
        quantity: hours, unit_rate: otRate.fee,
        taxable_amount: otFee, gst_percent: otRate.gstPct,
        gst_amount: otGst, total_amount: otFee + otGst,
        hsn_code: otRate.hsn || "999315", source_module: "ot",
        source_record_id: ot.id,
        source_dedupe_key: `ot:${ot.id}:ot_charge`,
      });

      if (ot.surgeon_id) {
        const surgGst = calcGST(surgRate.fee, surgRate.gstPct);
        addUniqueItem({
          hospital_id: hospitalId, bill_id: billId,
          item_type: "surgeon_fee",
          description: `Surgeon Fee: ${ot.surgery_name}`,
          quantity: 1, unit_rate: surgRate.fee,
          taxable_amount: surgRate.fee, gst_percent: surgRate.gstPct,
          gst_amount: surgGst, total_amount: surgRate.fee + surgGst,
          hsn_code: surgRate.hsn || "999316", source_module: "ot",
          source_record_id: ot.id,
          source_dedupe_key: `ot:${ot.id}:surgeon_fee`,
        });
      }

      if (ot.anaesthetist_id) {
        const anaGst = calcGST(anaesRate.fee, anaesRate.gstPct);
        addUniqueItem({
          hospital_id: hospitalId, bill_id: billId,
          item_type: "anaesthesia_fee",
          description: `Anaesthesia: ${ot.anaesthesia_type || "General"}`,
          quantity: 1, unit_rate: anaesRate.fee,
          taxable_amount: anaesRate.fee, gst_percent: anaesRate.gstPct,
          gst_amount: anaGst, total_amount: anaesRate.fee + anaGst,
          hsn_code: anaesRate.hsn || "999317", source_module: "ot",
          source_record_id: ot.id,
          source_dedupe_key: `ot:${ot.id}:anaesthesia_fee`,
        });
      }

      const implants = (ot.implants_consumables as any[]) || [];
      implants.forEach((imp: any, idx: number) => {
        const cost = Number(imp.cost || imp.price || 0);
        if (cost <= 0) return;
        const qty = Number(imp.quantity || 1);
        const total = cost * qty;
        const impGst = calcGST(total, 12);
        addUniqueItem({
          hospital_id: hospitalId, bill_id: billId,
          item_type: "implant",
          description: `Implant: ${imp.name || imp.item_name || "Surgical Consumable"}`,
          quantity: qty, unit_rate: cost,
          taxable_amount: total, gst_percent: 12,
          gst_amount: impGst, total_amount: total + impGst,
          hsn_code: "9021", source_module: "ot",
          source_record_id: ot.id,
          source_dedupe_key: `ot:${ot.id}:implant:${idx}`,
        });
      });
    }
  }

  // ----- Room charges (always recompute on re-pull) -----
  const { data: admission } = await supabase
    .from("admissions")
    .select(
      "admitted_at, discharged_at, ward_id, bed_id, wards(name, type, rate_per_day), beds(bed_number, bed_category)"
    )
    .eq("id", admissionId)
    .maybeSingle();

  if (admission) {
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
    const { data: categoryRate } = await (supabase as any)
      .from("service_rates")
      .select("rate, gst_percent, gst_applicable")
      .eq("hospital_id", hospitalId)
      .eq("bed_category", bedCategory)
      .eq("is_active", true)
      .ilike("item_type", "%room%")
      .limit(1)
      .maybeSingle();

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
    const effectiveRate = categoryRate ?? roomRate;
    const roomGstPct = effectiveRate?.gst_applicable
      ? Number(effectiveRate.gst_percent) || 0
      : 0;
    const roomTotal = ratePerDay * days;
    const roomGst = calcGST(roomTotal, roomGstPct);

    // Always delete the previous room line item so day-count stays current.
    const roomDedupeKey = `ipd:room:${admissionId}`;
    await (supabase as any)
      .from("bill_line_items")
      .delete()
      .eq("bill_id", billId)
      .eq("source_dedupe_key", roomDedupeKey);
    existingKeys.delete(
      buildKey({
        source_module: "ipd",
        source_dedupe_key: roomDedupeKey,
        item_type: "room_charge",
      })
    );

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
  const { data: relatedBills } = await supabase
    .from("bills")
    .select("id, bill_number, bill_type, subtotal, gst_amount, total_amount, notes")
    .eq("hospital_id", hospitalId)
    .eq("admission_id", admissionId)
    .neq("id", billId);

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
    const { error: insertError } = await supabase
      .from("bill_line_items")
      .insert(items);
    if (insertError) {
      console.error("IPD auto-pull insert failed:", insertError.message);
      return { ok: false, insertedCount: 0, usedFallbackRate, error: insertError.message };
    }
    insertedCount = items.length;

    if (nursingProcedureIdsToMark.length > 0) {
      await (supabase as any)
        .from("nursing_procedures")
        .update({ billed: true, bill_id: billId })
        .in("id", nursingProcedureIdsToMark);
    }
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
}
