-- Minimal stand-in for the tables price_consultation() touches, with the same column
-- names/types as the real migrations, so the ladder and episode walk can be exercised.

CREATE TABLE hospitals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hospital_id uuid, name text);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hospital_id uuid, full_name text,
  department_id uuid, role text DEFAULT 'doctor', is_active boolean DEFAULT true
);
CREATE TABLE patients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hospital_id uuid, full_name text, phone text);

CREATE TABLE service_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL, name text NOT NULL, category text DEFAULT 'consultation',
  fee numeric(10,2) NOT NULL DEFAULT 0, follow_up_fee numeric(10,2),
  is_active boolean NOT NULL DEFAULT true, item_type text DEFAULT 'service',
  doctor_id uuid, department_id uuid, validity_days integer DEFAULT 7,
  follow_up_max_visits integer, emergency_fee numeric(10,2), gst_applicable boolean DEFAULT false, gst_percent numeric(5,2) DEFAULT 0
);

CREATE TABLE opd_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL, patient_id uuid NOT NULL, doctor_id uuid, department_id uuid,
  token_number text, visit_date date DEFAULT CURRENT_DATE NOT NULL,
  status text DEFAULT 'waiting' NOT NULL, charged_tier text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE hospital_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL, key text NOT NULL, value jsonb NOT NULL DEFAULT '{}',
  UNIQUE (hospital_id, key)
);
