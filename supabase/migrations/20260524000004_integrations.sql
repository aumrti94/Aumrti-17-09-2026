-- ─────────────────────────────────────────────────────────────────────────────
-- Integrations Console: Lab Analyzers, PACS, WhatsApp multi-provider, Tally
-- ─────────────────────────────────────────────────────────────────────────────

-- Lab Device Connectors (analyzers, hematology, blood-gas, etc.)
CREATE TABLE IF NOT EXISTS public.lab_device_connectors (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id      UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  device_type      TEXT        NOT NULL DEFAULT 'analyzer',
  -- device_type: 'analyzer' | 'hematology' | 'blood_gas' | 'biochemistry' | 'urine' | 'microbiology' | 'other'
  connection_type  TEXT        NOT NULL DEFAULT 'tcp_ip',
  -- connection_type: 'tcp_ip' | 'serial' | 'file_drop'
  host             TEXT,
  port             INTEGER,
  serial_port      TEXT,       -- e.g. COM3 or /dev/ttyUSB0 for serial
  protocol         TEXT        NOT NULL DEFAULT 'hl7',
  -- protocol: 'hl7' | 'astm' | 'csv' | 'custom'
  file_drop_path   TEXT,       -- watched folder path for file_drop type
  active           BOOLEAN     NOT NULL DEFAULT true,
  last_seen        TIMESTAMPTZ,
  last_import      TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_device_connectors_hospital
  ON public.lab_device_connectors(hospital_id);

ALTER TABLE public.lab_device_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY lab_device_connectors_hospital_policy
  ON public.lab_device_connectors
  FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PACS Connectors (one per hospital — stores DICOM or vendor-API credentials)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pacs_connectors (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id  UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  vendor_name  TEXT        NOT NULL,
  base_url     TEXT,
  ae_title     TEXT,       -- DICOM Application Entity Title
  dicom_port   INTEGER     DEFAULT 4242,
  auth_type    TEXT        NOT NULL DEFAULT 'none',
  -- auth_type: 'none' | 'basic' | 'bearer' | 'dicom_tls'
  credentials  JSONB       NOT NULL DEFAULT '{}',
  active       BOOLEAN     NOT NULL DEFAULT false,
  last_ping    TIMESTAMPTZ,
  ping_status  TEXT,       -- 'ok' | 'error' | null
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_pacs_hospital UNIQUE (hospital_id)
);

ALTER TABLE public.pacs_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY pacs_connectors_hospital_policy
  ON public.pacs_connectors
  FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- WhatsApp Connectors — multi-provider (Interakt, Gupshup, Twilio, Meta Cloud)
-- The legacy WATI config lives in hospitals.wati_api_url; new providers go here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_connectors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id     UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  provider        TEXT        NOT NULL,
  -- provider: 'interakt' | 'gupshup' | 'twilio' | 'meta_cloud' | 'wati'
  api_key         TEXT,
  api_secret      TEXT,
  sender_number   TEXT,       -- WhatsApp sender number (E.164)
  base_url        TEXT,
  template_config JSONB       NOT NULL DEFAULT '{}',
  active          BOOLEAN     NOT NULL DEFAULT false,
  last_tested     TIMESTAMPTZ,
  test_status     TEXT,       -- 'ok' | 'error' | null
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_hospital_provider UNIQUE (hospital_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_connectors_hospital
  ON public.whatsapp_connectors(hospital_id);

ALTER TABLE public.whatsapp_connectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_connectors_hospital_policy
  ON public.whatsapp_connectors
  FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Tally Ledger Mapping — maps Aumrti revenue heads to Tally ledger names
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tally_ledger_mapping (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id         UUID        NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  aumrti_revenue_head TEXT        NOT NULL,
  -- heads: 'opd_consultation' | 'ipd_room' | 'ipd_services' | 'lab' | 'radiology'
  --        | 'pharmacy' | 'ot_charges' | 'ambulance' | 'misc' | 'insurance_receipt'
  tally_ledger_name   TEXT        NOT NULL,
  tally_group         TEXT,       -- e.g. 'Direct Income', 'Indirect Income'
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tally_hospital_head UNIQUE (hospital_id, aumrti_revenue_head)
);

CREATE INDEX IF NOT EXISTS idx_tally_ledger_mapping_hospital
  ON public.tally_ledger_mapping(hospital_id);

ALTER TABLE public.tally_ledger_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY tally_ledger_mapping_hospital_policy
  ON public.tally_ledger_mapping
  FOR ALL
  TO authenticated
  USING (
    hospital_id IN (
      SELECT hospital_id FROM public.users WHERE auth_user_id = auth.uid()
    )
  );
