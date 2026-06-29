-- NABH 6th Edition Gap Fill Migration
-- Covers: Fire Safety, Medical Gas, Electrical Safety, Hand Hygiene,
--         Performance Appraisals, Occupational Health, Palliative Care, Pain Audits

-- ── 1. Fire Safety Drills ────────────────────────────────────────────────────
create table if not exists fire_safety_drills (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  drill_date      date not null,
  drill_type      text not null default 'evacuation', -- evacuation | extinguisher | code_red | mock
  area_covered    text,
  shift           text, -- morning | afternoon | night
  participants_count integer default 0,
  time_to_evacuate_mins numeric(5,2),
  fire_exits_clear boolean default true,
  extinguisher_count integer,
  observations    text,
  corrective_actions text,
  conducted_by    uuid references users(id),
  document_url    text,
  created_at      timestamptz not null default now()
);

create index if not exists fire_safety_drills_hospital_date
  on fire_safety_drills(hospital_id, drill_date desc);

alter table fire_safety_drills enable row level security;
create policy "hospital_isolation" on fire_safety_drills
  using (hospital_id = public.get_user_hospital_id());

-- ── 2. Medical Gas Logs ──────────────────────────────────────────────────────
create table if not exists medical_gas_logs (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  log_date        date not null,
  gas_type        text not null, -- oxygen | nitrous_oxide | compressed_air | co2 | nitrogen
  source_type     text default 'cylinder', -- cylinder | manifold | psa_plant | pipeline
  pressure_bar    numeric(6,2),         -- current reading (bar)
  volume_liters   numeric(10,2),        -- consumption / refill in liters
  cylinders_in    integer default 0,    -- cylinders received
  cylinders_out   integer default 0,    -- cylinders returned/exhausted
  supplier        text,
  alarm_triggered boolean default false,
  alarm_details   text,
  pipeline_checked boolean default true,
  next_inspection_date date,
  recorded_by     uuid references users(id),
  remarks         text,
  created_at      timestamptz not null default now()
);

create index if not exists medical_gas_logs_hospital_date
  on medical_gas_logs(hospital_id, log_date desc);

alter table medical_gas_logs enable row level security;
create policy "hospital_isolation" on medical_gas_logs
  using (hospital_id = public.get_user_hospital_id());

-- ── 3. Electrical Safety Logs ────────────────────────────────────────────────
create table if not exists electrical_safety_logs (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  log_date        date not null,
  check_type      text not null, -- dg_set | ups | earthing | panel | lighting | emergency_lighting
  equipment_id    text,          -- asset tag or description
  location        text,
  load_kva        numeric(8,2),
  fuel_level_pct  integer,       -- for DG sets
  run_duration_mins integer,     -- auto-start test duration
  status          text not null default 'ok', -- ok | observation | fault
  findings        text,
  corrective_actions text,
  next_due_date   date,
  performed_by    uuid references users(id),
  document_url    text,
  created_at      timestamptz not null default now()
);

create index if not exists electrical_safety_logs_hospital_date
  on electrical_safety_logs(hospital_id, log_date desc);

alter table electrical_safety_logs enable row level security;
create policy "hospital_isolation" on electrical_safety_logs
  using (hospital_id = public.get_user_hospital_id());

-- ── 4. Hand Hygiene Audits ───────────────────────────────────────────────────
create table if not exists hand_hygiene_audits (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  audit_date      date not null,
  ward_id         uuid references wards(id),
  area_name       text,
  auditor_id      uuid references users(id),
  -- Five Moments counts
  m1_before_patient_contact_total    integer default 0,
  m1_before_patient_contact_done     integer default 0,
  m2_before_aseptic_total            integer default 0,
  m2_before_aseptic_done             integer default 0,
  m3_after_body_fluid_total          integer default 0,
  m3_after_body_fluid_done           integer default 0,
  m4_after_patient_contact_total     integer default 0,
  m4_after_patient_contact_done      integer default 0,
  m5_after_touching_surroundings_total integer default 0,
  m5_after_touching_surroundings_done  integer default 0,
  -- Technique
  glove_use_appropriate boolean default true,
  hand_rub_available    boolean default true,
  soap_available        boolean default true,
  -- Computed
  total_opportunities integer generated always as (
    m1_before_patient_contact_total + m2_before_aseptic_total +
    m3_after_body_fluid_total + m4_after_patient_contact_total +
    m5_after_touching_surroundings_total
  ) stored,
  total_compliant integer generated always as (
    m1_before_patient_contact_done + m2_before_aseptic_done +
    m3_after_body_fluid_done + m4_after_patient_contact_done +
    m5_after_touching_surroundings_done
  ) stored,
  observations    text,
  corrective_actions text,
  created_at      timestamptz not null default now()
);

create index if not exists hand_hygiene_audits_hospital_date
  on hand_hygiene_audits(hospital_id, audit_date desc);

alter table hand_hygiene_audits enable row level security;
create policy "hospital_isolation" on hand_hygiene_audits
  using (hospital_id = public.get_user_hospital_id());

