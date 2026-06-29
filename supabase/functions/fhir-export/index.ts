import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── FHIR R4 resource builders ────────────────────────────────────────────────

function fhirPatient(p: Record<string, unknown>, abhaProfile?: Record<string, unknown> | null) {
  const identifiers: unknown[] = [];
  const abhaNumber = (abhaProfile?.abha_number ?? p.abha_id) as string | null;
  const abhaAddress = abhaProfile?.abha_address as string | null;
  if (abhaNumber) identifiers.push({ system: "https://healthid.ndhm.gov.in", value: abhaNumber });
  if (abhaAddress) identifiers.push({ system: "https://abha.abdm.gov.in/api/v3", value: abhaAddress });
  identifiers.push({ system: "urn:hospital:uhid", value: (p.uhid ?? p.id) as string });
  return {
    resourceType: "Patient",
    id: p.id as string,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"] },
    identifier: identifiers,
    name: [{ use: "official", text: p.full_name as string }],
    telecom: p.phone ? [{ system: "phone", value: p.phone as string, use: "mobile" }] : [],
    gender: p.gender === "male" ? "male" : p.gender === "female" ? "female" : "unknown",
    birthDate: (p.dob as string) || undefined,
  };
}

function fhirPractitioner(doctor: Record<string, unknown>) {
  const id = (doctor.id ?? `prac-${crypto.randomUUID()}`) as string;
  return {
    resourceType: "Practitioner",
    id,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner"] },
    identifier: doctor.hpr_id
      ? [{ system: "https://hpr.abdm.gov.in", value: doctor.hpr_id as string }]
      : [],
    name: [{ use: "official", text: (doctor.full_name ?? "Unknown Doctor") as string }],
  };
}

function fhirEncounterOpd(enc: Record<string, unknown>, patientId: string, practitionerId: string) {
  return {
    resourceType: "Encounter",
    id: enc.id as string,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: [{ coding: [{ system: "http://snomed.info/sct", code: "11429006", display: "Consultation" }] }],
    subject: { reference: `Patient/${patientId}` },
    participant: [{ individual: { reference: `Practitioner/${practitionerId}` } }],
    period: { start: (enc.created_at ?? enc.visit_date) as string },
    reasonCode: enc.chief_complaint
      ? [{ text: enc.chief_complaint as string }]
      : [],
  };
}

function fhirCondition(
  id: string,
  diagnosisText: string,
  icd10Code: string | null,
  patientId: string,
  encounterId: string,
  isPrimary = false,
) {
  return {
    resourceType: "Condition",
    id,
    clinicalStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
    },
    verificationStatus: {
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }],
    },
    category: [{
      coding: [{ system: "http://snomed.info/sct", code: isPrimary ? "439401001" : "404684003", display: isPrimary ? "Diagnosis" : "Clinical finding" }],
    }],
    code: {
      coding: icd10Code
        ? [{ system: "http://hl7.org/fhir/sid/icd-10", code: icd10Code, display: diagnosisText }]
        : [],
      text: diagnosisText,
    },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
  };
}

function fhirMedicationRequest(
  id: string,
  drug: Record<string, unknown>,
  patientId: string,
  practitionerId: string,
  encounterId?: string,
) {
  const resource: Record<string, unknown> = {
    resourceType: "MedicationRequest",
    id,
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: [],
      text: drug.drug_name as string,
    },
    subject: { reference: `Patient/${patientId}` },
    requester: { reference: `Practitioner/${practitionerId}` },
    dosageInstruction: [{
      text: [drug.dose, drug.frequency, drug.route, drug.duration_days ? `for ${drug.duration_days} days` : ""]
        .filter(Boolean).join(", "),
      route: drug.route
        ? { coding: [], text: drug.route as string }
        : undefined,
    }],
  };
  if (encounterId) resource.encounter = { reference: `Encounter/${encounterId}` };
  if (drug.instructions) {
    (resource.dosageInstruction as Record<string, unknown>[])[0].patientInstruction = drug.instructions;
  }
  return resource;
}

