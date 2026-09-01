-- BUG-P4-006 — two `users` rows were found sharing one `auth_user_id`, which made
-- HospitalContext.tsx's `.eq("auth_user_id", authUserId).maybeSingle()` error with
-- PostgREST's "multiple (or no) rows returned" for that login, silently breaking role
-- resolution (see the app-side fix in the same commit: HospitalContext now fails closed on
-- that error). The duplicate was a one-time data artefact, cleaned up directly in the QA
-- tenant, not something the seeder or the "Enable Login" edge function can produce under
-- normal operation.
--
-- This index turns that class of bug into an impossible state: any future attempt to link a
-- second `users` row to an `auth_user_id` already in use fails loudly at write time instead
-- of silently at every later read.

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON public.users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;
