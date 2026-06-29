// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer",
  "Content-Type": "application/fhir+json; charset=utf-8",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" };

const sb = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const BASE_URL = Deno.env.get("FHIR_BASE_URL") || "https://api.aumrti.in/fhir";

// ── Resource Builders ────────────────────────────────────────────────────────

function buildPatientResource(p: any) {
  const identifiers: any[] = [{ system: "urn:aumrti:uhid", value: p.uhid }];
  if (p.abha_id) identifiers.push({ system: "https://ndhm.gov.in/id", value: p.abha_id });
  return {
    resourceType: "Patient",
    id: p.id,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"] },
    identifier: identifiers,
    name: [{ use: "official", text: p.full_name }],
    gender: p.gender === "male" ? "male" : p.gender === "female" ? "female" : "unknown",
    birthDate: p.dob || undefined,
    telecom: [
      ...(p.phone ? [{ system: "phone", value: p.phone, use: "mobile" }] : []),
      ...(p.email ? [{ system: "email", value: p.email }] : []),
    ],
    address: p.address ? [{ text: p.address, country: "IN" }] : [],
  };
}

function buildObservation(lab: any, patientId: string) {
  return {
    resourceType: "Observation",
    id: lab.id,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationBodyMeasurement"] },
    status: lab.status === "resulted" ? "final" : "registered",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory", display: "Laboratory" }] }],
    code: { coding: lab.loinc_code ? [{ system: "http://loinc.org", code: lab.loinc_code }] : [], text: lab.test_name || "Laboratory Result" },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: lab.resulted_at || lab.created_at,
    valueQuantity: lab.result_value && lab.result_unit ? { value: parseFloat(lab.result_value), unit: lab.result_unit } : undefined,
    valueString: !lab.result_unit && lab.result_value ? String(lab.result_value) : undefined,
    referenceRange: lab.reference_range ? [{ text: lab.reference_range }] : undefined,
    interpretation: lab.is_critical ? [{ coding: [{ code: "H", display: "High" }] }] : undefined,
  };
}

function buildDiagnosticReport(labOrder: any, patientId: string, items: any[]) {
  return {
    resourceType: "DiagnosticReport",
    id: labOrder.id,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab"] },
    status: labOrder.status === "resulted" ? "final" : "partial",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "LAB" }] }],
    code: { text: labOrder.test_panel || "Laboratory Report" },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: labOrder.resulted_at || labOrder.created_at,
    issued: labOrder.resulted_at,
    result: items.map((i: any) => ({ reference: `Observation/${i.id}` })),
  };
}

function buildMedicationRequest(rx: any, patientId: string) {
  const items = rx.items || [];
  return items.map((item: any) => ({
    resourceType: "MedicationRequest",
    id: `${rx.id}-${item.drug_name?.replace(/\s/g, "-")}`,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest"] },
    status: "active",
    intent: "order",
    medicationCodeableConcept: {
      coding: item.rxnorm_code ? [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: item.rxnorm_code }] : [],
      text: item.drug_name,
    },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: rx.created_at,
    dosageInstruction: [{ text: `${item.dose || ""} ${item.route || ""} ${item.frequency || ""}`.trim() }],
  }));
}

function buildCondition(enc: any, patientId: string) {
  if (!enc.diagnosis) return null;
  return {
    resourceType: "Condition",
    id: `cond-${enc.id}`,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition"] },
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
    code: {
      coding: enc.icd10_code ? [{ system: "http://hl7.org/fhir/sid/icd-10", code: enc.icd10_code }] : [],
      text: enc.diagnosis,
    },
    subject: { reference: `Patient/${patientId}` },
    recordedDate: enc.created_at,
  };
}

function buildEncounter(enc: any, patientId: string) {
  return {
    resourceType: "Encounter",
    id: enc.id,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Encounter"] },
    status: enc.status || "finished",
    class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "ambulatory" },
    subject: { reference: `Patient/${patientId}` },
    period: { start: enc.created_at },
    reasonCode: enc.chief_complaint ? [{ text: enc.chief_complaint }] : [],
  };
}

