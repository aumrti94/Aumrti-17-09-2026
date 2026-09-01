/**
 * The route registry — the source of truth for the public API.
 *
 * A module exposes an API by adding an entry here. It does NOT write an HTTP handler. That is the
 * whole structural idea: consistency across 39 modules becomes a property of the system rather
 * than something reviewers have to catch. A developer cannot ship an endpoint with offset
 * pagination or a missing tenant predicate, because they never write either one.
 *
 * Two other things are generated from this file rather than maintained beside it:
 *   - the OpenAPI 3.1 spec (scripts/generate-openapi.mjs), so docs cannot drift from behaviour;
 *   - the CI completeness check, which fails the build on a route with no scope, no description,
 *     or PHI with no documented DPDP purpose.
 *
 * Contract: docs/api/API_DESIGN_STANDARD.md
 */

export type HttpMethod = "GET" | "POST" | "PATCH";

export type FilterOp = "eq" | "gte" | "lte" | "ilike";

export interface FilterDef {
  /** Query-string parameter name, e.g. "created_after". */
  param: string;
  column: string;
  op: FilterOp;
  description: string;
}

/**
 * How a write is actually performed.
 *
 * The read side maps cleanly onto tables. The write side does not, and assuming it does is the
 * mistake this type exists to prevent: creating a patient requires an atomic UHID from next_seq
 * plus PHI encryption through upsert-patient-phi, neither of which a table insert performs. A
 * generic INSERT would produce a NOT NULL violation on uhid, or — worse, if someone "fixed" that
 * by generating one inline — colliding UHIDs and unencrypted phone numbers.
 *
 * So a write declares where its invariants live:
 *
 *   handler: "table"  — a plain insert/update is genuinely safe, because the DATABASE enforces
 *                       the invariants. Requires dbEnforcedInvariants naming the constraints or
 *                       triggers relied upon, so the claim is explicit and reviewable rather
 *                       than assumed.
 *   handler: "<name>" — invariants live in application code; a named handler in writers.ts owns
 *                       them and the gateway calls that instead of touching the table.
 */
export type WriteHandler = "table" | "patients.create";

export interface WriteSpec {
  /** Fields the caller may set. Anything else in the body is rejected, never silently ignored. */
  writable: string[];
  /** Fields that must be present. Applies to POST; PATCH is a partial update. */
  required?: string[];
  handler: WriteHandler;
  /**
   * Required when handler is "table": the database objects that make a bare insert safe.
   * Naming them forces the author to establish that something actually enforces the invariant.
   */
  dbEnforcedInvariants?: string[];
  /** Domain event emitted on success. Must exist in docs/api/EVENT_CATALOG.md. */
  emits?: string;
}

export interface RouteDef {
  method: HttpMethod;
  /** Pattern with {id} placeholders, e.g. "/v1/patients/{id}". */
  path: string;
  scope: string;
  table: string;
  /**
   * The column carrying the tenant. Always applied, always from the authenticated key — no
   * endpoint accepts a hospital_id parameter, so there is no way to express the question
   * "give me another hospital's data".
   */
  tenantColumn: string;
  /**
   * Response column allowlist. There is no SELECT * anywhere in this file: a column added to a
   * table for internal use must not silently become public API the next day.
   */
  select: string[];
  filters?: FilterDef[];
  /** Column defining the total order for keyset pagination. Must be non-null for every row. */
  sort?: string;
  /** True when the route can return patient-identifiable data. */
  phi: boolean;
  /** DPDP Act 2023 purpose limitation record. Required whenever phi is true; CI enforces it. */
  phiPurpose?: string;
  /**
   * Fields blanked when the key holds the route's scope but not the PHI scope for the data.
   * Redacting beats a 403 here: a billing integration can still reconcile by id.
   */
  phiFields?: string[];
  module: string;
  description: string;
  /** Present on POST and PATCH routes only. */
  write?: WriteSpec;
}

const ISO_DATE = "ISO 8601 date or timestamp";