function fhirObservation(
  id: string,
  item: Record<string, unknown>,
  patientId: string,
  reportId: string,
  orderedAt: string,
) {
  const flagMap: Record<string, { code: string; display: string }> = {
    H: { code: "H", display: "High" },
    L: { code: "L", display: "Low" },
    N: { code: "N", display: "Normal" },
    CH: { code: "HH", display: "Critical High" },
    CL: { code: "LL", display: "Critical Low" },
  };
  const flag = (item.result_flag as string) ?? "N";
  const testMaster = item.lab_test_master as Record<string, unknown> | null;
  const testName = (testMaster?.test_name ?? item.test_name ?? "Lab Test") as string;
  const testCode = testMaster?.test_code as string | null;

  const obs: Record<string, unknown> = {
    resourceType: "Observation",
    id,
    status: "final",
    category: [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "laboratory",
        display: "Laboratory",
      }],
    }],
    code: {
      coding: testCode
        ? [{ system: "http://loinc.org", code: testCode, display: testName }]
        : [],
      text: testName,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: orderedAt,
    issued: orderedAt,
    basedOn: [{ reference: `DiagnosticReport/${reportId}` }],
  };

  if (item.result_numeric != null) {
    obs.valueQuantity = {
      value: item.result_numeric as number,
      unit: (item.result_unit ?? "") as string,
      system: "http://unitsofmeasure.org",
    };
    if (item.result_unit) (obs.valueQuantity as Record<string, unknown>).code = item.result_unit;
  } else if (item.result_value) {
    obs.valueString = item.result_value as string;
  }

  if (item.reference_range) {
    obs.referenceRange = [{ text: item.reference_range as string }];
  }

  if (flagMap[flag]) {
    obs.interpretation = [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
        code: flagMap[flag].code,
        display: flagMap[flag].display,
      }],
    }];
  }
  return obs;
}

function fhirDiagnosticReportLab(
  orderId: string,
  order: Record<string, unknown>,
  observations: string[],
  patientId: string,
  practitionerId: string,
) {
  return {
    resourceType: "DiagnosticReport",
    id: orderId,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab"] },
    status: "final",
    category: [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/v2-0074",
        code: "LAB",
        display: "Laboratory",
      }],
    }],
    code: { text: "Laboratory Report" },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: (order.order_date ?? order.created_at) as string,
    issued: ((order.validated_at as string) ?? (order.created_at as string)),
    performer: [{ reference: `Practitioner/${practitionerId}` }],
    result: observations.map((obsId) => ({ reference: `Observation/${obsId}` })),
  };
}

function fhirDiagnosticReportRadiology(
  orderId: string,
  order: Record<string, unknown>,
  report: Record<string, unknown>,
  patientId: string,
  practitionerId: string,
) {
  return {
    resourceType: "DiagnosticReport",
    id: orderId,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportImaging"] },
    status: "final",
    category: [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/v2-0074",
        code: "RAD",
        display: "Radiology",
      }],
    }],
    code: {
      coding: [],
      text: (order.study_name ?? "Radiology Study") as string,
    },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: (order.order_date ?? order.created_at) as string,
    issued: (report.validated_at ?? report.reported_at ?? order.created_at) as string,
    performer: [{ reference: `Practitioner/${practitionerId}` }],
    conclusion: (report.impression ?? "") as string,
    presentedForm: report.findings
      ? [{
          contentType: "text/plain",
          data: btoa(unescape(encodeURIComponent(report.findings as string))),
          title: "Findings",
        }]
      : [],
  };
}

function makeBundle(
  type: "document" | "collection",
  id: string,
  entries: unknown[],
  timestamp: string,
  identifier?: { system: string; value: string },
): Record<string, unknown> {
  const bundle: Record<string, unknown> = {
    resourceType: "Bundle",
    id: `bundle-${id}`,
    meta: {
      lastUpdated: timestamp,
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle"],
    },
    type,
    timestamp,
    entry: (entries as Record<string, unknown>[]).map((r) => ({
      fullUrl: `urn:uuid:${(r as Record<string, unknown>).id as string}`,
      resource: r,
    })),
  };
  if (identifier) bundle.identifier = identifier;
  return bundle;
}

