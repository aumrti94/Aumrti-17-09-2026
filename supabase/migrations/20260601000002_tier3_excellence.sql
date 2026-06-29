-- NABH Excellence Tier 3 — AI feature supporting columns

-- Readmission risk on admissions (stored at discharge)
alter table public.admissions
  add column if not exists readmission_risk_level        text,
  add column if not exists readmission_risk_score        integer,
  add column if not exists readmission_risk_factors      jsonb,
  add column if not exists readmission_risk_assessed_at  timestamptz;

-- Burnout risk scores (refreshed periodically per staff member)
create table if not exists public.staff_burnout_scores (
  id               uuid        primary key default gen_random_uuid(),
  hospital_id      uuid        not null references public.hospitals(id) on delete cascade,
  user_id          uuid        not null references public.users(id),
  score_date       date        not null default current_date,
  burnout_score    integer     not null check (burnout_score between 0 and 100),
  risk_level       text        not null default 'low',
  attendance_score integer,
  overtime_score   integer,
  incident_score   integer,
  training_score   integer,
  risk_factors     jsonb,
  recommendations  text,
  assessed_by_ai   boolean     default true,
  created_at       timestamptz not null default now(),
  unique (hospital_id, user_id, score_date)
);

create index if not exists staff_burnout_scores_hospital_date
  on public.staff_burnout_scores(hospital_id, score_date desc);

alter table public.staff_burnout_scores enable row level security;

create policy "staff_burnout_scores_hospital_isolation"
  on public.staff_burnout_scores
  for all
  to authenticated
  using (hospital_id = public.get_user_hospital_id())
  with check (hospital_id = public.get_user_hospital_id());
