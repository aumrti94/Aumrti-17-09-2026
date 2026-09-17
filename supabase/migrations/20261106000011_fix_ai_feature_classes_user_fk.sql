-- KNOWN-BUG-122 fix (2026-09-12) — repoint ai_feature_classes.updated_by from
-- auth.users(id) to public.users(id).
--
-- Same defect class as 20261106000003_fix_user_fk_targets.sql, one table late: this column
-- did not exist in git until 20261016000000 recovered it faithfully from the live cloud
-- schema, which is why check:user-fk never had a chance to flag it before now. Reproduced
-- verbatim there on purpose (a recovery migration's job is to match what is real, not silently
-- redesign it) — this is the deliberate follow-up that actually corrects it, run as its own
-- migration rather than edited into 20261106000003, which may already have applied elsewhere
-- and must not be changed retroactively.
--
-- Same remap-then-swap approach as that migration: an existing auth uid is translated to the
-- owning public.users.id via auth_user_id before the constraint changes, so "who last updated
-- this AI feature's governance class" survives the repair rather than being nulled. Only a
-- value matching no user at all is blanked. updated_by is nullable, so ON DELETE SET NULL is
-- valid immediately with no NOT VALID step.

BEGIN;

DO $$
DECLARE
  v_relid   oid := to_regclass('public.ai_feature_classes');
  v_attnum  smallint;
  v_conname text;
BEGIN
  IF v_relid IS NULL THEN
    RETURN; -- table not in this database yet
  END IF;

  SELECT attnum INTO v_attnum
    FROM pg_attribute
   WHERE attrelid = v_relid AND attname = 'updated_by' AND NOT attisdropped;
  IF v_attnum IS NULL THEN
    RETURN; -- column not in this database
  END IF;

  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = v_relid
     AND contype = 'f'
     AND confrelid = 'auth.users'::regclass
     AND conkey = ARRAY[v_attnum]::smallint[]
   LIMIT 1;
  IF v_conname IS NULL THEN
    RETURN; -- already repointed — idempotent re-run
  END IF;

  -- 1. Preserve attribution: auth uid -> the owning public.users.id.
  UPDATE public.ai_feature_classes t
     SET updated_by = u.id
    FROM public.users u
   WHERE t.updated_by = u.auth_user_id AND t.updated_by IS DISTINCT FROM u.id;

  -- 2. Blank values that match no user at all.
  UPDATE public.ai_feature_classes
     SET updated_by = NULL
   WHERE updated_by IS NOT NULL
     AND updated_by NOT IN (SELECT id FROM public.users);

  -- 3. Swap the constraint.
  EXECUTE format('ALTER TABLE public.ai_feature_classes DROP CONSTRAINT %I', v_conname);
  ALTER TABLE public.ai_feature_classes
    ADD CONSTRAINT ai_feature_classes_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

  RAISE NOTICE 'repointed ai_feature_classes.updated_by -> public.users(id)';
END $$;

COMMIT;