function buildAllergyIntolerance(allergy: string, patientId: string, index: number) {
  return {
    resourceType: "AllergyIntolerance",
    id: `allergy-${patientId}-${index}`,
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance"] },
    clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }] },
    verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }] },
    patient: { reference: `Patient/${patientId}` },
    code: { text: allergy.trim() },
  };
}

function buildImmunization(vac: any, patientId: string) {
  return {
    resourceType: "Immunization",
    id: vac.id,
    status: "completed",
    vaccineCode: { text: vac.vaccine_name || vac.vaccine_type },
    patient: { reference: `Patient/${patientId}` },
    occurrenceDateTime: vac.administered_at || vac.created_at,
    lotNumber: vac.batch_number,
  };
}

function buildCapabilityStatement() {
  return {
    resourceType: "CapabilityStatement",
    id: "aumrti-fhir-server",
    url: `${BASE_URL}/metadata`,
    version: "4.0.1",
    name: "AumrtiHMSFHIRCapabilities",
    title: "Aumrti HMS FHIR R4 Server",
    status: "active",
    experimental: false,
    date: "2026-06-04",
    publisher: "Aumrti Health Technologies",
    description: "Aumrti HMS FHIR R4 server — ABDM PHR and NRCeS HIE compliant",
    kind: "instance",
    software: { name: "Aumrti HMS", version: "3.0" },
    implementation: { description: "Aumrti HMS FHIR Server", url: BASE_URL },
    fhirVersion: "4.0.1",
    format: ["application/fhir+json"],
    rest: [{
      mode: "server",
      security: {
        cors: true,
        service: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/restful-security-service", code: "SMART-on-FHIR" }] }],
        extension: [{
          url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
          extension: [
            { url: "token", valueUri: `${BASE_URL}/../auth/token` },
            { url: "authorize", valueUri: `${BASE_URL}/../auth/authorize` },
          ],
        }],
      },
      resource: [
        { type: "Patient",             versioning: "no-version", readHistory: false, updateCreate: false, interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "_id", type: "token" }, { name: "identifier", type: "token" }] },
        { type: "Observation",         versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "DiagnosticReport",    versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "Condition",           versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "Encounter",           versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "MedicationRequest",   versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "AllergyIntolerance",  versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "Immunization",        versioning: "no-version", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
      ],
      operation: [
        { name: "everything",   definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" },
        { name: "export",       definition: "http://hl7.org/fhir/uv/bulkdata/OperationDefinition/export" },
      ],
    }],
  };
}