function opdComposition(
  encounterId: string,
  patientId: string,
  practitionerId: string,
  enc: Record<string, unknown>,
  conditionIds: string[],
  medIds: string[],
) {
  const sections: unknown[] = [];
  if (enc.chief_complaint) {
    sections.push({
      title: "Chief Complaint",
      code: { coding: [{ system: "http://snomed.info/sct", code: "422843007", display: "Chief complaint" }] },
      text: { status: "generated", div: `<div>${enc.chief_complaint}</div>` },
    });
  }
  if (conditionIds.length) {
    sections.push({
      title: "Diagnoses",
      code: { coding: [{ system: "http://loinc.org", code: "29548-5", display: "Diagnosis" }] },
      entry: conditionIds.map((id) => ({ reference: `Condition/${id}` })),
    });
  }
  if (medIds.length) {
    sections.push({
      title: "Medications Prescribed",
      code: { coding: [{ system: "http://loinc.org", code: "10160-0", display: "History of medication use" }] },
      entry: medIds.map((id) => ({ reference: `MedicationRequest/${id}` })),
    });
  }
  if (enc.soap_assessment || enc.soap_plan) {
    sections.push({
      title: "Assessment & Plan",
      code: { coding: [{ system: "http://loinc.org", code: "51847-2", display: "Evaluation + Plan" }] },
      text: {
        status: "generated",
        div: `<div>${[enc.soap_assessment, enc.soap_plan].filter(Boolean).join(" | ")}</div>`,
      },
    });
  }
  return {
    resourceType: "Composition",
    id: `comp-${encounterId}`,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultationRecord"] },
    status: "final",
    type: {
      coding: [{ system: "http://snomed.info/sct", code: "371530004", display: "Clinical consultation report" }],
    },
    subject: { reference: `Patient/${patientId}` },
    date: (enc.created_at ?? enc.visit_date) as string,
    author: [{ reference: `Practitioner/${practitionerId}` }],
    title: "OPD Consultation",
    section: sections,
  };
}

function dischargeComposition(
  admissionId: string,
  patientId: string,
  practitionerId: string,
  adm: Record<string, unknown>,
  conditionIds: string[],
  medIds: string[],
  labReportIds: string[],
  radioReportIds: string[],
) {
  const sections: unknown[] = [];
  if (adm.admitting_diagnosis) {
    sections.push({
      title: "Admitting Diagnosis",
      code: { coding: [{ system: "http://snomed.info/sct", code: "439401001", display: "Diagnosis" }] },
      text: { status: "generated", div: `<div>${adm.admitting_diagnosis}</div>` },
    });
  }
  if (conditionIds.length) {
    sections.push({
      title: "Discharge Diagnosis",
      code: { coding: [{ system: "http://loinc.org", code: "29548-5", display: "Diagnosis" }] },
      entry: conditionIds.map((id) => ({ reference: `Condition/${id}` })),
    });
  }
  if (medIds.length) {
    sections.push({
      title: "Medications on Discharge",
      code: { coding: [{ system: "http://loinc.org", code: "10160-0", display: "History of medication use" }] },
      entry: medIds.map((id) => ({ reference: `MedicationRequest/${id}` })),
    });
  }
  if (labReportIds.length) {
    sections.push({
      title: "Laboratory Investigations",
      code: { coding: [{ system: "http://loinc.org", code: "30954-2", display: "Lab studies" }] },
      entry: labReportIds.map((id) => ({ reference: `DiagnosticReport/${id}` })),
    });
  }
  if (radioReportIds.length) {
    sections.push({
      title: "Radiology Investigations",
      code: { coding: [{ system: "http://loinc.org", code: "18748-4", display: "Diagnostic imaging study" }] },
      entry: radioReportIds.map((id) => ({ reference: `DiagnosticReport/${id}` })),
    });
  }
  if (adm.discharge_notes) {
    sections.push({
      title: "Discharge Summary",
      code: { coding: [{ system: "http://loinc.org", code: "18842-5", display: "Discharge summary" }] },
      text: { status: "generated", div: `<div>${adm.discharge_notes}</div>` },
    });
  }
  return {
    resourceType: "Composition",
    id: `comp-${admissionId}`,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord"] },
    status: "final",
    type: {
      coding: [{ system: "http://loinc.org", code: "18842-5", display: "Discharge summary" }],
    },
    subject: { reference: `Patient/${patientId}` },
    date: (adm.discharged_at ?? adm.admitted_at) as string,
    author: [{ reference: `Practitioner/${practitionerId}` }],
    title: "Discharge Summary",
    section: sections,
  };
}

// ─── Action handlers ──────────────────────────────────────────────────────────

