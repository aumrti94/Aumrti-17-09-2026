-- Repair service_master.item_type for hospital-authored catalog rows.
--
-- Bug: service_master.item_type has DEFAULT 'service' (20260323042425), and the
-- Settings › Services & Fees "Add Service" drawer only ever wrote `category` —
-- never `item_type`. The Billing line-item picker derives GST from item_type via
-- getDefaultGSTRate (src/lib/gstRules.ts), where GST_RATE_RULES.service = 18.
-- Net effect: every service created from that drawer was billed at 18% GST even
-- though the screen displayed "GST: No". Live overtaxation on patient bills.
--
-- The app-side fixes (writing item_type on save, and honouring gst_applicable in
-- the picker) only help rows created from now on. This repairs the existing ones.

-- 1. Backfill: for hospital-authored rows only. The drawer's category vocabulary is
--    exactly the item_type vocabulary gstRules models, so category is the correct
--    value. Scoped deliberately:
--      - source_table IS NULL  → skips trigger-maintained mirrors from
--        20261008000136 / 20261008000139 (wards, lab_test_master, lab_test_groups,
--        radiology_study_master, health_packages, service_rates, day_care_procedures),
--        which already carry a correct item_type and would be overwritten by their
--        own sync trigger on the next source edit anyway.
--      - item_type = 'service' → only rows that fell through to the column default.
--        Rows written by Step4Doctors / SettingsStaffPage / ImportWizard already set
--        item_type explicitly and are left untouched.
--      - category IN (…)      → the drawer's six options. Excludes the OT and ED
--        fixed-charge rows (item_type 'ot_charge', 'surgeon_fee', 'anaesthesia_fee',
--        'ed_consultation', …) which upsertFixedCharge already sets correctly.
UPDATE public.service_master
   SET item_type = category
 WHERE source_table IS NULL
   AND item_type = 'service'
   AND category IN ('consultation', 'procedure', 'package', 'lab', 'radiology', 'other');

-- 2. Move the column default off the 18% trap. Any future insert that forgets the
--    column now lands on a modelled type instead of silently attracting 18% GST.
--    'other' is still 18% in GST_RATE_RULES, but it is a type the rules table models
--    deliberately, and resolveServiceGstPercent now lets the gst_applicable toggle
--    override it for hospital-authored rows.
ALTER TABLE public.service_master ALTER COLUMN item_type SET DEFAULT 'other';

-- Note: bill_line_items is deliberately NOT touched. Already-issued bills keep the
-- tax they were raised with; restating historical GST would desync them from the
-- GL journals and any filed GSTR return.
