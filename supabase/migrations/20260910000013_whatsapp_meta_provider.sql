-- Add direct Meta Cloud API as an alternative WhatsApp provider, alongside the existing WATI integration.
-- whatsapp_provider selects which credentials whatsapp-send.ts / send-whatsapp-meta use for this hospital.
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS whatsapp_provider text NOT NULL DEFAULT 'wati';
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS meta_phone_number_id text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS meta_waba_id text;
ALTER TABLE public.hospitals ADD COLUMN IF NOT EXISTS meta_access_token text;

-- Meta template name/language are independent of the WATI template name already on this table.
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS meta_template_name text;
ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS meta_template_lang text NOT NULL DEFAULT 'en';
