import { supabase } from "@/integrations/supabase/client";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface LabOrderInput {
  test_name: string;
  urgency?: string;
  clinical_indication?: string;
}

interface RadiologyOrderInput {
  study_name: string;
  urgency?: string;
  clinical_indication?: string;
}

function randomChars(n: number) {
  return Math.random().toString(36).substring(2, 2 + n).toUpperCase();
}

/**
 * Sync prescription lab_orders JSON → real lab_orders / lab_order_items / lab_samples rows.
 * Skips duplicates by checking existing orders for the same encounter/admission + test.
 */
export async function syncLabOrders(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  encounterId?: string | null;
  admissionId?: string | null;
  items: LabOrderInput[];
}): Promise<number> {
  if (!opts.items.length) return 0;
  let created = 0;

  // Fetch existing lab orders for this encounter/admission to avoid dupes
  let existingTests: string[] = [];
  if (opts.encounterId) {
    const { data: existing } = await (supabase as any)
      .from("lab_orders")
      .select("id, lab_order_items(test_id, lab_test_master:test_id(test_name))")
      .eq("encounter_id", opts.encounterId);
    // flatten test names
    existingTests = (existing || []).flatMap((o: any) =>
      (o.lab_order_items || []).map((i: any) => (i.lab_test_master?.test_name || "").toLowerCase())
    );
  } else if (opts.admissionId) {
    const { data: existing } = await (supabase as any)
      .from("lab_orders")
      .select("id, lab_order_items(test_id, lab_test_master:test_id(test_name))")
      .eq("admission_id", opts.admissionId);
    existingTests = (existing || []).flatMap((o: any) =>
      (o.lab_order_items || []).map((i: any) => (i.lab_test_master?.test_name || "").toLowerCase())
    );
  }

  // Fetch lab_test_master for lookups
  const { data: masterTests } = await (supabase as any)
    .from("lab_test_master")
    .select("id, test_name, sample_type, unit, normal_range_male, normal_range_female")
    .eq("hospital_id", opts.hospitalId)
    .eq("is_active", true);

  for (const item of opts.items) {
    if (!item.test_name?.trim()) continue;
    if (existingTests.includes(item.test_name.toLowerCase())) continue;

    const orderedAt = new Date().toISOString();

    // Create lab_order
    const { data: newOrder, error: orderErr } = await (supabase as any)
      .from("lab_orders")
      .insert({
        hospital_id: opts.hospitalId,
        patient_id: opts.patientId,
        ordered_by: opts.orderedBy,
        encounter_id: opts.encounterId || null,
        admission_id: opts.admissionId || null,
        priority: item.urgency || "routine",
        clinical_notes: item.clinical_indication || null,
        status: "ordered",
        billing_status: "unbilled",
        ordered_at: orderedAt,
      })
      .select("id")
      .maybeSingle();

    if (orderErr || !newOrder) {
      console.error("Lab order insert failed:", orderErr?.message);
      continue;
    }

    // Match test in master
    const matched = (masterTests || []).find(
      (t: any) => t.test_name.toLowerCase() === item.test_name.toLowerCase()
    );

    // Create lab_order_item — rollback lab_orders if this fails
    const { error: itemErr } = await (supabase as any).from("lab_order_items").insert({
      hospital_id: opts.hospitalId,
      lab_order_id: newOrder.id,
      test_id: matched?.id || null,
      status: "ordered",
      result_unit: matched?.unit || null,
      reference_range: matched?.normal_range_male || matched?.normal_range_female || null,
    });
    if (itemErr) {
      await (supabase as any).from("lab_orders").delete().eq("id", newOrder.id);
      console.error("Lab order item insert failed (order rolled back):", itemErr.message);
      continue;
    }

    // Create lab_sample
    await (supabase as any).from("lab_samples").insert({
      hospital_id: opts.hospitalId,
      lab_order_id: newOrder.id,
      sample_type: matched?.sample_type || "blood",
      barcode: `BC-${Date.now()}-${randomChars(4)}`,
      status: "pending",
    });

    await logNABHEvidence(
      opts.hospitalId,
      "COP.6",
      `Lab investigation ordered: ${item.test_name} for encounter ${opts.encounterId || opts.admissionId || "unknown"}`,
      "compliant"
    );

    created++;
    existingTests.push(item.test_name.toLowerCase());
  }

  return created;
}

/**
 * Sync prescription radiology_orders JSON → real radiology_orders rows.
 */
