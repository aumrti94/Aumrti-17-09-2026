import { supabase } from "@/integrations/supabase/client";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { requiresPcpndtFormF, buildFormFRow, ageFromDob } from "@/lib/pcpndt";
import { formatReferenceRange } from "@/lib/labReferenceRange";
import { buildOrderCatalogue, matchOrderNameDetailed } from "@/lib/orderCatalogue";

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
 * Heuristic: does an investigation name look like a radiology / imaging study
 * (as opposed to a lab test)? Single source for the keyword regex previously
 * duplicated in IPDWorkspace and OPD ConsultationWorkspace.
 */
export function isRadiologyKeyword(name: string): boolean {
  return /\bx[\s-]?ray\b|\bcect\b|\bhrct\b|\bct\b|\bmri\b|\busg\b|\bultrasound\b|\bultrasonography\b|\becg\b|\belectrocardiogram\b|\becho\b|\b2d\s*echo\b|\bechocardiography\b|\bdexa\b|\bmammograph|\bfluoroscop|\bpet\b/i.test(name);
}

export interface SyncLabOrdersResult {
  /** Number of TESTS ordered — not the number of orders, which is at most one per call. */
  created: number;
  /** Prescribed test names with no active lab_test_master match — NOT ordered.
   *  Callers should surface these so staff can order them manually. */
  unmatched: string[];
  /** ids of the lab_orders actually created by this call — at most one.
   *  Needed to charge them: the charge is keyed per lab_order_items row (lab:{item.id}), so
   *  callers re-query the items for these orders rather than guessing. Empty when every test
   *  was a duplicate or unmatched — a skipped duplicate was already charged when it was first
   *  created. */
  orderIds: string[];
}

/** STAT beats urgent beats routine. Grouping tests into one order must not quietly downgrade
 *  an urgent one to the priority of whichever test happened to come first in the list. */
const PRIORITY_RANK: Record<string, number> = { routine: 0, urgent: 1, stat: 2 };
const highestPriority = (a: string, b: string) =>
  (PRIORITY_RANK[b?.toLowerCase()] ?? 0) > (PRIORITY_RANK[a?.toLowerCase()] ?? 0) ? b : a;

/**
 * Sync prescription lab_orders JSON → real lab_orders / lab_order_items / lab_samples rows.
 * Skips duplicates by checking existing orders for the same encounter/admission + test.
 * Creation is atomic via the create_lab_order_with_items RPC (Phase 4) — header-only ghost
 * orders can no longer be left behind.
 *
 * ONE ORDER PER CALL, holding every matched test as an item. This used to call the RPC inside
 * the per-test loop, so a doctor who ordered four tests produced four lab_orders headers —
 * four accessions, four samples, four cards in the lab worklist for one patient, and a
 * collection run that drew blood four times. The RPC has always taken `p_items` as an array;
 * only the caller was wrong. (The fan-out was invisible until BUG-P4-008 was fixed below,
 * because before that this function never created anything at all.)
 */
