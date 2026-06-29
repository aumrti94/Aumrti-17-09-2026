-- ============================================================
-- DICOM / PACS: hospital_pacs_config + dicom_files
-- ============================================================

-- Per-hospital PACS connection configuration
CREATE TABLE IF NOT EXISTS hospital_pacs_config (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id       uuid        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  pacs_type         text        NOT NULL DEFAULT 'none',
    -- none | wado_uri | wado_rs | ohif | custom
  pacs_name         text,          -- e.g. "Synapse PACS", "Orthanc"
  wado_uri_root     text,          -- https://pacs.hospital.com/wado
  wado_rs_root      text,          -- https://pacs.hospital.com/wado/rs
  qido_rs_root      text,          -- https://pacs.hospital.com/qido/rs
  ohif_viewer_url   text,          -- https://ohif.hospital.com/viewer
  ae_title          text,          -- DICOM AE Title
  use_auth          boolean     NOT NULL DEFAULT false,
  auth_username     text,
  auth_password_enc text,          -- store encrypted; never return to client
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE hospital_pacs_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pacs_config_hospital_rls" ON hospital_pacs_config
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE UNIQUE INDEX IF NOT EXISTS hospital_pacs_config_hospital_idx
  ON hospital_pacs_config (hospital_id);

-- ----------------------------------------------------------------
-- DICOM files uploaded directly to Supabase Storage
-- (for hospitals without PACS)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dicom_files (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id           uuid        NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  order_id              uuid        REFERENCES radiology_orders(id) ON DELETE CASCADE,

  -- Storage
  storage_path          text        NOT NULL,   -- path inside "dicom" bucket
  original_filename     text        NOT NULL,
  file_size_bytes       bigint,

  -- DICOM metadata (extracted client-side at upload)
  study_instance_uid    text,
  series_instance_uid   text,
  sop_instance_uid      text,
  sop_class_uid         text,
  transfer_syntax_uid   text,
  modality              text,
  series_description    text,
  series_number         int,
  instance_number       int,
  rows                  int,
  columns               int,
  number_of_frames      int         DEFAULT 1,
  bits_allocated        int,
  is_jpeg_compressed    boolean     NOT NULL DEFAULT false,

  -- Audit
  uploaded_by           uuid        REFERENCES users(id),
  uploaded_at           timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);

ALTER TABLE dicom_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dicom_files_hospital_rls" ON dicom_files
  FOR ALL USING (hospital_id = get_user_hospital_id());

CREATE INDEX IF NOT EXISTS dicom_files_order_idx    ON dicom_files (order_id);
CREATE INDEX IF NOT EXISTS dicom_files_hospital_idx ON dicom_files (hospital_id);
CREATE INDEX IF NOT EXISTS dicom_files_study_idx    ON dicom_files (study_instance_uid);
