-- queue_state: tracks the currently-called token per doctor (for TV display + real-time announcements)
CREATE TABLE IF NOT EXISTS queue_state (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id   UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  doctor_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  current_token_id     UUID REFERENCES opd_tokens(id) ON DELETE SET NULL,
  current_token_number TEXT,
  current_patient_name TEXT,
  called_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  called_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_queue_state_hospital_doctor UNIQUE (hospital_id, doctor_id)
);

-- tv_display_settings: per-hospital TV queue display and announcement configuration
CREATE TABLE IF NOT EXISTS tv_display_settings (
  id                      UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id             UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE UNIQUE,
  announcement_language   TEXT NOT NULL DEFAULT 'en-IN',
  call_format             TEXT NOT NULL DEFAULT 'Token {number}, please proceed to {doctor}',
  marketing_slides        JSONB NOT NULL DEFAULT '[]'::jsonb,
  slide_interval_seconds  INTEGER NOT NULL DEFAULT 8,
  show_marketing_panel    BOOLEAN NOT NULL DEFAULT true,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE queue_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tv_display_settings ENABLE ROW LEVEL SECURITY;

-- queue_state: hospital staff can read/write; TV display (anon) can only read
CREATE POLICY "Hospital staff manage queue_state"
  ON queue_state FOR ALL
  USING (
    hospital_id IN (
      SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can read queue_state"
  ON queue_state FOR SELECT USING (true);

-- tv_display_settings: public read so TV page (no auth) can fetch it
CREATE POLICY "Anyone can read tv_display_settings"
  ON tv_display_settings FOR SELECT USING (true);

CREATE POLICY "Hospital admins manage tv_display_settings"
  ON tv_display_settings FOR ALL
  USING (
    hospital_id IN (
      SELECT hospital_id FROM users WHERE auth_user_id = auth.uid()
    )
  );