export async function syncLabOrders(opts: {
  hospitalId: string;
  patientId: string;
  orderedBy: string;
  encounterId?: string | null;
  admissionId?: string | null;
  items: LabOrderInput[];
}): Promise<SyncLabOrdersResult> {
  if (!opts.items.length) return { created: 0, unmatched: [], orderIds: [] };
  let created = 0;
  const unmatched: string[] = [];
  const orderIds: string[] = [];

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

  // Fetch lab_test_master for lookups.
  //
  // BUG-P4-008: this used to select "normal_range_male, normal_range_female", columns that do
  // not exist on lab_test_master (the real schema is normal_min/normal_max, plus
  // male_normal_min/max and female_normal_min/max for the handful of tests with gender-specific
  // ranges — see SettingsLabTestsPage.tsx). PostgREST errors on an unknown column, and this call
  // only destructured `data` (never checked `error`), so masterTests silently became undefined
  // on EVERY call — meaning `(masterTests || []).find(...)` below always returned nothing, and
  // every prescribed test was always pushed to `unmatched`, no matter how it was spelled. This
  // function has therefore never actually created a lab order for as long as this bug existed,
  // in IPD or in OPD (the only two callers).
  const { data: masterTests, error: masterErr } = await (supabase as any)
    .from("lab_test_master")
    .select(
      "id, test_name, sample_type, unit, normal_min, normal_max, " +
      "male_normal_min, male_normal_max, female_normal_min, female_normal_max",
    )
    .eq("hospital_id", opts.hospitalId)
    .eq("is_active", true);
  if (masterErr) console.error("lab_test_master lookup failed:", masterErr.message);

  // Panels are GROUPS, not rows. 'Complete Blood Count', 'Liver Function Test', 'Kidney
  // Function Test', 'Lipid Profile' and 'Serum Electrolytes' used to be single
  // lab_test_master rows with unit 'report', so a CBC came back as one unitless blob
  // that no analyte inside could be flagged, delta-checked or auto-verified against.
  // They are retired (see LAB_TEST_RETIRED) in favour of identically named groups.
  //
  // A doctor still prescribes "CBC". The match below is by NAME against lab_test_master
  // and a miss is pushed to `unmatched` SILENTLY — so without this fallback, retiring the
  // row would stop every prescribed CBC from reaching the lab with nothing raising an
  // error anywhere. That is the same class of failure as BUG-P4-008 above.
  //
  // Members are filtered to is_active here rather than in the query: PostgREST applies a
  // filter on an embedded resource by dropping the PARENT row, so a group holding one
  // deactivated test would vanish entirely instead of losing that one member.
  const { data: groupRows, error: groupErr } = await (supabase as any)
    .from("lab_test_groups")
    .select(
      "group_name, lab_test_group_items(lab_test_master:test_id(" +
      "id, test_name, sample_type, unit, is_active, normal_min, normal_max, " +
      "male_normal_min, male_normal_max, female_normal_min, female_normal_max))",
    )
    .eq("hospital_id", opts.hospitalId)
    .eq("is_active", true);
  if (groupErr) console.error("lab_test_groups lookup failed:", groupErr.message);

  const groupsByName = new Map<string, any[]>();
  const groupNames: string[] = [];
  for (const g of groupRows || []) {
    const members = (g.lab_test_group_items || [])
      .map((i: any) => i.lab_test_master)
      .filter((m: any) => m && m.is_active);
    if (members.length) {
      groupsByName.set(String(g.group_name).toLowerCase(), members);
      groupNames.push(String(g.group_name));
    }
  }

  // The same matcher the Rx & Orders tab uses, over the rows already fetched above — no extra
  // round trip. Without this, the two disagree: the tab can show a test as resolved while this
  // function, matching on exact name only, drops it into `unmatched` and never orders it.
  //
  // It is not merely a mirror of the UI. A prescription saved BEFORE the tab could resolve
  // names, or written by any path that bypasses the tab, arrives here as raw free text, and
  // this is the last place anything can still recognise it.
  const syncCatalogue = buildOrderCatalogue([
    ...(masterTests || []).map((t: any) => ({ id: String(t.id), name: String(t.test_name), kind: "lab" as const })),
    // A group's id is its name here: resolution goes back through groupsByName, which is
    // keyed by name because the embedded select carries no group id.
    ...groupNames.map((n) => ({ id: n, name: n, kind: "lab_group" as const })),
  ]);

  // The sex is read here rather than added to this function's options because every
  // caller already passes patientId — an option would be one more thing for a new
  // caller to forget, and forgetting it silently prints the wrong reference interval.
  const { data: patientRow } = await (supabase as any)
    .from("patients")
    .select("gender")
    .eq("id", opts.patientId)
    .maybeSingle();
  const patientGender: string | null = patientRow?.gender ?? null;

  // Pass 1 — resolve every prescribed test against the master, accumulating one batch.
  // Nothing is written until the whole batch is known, so the order is created once.
  const rpcItems: Array<{ test_id: string; result_unit: string | null; reference_range: string | null }> = [];
  const rpcSamples: Array<{ sample_type: string; barcode: string }> = [];
  const orderedNames: string[] = [];
  const indications: string[] = [];
  let priority = "routine";
  // One sample per sample_type, not per test: a CBC and an ESR are both whole blood and are
  // drawn into one tube. Creating a sample per test is what produced duplicate barcodes for
  // the same draw.
  const seenSampleTypes = new Set<string>();

  for (const item of opts.items) {
    if (!item.test_name?.trim()) continue;
    if (existingTests.includes(item.test_name.toLowerCase())) continue;

    // Resolve to one or more master rows: a direct test match, else a panel group that
    // expands into its members. Names that match neither are no longer ordered as
    // nameless test_id:null items (they had no name, no rate, and no analyzer mapping) —
    // they are returned to the caller to surface for manual ordering.
    const requested = item.test_name.toLowerCase();
    let direct = (masterTests || []).find((t: any) => t.test_name.toLowerCase() === requested);
    let resolved: any[] = direct ? [direct] : (groupsByName.get(requested) ?? []);
    // The key a matched PANEL is deduped under. It has to be the canonical group name, not
    // what the doctor typed, or "Fever panel test" followed by "Fever Panel" on the same
    // encounter expands the panel twice.
    let panelKey = requested;

    // Exact match missed. Before giving up on a test the hospital may well offer, try the
    // alias and fuzzy tiers — this is what stops "Fever panel test" being dropped when Fever
    // Panel is right there in the catalogue.
    if (!resolved.length) {
      const hit = matchOrderNameDetailed(item.test_name, syncCatalogue);
      if (hit?.entry.kind === "lab") {
        const row = (masterTests || []).find((t: any) => String(t.id) === hit.entry.id);
        if (row) { direct = row; resolved = [row]; }
      } else if (hit?.entry.kind === "lab_group") {
        panelKey = hit.entry.name.toLowerCase();
        resolved = groupsByName.get(panelKey) ?? [];
      }
    }

    if (!resolved.length) {
      unmatched.push(item.test_name);
      continue;
    }

    let addedAny = false;
    for (const matched of resolved) {
      // Deduped per MEMBER, not per panel: prescribing "CBC" after a standalone
      // haemoglobin adds the other nine analytes instead of drawing the Hb twice.
      const memberKey = String(matched.test_name).toLowerCase();
      if (existingTests.includes(memberKey)) continue;

      rpcItems.push({
        test_id: matched.id,
        result_unit: matched.unit || null,
        // Sex-specific where the analyte has one (Hb, RBC, PCV, creatinine, ...), falling
        // back to the shared interval when the patient's sex is unknown. Also covers
        // one-sided intervals like HDL, which the old `min != null && max != null` test
        // dropped entirely — an HDL result reached the report with no range beside it.
        reference_range: formatReferenceRange(matched, patientGender),
      });

      const sampleType = matched.sample_type || "blood";
      if (!seenSampleTypes.has(sampleType)) {
        seenSampleTypes.add(sampleType);
        rpcSamples.push({ sample_type: sampleType, barcode: `BC-${Date.now()}-${randomChars(4)}` });
      }

      // The canonical master name, not what the doctor typed — the NABH evidence line
      // below should record the test the lab actually received.
      orderedNames.push(matched.test_name);
      existingTests.push(memberKey);
      addedAny = true;
    }

    // Every member was already on this encounter: nothing new to order, and the urgency
    // of a fully duplicate request must not escalate the whole order's priority.
    if (!addedAny) continue;

    priority = highestPriority(priority, item.urgency || "routine");
    if (item.clinical_indication) indications.push(item.clinical_indication);
    // Remember the PANEL name too, so a second "CBC" on the same encounter is a no-op
    // rather than re-expanding into ten members that are each individually deduped.
    if (!direct) existingTests.push(panelKey);
  }

  // Every test was a duplicate or unmatched. The RPC raises on an empty p_items, so returning
  // here is what keeps a re-completed consultation from erroring instead of no-opping.
  if (rpcItems.length === 0) return { created: 0, unmatched, orderIds: [] };

  // Pass 2 — one atomic create: header + all items + samples in one transaction
  // (accession assigned inside).
  const { data: newOrderId, error: rpcErr } = await (supabase as any).rpc("create_lab_order_with_items", {
    p_hospital_id: opts.hospitalId,
    p_patient_id: opts.patientId,
    p_ordered_by: opts.orderedBy,
    p_encounter_id: opts.encounterId || null,
    p_admission_id: opts.admissionId || null,
    p_priority: priority,
    // Indications are per-test in the prescription but the order carries one note. Joining
    // beats picking the first, which silently dropped the rest.
    p_clinical_notes: indications.length ? [...new Set(indications)].join("; ") : null,
    p_billing_status: "unbilled",
    p_items: rpcItems,
    p_samples: rpcSamples,
  });

  if (rpcErr || !newOrderId) {
    console.error("Lab order create failed:", rpcErr?.message);
    // Nothing was written, so nothing is half-ordered — report the tests back as unordered
    // rather than letting the caller believe they reached the lab.
    return { created: 0, unmatched: [...unmatched, ...orderedNames], orderIds: [] };
  }

  created = rpcItems.length;
  orderIds.push(newOrderId as string);

  for (const name of orderedNames) {
    await logNABHEvidence(
      opts.hospitalId,
      "COP.6",
      `Lab investigation ordered: ${name} for encounter ${opts.encounterId || opts.admissionId || "unknown"}`,
      "compliant"
    );
  }

  return { created, unmatched, orderIds };
}

