-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: bills_bill_type_allow_registration
-- Purpose  : Let the optional patient registration fee actually post.
--
-- Bug      : "Collect Registration Fee" on the patient registration modal fails
--            with
--              new row for relation "bills" violates check constraint
--              "bills_bill_type_check"
--
--            createAndPayRegistrationBill (src/lib/registrationBill.ts) inserts
--            the fee as an ordinary bills row with bill_type = 'registration'.
--            Migration 20261009000172 taught bill_prefix_for_type() about
--            'registration' so the row would land on the REG-YYYYMMDD-#### series
--            — but nothing ever added 'registration' to bills_bill_type_check,
--            last rewritten by 20260821000002_home_care_billing_and_audit. The
--            BEFORE INSERT trigger mints the number, then the CHECK rejects the
--            row, so the fee has never been collectable on any tenant: the modal
--            surfaces the raw Postgres message and the front desk cannot finish
--            registration without "Skip / collect later".
--
-- Fix      : add 'registration' to the allow-list. Permissive change only — adds
--            one value, removes none, touches no existing row.
--
-- NOTE     : this is the third time this CHECK has been patched after a module
--            shipped a bill_type it did not know about (20260520000002,
--            20260821000002, here). Known still-missing values that will fail the
--            same way when exercised: 'physio' (src/pages/physio/PhysioPage.tsx
--            writes 'physio', the list has 'physiotherapy') and the standalone
--            branch of autoChargeService, which derives bill_type from the module
--            name (mortuary, dietetics, ambulance, ed, oncology, mentalhealth).
--            Deliberately NOT changed here — out of scope for this fix; the
--            billing-leakage ticket 20260821000002 asks for still stands, and
--            dropping this CHECK outright (as 20261008000051 did for
--            bill_line_items.item_type, for exactly this reason) is the decision
--            that ticket should make.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_bill_type_check;
  ALTER TABLE public.bills
    ADD CONSTRAINT bills_bill_type_check
    CHECK (bill_type IN (
      'opd', 'ipd', 'emergency', 'daycare', 'package',
      'lab', 'radiology', 'pharmacy', 'dialysis', 'ot',
      'blood_bank', 'vaccination', 'dental', 'physiotherapy',
      'nursing', 'telemedicine', 'ivf', 'ayush', 'retail',
      'homecare',      -- MODULE_HOME_CARE standalone bills (20260821000002)
      'chroniccare',   -- MODULE_CHRONIC_CARE review bills  (20260821000002)
      'registration'   -- NEW: patient registration fee, REG series (20261009000172)
    ));
END $$;
