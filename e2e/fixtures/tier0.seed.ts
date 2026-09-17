/**
 * Tier-0 fixture — two hospitals, deterministic, idempotent, committed code.
 *
 * §5 of docs/testing/PHASED_TEST_PLAN.md. This is the "mock data" that makes
 * "Playwright automatically tests with mock data" real. It is a script rather than a UI
 * walkthrough because a walkthrough cannot be re-run from scratch, cannot be diffed, and
 * cannot be trusted to produce the same state twice.
 *
 * THE THREE PROPERTIES THAT MATTER
 *
 *   Deterministic — every id, rate and name is a fixed constant (D6), so a journey's expected
 *   total is hand-derivable and an assertion can name the row it expects.
 *
 *   Idempotent — running it twice produces byte-identical state. This is a Phase 3 exit-gate
 *   criterion, and it is why every write below is an upsert on a known primary key rather
 *   than an insert. A fixture that accumulates rows makes "exactly one" assertions fail on
 *   the second run for a reason that has nothing to do with the code under test.
 *
 *   Two tenants — not one. Every isolation assertion in Phase 4 needs a second hospital to be
 *   absent from, and retrofitting one means rebuilding the fixture.
 *
 * SAFETY. This script writes tenant data. `assertLocalTarget` refuses to run it against
 * anything but a local container, and there is no flag to override that.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ENABLED_MODULE_KEYS,
  HOSPITAL_A,
  HOSPITAL_B,
  PATIENTS_BY_TENANT,
  SEEDED_ROLES,
  TEST_PASSWORD,
  TENANT_BY_KEY,
  beds,
  departments,
  drugBatches,
  drugs,
  labTestMaster,
  otRooms,
  otService,
  payerMaster,
  radiologyStudy,
  seniorAdminEmail,
  seniorAdminUserId,
  services,
  staffEmail,
  staffUserId,
  surgicalPrivilegeId,
  tpaConfig,
  wards,
  type SeededRole,
  type TenantKey,
} from "./constants.ts";
import { serviceClient } from "./serviceClient.ts";

const TENANT_KEYS: TenantKey[] = ["a", "b"];

function fail(step: string, error: { message: string } | null): void {
  if (error) throw new Error(`Tier-0 seed failed at ${step}: ${error.message}`);
}

/**
 * Create (or reuse) an auth user and return its uid.
 *
 * `public.users.id` and `auth.users.id` are DIFFERENT values in this codebase — they were
 * decoupled at migration 20260322111223, and ~70 tables FK to `public.users(id)`. The seed
 * therefore creates the auth account, then links it via `auth_user_id` rather than reusing
 * the uid as the staff-row id. A fixture that conflated them would make every `*_by`
 * attribution assertion pass for the wrong reason.
 */
async function upsertAuthUser(svc: SupabaseClient, email: string): Promise<string> {
  const { data: created, error } = await svc.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (!error && created?.user) return created.user.id;

  // Already exists — the idempotent path. Find it rather than treating this as a failure.
  const alreadyExists = /already|duplicate|registered/i.test(error?.message ?? "");
  if (!alreadyExists) {
    throw new Error(`Could not create auth user ${email}: ${error?.message}`);
  }

  const { data: list, error: listErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error(`Could not list auth users while resolving ${email}: ${listErr.message}`);

  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existing) throw new Error(`Auth user ${email} reported as existing but was not found.`);

  // Reset the password so a re-run recovers an account whose password drifted.
  await svc.auth.admin.updateUserById(existing.id, { password: TEST_PASSWORD, email_confirm: true });
  return existing.id;
}