-- ── 5. Performance Appraisals ─────────────────────────────────────────────────
create table if not exists performance_appraisals (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  user_id         uuid not null references users(id),
  appraisal_period text not null, -- e.g. "2025-26 Annual" or "Q1 2026"
  period_start    date not null,
  period_end      date not null,
  appraisal_type  text default 'annual', -- annual | mid_year | probation | exit
  -- KRA scores (0-5 each)
  kra_clinical_score       numeric(3,1),
  kra_patient_safety_score numeric(3,1),
  kra_teamwork_score       numeric(3,1),
  kra_attendance_score     numeric(3,1),
  kra_training_score       numeric(3,1),
  kra_quality_score        numeric(3,1),
  -- Self assessment
  self_assessment_text     text,
  self_overall_score       numeric(3,1),
  -- Manager review
  manager_id      uuid references users(id),
  manager_comments text,
  manager_score   numeric(3,1),
  overall_rating  text, -- outstanding | exceeds | meets | needs_improvement | unsatisfactory
  goals_next_period text,
  -- Workflow
  status          text not null default 'draft', -- draft | self_submitted | manager_reviewed | hr_approved | closed
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists performance_appraisals_hospital_user
  on performance_appraisals(hospital_id, user_id, period_start desc);

alter table performance_appraisals enable row level security;
create policy "hospital_isolation" on performance_appraisals
  using (hospital_id = public.get_user_hospital_id());

-- ── 6. Occupational Health Records ───────────────────────────────────────────
create table if not exists occupational_health_records (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  user_id         uuid not null references users(id),
  record_type     text not null,
  -- needle_stick | blood_exposure | chemical_exposure | musculoskeletal_injury
  -- vaccination | pre_employment | periodic_checkup | return_to_work | rtw_clearance
  event_date      date not null,
  description     text,
  -- Needle stick / exposure specific
  exposure_site   text,
  patient_hiv_status  text,
  patient_hbsag_status text,
  pep_given       boolean,
  pep_start_date  date,
  -- Vaccination
  vaccine_name    text,
  dose_number     integer,
  next_due_date   date,
  -- Fitness / checkup
  fit_for_duty    boolean,
  restrictions    text,
  -- Outcome
  outcome         text,
  referred_to     text,
  follow_up_date  date,
  -- Recorded by
  recorded_by     uuid references users(id),
  document_url    text,
  created_at      timestamptz not null default now()
);

create index if not exists occupational_health_records_hospital_user
  on occupational_health_records(hospital_id, user_id, event_date desc);

alter table occupational_health_records enable row level security;
create policy "hospital_isolation" on occupational_health_records
  using (hospital_id = public.get_user_hospital_id());

-- ── 7. Palliative Care Plans ─────────────────────────────────────────────────
create table if not exists palliative_care_plans (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  admission_id    uuid references admissions(id),
  patient_id      uuid not null references patients(id),
  -- Care goals
  care_goal       text not null default 'comfort', -- comfort | curative | mixed
  dnacpr          boolean default false,           -- Do Not Attempt CPR order
  dnacpr_date     date,
  dnacpr_reason   text,
  advance_directive_present boolean default false,
  advance_directive_url     text,
  -- Symptom management
  pain_score_current integer check (pain_score_current between 0 and 10),
  pain_score_target  integer check (pain_score_target between 0 and 10),
  pain_regimen    text,
  dyspnoea_management text,
  nausea_management   text,
  bowel_management    text,
  -- Spiritual / psychosocial
  spiritual_needs   text,
  family_counselled boolean default false,
  counselling_notes text,
  -- Team
  palliative_physician_id uuid references users(id),
  key_nurse_id            uuid references users(id),
  social_worker_assigned  boolean default false,
  -- Review
  last_reviewed_at  timestamptz,
  next_review_date  date,
  goals_of_care_discussed boolean default false,
  status          text not null default 'active', -- active | discharged | deceased | suspended
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists palliative_care_plans_hospital_patient
  on palliative_care_plans(hospital_id, patient_id, created_at desc);

alter table palliative_care_plans enable row level security;
create policy "hospital_isolation" on palliative_care_plans
  using (hospital_id = public.get_user_hospital_id());

-- ── 8. Pain Audit Records ────────────────────────────────────────────────────
create table if not exists pain_audit_records (
  id              uuid primary key default gen_random_uuid(),
  hospital_id     uuid not null references hospitals(id) on delete cascade,
  audit_date      date not null,
  ward_id         uuid references wards(id),
  area_name       text,
  auditor_id      uuid references users(id),
  -- Sample size
  total_patients_audited   integer default 0,
  pain_assessed_on_admission integer default 0,
  pain_reassessed_4hourly    integer default 0,
  pain_scale_used_correctly  integer default 0,
  analgesic_given_within_30min integer default 0,
  non_pharma_used            integer default 0,
  -- Findings
  observations    text,
  corrective_actions text,
  created_at      timestamptz not null default now()
);

create index if not exists pain_audit_records_hospital_date
  on pain_audit_records(hospital_id, audit_date desc);

alter table pain_audit_records enable row level security;
create policy "hospital_isolation" on pain_audit_records
  using (hospital_id = public.get_user_hospital_id());

-- ── 9. Nutritional Screening (MUST score) on admissions ─────────────────────
alter table admissions
  add column if not exists must_score            integer,   -- 0=low, 1=medium, 2+=high
  add column if not exists must_bmi              numeric(4,1),
  add column if not exists must_weight_loss_pct  numeric(4,1),
  add column if not exists must_acute_disease    boolean default false,
  add column if not exists must_assessed_at      timestamptz,
  add column if not exists nutritional_plan      text;