export const ROUTES: RouteDef[] = [
  // ── Patients ───────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/patients", scope: "read:patients",
    table: "patients", tenantColumn: "hospital_id",
    select: ["id", "uhid", "full_name", "gender", "dob", "phone", "email", "blood_group",
             "abha_id", "patient_category", "is_active", "created_at"],
    filters: [
      { param: "uhid", column: "uhid", op: "eq", description: "Exact UHID." },
      { param: "phone", column: "phone", op: "eq", description: "Exact registered phone number." },
      { param: "created_after", column: "created_at", op: "gte", description: `Registered on or after this ${ISO_DATE}.` },
      { param: "created_before", column: "created_at", op: "lte", description: `Registered on or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Patient identification for partner systems the hospital has commissioned "
              + "(portal, BI, referral network). Retention: for the life of the API key.",
    phiFields: ["full_name", "dob", "phone", "email", "abha_id"],
    module: "patients",
    description: "List patients registered at this hospital, oldest first.",
  },
  {
    method: "GET", path: "/v1/patients/{id}", scope: "read:patients",
    table: "patients", tenantColumn: "hospital_id",
    select: ["id", "uhid", "full_name", "gender", "dob", "phone", "email", "blood_group",
             "address", "abha_id", "allergies", "chronic_conditions", "patient_category",
             "is_active", "created_at"],
    phi: true,
    phiPurpose: "Retrieval of a single patient record by a partner system acting on the "
              + "hospital's behalf. Retention: for the life of the API key.",
    phiFields: ["full_name", "dob", "phone", "email", "address", "abha_id", "allergies", "chronic_conditions"],
    module: "patients",
    description: "Retrieve one patient by id.",
  },

  {
    method: "POST", path: "/v1/patients", scope: "write:patients",
    table: "patients", tenantColumn: "hospital_id",
    select: ["id", "uhid", "full_name", "gender", "dob", "phone", "email", "created_at"],
    phi: true,
    phiPurpose: "Patient registration by a partner system the hospital has commissioned "
              + "(kiosk, portal, referral network). Retention: for the life of the patient record.",
    module: "patients",
    description: "Register a patient. The UHID is allocated by the hospital's own numbering "
               + "sequence — do not supply one.",
    write: {
      // No uhid: it comes from next_seq under the hospital's configured prefix and format.
      // Accepting a caller-supplied one would let two integrations mint the same identifier.
      writable: ["full_name", "phone", "dob", "gender", "email", "address", "blood_group"],
      required: ["full_name"],
      handler: "patients.create",
      emits: "patients.patient.registered",
    },
  },
  {
    method: "PATCH", path: "/v1/patients/{id}", scope: "write:patients",
    table: "patients", tenantColumn: "hospital_id",
    select: ["id", "uhid", "full_name", "gender", "dob", "phone", "email", "address",
             "blood_group", "is_active", "created_at"],
    phi: true,
    phiPurpose: "Correction of patient demographics by a partner system. "
              + "Retention: for the life of the patient record.",
    module: "patients",
    description: "Update a patient's demographics. Partial update — omitted fields are unchanged.",
    write: {
      // uhid is deliberately absent: it is referenced by bills, lab orders and ABDM links, and
      // is the identifier printed on the patient's own paperwork. It is not editable over the API.
      writable: ["full_name", "phone", "dob", "gender", "email", "address", "blood_group", "is_active"],
      handler: "table",
      dbEnforcedInvariants: [
        "patients_pkey — the row is addressed by id, and the tenant predicate scopes it",
        "audit trigger on patients — every change is recorded regardless of who made it",
      ],
      emits: "patients.patient.updated",
    },
  },

  // ── Scheduling ─────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/appointments", scope: "read:appointments",
    table: "appointments", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time",
             "status", "visit_type", "appointment_type", "consultation_fee", "booked_via", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Appointments for one patient." },
      { param: "doctor_id", column: "doctor_id", op: "eq", description: "Appointments for one doctor." },
      { param: "status", column: "status", op: "eq", description: "Exact status value." },
      { param: "date_from", column: "appointment_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "appointment_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "scheduling",
    description: "List appointments. Carries patient and doctor ids, not names — resolve via /v1/patients.",
  },
  {
    method: "GET", path: "/v1/appointments/{id}", scope: "read:appointments",
    table: "appointments", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time",
             "status", "visit_type", "appointment_type", "chief_complaint", "consultation_fee",
             "booked_via", "notes", "created_at"],
    phi: true,
    phiPurpose: "Appointment detail including presenting complaint, for partner scheduling and "
              + "triage systems. Retention: for the life of the API key.",
    phiFields: ["chief_complaint", "notes"],
    module: "scheduling",
    description: "Retrieve one appointment by id.",
  },

  {
    method: "POST", path: "/v1/appointments", scope: "write:appointments",
    table: "appointments", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time",
             "status", "visit_type", "created_at"],
    phi: false,
    module: "scheduling",
    description: "Book an appointment. Returns 409 if the doctor already has an active "
               + "appointment at that date and time.",
    write: {
      writable: ["patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time",
                 "visit_type", "appointment_type", "chief_complaint", "notes", "consultation_fee"],
      required: ["patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time"],
      // A plain insert is safe here precisely because the database — not this gateway, and not
      // the four app call sites — is what enforces the rules.
      handler: "table",
      dbEnforcedInvariants: [
        "appointments_active_slot_uniq (20261007000000) — partial unique index preventing a real "
          + "double-booking of one doctor+date+time; surfaces as 23505 and is returned as 409",
        "validate_appointment() (20260418180322) — constrains status to the permitted set",
        "trg_sync_slot_booked_count (20261014000001) — recomputes doctor_slots.booked_count from "
          + "an actual COUNT, so the gateway must not and does not maintain that counter",
      ],
      emits: "scheduling.appointment.booked",
    },
  },
  {
    method: "PATCH", path: "/v1/appointments/{id}", scope: "write:appointments",
    table: "appointments", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "appointment_date", "slot_time", "slot_end_time",
             "status", "visit_type", "created_at"],
    phi: false,
    module: "scheduling",
    description: "Reschedule or cancel an appointment. Set status to \"cancelled\" to cancel.",
    write: {
      writable: ["status", "appointment_date", "slot_time", "slot_end_time", "notes", "chief_complaint"],
      handler: "table",
      dbEnforcedInvariants: [
        "validate_appointment() (20260418180322) — rejects any status outside the permitted set",
        "trg_sync_slot_booked_count (20261014000001) — frees the seat on cancelled/no_show, which "
          + "the hand-maintained counter never did for no_show",
      ],
      emits: "scheduling.appointment.rescheduled",
    },
  },

  // ── OPD ────────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/encounters", scope: "read:encounters",
    table: "opd_encounters", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "visit_date", "visit_mode", "visit_purpose",
             "diagnosis", "icd10_code", "icd11_code", "is_admitted", "follow_up_date", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Encounters for one patient." },
      { param: "doctor_id", column: "doctor_id", op: "eq", description: "Encounters for one doctor." },
      { param: "date_from", column: "visit_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "visit_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Consultation summaries for continuity-of-care and analytics partners. "
              + "Diagnosis text is clinical PHI. Retention: for the life of the API key.",
    phiFields: ["diagnosis"],
    module: "opd",
    description: "List OPD consultation records.",
  },

  // ── IPD ────────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/admissions", scope: "read:admissions",
    table: "admissions", tenantColumn: "hospital_id",
    select: ["id", "admission_number", "patient_id", "admitting_doctor_id", "consultant_doctor_id",
             "ward_id", "bed_id", "department_id", "admission_type", "status", "admitted_at",
             "expected_discharge_date", "discharged_at", "discharge_type", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Admissions for one patient." },
      { param: "status", column: "status", op: "eq", description: "Exact status value." },
      { param: "ward_id", column: "ward_id", op: "eq", description: "Admissions in one ward." },
      { param: "admitted_after", column: "admitted_at", op: "gte", description: `Admitted on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "ipd",
    description: "List IPD admissions and their bed occupancy. Diagnosis text is excluded — use /v1/admissions/{id}.",
  },
  {
    method: "GET", path: "/v1/admissions/{id}", scope: "read:admissions",
    table: "admissions", tenantColumn: "hospital_id",
    select: ["id", "admission_number", "patient_id", "admitting_doctor_id", "consultant_doctor_id",
             "ward_id", "bed_id", "department_id", "admission_type", "admitting_diagnosis",
             "status", "admitted_at", "expected_discharge_date", "discharged_at", "discharge_type",
             "payer_type", "insurance_type", "created_at"],
    phi: true,
    phiPurpose: "Admission detail including admitting diagnosis, for insurance and continuity-of-care "
              + "partners. Retention: for the life of the API key.",
    phiFields: ["admitting_diagnosis"],
    module: "ipd",
    description: "Retrieve one admission by id.",
  },

  // ── Billing ────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/bills", scope: "read:bills",
    table: "bills", tenantColumn: "hospital_id",
    select: ["id", "bill_number", "patient_id", "encounter_id", "admission_id", "bill_date",
             "bill_type", "bill_status", "payment_status", "gst_amount", "discount_amount",
             "paid_amount", "balance_due", "patient_payable", "insurance_amount", "irn", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Bills for one patient." },
      { param: "bill_number", column: "bill_number", op: "eq", description: "Exact bill number." },
      { param: "payment_status", column: "payment_status", op: "eq", description: "Exact payment status." },
      { param: "date_from", column: "bill_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "bill_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "bill_date", phi: false,
    module: "billing",
    description: "List bills. Amounts are rupees as numeric(12,2) — parse as decimal, never float.",
  },
  {
    method: "GET", path: "/v1/payments", scope: "read:bills",
    table: "bill_payments", tenantColumn: "hospital_id",
    select: ["id", "bill_id", "amount", "payment_mode", "payment_date", "payment_time",
             "transaction_id", "gateway_reference", "bank_reference", "is_advance", "created_at"],
    filters: [
      { param: "bill_id", column: "bill_id", op: "eq", description: "Payments against one bill." },
      { param: "payment_mode", column: "payment_mode", op: "eq", description: "Exact payment mode." },
      { param: "date_from", column: "payment_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "payment_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "billing",
    description: "List payments received, including part payments and advances.",
  },

  // ── Insurance / TPA ────────────────────────────────────────────────────────────────────────
  //
  // Two categories are excluded from every route here, for different reasons:
  //
  //  1. AI assessments — ai_denial_risk_score, ai_draft_response, ai_suggested_reply,
  //     appeal_letter. These are the hospital's own internal working. Handing a payer our
  //     predicted likelihood that they will deny a claim, or our unsent draft reply to their
  //     query, is commercially self-harming in a way no privacy control would catch.
  //
  //  2. Raw payer payloads — hcx_response_json, hcx_response_payload, eligibility_response.
  //     Large, unshaped, and carrying whatever PHI the payer chose to echo back. Nothing that
  //     has not passed through the allowlist should leave through it.
  {
    method: "GET", path: "/v1/insurance/claims", scope: "read:insurance",
    table: "insurance_claims", tenantColumn: "hospital_id",
    select: ["id", "claim_number", "patient_id", "admission_id", "bill_id", "payer_type",
             "payer_id", "tpa_name", "tpa_reference_number", "policy_number", "claimed_amount",
             "approved_amount", "settled_amount", "underpayment_amount", "status",
             "submission_date", "submitted_at", "settlement_date", "denial_code", "denial_reason",
             "rejection_code", "rejection_reason", "appeal_status", "appeal_deadline",
             "submission_deadline", "resubmission_deadline", "query_count", "reconciled",
             "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Claims for one patient." },
      { param: "claim_number", column: "claim_number", op: "eq", description: "Exact claim number." },
      { param: "status", column: "status", op: "eq", description: "Exact claim status." },
      { param: "tpa_name", column: "tpa_name", op: "eq", description: "Claims for one TPA." },
      { param: "submitted_after", column: "submitted_at", op: "gte", description: `Submitted on or after this ${ISO_DATE}.` },
      { param: "settled_after", column: "settlement_date", op: "gte", description: `Settled on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Claim status and settlement tracking for the hospital's TPA, insurer and "
              + "revenue-cycle partners. Policy numbers and denial reasons identify the patient "
              + "and their treatment. Retention: for the life of the API key.",
    phiFields: ["policy_number", "denial_reason", "rejection_reason"],
    module: "insurance",
    description: "List insurance claims. Amounts are rupees as numeric(12,2) — parse as decimal, never float.",
  },
  {
    method: "GET", path: "/v1/insurance/pre-authorisations", scope: "read:insurance",
    table: "insurance_pre_auth", tenantColumn: "hospital_id",
    // mlc_number and fir_number are deliberately absent. A medico-legal case number ties a
    // patient to a police matter; that is not partner-integration data, and exposing it on a
    // general API is a decision for Suresh (regulatory), not a field allowlist.
    select: ["id", "pre_auth_number", "patient_id", "admission_id", "tpa_name",
             "tpa_reference_number", "policy_number", "care_type", "estimated_amount",
             "approved_amount", "supplementary_amount", "supplementary_required", "status",
             "submitted_at", "approved_at", "valid_until", "sla_deadline", "sla_breached",
             "is_emergency_admission", "is_extension", "diagnosis_codes", "procedure_codes",
             "denial_reason", "rejection_reason", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Pre-authorisations for one patient." },
      { param: "admission_id", column: "admission_id", op: "eq", description: "Pre-authorisations for one admission." },
      { param: "status", column: "status", op: "eq", description: "Exact status." },
      { param: "tpa_name", column: "tpa_name", op: "eq", description: "Pre-authorisations for one TPA." },
      { param: "submitted_after", column: "submitted_at", op: "gte", description: `Submitted on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Pre-authorisation status for the hospital's TPA and insurer integrations. "
              + "Diagnosis and procedure codes are clinical PHI. Retention: for the life of the API key.",
    phiFields: ["diagnosis_codes", "procedure_codes", "policy_number", "denial_reason", "rejection_reason"],
    module: "insurance",
    description: "List pre-authorisation requests, including SLA deadlines and whether they were breached.",
  },
  {
    method: "GET", path: "/v1/insurance/queries", scope: "read:insurance",
    table: "tpa_queries", tenantColumn: "hospital_id",
    select: ["id", "claim_id", "pre_auth_id", "admission_id", "query_date", "raised_at",
             "query_text", "documents_requested", "status", "priority", "response_deadline",
             "response_date", "replied_at", "response_text", "created_at"],
    filters: [
      { param: "claim_id", column: "claim_id", op: "eq", description: "Queries against one claim." },
      { param: "pre_auth_id", column: "pre_auth_id", op: "eq", description: "Queries against one pre-authorisation." },
      { param: "status", column: "status", op: "eq", description: "One of: open, responded, replied, overdue, escalated, closed." },
      { param: "raised_after", column: "raised_at", op: "gte", description: `Raised on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "TPA query correspondence, so a partner can track and answer payer questions "
              + "before the response deadline. Query and response text carry clinical "
              + "justification. Retention: for the life of the API key.",
    phiFields: ["query_text", "response_text"],
    module: "insurance",
    description: "List TPA queries raised against claims and pre-authorisations. Watch "
               + "response_deadline — an unanswered query is a common cause of claim rejection.",
  },

  // ── Laboratory ─────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/lab/orders", scope: "read:lab",
    table: "lab_orders", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "encounter_id", "admission_id", "order_date", "order_time",
             "status", "priority", "billing_status", "sample_collected_at", "validated_at", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Orders for one patient." },
      { param: "status", column: "status", op: "eq", description: "Exact order status." },
      { param: "date_from", column: "order_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "order_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "lab",
    description: "List lab orders. Results are on /v1/lab/results.",
  },
  {
    method: "GET", path: "/v1/lab/results", scope: "read:lab",
    table: "lab_order_items", tenantColumn: "hospital_id",
    select: ["id", "lab_order_id", "test_id", "status", "result_value", "result_numeric",
             "result_unit", "result_flag", "reference_range", "delta_flag", "critical_acknowledged",
             "result_entered_at", "validated_at", "created_at"],
    filters: [
      { param: "lab_order_id", column: "lab_order_id", op: "eq", description: "Results for one order." },
      { param: "status", column: "status", op: "eq", description: "Exact result status." },
      { param: "resulted_after", column: "result_entered_at", op: "gte", description: `Resulted on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Laboratory results for the hospital's own analyser, LIS and continuity-of-care "
              + "integrations. Values are clinical PHI. Retention: for the life of the API key.",
    phiFields: ["result_value", "result_numeric", "result_flag", "delta_flag"],
    module: "lab",
    description: "List lab result lines. A result is only clinically final once validated_at is set.",
  },

  // ── Radiology ──────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ PCPNDT: radiology_orders also holds is_pregnant, pregnancy_status and lmp_date, and flags
  // sex-determination-regulated studies via is_pcpndt. Under the Pre-Conception and Pre-Natal
  // Diagnostic Techniques Act, disclosure around sex determination is a criminal matter, not a
  // privacy preference. Those columns are therefore absent from the allowlist entirely — not
  // redactable, not scope-gated, simply not exposed. is_pcpndt itself IS returned, so a partner
  // system can recognise a restricted record and handle it accordingly.
  // Adding any of the excluded columns needs Suresh (regulatory) and Ananya (DPDP) sign-off.
  {
    method: "GET", path: "/v1/radiology/orders", scope: "read:radiology",
    table: "radiology_orders", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "encounter_id", "admission_id", "accession_number", "study_name",
             "modality_type", "body_part", "status", "priority", "order_date", "order_time",
             "scheduled_time", "billing_status", "is_pcpndt", "dicom_study_uid", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Orders for one patient." },
      { param: "status", column: "status", op: "eq", description: "Exact order status." },
      { param: "modality_type", column: "modality_type", op: "eq", description: "Exact modality, e.g. CT, MRI." },
      { param: "date_from", column: "order_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "order_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "radiology",
    description: "List radiology orders. Scheduling and workflow fields only — clinical history "
               + "and indication are not exposed, and PCPNDT-regulated fields never are.",
  },
  {
    method: "GET", path: "/v1/radiology/reports", scope: "read:radiology",
    table: "radiology_reports", tenantColumn: "hospital_id",
    select: ["id", "order_id", "patient_id", "radiologist_id", "is_signed", "is_critical",
             "reported_at", "validated_at", "technique", "findings", "impression",
             "recommendations", "created_at"],
    filters: [
      { param: "order_id", column: "order_id", op: "eq", description: "Report for one order." },
      { param: "patient_id", column: "patient_id", op: "eq", description: "Reports for one patient." },
      { param: "is_signed", column: "is_signed", op: "eq", description: "Only signed reports (true)." },
      { param: "reported_after", column: "reported_at", op: "gte", description: `Reported on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Radiology report content for the hospital's PACS, teleradiology and "
              + "continuity-of-care partners. Findings and impression are clinical PHI. "
              + "Retention: for the life of the API key.",
    // ai_impression_suggestion is deliberately not in select: an unreviewed model suggestion
    // leaving the product would be indistinguishable from a radiologist's own impression.
    phiFields: ["findings", "impression", "recommendations", "technique"],
    module: "radiology",
    description: "List radiology reports. A report is clinically final only once is_signed is true.",
  },

  // ── Pharmacy ───────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/pharmacy/prescriptions", scope: "read:pharmacy",
    table: "prescriptions", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "encounter_id", "admission_id", "prescription_date",
             "status", "is_signed", "signed_at", "review_date", "source", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Prescriptions for one patient." },
      { param: "status", column: "status", op: "eq", description: "Exact status." },
      { param: "date_from", column: "prescription_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "pharmacy",
    description: "List prescriptions. The drugs array is omitted from the list — use the detail route.",
  },
  {
    method: "GET", path: "/v1/pharmacy/prescriptions/{id}", scope: "read:pharmacy",
    table: "prescriptions", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "doctor_id", "encounter_id", "admission_id", "prescription_date",
             "drugs", "advice_notes", "status", "is_signed", "signed_at", "review_date", "created_at"],
    phi: true,
    phiPurpose: "Prescription detail for the hospital's pharmacy and e-prescription partners. "
              + "Drug lists are clinical PHI. Retention: for the life of the API key.",
    phiFields: ["drugs", "advice_notes"],
    module: "pharmacy",
    description: "Retrieve one prescription including its drug list.",
  },

  {
    method: "GET", path: "/v1/pharmacy/dispenses", scope: "read:pharmacy",
    table: "pharmacy_dispensing", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "prescription_id", "encounter_id", "admission_id",
             "dispensing_number", "dispensing_type", "status", "dispensed_at", "payment_mode",
             "total_amount", "discount_amount", "gst_amount", "net_amount", "billed",
             "bill_linked", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Dispenses for one patient." },
      { param: "prescription_id", column: "prescription_id", op: "eq", description: "Dispenses against one prescription." },
      { param: "status", column: "status", op: "eq", description: "Exact status." },
      { param: "dispensed_after", column: "dispensed_at", op: "gte", description: `Dispensed on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "pharmacy",
    // Line items name the drugs, which is clinical PHI — the totals are not.
    description: "List dispensing records with their financial totals. Drug-level line items are "
               + "not exposed; use /v1/pharmacy/prescriptions/{id} for what was prescribed.",
  },

  // ── Emergency ──────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/emergency/visits", scope: "read:emergency",
    table: "ed_visits", tenantColumn: "hospital_id",
    // mlc_details is excluded for the same reason as insurance_pre_auth.mlc_number: it is free
    // text about a police matter. The `mlc` boolean IS returned, so a partner can recognise a
    // medico-legal case and handle it accordingly without receiving the narrative.
    select: ["id", "patient_id", "doctor_id", "arrival_time", "arrival_mode", "triage_category",
             "chief_complaint", "working_diagnosis", "gcs_score", "disposition",
             "disposition_time", "mlc", "payer_type", "billing_status", "ed_charge", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Visits for one patient." },
      { param: "triage_category", column: "triage_category", op: "eq", description: "Exact triage category." },
      { param: "disposition", column: "disposition", op: "eq", description: "Exact disposition." },
      { param: "arrived_after", column: "arrival_time", op: "gte", description: `Arrived on or after this ${ISO_DATE}.` },
      { param: "arrived_before", column: "arrival_time", op: "lte", description: `Arrived on or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Emergency attendance and triage for the hospital's ED dashboards, ambulance and "
              + "referral partners. Complaint and diagnosis are clinical PHI. "
              + "Retention: for the life of the API key.",
    phiFields: ["chief_complaint", "working_diagnosis", "gcs_score"],
    module: "emergency",
    description: "List emergency department visits. AMPLE history and MLC narrative are not exposed.",
  },

  // ── Operation theatre ──────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/theatre/schedules", scope: "read:ot",
    table: "ot_schedules", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "admission_id", "ot_room_id", "surgeon_id", "anaesthetist_id",
             "surgery_name", "surgery_category", "anaesthesia_type", "scheduled_date",
             "scheduled_start_time", "scheduled_end_time", "estimated_duration_minutes",
             "actual_start_time", "actual_end_time", "status", "pac_done", "pac_cleared",
             "post_op_diagnosis", "ot_charge", "surgeon_fee", "anaesthetist_fee", "billed",
             "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Bookings for one patient." },
      { param: "surgeon_id", column: "surgeon_id", op: "eq", description: "Bookings for one surgeon." },
      { param: "ot_room_id", column: "ot_room_id", op: "eq", description: "Bookings in one theatre." },
      { param: "status", column: "status", op: "eq", description: "Exact status." },
      { param: "date_from", column: "scheduled_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "scheduled_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Theatre scheduling and utilisation for the hospital's OT management and "
              + "anaesthesia partners. Surgery name and post-op diagnosis are clinical PHI. "
              + "Retention: for the life of the API key.",
    phiFields: ["surgery_name", "post_op_diagnosis", "anaesthesia_type"],
    module: "theatre",
    description: "List theatre bookings with scheduled and actual timings. PAC notes and "
               + "cancellation reasons are not exposed.",
  },

  // ── Nursing ────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/nursing/vitals", scope: "read:nursing",
    table: "nursing_vitals", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "admission_id", "recorded_at", "shift", "temperature", "pulse",
             "respiratory_rate", "bp_systolic", "bp_diastolic", "pain_score", "gcs_total",
             "mews_score", "qsofa_score", "weight", "intake_oral_ml", "intake_iv_ml",
             "urine_output_ml"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Observations for one patient." },
      { param: "admission_id", column: "admission_id", op: "eq", description: "Observations for one admission." },
      { param: "recorded_after", column: "recorded_at", op: "gte", description: `Recorded on or after this ${ISO_DATE}.` },
      { param: "recorded_before", column: "recorded_at", op: "lte", description: `Recorded on or before this ${ISO_DATE}.` },
    ],
    // recorded_at, not created_at — this table has no created_at, and the clinical ordering that
    // matters is when the observation was taken.
    sort: "recorded_at", phi: true,
    phiPurpose: "Nursing observations for the hospital's monitoring, early-warning and "
              + "tele-ICU integrations. Every value here is clinical PHI. "
              + "Retention: for the life of the API key.",
    phiFields: ["temperature", "pulse", "respiratory_rate", "bp_systolic", "bp_diastolic",
                "pain_score", "gcs_total", "mews_score", "qsofa_score", "weight",
                "intake_oral_ml", "intake_iv_ml", "urine_output_ml"],
    module: "nursing",
    description: "List recorded vitals, including MEWS and qSOFA scores. Free-text nursing notes "
               + "are not exposed.",
  },

  // ── Blood bank ─────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ The individual transfusion-transmissible infection results — tti_hiv, tti_hbsag, tti_hcv,
  // tti_vdrl, tti_malaria — are NOT exposed, and are not merely redactable. They are a named
  // donor's infection status; HIV status in particular is among the most sensitive categories of
  // personal data there is, and a donor consented to a blood donation, not to their serology
  // reaching a third-party system.
  //
  // tti_status IS returned, because the aggregate pass/fail is what stock and issue integrations
  // actually need — a unit is either safe to issue or it is not. Exposing any individual result
  // needs Ananya (DPDP) and a documented donor consent basis.
  {
    method: "GET", path: "/v1/bloodbank/units", scope: "read:bloodbank",
    table: "blood_units", tenantColumn: "hospital_id",
    select: ["id", "unit_number", "bag_number", "blood_group", "rh_factor", "component",
             "status", "tti_status", "volume_ml", "collected_at", "processing_date",
             "expiry_at", "expiry_date", "storage_location", "reserved_for", "issued_to",
             "isbt_donation_id", "isbt_product_code", "isbt_facility_code", "created_at"],
    filters: [
      { param: "blood_group", column: "blood_group", op: "eq", description: "Exact blood group, e.g. O." },
      { param: "component", column: "component", op: "eq", description: "Exact component, e.g. PRBC, FFP." },
      { param: "status", column: "status", op: "eq", description: "Exact unit status." },
      { param: "expires_before", column: "expiry_at", op: "lte", description: `Expiring on or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "bloodbank",
    description: "List blood units and their availability. Donor identity and individual "
               + "infection-screening results are never exposed — only the aggregate tti_status.",
  },
  {
    method: "GET", path: "/v1/bloodbank/requests", scope: "read:bloodbank",
    table: "blood_requests", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "admission_id", "blood_group", "rh_factor", "component",
             "units_required", "urgency", "status", "indication", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Requests for one patient." },
      { param: "status", column: "status", op: "eq", description: "Exact request status." },
      { param: "urgency", column: "urgency", op: "eq", description: "Exact urgency level." },
      { param: "requested_after", column: "created_at", op: "gte", description: `Raised on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Blood requirement tracking for the hospital's blood bank and inter-hospital "
              + "supply partners. The clinical indication is PHI. "
              + "Retention: for the life of the API key.",
    phiFields: ["indication"],
    module: "bloodbank",
    description: "List blood requests raised for patients.",
  },

  // ── Dialysis ───────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/dialysis/sessions", scope: "read:dialysis",
    table: "dialysis_sessions", tenantColumn: "hospital_id",
    select: ["id", "dialysis_patient_id", "machine_id", "session_date", "shift",
             "scheduled_start", "started_at", "ended_at", "status", "access_used",
             "pre_weight_kg", "post_weight_kg", "uf_goal_ml", "uf_achieved_ml", "kt_v",
             "blood_flow_rate_ml", "complications", "billing_status", "created_at"],
    filters: [
      { param: "dialysis_patient_id", column: "dialysis_patient_id", op: "eq", description: "Sessions for one dialysis patient." },
      { param: "machine_id", column: "machine_id", op: "eq", description: "Sessions on one machine." },
      { param: "status", column: "status", op: "eq", description: "Exact session status." },
      { param: "date_from", column: "session_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "session_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Dialysis session records for the hospital's nephrology and machine-vendor "
              + "integrations. Adequacy and complication data are clinical PHI. "
              + "Retention: for the life of the API key.",
    phiFields: ["pre_weight_kg", "post_weight_kg", "uf_goal_ml", "uf_achieved_ml", "kt_v",
                "complications", "access_used"],
    module: "dialysis",
    description: "List dialysis sessions with adequacy (Kt/V) and ultrafiltration figures.",
  },

  // ── Immunisation ───────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/vaccinations", scope: "read:vaccination",
    table: "vaccination_records", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "vaccine_id", "dose_number", "administered_at", "route", "site",
             "batch_number", "manufacturer", "expiry_date", "next_dose_due", "camp_id",
             "aefi_reported", "aefi_severity", "vvm_status", "billing_status", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Doses for one patient." },
      { param: "vaccine_id", column: "vaccine_id", op: "eq", description: "Doses of one vaccine." },
      { param: "camp_id", column: "camp_id", op: "eq", description: "Doses given at one camp." },
      { param: "administered_after", column: "administered_at", op: "gte", description: `Given on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Immunisation history for the hospital's public-health reporting (UWIN/CoWIN-style "
              + "registries) and paediatric follow-up partners. "
              + "Retention: for the life of the API key.",
    // aefi_description is excluded entirely — a free-text adverse-event narrative. The severity
    // and the fact one was reported are enough for a registry integration.
    phiFields: ["aefi_severity"],
    module: "vaccination",
    description: "List administered vaccine doses, including batch and next-dose-due tracking.",
  },

  // ── Ambulance ──────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/ambulance/dispatches", scope: "read:ambulance",
    table: "ambulance_dispatches", tenantColumn: "hospital_id",
    select: ["id", "patient_id", "vehicle_id", "status", "call_received_at", "dispatch_at",
             "pickup_at", "arrival_at", "pickup_location", "destination", "complaint",
             "distance_km", "trip_charge", "per_km_rate", "billing_status", "created_at"],
    filters: [
      { param: "patient_id", column: "patient_id", op: "eq", description: "Trips for one patient." },
      { param: "vehicle_id", column: "vehicle_id", op: "eq", description: "Trips for one vehicle." },
      { param: "status", column: "status", op: "eq", description: "Exact dispatch status." },
      { param: "called_after", column: "call_received_at", op: "gte", description: `Call received on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: true,
    phiPurpose: "Ambulance dispatch and response-time tracking for the hospital's fleet and "
              + "emergency-network partners. Pickup location and complaint identify the patient "
              + "and their condition. Retention: for the life of the API key.",
    phiFields: ["pickup_location", "complaint"],
    module: "ambulance",
    description: "List ambulance dispatches with response timestamps and trip charges.",
  },

  // ── Inventory ──────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/inventory/items", scope: "read:inventory",
    table: "inventory_items", tenantColumn: "hospital_id",
    select: ["id", "item_code", "item_name", "category", "uom", "hsn_code", "gst_percent",
             "reorder_level", "max_stock_level", "minimum_order_qty", "abc_class", "ved_class",
             "is_active", "created_at"],
    filters: [
      { param: "item_code", column: "item_code", op: "eq", description: "Exact item code." },
      { param: "category", column: "category", op: "eq", description: "Exact category." },
      { param: "is_active", column: "is_active", op: "eq", description: "Filter to active items." },
    ],
    sort: "created_at", phi: false,
    module: "inventory",
    description: "List the item master, including ABC/VED classification and reorder levels.",
  },
  {
    method: "GET", path: "/v1/inventory/stock", scope: "read:inventory",
    table: "inventory_stock", tenantColumn: "hospital_id",
    select: ["id", "item_id", "batch_number", "expiry_date", "quantity_available",
             "quantity_reserved", "location", "cost_price", "mrp", "last_received_date",
             "is_consignment"],
    filters: [
      { param: "item_id", column: "item_id", op: "eq", description: "Stock for one item." },
      { param: "location", column: "location", op: "eq", description: "Stock at one location." },
      { param: "expires_before", column: "expiry_date", op: "lte", description: `Expiring on or before this ${ISO_DATE}.` },
    ],
    // This table has no created_at, and expiry_date is nullable — keyset pagination over a
    // nullable column silently drops every row where it is NULL, so a stock list would omit
    // exactly the non-expiring items. The primary key is the correct fallback: not chronological,
    // but a genuine total order that is never null.
    sort: "id", phi: false,
    module: "inventory",
    description: "List batch-level stock balances. Ordered by id — this table records no "
               + "timestamp, so there is no chronological order to page by.",
  },
  {
    method: "GET", path: "/v1/inventory/transactions", scope: "read:inventory",
    table: "stock_transactions", tenantColumn: "hospital_id",
    select: ["id", "item_id", "department_id", "transaction_type", "quantity", "unit_rate",
             "reference_type", "reference_id", "created_at"],
    filters: [
      { param: "item_id", column: "item_id", op: "eq", description: "Movements for one item." },
      { param: "transaction_type", column: "transaction_type", op: "eq", description: "Exact movement type." },
      { param: "department_id", column: "department_id", op: "eq", description: "Movements for one department." },
      { param: "since", column: "created_at", op: "gte", description: `Recorded on or after this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "inventory",
    description: "List stock movements. Free-text notes are not exposed.",
  },

  // ── Staff ──────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/staff/attendance", scope: "read:staff",
    table: "staff_attendance", tenantColumn: "hospital_id",
    // Employee personal data rather than patient data, so phi is false — but it is still personal
    // data under the DPDP Act, and `source` records whether a row came from a biometric device.
    select: ["id", "user_id", "attendance_date", "in_time", "out_time", "hours_worked",
             "overtime_hours", "status", "shift_code", "source", "created_at"],
    filters: [
      { param: "user_id", column: "user_id", op: "eq", description: "Attendance for one staff member." },
      { param: "status", column: "status", op: "eq", description: "Exact attendance status." },
      { param: "date_from", column: "attendance_date", op: "gte", description: `On or after this ${ISO_DATE}.` },
      { param: "date_to", column: "attendance_date", op: "lte", description: `On or before this ${ISO_DATE}.` },
    ],
    sort: "created_at", phi: false,
    module: "staff",
    description: "List staff attendance for payroll and biometric-device reconciliation. "
               + "Free-text notes and remarks are not exposed.",
  },

  // ── Masters ────────────────────────────────────────────────────────────────────────────────
  {
    method: "GET", path: "/v1/masters/departments", scope: "read:masters",
    table: "departments", tenantColumn: "hospital_id",
    select: ["id", "name", "type", "head_doctor_id", "is_active", "created_at"],
    filters: [
      { param: "is_active", column: "is_active", op: "eq", description: "Filter to active departments." },
    ],
    sort: "created_at", phi: false,
    module: "masters",
    description: "List departments.",
  },
  {
    method: "GET", path: "/v1/masters/services", scope: "read:masters",
    table: "service_master", tenantColumn: "hospital_id",
    select: ["id", "name", "category", "item_type", "department_id", "fee", "follow_up_fee",
             "emergency_fee", "gst_applicable", "gst_percent", "hsn_code", "is_active", "created_at"],
    filters: [
      { param: "category", column: "category", op: "eq", description: "Exact category." },
      { param: "is_active", column: "is_active", op: "eq", description: "Filter to active services." },
    ],
    sort: "created_at", phi: false,
    module: "masters",
    description: "List the service and rate catalogue.",
  },
  {
    method: "GET", path: "/v1/masters/wards", scope: "read:masters",
    table: "wards", tenantColumn: "hospital_id",
    select: ["id", "name", "created_at"],
    sort: "created_at", phi: false,
    module: "masters",
    description: "List wards.",
  },
];

// ── Registry validation ──────────────────────────────────────────────────────────────────────

export interface RegistryProblem {
  path: string;
  method: string;
  problem: string;
}

/**
 * The rules from the design standard, checked mechanically.
 *
 * Run at gateway start-up (so a malformed registry fails the deploy rather than one request at
 * 3am) and by CI via scripts/check-api-registry.mjs.
 */
export function validateRegistry(routes: RouteDef[] = ROUTES): RegistryProblem[] {
  const problems: RegistryProblem[] = [];
  const seen = new Set<string>();

  for (const r of routes) {
    const at = { path: r.path, method: r.method };
    const key = `${r.method} ${r.path}`;

    if (seen.has(key)) problems.push({ ...at, problem: "duplicate method+path" });
    seen.add(key);

    if (!r.scope) problems.push({ ...at, problem: "no scope" });
    if (!r.description?.trim()) problems.push({ ...at, problem: "no description" });
    if (!r.module) problems.push({ ...at, problem: "no module" });

    // The tenant predicate is what makes cross-tenant isolation structural. A route without it
    // would serve every hospital's rows to whoever asked first.
    if (!r.tenantColumn) problems.push({ ...at, problem: "no tenantColumn" });

    if (!r.select?.length) problems.push({ ...at, problem: "empty select allowlist" });
    if (r.select?.includes("*")) problems.push({ ...at, problem: "SELECT * is not permitted" });
    if (r.select?.length && !r.select.includes("id")) {
      problems.push({ ...at, problem: "select must include id (used as the pagination tiebreaker)" });
    }

    // DPDP Act 2023 purpose limitation.
    if (r.phi && !r.phiPurpose?.trim()) {
      problems.push({ ...at, problem: "phi: true with no phiPurpose (DPDP purpose limitation)" });
    }
    if (!r.phi && r.phiPurpose) {
      problems.push({ ...at, problem: "phiPurpose declared on a non-PHI route" });
    }
    for (const f of r.phiFields ?? []) {
      if (!r.select.includes(f)) {
        problems.push({ ...at, problem: `phiFields lists "${f}", which is not in select` });
      }
    }

    const isCollection = !r.path.includes("{id}");
    if (isCollection && r.method === "GET") {
      if (!r.sort) problems.push({ ...at, problem: "collection route needs a sort column for keyset pagination" });
      if (r.sort && !r.select.includes(r.sort)) {
        problems.push({ ...at, problem: `sort column "${r.sort}" must be in select so the cursor can be built` });
      }
    }

    for (const f of r.filters ?? []) {
      if (!f.description?.trim()) problems.push({ ...at, problem: `filter "${f.param}" has no description` });
    }

    // ── Write rules ──────────────────────────────────────────────────────────────────────────
    const isWrite = r.method === "POST" || r.method === "PATCH";

    if (isWrite && !r.write) problems.push({ ...at, problem: "write method with no write spec" });
    if (!isWrite && r.write) problems.push({ ...at, problem: "write spec on a read route" });

    if (r.write) {
      const w = r.write;

      // A write gated on a read scope would let any integration with read access mutate records.
      if (!r.scope.startsWith("write:")) {
        problems.push({ ...at, problem: `write route must use a write: scope, not "${r.scope}"` });
      }

      if (!w.writable?.length) problems.push({ ...at, problem: "write spec has no writable fields" });

      // The tenant, the primary key and the audit timestamps are the system's to set. A caller
      // that could set hospital_id would be choosing which hospital to write into.
      for (const forbidden of ["id", "hospital_id", "created_at", "updated_at", "uhid"]) {
        if (w.writable?.includes(forbidden)) {
          problems.push({ ...at, problem: `"${forbidden}" must never be caller-writable` });
        }
      }

      for (const req of w.required ?? []) {
        if (!w.writable.includes(req)) {
          problems.push({ ...at, problem: `required field "${req}" is not in writable` });
        }
      }

      if (r.method === "POST" && !w.required?.length) {
        problems.push({ ...at, problem: "POST must declare its required fields" });
      }

      // The rule this whole type exists for: claiming a bare table write is safe requires
      // naming what makes it safe.
      if (w.handler === "table" && !w.dbEnforcedInvariants?.length) {
        problems.push({
          ...at,
          problem: 'handler "table" requires dbEnforcedInvariants naming the constraints or '
                 + "triggers that enforce this resource's rules in the database",
        });
      }
      if (w.handler !== "table" && w.dbEnforcedInvariants?.length) {
        problems.push({ ...at, problem: "dbEnforcedInvariants applies only to handler \"table\"" });
      }

      // An event nobody can subscribe to is an event that does not exist.
      if (w.emits && !/^[a-z]+\.[a-z_]+\.[a-z_]+$/.test(w.emits)) {
        problems.push({ ...at, problem: `event "${w.emits}" is not {domain}.{resource}.{past-tense-verb}` });
      }
    }
  }

  return problems;
}

/** Longest-prefix-free lookup: patterns are matched segment-wise, literal beating placeholder. */
export function matchRoute(method: string, pathname: string): { route: RouteDef; params: Record<string, string> } | null {
  const segments = pathname.replace(/\/+$/, "").split("/").filter(Boolean);

  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;

    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      const p = pattern[i];
      if (p.startsWith("{") && p.endsWith("}")) {
        params[p.slice(1, -1)] = decodeURIComponent(segments[i]);
      } else if (p !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}