async function seedHospital(svc: SupabaseClient, tenant: TenantKey): Promise<void> {
  const hospital = TENANT_BY_KEY[tenant];

  fail(
    `hospitals(${hospital.name})`,
    (
      await svc.from("hospitals").upsert(
        {
          id: hospital.id,
          name: hospital.name,
          type: "general",
          subscription_tier: "enterprise",
          is_active: true,
          setup_complete: true,
          uhid_prefix: hospital.uhidPrefix,
          uhid_date_format: "YYYY",
          payment_methods: ["cash", "card", "upi"],
          // Off deliberately: a seeded hospital must never be able to send a real message.
          whatsapp_enabled: false,
          whatsapp_provider: "none",
        },
        { onConflict: "id" },
      )
    ).error,
  );

  // `users(hospital_id, role)` FKs to `role_permissions(hospital_id, role_name)` as of
  // 20261009000185 — a role must exist for a hospital before a staff member can be
  // assigned to it. `seed_default_roles_for_hospital` covers super_admin, hospital_admin,
  // doctor, nurse, receptionist, pharmacist, lab_tech and accountant; it does NOT cover
  // `billing_executive`, which this fixture also seeds a staff account for, so that role
  // is added explicitly. Both are idempotent (`ON CONFLICT DO NOTHING` / upsert on a fixed
  // key), matching this file's re-runnable-from-scratch requirement.
  fail(
    `seed_default_roles_for_hospital(${tenant})`,
    (await svc.rpc("seed_default_roles_for_hospital", { p_hospital_id: hospital.id })).error,
  );
  fail(
    `role_permissions(billing_executive, ${tenant})`,
    (
      await svc.from("role_permissions").upsert(
        {
          hospital_id: hospital.id,
          role_name: "billing_executive",
          role_label: "Billing Executive",
          is_system_role: true,
          permissions: { billing: "rw", reports: "r", patients: "r" },
        },
        { onConflict: "hospital_id,role_name" },
      )
    ).error,
  );

  fail(
    `departments(${tenant})`,
    (
      await svc.from("departments").upsert(
        departments(tenant).map((d) => ({
          id: d.id,
          hospital_id: hospital.id,
          name: d.name,
          type: d.type,
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `service_master(${tenant})`,
    (
      await svc.from("service_master").upsert(
        [...services(tenant), otService(tenant)].map((s) => ({
          id: s.id,
          hospital_id: hospital.id,
          name: s.name,
          category: s.category,
          item_type: s.itemType,
          fee: s.fee,
          gst_applicable: s.gstApplicable,
          gst_percent: s.gstPercent,
          is_active: true,
          // undefined for every service but General Consultation — JSON.stringify drops an
          // undefined key entirely, so this never touches follow-up columns on OT/lab/etc rows.
          follow_up_fee: s.followUpFee,
          validity_days: s.followUpValidityDays,
          follow_up_max_visits: s.followUpMaxVisits,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  // ── Lab test catalogue (Phase 7, J12: OPD cash walk-in) ─────────────────────────────────
  fail(
    `lab_test_master(${tenant})`,
    (
      await svc.from("lab_test_master").upsert(
        (() => {
          const t = labTestMaster(tenant);
          return [{
            id: t.id,
            hospital_id: hospital.id,
            test_name: t.testName,
            category: t.category,
            // The column's own DB default is lowercase "blood", which the same
            // config-values trigger rejects (valid options are capitalized) — must be set
            // explicitly, confirmed live.
            sample_type: "Blood",
            fee: t.fee,
            is_active: true,
            normal_min: t.normalMin,
            normal_max: t.normalMax,
            critical_low: t.criticalLow,
            critical_high: t.criticalHigh,
          }];
        })(),
        { onConflict: "id" },
      )
    ).error,
  );

  // ── Drug catalogue + stock (Phase 7.5: Pharmacy spine) ──────────────────────────────────
  fail(
    `drug_master(${tenant})`,
    (
      await svc.from("drug_master").upsert(
        drugs(tenant).map((d) => ({
          id: d.id,
          hospital_id: hospital.id,
          drug_name: d.drugName,
          generic_name: d.genericName ?? null,
          is_ndps: d.isNdps ?? false,
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `drug_batches(${tenant})`,
    (
      await svc.from("drug_batches").upsert(
        drugBatches(tenant).map((b) => ({
          id: b.id,
          hospital_id: hospital.id,
          drug_id: b.drugId,
          batch_number: b.batchNumber,
          // Idempotent re-runs must not slowly drain stock to zero across repeated test
          // runs — reset to a fixed quantity every seed run, same discipline as beds' own
          // status reset.
          quantity_received: 1000,
          quantity_available: 1000,
          expiry_date: "2030-12-31",
          cost_price: 1,
          mrp: 5,
          sale_price: 5,
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  // ── Radiology modality + priced study (Phase 7.5: Radiology spine) ──────────────────────
  fail(
    `radiology_modalities(${tenant})`,
    (
      await svc.from("radiology_modalities").upsert(
        (() => {
          const r = radiologyStudy(tenant);
          return [{ id: r.modalityId, hospital_id: hospital.id, name: r.modalityName, modality_type: "other", is_active: true }];
        })(),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `radiology_study_master(${tenant})`,
    (
      await svc.from("radiology_study_master").upsert(
        (() => {
          const r = radiologyStudy(tenant);
          return [{
            id: r.studyId,
            hospital_id: hospital.id,
            modality_id: r.modalityId,
            modality_type: "other",
            study_name: r.studyName,
            fee: r.fee,
            is_active: true,
          }];
        })(),
        { onConflict: "id" },
      )
    ).error,
  );

  // Phase 8, MCCD/mortuary spine: autoChargeService's rate lookup (src/lib/serviceRates.ts,
  // getModuleDefaultRate) falls through to service_rates keyed on item_code "mortuary_charge"
  // when no service_master match exists — confirmed live, without it a body release's charge
  // attempt lands in service_charges as billing_status "unbilled" (a deliberate, correct
  // "flag for manual billing" fallback, not a bug) rather than a real bill_line_items row. A
  // real hospital prices this during onboarding; this fixture does the same.
  fail(
    `service_rates(mortuary, ${tenant})`,
    (
      await svc.from("service_rates").upsert(
        {
          hospital_id: hospital.id,
          item_code: "mortuary_charge",
          item_name: "Mortuary Services",
          item_type: "mortuary",
          default_rate: 1500,
          gst_rate: 0,
          is_active: true,
        },
        { onConflict: "hospital_id,item_code" },
      )
    ).error,
  );

  // ── Wards, beds, OT room, TPA (Phase 7, J06: IPD elective surgical, TPA-insured) ────────
  fail(
    `wards(${tenant})`,
    (
      await svc.from("wards").upsert(
        wards(tenant).map((w) => ({
          id: w.id,
          hospital_id: hospital.id,
          name: w.name,
          type: w.type,
          total_beds: beds(tenant).length,
          rate_per_day: w.ratePerDay,
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `beds(${tenant})`,
    (
      await svc.from("beds").upsert(
        beds(tenant).map((b) => ({
          id: b.id,
          hospital_id: hospital.id,
          ward_id: b.wardId,
          bed_number: b.bedNumber,
          // 'available' on every re-run — a bed a previous run's admission occupied must not
          // stay occupied forever, or the next run's admission has nothing to admit into.
          status: "available",
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `ot_rooms(${tenant})`,
    (
      await svc.from("ot_rooms").upsert(
        otRooms(tenant).map((r) => ({
          id: r.id,
          hospital_id: hospital.id,
          name: r.name,
          type: r.type,
          is_active: true,
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `tpa_config(${tenant})`,
    (
      await svc.from("tpa_config").upsert(
        (() => {
          const tpa = tpaConfig(tenant);
          return { id: tpa.id, hospital_id: hospital.id, tpa_name: tpa.tpaName, tpa_code: tpa.tpaCode, is_active: true };
        })(),
        { onConflict: "id" },
      )
    ).error,
  );

  fail(
    `payer_masters(${tenant})`,
    (
      await svc.from("payer_masters").upsert(
        (() => {
          const pm = payerMaster(tenant);
          return { id: pm.id, hospital_id: hospital.id, payer_type: pm.payerType, payer_name: pm.payerName, is_active: true };
        })(),
        { onConflict: "id" },
      )
    ).error,
  );

  // ── Staff ──────────────────────────────────────────────────────────────────
  for (const role of SEEDED_ROLES) {
    const email = staffEmail(tenant, role as SeededRole);
    const authUserId = await upsertAuthUser(svc, email);

    fail(
      `users(${email})`,
      (
        await svc.from("users").upsert(
          {
            id: staffUserId(tenant, role as SeededRole),
            hospital_id: hospital.id,
            auth_user_id: authUserId,
            email,
            full_name: `${role.replace(/_/g, " ")} ${tenant.toUpperCase()}`,
            role,
            is_active: true,
            can_login: true,
            mfa_required: false,
            // Phase 7, J12: WalkInModal's doctor <select> is filtered client-side to
            // `doctors.filter(d => d.department_id === deptId)` the moment a department is
            // picked — and unlike IPD's admission wizard (where department stayed optional
            // specifically to dodge this), OPD registration hard-requires a department. Every
            // OTHER seeded role deliberately has no department_id (IPDAdmissionPage.ts's own
            // comment documents why) — only "doctor" needs one, confirmed live.
            ...(role === "doctor" ? { department_id: departments(tenant)[0].id } : {}),
          },
          { onConflict: "id" },
        )
      ).error,
    );
  }

  // Phase 8, NDPS dual sign-off: a second hospital_admin-role user, distinct from the one
  // every E2E spec logs in as — see seniorAdminEmail/seniorAdminUserId's own comment in
  // constants.ts for why a real, different, known-password account is needed here.
  {
    const email = seniorAdminEmail(tenant);
    const authUserId = await upsertAuthUser(svc, email);
    fail(
      `users(${email})`,
      (
        await svc.from("users").upsert(
          {
            id: seniorAdminUserId(tenant),
            hospital_id: hospital.id,
            auth_user_id: authUserId,
            email,
            full_name: `Senior Admin ${tenant.toUpperCase()}`,
            role: "hospital_admin",
            is_active: true,
            can_login: true,
            mfa_required: false,
          },
          { onConflict: "id" },
        )
      ).error,
    );
  }

  // Phase 7, J06: the seeded doctor needs an active surgical privilege, or OTCaseWorkspace's
  // Confirm/Start Case actions route through a privilege-override modal instead of proceeding
  // directly — a real, separate workflow this fixture is not trying to exercise.
  fail(
    `staff_privileges(doctor, ${tenant})`,
    (
      await svc.from("staff_privileges").upsert(
        {
          id: surgicalPrivilegeId(tenant),
          hospital_id: hospital.id,
          user_id: staffUserId(tenant, "doctor"),
          privilege_scope: "General Surgery - Level I",
          active: true,
        },
        { onConflict: "id" },
      )
    ).error,
  );

  // Phase 7.5, Lab spine: `checkClinicianCredential` (src/lib/credentialGate.ts) gates every
  // lab/radiology/nursing sign-off — `LabResultWorkspace`'s "Validate & Release",
  // `PathologyCaseWorkspace`, `RadiologyReportingWorkspace`'s "Validate & Sign", and
  // `NursingMedicationTask` all call it on `currentUserId`, i.e. whoever is actually logged
  // in. Every spec here logs in as `hospital_admin` only (global-setup.ts) — discovered live
  // when Lab's release step hit a real, correctly-implemented "Credential Check Failed"
  // override modal because no `staff_profiles` row existed for that user at all. A real
  // signing clinician has a registration on file, so the happy path needs one seeded; the
  // "no credential on record → audited override" branch itself stays covered by
  // `credentialGate.ts` reading a genuinely absent row, exercised deliberately for a
  // negative-fork case rather than being every spec's accidental default.
  fail(
    `staff_profiles(hospital_admin, ${tenant})`,
    (
      await svc.from("staff_profiles").upsert(
        {
          hospital_id: hospital.id,
          user_id: staffUserId(tenant, "hospital_admin"),
          registration_number: `MCI-${tenant.toUpperCase()}-000001`,
          registration_body: "Medical Council of India",
          license_expiry_date: "2030-12-31",
          is_active: true,
        },
        { onConflict: "user_id" },
      )
    ).error,
  );

  // ── Patients, and the allergy the negative forks need ──────────────────────
  const patients = PATIENTS_BY_TENANT[tenant];

  fail(
    `patients(${tenant})`,
    (
      await svc.from("patients").upsert(
        patients.map((p) => ({
          id: p.id,
          hospital_id: hospital.id,
          full_name: p.fullName,
          uhid: p.uhid,
          phone: p.phone,
          ...(p.patientCategory ? { patient_category: p.patientCategory } : {}),
          // Phase 7.5, Pharmacy: `patients.allergies` (flat comma text) is what every REAL
          // check reads — RxOrdersTab's prescribing-time contraindication gate,
          // checkDrugSafety, DispensingWorkspace's allergy badge, ADRCheckPanel — confirmed by
          // reading each directly. `allergy_records` (seeded below) is a structured audit
          // table nothing in the prescribing/dispensing path actually queries. Without this,
          // the seeded Penicillin/Sulphonamides allergy is invisible everywhere it matters.
          ...(p.allergy ? { allergies: p.allergy } : {}),
        })),
        { onConflict: "id" },
      )
    ).error,
  );

  for (const p of patients.filter((x) => x.allergy)) {
    fail(
      `allergy_records(${p.uhid})`,
      (
        await svc.from("allergy_records").upsert(
          {
            // Derived from the patient id so a re-run updates rather than appends.
            id: p.id.replace("-2000", "-5000"),
            hospital_id: hospital.id,
            patient_id: p.id,
            allergen: p.allergy!,
            status: "active",
          },
          { onConflict: "id" },
        )
      ).error,
    );
  }

  // ── Entitlements ───────────────────────────────────────────────────────────
  // Without these the control plane blocks the module before a test reaches the feature,
  // and the failure looks like a broken feature rather than a missing subscription.
  fail(
    `hospital_feature_overrides(${tenant})`,
    (
      await svc.from("hospital_feature_overrides").upsert(
        ENABLED_MODULE_KEYS.map((key) => ({
          hospital_id: hospital.id,
          module_key: key,
          is_enabled: true,
        })),
        { onConflict: "hospital_id,module_key" },
      )
    ).error,
  );
}

/** Seed both tenants. Safe to run repeatedly. */
export async function seedTier0(svc: SupabaseClient = serviceClient()): Promise<void> {
  for (const tenant of TENANT_KEYS) {
    await seedHospital(svc, tenant);
  }
}

/**
 * Read back the seeded state as a comparable snapshot.
 *
 * Used by the idempotency check: the Phase 3 exit gate requires two consecutive runs to
 * produce identical state, and "identical" has to be something a machine can compare rather
 * than something a person eyeballs.
 */
export async function snapshotTier0(svc: SupabaseClient = serviceClient()): Promise<string> {
  const parts: string[] = [];
  const ids = [HOSPITAL_A.id, HOSPITAL_B.id];

  // `hospitals`' own key is `id`, not `hospital_id` — every other seeded table is scoped
  // BY hospital_id, but the hospitals row itself IS the hospital, so it filters on `id`.
  // `orderBy` is listed in full (not derived from `cols`) so two rows sharing a leading
  // column — every role_permissions row for one hospital, for instance — still sort
  // deterministically; a snapshot compared by JSON string equality is order-sensitive.
  const tables: { table: string; cols: string; idCol: "id" | "hospital_id"; orderBy: string[] }[] = [
    { table: "hospitals", cols: "id,name,type,subscription_tier,is_active,uhid_prefix", idCol: "id", orderBy: ["id"] },
    { table: "departments", cols: "id,hospital_id,name,type,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "role_permissions", cols: "hospital_id,role_name,role_label,is_system_role", idCol: "hospital_id", orderBy: ["hospital_id", "role_name"] },
    { table: "service_master", cols: "id,hospital_id,name,category,item_type,fee,gst_applicable,gst_percent", idCol: "hospital_id", orderBy: ["id"] },
    { table: "lab_test_master", cols: "id,hospital_id,test_name,category,fee,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "drug_master", cols: "id,hospital_id,drug_name,generic_name,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "drug_batches", cols: "id,hospital_id,drug_id,batch_number,quantity_available,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "radiology_modalities", cols: "id,hospital_id,name,modality_type,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "radiology_study_master", cols: "id,hospital_id,modality_id,study_name,fee,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "service_rates", cols: "hospital_id,item_code,item_name,default_rate,gst_rate,is_active", idCol: "hospital_id", orderBy: ["item_code"] },
    { table: "users", cols: "id,hospital_id,email,role,is_active,can_login", idCol: "hospital_id", orderBy: ["id"] },
    { table: "patients", cols: "id,hospital_id,full_name,uhid,phone,patient_category", idCol: "hospital_id", orderBy: ["id"] },
    { table: "allergy_records", cols: "id,hospital_id,patient_id,allergen,status", idCol: "hospital_id", orderBy: ["id"] },
    { table: "hospital_feature_overrides", cols: "hospital_id,module_key,is_enabled", idCol: "hospital_id", orderBy: ["hospital_id", "module_key"] },
    { table: "wards", cols: "id,hospital_id,name,type,total_beds,rate_per_day,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "beds", cols: "id,hospital_id,ward_id,bed_number,status,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "ot_rooms", cols: "id,hospital_id,name,type,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "tpa_config", cols: "id,hospital_id,tpa_name,tpa_code,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "payer_masters", cols: "id,hospital_id,payer_type,payer_name,is_active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "staff_privileges", cols: "id,hospital_id,user_id,privilege_scope,active", idCol: "hospital_id", orderBy: ["id"] },
    { table: "staff_profiles", cols: "hospital_id,user_id,registration_number,registration_body,license_expiry_date,is_active", idCol: "hospital_id", orderBy: ["user_id"] },
  ];

  for (const { table, cols, idCol, orderBy } of tables) {
    let q = svc.from(table).select(cols).in(idCol, ids);
    for (const col of orderBy) q = q.order(col as never);
    const { data, error } = await q;
    if (error) throw new Error(`Snapshot of ${table} failed: ${error.message}`);
    parts.push(`${table}\n${JSON.stringify(data ?? [], null, 0)}`);
  }

  return parts.join("\n---\n");
}
