-- Editable marketing feature bullets for subscription plan cards.
-- Each entry is { "text": string, "included": boolean } — `included` drives the ✓ (true) / ✗ (false)
-- mark on the /register plan cards. Previously these bullets were hardcoded in
-- Step4ChoosePlan.tsx (PLAN_HIGHLIGHTS); now they live per-plan in the DB and are editable from
-- Platform → Plans Manager (+ AI copywriter). subscription_plans is already anon/public-readable.

ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS feature_highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill from the current hardcoded arrays so nothing renders empty. Only where still empty.
UPDATE public.subscription_plans SET feature_highlights = '[
  {"text": "OPD, IPD & Emergency", "included": true},
  {"text": "Lab, Radiology & Pharmacy", "included": true},
  {"text": "Billing & Payments (GST)", "included": true},
  {"text": "HR & Inventory", "included": true},
  {"text": "WhatsApp Notifications", "included": true},
  {"text": "Insurance / TPA", "included": false},
  {"text": "AI Voice Scribe", "included": false},
  {"text": "NABH Compliance Engine", "included": false},
  {"text": "Analytics & BI Dashboard", "included": false}
]'::jsonb
WHERE slug = 'starter' AND (feature_highlights IS NULL OR feature_highlights = '[]'::jsonb);

UPDATE public.subscription_plans SET feature_highlights = '[
  {"text": "Everything in Starter", "included": true},
  {"text": "All 56 Modules", "included": true},
  {"text": "AI Voice Scribe (4 languages)", "included": true},
  {"text": "NABH 6th Edition Engine", "included": true},
  {"text": "ABDM / ABHA Integration", "included": true},
  {"text": "Insurance / TPA / PMJAY", "included": true},
  {"text": "Analytics & BI Dashboard", "included": true},
  {"text": "Oncology, IVF, Dialysis & more", "included": true},
  {"text": "Priority Support", "included": true}
]'::jsonb
WHERE slug = 'professional' AND (feature_highlights IS NULL OR feature_highlights = '[]'::jsonb);

UPDATE public.subscription_plans SET feature_highlights = '[
  {"text": "Everything in Professional", "included": true},
  {"text": "Multi-Branch Management", "included": true},
  {"text": "White-Label Branding", "included": true},
  {"text": "Custom Integrations", "included": true},
  {"text": "SLA-backed Support", "included": true},
  {"text": "On-site Training", "included": true},
  {"text": "Data Migration Assistance", "included": true},
  {"text": "Unlimited Users & Beds", "included": true}
]'::jsonb
WHERE slug = 'enterprise' AND (feature_highlights IS NULL OR feature_highlights = '[]'::jsonb);

-- Clinics had no hardcoded entry — give it a sensible starter-style set.
UPDATE public.subscription_plans SET feature_highlights = '[
  {"text": "OPD & Appointments", "included": true},
  {"text": "Billing & Payments (GST)", "included": true},
  {"text": "Pharmacy & Basic Inventory", "included": true},
  {"text": "WhatsApp Notifications", "included": true},
  {"text": "IPD / Wards", "included": false},
  {"text": "Lab & Radiology", "included": false},
  {"text": "Insurance / TPA", "included": false},
  {"text": "Analytics & BI Dashboard", "included": false}
]'::jsonb
WHERE slug = 'clinics' AND (feature_highlights IS NULL OR feature_highlights = '[]'::jsonb);