// ── SMART on FHIR discovery ──────────────────────────────────────────────────
function buildSmartConfiguration() {
  return {
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/../auth/authorize`,
    token_endpoint: `${BASE_URL}/../auth/token`,
    token_endpoint_auth_methods_supported: ["private_key_jwt", "client_secret_basic"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    scopes_supported: ["openid", "fhirUser", "patient/*.read", "user/*.read", "system/*.read"],
    response_types_supported: ["code"],
    capabilities: ["launch-ehr", "sso-openid-connect", "context-ehr-patient", "permission-patient", "permission-user"],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/fhir-r4-server/, "");

  // ── SMART discovery ──────────────────────────────────────────────────────
  if (path === "/.well-known/smart-configuration") {
    return new Response(JSON.stringify(buildSmartConfiguration()), { headers: jsonHeaders });
  }

  // ── CapabilityStatement ──────────────────────────────────────────────────
  if (path === "/fhir/metadata" || path === "/metadata") {
    return new Response(JSON.stringify(buildCapabilityStatement()), { headers: corsHeaders });
  }

  try {
    const db = sb();

    // ── Bulk export: POST /fhir/$export ─────────────────────────────────────
    if ((path === "/fhir/$export" || path === "/$export") && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const hospitalId = body.hospital_id || url.searchParams.get("hospital_id");
      if (!hospitalId) return new Response(JSON.stringify({ error: "hospital_id required" }), { status: 400, headers: jsonHeaders });

      const [patientsRes, encountersRes, labRes, rxRes] = await Promise.all([
        db.from("patients").select("*").eq("hospital_id", hospitalId).limit(10000),
        db.from("opd_encounters").select("*").eq("hospital_id", hospitalId).limit(50000),
        db.from("lab_order_items").select("*, lab_orders!inner(hospital_id,patient_id,created_at)").eq("lab_orders.hospital_id", hospitalId).limit(50000),
        db.from("prescriptions").select("*").eq("hospital_id", hospitalId).limit(20000),
      ]);

      const patients = (patientsRes.data || []).map((p: any) => buildPatientResource(p));
      const encounters = (encountersRes.data || []).map((e: any) => buildEncounter(e, e.patient_id));
      const observations = (labRes.data || []).map((l: any) => buildObservation(l, l.lab_orders?.patient_id || "unknown"));
      const medications = (rxRes.data || []).flatMap((rx: any) => buildMedicationRequest(rx, rx.patient_id));

      const bundle = {
        resourceType: "Bundle",
        type: "transaction",
        timestamp: new Date().toISOString(),
        total: patients.length + encounters.length + observations.length + medications.length,
        entry: [
          ...patients.map((r: any) => ({ resource: r })),
          ...encounters.map((r: any) => ({ resource: r })),
          ...observations.map((r: any) => ({ resource: r })),
          ...medications.map((r: any) => ({ resource: r })),
        ],
      };
      return new Response(JSON.stringify(bundle), { headers: corsHeaders });
    }

    // ── GET /fhir/Patient/{id} ────────────────────────────────────────────
    const patientMatch = path.match(/^\/fhir\/Patient\/([^/$]+)$/);
    if (patientMatch && req.method === "GET") {
      const { data } = await db.from("patients").select("*").eq("id", patientMatch[1]).maybeSingle();
      if (!data) return new Response(JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found" }] }), { status: 404, headers: corsHeaders });
      return new Response(JSON.stringify(buildPatientResource(data)), { headers: corsHeaders });
    }

    // ── GET /fhir/Patient?identifier={abha_id} ──────────────────────────
    if (path === "/fhir/Patient" && url.searchParams.get("identifier")) {
      const identifier = url.searchParams.get("identifier")!;
      const { data } = await db.from("patients").select("*").eq("abha_id", identifier).limit(5);
      const resources = (data || []).map((p: any) => buildPatientResource(p));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/Patient/{id}/$everything ───────────────────────────────
    const everythingMatch = path.match(/^\/fhir\/Patient\/([^/$]+)\/\$everything$/);
    if (everythingMatch && req.method === "GET") {
      const patientId = everythingMatch[1];
      const [
        { data: patient },
        { data: encounters },
        { data: labOrders },
        { data: prescriptions },
        { data: admissions },
        { data: vaccinations },
      ] = await Promise.all([
        db.from("patients").select("*").eq("id", patientId).maybeSingle(),
        db.from("opd_encounters").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20),
        db.from("lab_order_items").select("*, lab_orders!inner(patient_id, created_at, hospital_id, status)").eq("lab_orders.patient_id", patientId).limit(50),
        db.from("prescriptions").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(10),
        db.from("admissions").select("*").eq("patient_id", patientId).order("admitted_at", { ascending: false }).limit(5),
        db.from("vaccination_records").select("*").eq("patient_id", patientId).limit(20).catch(() => ({ data: [] })),
      ]);

      if (!patient) return new Response(JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found" }] }), { status: 404, headers: corsHeaders });

      const allergies = patient.allergies
        ? String(patient.allergies).split(",").map((a: string, i: number) => buildAllergyIntolerance(a, patientId, i))
        : [];

      const entries: any[] = [
        { resource: buildPatientResource(patient) },
        ...(encounters || []).map((e: any) => ({ resource: buildEncounter(e, patientId) })),
        ...(encounters || []).map((e: any) => buildCondition(e, patientId)).filter(Boolean).map((r: any) => ({ resource: r })),
        ...(labOrders || []).map((l: any) => ({ resource: buildObservation(l, patientId) })),
        ...(prescriptions || []).flatMap((rx: any) => buildMedicationRequest(rx, patientId).map((r: any) => ({ resource: r }))),
        ...(allergies).map((r: any) => ({ resource: r })),
        ...((vaccinations as any[]) || []).map((v: any) => ({ resource: buildImmunization(v, patientId) })),
      ];

      return new Response(JSON.stringify({
        resourceType: "Bundle",
        type: "searchset",
        total: entries.length,
        entry: entries,
      }), { headers: corsHeaders });
    }

    // ── GET /fhir/AllergyIntolerance?patient={id} ─────────────────────────
    if (path.startsWith("/fhir/AllergyIntolerance") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("patients").select("allergies").eq("id", patientId).maybeSingle();
      const allergies = data?.allergies
        ? String(data.allergies).split(",").map((a: string, i: number) => buildAllergyIntolerance(a, patientId, i))
        : [];
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: allergies.length, entry: allergies.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/DiagnosticReport?patient={id} ──────────────────────────
    if (path.startsWith("/fhir/DiagnosticReport") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data: orders } = await db.from("lab_orders").select("*, lab_order_items(*)").eq("patient_id", patientId).limit(20);
      const resources = (orders || []).map((o: any) => buildDiagnosticReport(o, patientId, o.lab_order_items || []));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/Immunization?patient={id} ──────────────────────────────
    if (path.startsWith("/fhir/Immunization") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("vaccination_records").select("*").eq("patient_id", patientId).limit(30);
      const resources = (data || []).map((v: any) => buildImmunization(v, patientId));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/Condition?patient={id} ─────────────────────────────────
    if (path.startsWith("/fhir/Condition") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("opd_encounters").select("*").eq("patient_id", patientId).not("diagnosis", "is", null).limit(30);
      const resources = (data || []).map((e: any) => buildCondition(e, patientId)).filter(Boolean);
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/Observation?patient={id} ───────────────────────────────
    if (path.startsWith("/fhir/Observation") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("lab_order_items").select("*, lab_orders!inner(patient_id)").eq("lab_orders.patient_id", patientId).limit(50);
      const resources = (data || []).map((l: any) => buildObservation(l, patientId));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/MedicationRequest?patient={id} ─────────────────────────
    if (path.startsWith("/fhir/MedicationRequest") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("prescriptions").select("*").eq("patient_id", patientId).limit(20);
      const resources = (data || []).flatMap((rx: any) => buildMedicationRequest(rx, patientId));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── GET /fhir/Encounter?patient={id} ─────────────────────────────────
    if (path.startsWith("/fhir/Encounter") && req.method === "GET") {
      const patientId = url.searchParams.get("patient");
      if (!patientId) return new Response(JSON.stringify({ error: "patient param required" }), { status: 400, headers: jsonHeaders });
      const { data } = await db.from("opd_encounters").select("*").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(30);
      const resources = (data || []).map((e: any) => buildEncounter(e, patientId));
      return new Response(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: resources.length, entry: resources.map((r: any) => ({ resource: r })) }), { headers: corsHeaders });
    }

    // ── HCX Claim Bundle: POST /fhir/Claim ──────────────────────────────
    if (path === "/fhir/Claim" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return new Response(JSON.stringify({ error: "Bundle body required" }), { status: 400, headers: jsonHeaders });
      return new Response(JSON.stringify({
        resourceType: "ClaimResponse",
        id: crypto.randomUUID(),
        status: "active",
        type: body.type,
        use: "claim",
        patient: body.patient,
        created: new Date().toISOString(),
        outcome: "queued",
      }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "not-supported", diagnostics: `Path ${path} not supported. See /fhir/metadata for capabilities.` }],
    }), { status: 404, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "exception", diagnostics: String(err) }],
    }), { status: 500, headers: corsHeaders });
  }
});
