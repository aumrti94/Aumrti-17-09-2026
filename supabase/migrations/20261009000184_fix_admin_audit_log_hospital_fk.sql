-- ============================================================
-- Fix admin_audit_log -> hospitals FK to not block hospital purge
-- ============================================================
-- target_hospital_id (20261008000105) was created with a plain REFERENCES
-- clause, defaulting to ON DELETE NO ACTION. That blocks
-- purge_hospital_finalize's `DELETE FROM hospitals` whenever any audit row
-- (e.g. the hospital_delete_requested row written at soft-delete time)
-- references the hospital being purged.
--
-- admin_audit_log is an append-only, durable audit trail (no UPDATE/DELETE
-- RLS policy) that keeps target_hospital_name specifically so rows stay
-- meaningful after the hospital is gone — so SET NULL (drop the dangling
-- reference, keep the row and its name) is correct here, matching
-- referral_system.referred_hospital_id (20261008000129), the only other
-- non-hospital_id-named direct FK to hospitals.
-- ============================================================

ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_target_hospital_id_fkey;

ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_target_hospital_id_fkey
  FOREIGN KEY (target_hospital_id) REFERENCES public.hospitals(id)
  ON DELETE SET NULL;
