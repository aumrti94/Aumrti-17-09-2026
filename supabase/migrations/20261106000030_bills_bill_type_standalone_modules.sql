-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: bills_bill_type_standalone_modules
-- Purpose  : Close the standalone-module billing gap 20261106000004 documented but
--            deliberately deferred.
--
-- Bug      : Found live while building Phase 8's MCCD/mortuary regression test.
--            src/lib/serviceBilling.ts's autoChargeService, when called with no
--            admissionId and no encounterId (its "standalone" branch — ambulance,
--            mortuary, dietetics, etc.), inserts a new bills row with
--              bill_type: serviceModule.toLowerCase().replace("_", "")
--            MortuaryPage.tsx's handleRelease calls this on every body release —
--            and every single call has been failing with
--              new row for relation "bills" violates check constraint
--              "bills_bill_type_check"
--            silently, because the call site wraps it in `.catch(() => {})`. A
--            hospital releasing a body has NEVER had that release actually
--            billed, on any tenant, ever — the charge attempt does not even
--            reach the service_charges "unbilled" fallback, because the insert
--            fails before that fallback path is reached for this branch (that
--            fallback only fires when the RATE is unresolved, not when the bill
--            insert itself is rejected).
--
--            20261106000004 already named this exact gap ("the standalone branch
--            of autoChargeService, which derives bill_type from the module name
--            (mortuary, dietetics, ambulance, ed, oncology, mentalhealth)") and
--            deliberately deferred it. Reproducing it live and enumerating every
--            MODULE_* constant in serviceBilling.ts against the transform found
--            three more silently-missing values that comment did not name:
--            'cssd', 'opd_consult' -> 'opdconsult', and 'other'. A fourth,
--            'blood_bank' -> 'bloodbank', is a DIFFERENT failure shape: the
--            constraint already allows 'blood_bank' (with the underscore), but
--            the code strips it, so blood_bank's standalone branch would insert
--            'bloodbank' and still fail against the underscore'd value already
--            in the list — added here too so the actual runtime value is covered.
--
-- Fix      : add every currently-missing standalone-module value in one pass,
--            rather than the one-at-a-time pattern that let this exact bug class
--            recur three times already (20260520000002, 20260821000002,
--            20261106000004). Permissive change only — adds values, removes
--            none, touches no existing row.
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
      'homecare', 'chroniccare', 'registration',
      'mortuary',      -- MODULE_MORTUARY standalone bills
      'dietetics',     -- MODULE_DIETETICS standalone bills
      'ambulance',     -- MODULE_AMBULANCE standalone bills
      'cssd',          -- MODULE_CSSD standalone bills
      'opdconsult',    -- MODULE_OPD_CONSULT standalone bills ("opd_consult" stripped)
      'ed',            -- MODULE_ED standalone bills (encounter-linked ED bills use 'emergency' via findOrCreateEdBill instead)
      'oncology',      -- MODULE_ONCOLOGY standalone bills
      'mentalhealth',  -- MODULE_MENTAL_HEALTH standalone bills ("mental_health" stripped)
      'bloodbank',     -- MODULE_BLOOD_BANK standalone bills ("blood_bank" stripped — the actual runtime value, distinct from the pre-existing 'blood_bank' entry above)
      'other'          -- MODULE_OTHER standalone bills
    ));
END $$;