export interface SyncRadiologyOrdersResult {
  created: number;
  /** ids of the radiology_orders actually created by this call — the charge is keyed
   *  radiology:{order.id}. Only NEW orders are listed; a skipped duplicate was already
   *  charged when it was first created. */
  orderIds: string[];
  /** Study names that resolved to no radiology_study_master row. Unlike the lab side these
   *  ARE still ordered — a study the master has not been told about is usually a gap in the
   *  master rather than a study the hospital cannot do — but they bill at the default rate
   *  because no rate card matches, so the caller must be able to say so. */
  unmatched: string[];
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
}): Promise<SyncRadiologyOrdersResult> {
  if (!opts.items.length) return { created: 0, orderIds: [], unmatched: [] };
  let created = 0;
  const orderIds: string[] = [];
  const unmatched: string[] = [];

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

  // The study master carries the PCPNDT flag (requires_form_f). Fetched here so the Form F
  // decision below is driven by the hospital's own configuration rather than by a substring
  // of whatever the doctor typed. See src/lib/pcpndt.ts for why that distinction matters.
  const { data: studyMaster } = await (supabase as any)
    .from("radiology_study_master")
    .select("study_name, modality_type, requires_form_f")
    .eq("hospital_id", opts.hospitalId)
    .eq("is_active", true);

  // Same tiers as the lab side, over the master already fetched above. Resolving here does
  // more than fix a badge: the study_name inserted below is what investigationBilling's
  // `ilike` rate lookup searches on, so an unresolved name silently bills at the ₹500 default
  // instead of the study's real fee.
  const radCatalogue = buildOrderCatalogue(
    (studyMaster || [])
      .filter((s: any) => s.study_name)
      .map((s: any) => ({ id: String(s.study_name), name: String(s.study_name), kind: "radiology" as const })),
  );

  const masterFor = (name: string) => {
    const exact = (studyMaster || []).find(
      (s: any) => (s.study_name || "").toLowerCase() === name.toLowerCase()
    );
    if (exact) return exact;
    const hit = matchOrderNameDetailed(name, radCatalogue);
    if (!hit) return undefined;
    return (studyMaster || []).find((s: any) => s.study_name === hit.entry.name);
  };

  // Patient identity for the Form F register — fetched once, and only if any ordered study
  // actually needs it, so an ordinary X-ray order costs no extra round trip.
  let formFPatient: { full_name: string; dob: string | null; address: string | null } | null = null;
  const loadFormFPatient = async () => {
    if (formFPatient) return formFPatient;
    const { data } = await (supabase as any)
      .from("patients")
      .select("full_name, dob, address")
      .eq("id", opts.patientId)
      .maybeSingle();
    formFPatient = data ?? { full_name: "Unknown", dob: null, address: null };
    return formFPatient;
  };

  for (const item of opts.items) {
    if (!item.study_name?.trim()) continue;

    const master = masterFor(item.study_name);
    if (!master) unmatched.push(item.study_name);
    // The master's own spelling wins. It is what the rate lookup, the modality worklist and
    // the report header all search on; storing "usg abdomen and pelvis" when the master says
    // "USG Abdomen + Pelvis" is what made the study bill at the default rate.
    const studyName = master?.study_name || item.study_name;

    // Deduped on the CANONICAL name, so a study already ordered as "USG Abdomen + Pelvis" is
    // not scanned and billed a second time because this request spelled it differently.
    if (existingStudies.includes(studyName.toLowerCase())) continue;

    const matched = (modalities || []).find(
      (m: any) => m.name.toLowerCase().includes(studyName.toLowerCase()) ||
        studyName.toLowerCase().includes(m.modality_type?.toLowerCase() || "")
    );

    const radOrderedAt = new Date().toISOString();
    const modalityType =
      master?.modality_type || matched?.modality_type || fallbackModality?.modality_type || "X-Ray";

    // PCPNDT: decided by the shared rule, not by an inline substring test. An obstetric
    // ultrasound ordered from an OPD consultation previously reached this insert with neither
    // the flag nor a Form F — a statutory gap, not a reporting one (BUG-P4-002).
    // Judged on the CANONICAL name: "obs scan" carries no keyword the rule can see, and the
    // statutory obligation cannot depend on how the doctor abbreviated it.
    const isPcpndt = requiresPcpndtFormF({
      studyName,
      modalityType,
      requiresFormF: master?.requires_form_f ?? null,
    });

    const { data: newRad, error } = await (supabase as any)
      .from("radiology_orders")
      .insert({
        hospital_id: opts.hospitalId,
        patient_id: opts.patientId,
        ordered_by: opts.orderedBy,
        encounter_id: opts.encounterId || null,
        admission_id: opts.admissionId || null,
        study_name: studyName,
        modality_id: matched?.id || fallbackModality?.id || null,
        modality_type: modalityType,
        priority: item.urgency || "routine",
        indication: item.clinical_indication || null,
        status: "ordered",
        billing_status: "unbilled",
        is_pcpndt: isPcpndt,
        ordered_at: radOrderedAt,
      })
      .select("id")
      .maybeSingle();

    if (error || !newRad) {
      console.error("Radiology order insert failed:", error?.message);
      continue;
    }

    // The empty report row MUST exist before the radiologist opens the study.
    // RadiologyReportingWorkspace loads `report` and returns early from both saveDraft and
    // validateAndSign when it is missing, so an order created without this stub cannot be
    // reported at all — the scan is performed and the result never reaches the doctor who
    // ordered it. NewRadiologyOrderModal has always created it; this path did not, which is
    // why investigations ordered from an OPD/IPD consultation never came back.
    const { error: reportErr } = await (supabase as any)
      .from("radiology_reports")
      .insert({
        hospital_id: opts.hospitalId,
        order_id: newRad.id,
        patient_id: opts.patientId,
      });
    if (reportErr) {
      console.error(
        `Radiology report stub creation FAILED for order ${newRad.id} (${studyName}): ` +
          `${reportErr.message}. This study cannot be reported until a report row exists.`
      );
    }

    if (isPcpndt) {
      // A Form F failure must be loud. The order exists and the scan will be performed, so a
      // silently missing register entry is exactly the situation the PCPNDT Act penalises —
      // surfacing it lets the radiologist complete the form before the scan rather than
      // discover the gap at inspection.
      const patient = await loadFormFPatient();
      const { error: formFErr } = await (supabase as any)
        .from("pcpndt_form_f")
        .insert(
          buildFormFRow({
            hospitalId: opts.hospitalId,
            orderId: newRad.id as string,
            patientName: patient.full_name,
            patientAge: ageFromDob(patient.dob),
            patientAddress: patient.address,
            indication: item.clinical_indication || null,
            signedBy: opts.orderedBy,
            referredBy: opts.orderedBy,
          })
        );
      if (formFErr) {
        console.error(
          `PCPNDT Form F creation FAILED for order ${newRad.id} (${studyName}): ` +
            `${formFErr.message}. This scan is legally required to have one.`
        );
      }
      await logNABHEvidence(
        opts.hospitalId,
        "COP.6",
        `PCPNDT Form F raised for obstetric ultrasound: ${studyName}`,
        formFErr ? "non_compliant" : "compliant"
      );
    }

    await logNABHEvidence(
      opts.hospitalId,
      "COP.6",
      `Radiology investigation ordered: ${studyName} for encounter ${opts.encounterId || opts.admissionId || "unknown"}`,
      "compliant"
    );

    created++;
    orderIds.push(newRad.id as string);
    existingStudies.push(studyName.toLowerCase());
  }

  return { created, orderIds, unmatched };
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
