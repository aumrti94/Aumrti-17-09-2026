-- Phase 8B — found while building the delivery-recording screen (DeliveryRecordPage.tsx queries
-- partograph_entries for read-only labour-progress context, and got zero rows back for a row that
-- genuinely existed, inserted moments earlier).
--
-- WHY. `hospital_isolation_partograph` (20260901000008_add_specialty_emr_tables.sql) hand-rolls
-- `hospital_id = (SELECT hospital_id FROM users WHERE id = auth.uid())` instead of calling the
-- canonical `public.get_user_hospital_id()` helper. `id = auth.uid()` was the CORRECT predicate
-- only before migration 20260322111223 repointed the canonical helper itself to
-- `auth_user_id = auth.uid()`, once `public.users.id` and the auth uid started diverging for every
-- account created after that point (the exact bug class CLAUDE.md's `_by`-column rule exists for —
-- this is the same divergence, in an RLS predicate rather than a foreign key). This migration
-- postdates that fix by over five months but was never updated to match, so partograph_entries has
-- never been readable, by anyone, on any hospital, for any post-decoupling account — the real
-- Partograph.tsx screen's own `load()` has been silently getting an empty result back this whole
-- time, exactly the "silent, not thrown" failure shape this whole test-writing effort exists to
-- catch.
--
-- SCOPE NOTE. `grep -rl "FROM users WHERE id = auth.uid()" supabase/migrations/` turns up 14
-- files (the entire 2026-09-01 EMR-expansion batch: dental, IVF, vaccination, HMIS, PMJAY, health
-- packages, asset management, specialty EMR, lab calibration, CGHS/ECHS beneficiaries, EMI payment
-- plans, payment-first workflow). This migration fixes only `partograph_entries` — the one this
-- pass's own delivery-recording work actually exercises live. The other ~13 files were not audited
-- in this pass; each likely carries the identical defect and needs its own confirming fix.

DROP POLICY IF EXISTS "hospital_isolation_partograph" ON public.partograph_entries;

CREATE POLICY "hospital_isolation_partograph" ON public.partograph_entries
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());
