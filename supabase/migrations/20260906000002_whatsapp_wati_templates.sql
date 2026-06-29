-- Add wati_template_name column to whatsapp_templates
-- Applied: 2026-05-08

ALTER TABLE whatsapp_templates ADD COLUMN IF NOT EXISTS wati_template_name text;