export async function syncRadiologyOrders(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  encounterId?: string | null;
  admissionId?: string | null;
  items: RadiologyOrderInput[];
}): Promise<number> {
  if (!opts.items.length) return 0;
  let created = 0;

  // Check existing to avoid dupes
  let existingStudies: string[] = [];
  const filterCol = opts.encounterId ? "encounter_id" : "admission_id";
  const filterVal = opts.encounterId || opts.admissionId;
  if (filterVal) {
    const { data: existing } = await (supabase as any)
      .from("radiology_orders")
      .select("study_name")
      .eq(filterCol, filterVal);
    existingStudies = (existing || []).map((o: any) => (o.study_name || "").toLowerCase());
  }

  // Fetch modalities
  const { data: modalities } = await (supabase as any)
    .from("radiology_modalities")
    .select("id, name, modality_type")
    .eq("hospital_id", opts.hospitalId)
    .eq("is_active", true);

  const fallbackModality = modalities?.[0];

  for (const item of opts.items) {
    if (!item.study_name?.trim()) continue;
    if (existingStudies.includes(item.study_name.toLowerCase())) continue;

    const matched = (modalities || []).find(
      (m: any) => m.name.toLowerCase().includes(item.study_name.toLowerCase()) ||
        item.study_name.toLowerCase().includes(m.modality_type?.toLowerCase() || "")
    );

    const radOrderedAt = new Date().toISOString();
    const { error } = await (supabase as any)
      .from("radiology_orders")
      .insert({
        hospital_id: opts.hospitalId,
        patient_id: opts.patientId,
        ordered_by: opts.orderedBy,
        encounter_id: opts.encounterId || null,
        admission_id: opts.admissionId || null,
        study_name: item.study_name,
        modality_id: matched?.id || fallbackModality?.id || null,
        modality_type: matched?.modality_type || fallbackModality?.modality_type || "X-Ray",
        priority: item.urgency || "routine",
        indication: item.clinical_indication || null,
        status: "ordered",
        billing_status: "unbilled",
        ordered_at: radOrderedAt,
      });

    if (error) {
      console.error("Radiology order insert failed:", error.message);
      continue;
    }

    await logNABHEvidence(
      opts.hospitalId,
      "COP.6",
      `Radiology investigation ordered: ${item.study_name} for encounter ${opts.encounterId || opts.admissionId || "unknown"}`,
      "compliant"
    );

    created++;
    existingStudies.push(item.study_name.toLowerCase());
  }

  return created;
}

// Common lab/radiology keyword patterns for text parsing (IPD ward rounds)
const LAB_PATTERNS = [
  "cbc", "complete blood count", "lft", "liver function", "kft", "kidney function",
  "rft", "renal function", "blood sugar", "fbs", "ppbs", "rbs", "hba1c",
  "thyroid", "tsh", "t3", "t4", "lipid profile", "urine routine", "urine r/m",
  "abg", "arterial blood gas", "pt/inr", "pt inr", "aptt", "electrolytes",
  "serum electrolytes", "blood culture", "urine culture", "crp", "esr",
  "d-dimer", "procalcitonin", "troponin", "bnp", "proBNP", "ammonia",
  "serum creatinine", "serum albumin", "bilirubin",
];

const RADIOLOGY_PATTERNS = [
  { pattern: /\bx[\s-]?ray\b/i, study: "X-Ray" },
  { pattern: /\bct\s*scan\b/i, study: "CT Scan" },
  { pattern: /\bcect\b/i, study: "CT Scan" },
  { pattern: /\bhrct\b/i, study: "CT Scan" },
  { pattern: /\bmri\b/i, study: "MRI" },
  { pattern: /\busg\b|\bultrasound\b|\bultrasonography\b/i, study: "USG" },
  { pattern: /\becg\b|\belectrocardiogram\b/i, study: "ECG" },
  { pattern: /\becho\b|\b2d\s*echo\b|\bechocardiography\b/i, study: "Echo" },
  { pattern: /\bdexa\b/i, study: "DEXA" },
  { pattern: /\bmammography\b|\bmammogram\b/i, study: "Mammography" },
];

/**
 * Parse free-text plan for lab and radiology keywords.
 */
export function parseInvestigationsFromText(text: string): {
  labTests: string[];
  radiologyStudies: string[];
} {
  const lower = text.toLowerCase();
  const labTests: string[] = [];
  const radiologyStudies: string[] = [];

  for (const pattern of LAB_PATTERNS) {
    if (lower.includes(pattern) && !labTests.includes(pattern.toUpperCase())) {
      // Use a readable name
      labTests.push(pattern.toUpperCase());
    }
  }

  for (const { pattern, study } of RADIOLOGY_PATTERNS) {
    if (pattern.test(text) && !radiologyStudies.includes(study)) {
      radiologyStudies.push(study);
    }
  }

  return { labTests, radiologyStudies };
}