async function buildOpdConsultation(
  sb: ReturnType<typeof createClient>,
  sourceId: string,
  hospitalId: string,
): Promise<Record<string, unknown>> {
  const { data: enc } = await sb
    .from("opd_encounters")
    .select("*, doctor:users!opd_encounters_doctor_id_fkey(id, full_name, hpr_id), patients(id, full_name, uhid, dob, gender, phone, abha_id)")
    .eq("id", sourceId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (!enc) throw new Error(`OPD encounter not found: ${sourceId}`);

  const patient = enc.patients as Record<string, unknown>;
  const doctor = enc.doctor as Record<string, unknown>;

  // ABHA profile for richer identifiers
  const { data: abhaProfile } = await sb
    .from("patient_abha_profiles")
    .select("abha_number, abha_address")
    .eq("patient_id", patient.id as string)
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  // Diagnoses
  const { data: diagnosesRaw } = await sb
    .from("opd_diagnoses")
    .select("id, diagnosis_text, icd10_code, is_primary")
    .eq("encounter_id", sourceId);
  const diagnoses = diagnosesRaw ?? [];

  // Inline encounter.diagnosis as fallback if no opd_diagnoses rows
  const allDiagnoses = diagnoses.length > 0
    ? diagnoses
    : (enc.diagnosis ? [{ id: `diag-${sourceId}`, diagnosis_text: enc.diagnosis, icd10_code: enc.icd10_code, is_primary: true }] : []);

  // Prescriptions
  const { data: prescRaw } = await sb
    .from("prescriptions")
    .select("id, drugs")
    .eq("encounter_id", sourceId)
    .eq("hospital_id", hospitalId)
    .order("created_at", { ascending: false })
    .limit(1);
  const drugs: Record<string, unknown>[] = Array.isArray(prescRaw?.[0]?.drugs) ? (prescRaw![0].drugs as Record<string, unknown>[]) : [];

  const now = new Date().toISOString();
  const patientRes = fhirPatient(patient, abhaProfile);
  const practRes = fhirPractitioner(doctor);
  const encRes = fhirEncounterOpd(enc as Record<string, unknown>, patient.id as string, practRes.id);

  const conditionResources = (allDiagnoses as Record<string, unknown>[]).map((d, i) =>
    fhirCondition(
      `cond-${sourceId}-${i}`,
      d.diagnosis_text as string,
      (d.icd10_code as string) ?? null,
      patient.id as string,
      enc.id as string,
      !!(d.is_primary),
    )
  );

  const medResources = drugs.map((drug, i) =>
    fhirMedicationRequest(
      `med-${sourceId}-${i}`,
      drug,
      patient.id as string,
      practRes.id,
      enc.id as string,
    )
  );

  const comp = opdComposition(
    enc.id as string,
    patient.id as string,
    practRes.id,
    enc as Record<string, unknown>,
    conditionResources.map((c) => c.id),
    medResources.map((m) => m.id as string),
  );

  const entries = [comp, patientRes, practRes, encRes, ...conditionResources, ...medResources];
  return makeBundle("document", sourceId, entries, (enc.created_at as string) ?? now, {
    system: "urn:aumrti:encounter",
    value: sourceId,
  });
}

async function buildDischargeSummary(
  sb: ReturnType<typeof createClient>,
  sourceId: string,
  hospitalId: string,
): Promise<Record<string, unknown>> {
  const { data: adm } = await sb
    .from("admissions")
    .select("*, patients(id, full_name, uhid, dob, gender, phone, abha_id), wards(name), beds(bed_number), doctor:users!admissions_admitting_doctor_id_fkey(id, full_name, hpr_id)")
    .eq("id", sourceId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (!adm) throw new Error(`Admission not found: ${sourceId}`);

  const patient = adm.patients as Record<string, unknown>;
  const doctor = adm.doctor as Record<string, unknown>;

  const { data: abhaProfile } = await sb
    .from("patient_abha_profiles")
    .select("abha_number, abha_address")
    .eq("patient_id", patient.id as string)
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  // Primary ICD coding
  const { data: icdCoding } = await (sb as ReturnType<typeof createClient> & { from: unknown })
    .from("icd_codings")
    .select("primary_icd_code, primary_icd_desc")
    .eq("visit_id", sourceId)
    .eq("visit_type", "ipd")
    .maybeSingle();

  // IPD medications
  const { data: meds } = await (sb as ReturnType<typeof createClient> & { from: unknown })
    .from("ipd_medications")
    .select("drug_name, dose, route, frequency, start_date")
    .eq("admission_id", sourceId)
    .eq("is_active", true);

  // Lab orders (completed)
  const { data: labOrders } = await sb
    .from("lab_orders")
    .select("id, order_date, created_at, validated_at, lab_order_items(id, result_value, result_numeric, result_unit, result_flag, reference_range, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name, test_code))")
    .eq("admission_id", sourceId)
    .eq("hospital_id", hospitalId)
    .eq("status", "completed");

  // Radiology orders (validated)
  const { data: radioOrders } = await sb
    .from("radiology_orders")
    .select("id, study_name, order_date, created_at, radiology_reports(findings, impression, validated_at, reported_at)")
    .eq("admission_id", sourceId)
    .eq("hospital_id", hospitalId)
    .in("status", ["validated", "reported"]);

  const now = new Date().toISOString();
  const patientRes = fhirPatient(patient, abhaProfile);
  const practRes = fhirPractitioner(doctor);

  // Admission encounter resource
  const admEnc = {
    resourceType: "Encounter",
    id: `enc-${sourceId}`,
    status: "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "IMP", display: "inpatient encounter" },
    subject: { reference: `Patient/${patient.id as string}` },
    participant: [{ individual: { reference: `Practitioner/${practRes.id}` } }],
    period: {
      start: adm.admitted_at as string,
      end: adm.discharged_at as string ?? undefined,
    },
    location: [{ location: { display: [(adm.wards as Record<string, unknown>)?.name, (adm.beds as Record<string, unknown>)?.bed_number].filter(Boolean).join(" — ") } }],
  };

  // Discharge diagnosis conditions
  const conditionResources: ReturnType<typeof fhirCondition>[] = [];
  if (icdCoding?.primary_icd_code) {
    conditionResources.push(fhirCondition(
      `cond-${sourceId}-0`,
      (icdCoding.primary_icd_desc as string) ?? icdCoding.primary_icd_code as string,
      icdCoding.primary_icd_code as string,
      patient.id as string,
      admEnc.id,
      true,
    ));
  }
  if (!conditionResources.length && adm.admitting_diagnosis) {
    conditionResources.push(fhirCondition(
      `cond-${sourceId}-0`,
      adm.admitting_diagnosis as string,
      null,
      patient.id as string,
      admEnc.id,
      true,
    ));
  }

  // Medication resources from ipd_medications
  const medResources = ((meds ?? []) as Record<string, unknown>[]).map((m, i) =>
    fhirMedicationRequest(
      `med-${sourceId}-${i}`,
      { drug_name: m.drug_name, dose: m.dose, frequency: m.frequency, route: m.route },
      patient.id as string,
      practRes.id,
    )
  );

  // Lab DiagnosticReport + Observation resources
  const labEntries: unknown[] = [];
  const labReportIds: string[] = [];
  for (const lo of (labOrders ?? []) as Record<string, unknown>[]) {
    const items = (lo.lab_order_items as Record<string, unknown>[]) ?? [];
    const obsIds: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const obsId = `obs-${lo.id as string}-${i}`;
      labEntries.push(fhirObservation(obsId, items[i], patient.id as string, lo.id as string, (lo.order_date ?? lo.created_at) as string));
      obsIds.push(obsId);
    }
    labEntries.push(fhirDiagnosticReportLab(lo.id as string, lo, obsIds, patient.id as string, practRes.id));
    labReportIds.push(lo.id as string);
  }

  // Radiology DiagnosticReport resources
  const radioEntries: unknown[] = [];
  const radioReportIds: string[] = [];
  for (const ro of (radioOrders ?? []) as Record<string, unknown>[]) {
    const report = Array.isArray(ro.radiology_reports) ? (ro.radiology_reports as Record<string, unknown>[])[0] : (ro.radiology_reports as Record<string, unknown> | null);
    if (report) {
      radioEntries.push(fhirDiagnosticReportRadiology(ro.id as string, ro, report, patient.id as string, practRes.id));
      radioReportIds.push(ro.id as string);
    }
  }

  const comp = dischargeComposition(
    sourceId,
    patient.id as string,
    practRes.id,
    adm as Record<string, unknown>,
    conditionResources.map((c) => c.id),
    medResources.map((m) => m.id as string),
    labReportIds,
    radioReportIds,
  );

  const entries = [comp, patientRes, practRes, admEnc, ...conditionResources, ...medResources, ...labEntries, ...radioEntries];
  return makeBundle("document", sourceId, entries, (adm.discharged_at ?? adm.admitted_at) as string ?? now, {
    system: "urn:aumrti:admission",
    value: sourceId,
  });
}

async function buildLabReport(
  sb: ReturnType<typeof createClient>,
  sourceId: string,
  hospitalId: string,
): Promise<Record<string, unknown>> {
  const { data: order } = await sb
    .from("lab_orders")
    .select("id, order_date, created_at, validated_at, clinical_notes, patient_id, patients(id, full_name, uhid, dob, gender, phone, abha_id), ordered_by_user:users!lab_orders_ordered_by_fkey(id, full_name, hpr_id), validated_by_user:users!lab_orders_validated_by_fkey(id, full_name, hpr_id), lab_order_items(id, result_value, result_numeric, result_unit, result_flag, reference_range, notes, lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name, test_code, normal_min, normal_max))")
    .eq("id", sourceId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (!order) throw new Error(`Lab order not found: ${sourceId}`);

  const patient = order.patients as Record<string, unknown>;
  const doctor = (order.validated_by_user ?? order.ordered_by_user) as Record<string, unknown>;

  const { data: abhaProfile } = await sb
    .from("patient_abha_profiles")
    .select("abha_number, abha_address")
    .eq("patient_id", patient.id as string)
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  const patientRes = fhirPatient(patient, abhaProfile);
  const practRes = fhirPractitioner(doctor ?? { id: "unknown", full_name: "Unknown" });
  const items = (order.lab_order_items as Record<string, unknown>[]) ?? [];
  const orderedAt = (order.order_date ?? order.created_at) as string;

  const obsResources = items.map((item, i) =>
    fhirObservation(`obs-${sourceId}-${i}`, item, patient.id as string, sourceId, orderedAt)
  );

  const reportRes = fhirDiagnosticReportLab(
    sourceId,
    order as Record<string, unknown>,
    obsResources.map((o) => o.id),
    patient.id as string,
    practRes.id,
  );

  const entries = [reportRes, patientRes, practRes, ...obsResources];
  return makeBundle("collection", sourceId, entries, orderedAt);
}

async function buildRadiologyReport(
  sb: ReturnType<typeof createClient>,
  sourceId: string,
  hospitalId: string,
): Promise<Record<string, unknown>> {
  const { data: order } = await sb
    .from("radiology_orders")
    .select("id, study_name, modality_type, order_date, created_at, accession_number, body_part, clinical_history, patient_id, patients(id, full_name, uhid, dob, gender, phone, abha_id), ordered_by_user:users!radiology_orders_ordered_by_fkey(id, full_name, hpr_id), radiology_reports(findings, impression, technique, is_signed, reported_at, validated_at, is_critical, critical_finding)")
    .eq("id", sourceId)
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  if (!order) throw new Error(`Radiology order not found: ${sourceId}`);

  const patient = order.patients as Record<string, unknown>;
  const doctor = order.ordered_by_user as Record<string, unknown>;
  const report = Array.isArray(order.radiology_reports)
    ? (order.radiology_reports as Record<string, unknown>[])[0]
    : (order.radiology_reports as Record<string, unknown> | null);

  if (!report) throw new Error(`No radiology report found for order: ${sourceId}`);

  const { data: abhaProfile } = await sb
    .from("patient_abha_profiles")
    .select("abha_number, abha_address")
    .eq("patient_id", patient.id as string)
    .eq("hospital_id", hospitalId)
    .maybeSingle();

  const patientRes = fhirPatient(patient, abhaProfile);
  const practRes = fhirPractitioner(doctor ?? { id: "unknown", full_name: "Unknown" });
  const reportRes = fhirDiagnosticReportRadiology(sourceId, order as Record<string, unknown>, report, patient.id as string, practRes.id);

  // ImagingStudy stub (DICOM if available)
  const imagingStudy = {
    resourceType: "ImagingStudy",
    id: `imaging-${sourceId}`,
    status: "available",
    subject: { reference: `Patient/${patient.id as string}` },
    started: (order.order_date ?? order.created_at) as string,
    description: [(order.study_name as string), (order.body_part as string)].filter(Boolean).join(" — "),
    ...(order.accession_number ? { identifier: [{ system: "urn:dicom:uid", value: order.accession_number as string }] } : {}),
    basedOn: [{ reference: `DiagnosticReport/${sourceId}` }],
  };

  const entries = [reportRes, patientRes, practRes, imagingStudy];
  return makeBundle("collection", sourceId, entries, (order.order_date ?? order.created_at) as string);
}

// ─── Legacy patient-level export (backward compat) ────────────────────────────

function legacyPatientToFHIR(p: Record<string, unknown>, hospital: Record<string, unknown> | null) {
  return {
    resourceType: "Patient",
    id: p.id as string,
    identifier: [
      { system: "https://healthid.ndhm.gov.in", value: (p.abha_id ?? "") as string },
      { system: `urn:hospital:${(hospital?.id ?? "unknown")}:uhid`, value: (p.uhid ?? p.id) as string },
    ],
    name: [{ use: "official", text: p.full_name as string }],
    telecom: p.phone ? [{ system: "phone", value: p.phone as string }] : [],
    gender: p.gender === "male" ? "male" : p.gender === "female" ? "female" : "unknown",
    birthDate: (p.dob as string) || undefined,
  };
}

function legacyEncounterToFHIR(enc: Record<string, unknown>, patientId: string) {
  return {
    resourceType: "Encounter",
    id: enc.id as string,
    status: enc.status === "completed" ? "finished" : "in-progress",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    subject: { reference: `Patient/${patientId}` },
    period: { start: enc.created_at as string },
    reasonCode: enc.diagnosis ? [{ text: enc.diagnosis as string }] : [],
  };
}

// ─── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/fhir+json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { /* GET-style */ }
    }
    const url = new URL(req.url);
    const patientIdParam = url.searchParams.get("patient_id") ?? body.patient_id as string | null;
    const action = body.action as string | null;

    // ── New action-based mode ──────────────────────────────────────────────
    if (action) {
      const sourceId = body.source_id as string;
      const hospitalId = body.hospital_id as string;
      if (!sourceId || !hospitalId) {
        return json({ error: "source_id and hospital_id required" }, 400);
      }

      let bundle: Record<string, unknown>;
      switch (action) {
        case "opd_consultation":
          bundle = await buildOpdConsultation(sb, sourceId, hospitalId);
          break;
        case "discharge_summary":
          bundle = await buildDischargeSummary(sb, sourceId, hospitalId);
          break;
        case "lab_report":
          bundle = await buildLabReport(sb, sourceId, hospitalId);
          break;
        case "radiology_report":
          bundle = await buildRadiologyReport(sb, sourceId, hospitalId);
          break;
        default:
          return json({ error: `Unknown action: ${action}` }, 400);
      }

      // Optionally cache in care context
      const ccRef = body.care_context_reference as string | null;
      if (ccRef) {
        await sb
          .from("abdm_care_contexts")
          .update({ fhir_bundle: bundle })
          .eq("reference", ccRef)
          .eq("hospital_id", hospitalId);
      }

      return json({ bundle });
    }

    // ── Legacy patient-level mode ─────────────────────────────────────────
    if (!patientIdParam) {
      return json({ error: "patient_id or action required" }, 400);
    }
    if (!authHeader) return json({ error: "Authorization required" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return json({ error: "Invalid authorization" }, 401);

    const { data: callerProfile } = await sb
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!callerProfile?.hospital_id) return json({ error: "Caller hospital not found" }, 403);

    const { data: patient } = await sb
      .from("patients")
      .select("*")
      .eq("id", patientIdParam)
      .eq("hospital_id", callerProfile.hospital_id)
      .maybeSingle();
    if (!patient) return json({ error: "Patient not found" }, 404);

    const { data: hospital } = await sb.from("hospitals").select("id, name").eq("id", (patient as Record<string, unknown>).hospital_id as string).maybeSingle();
    const { data: encounters } = await sb
      .from("opd_encounters")
      .select("*")
      .eq("patient_id", patientIdParam)
      .eq("hospital_id", callerProfile.hospital_id)
      .order("created_at", { ascending: false })
      .limit(10);

    const entries: unknown[] = [];
    entries.push({ resource: legacyPatientToFHIR(patient as Record<string, unknown>, hospital as Record<string, unknown> | null) });
    for (const enc of (encounters ?? []) as Record<string, unknown>[]) {
      entries.push({ resource: legacyEncounterToFHIR(enc, patientIdParam) });
    }

    const bundle = {
      resourceType: "Bundle",
      id: `bundle-${patientIdParam}-${Date.now()}`,
      type: "document",
      timestamp: new Date().toISOString(),
      entry: (entries as { resource: Record<string, unknown> }[]).map((e) => ({
        fullUrl: `urn:uuid:${e.resource.id as string}`,
        resource: e.resource,
      })),
    };

    return json(bundle);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
