-- Fix: ed_charge_items.performed_by must not FK to public.users(id).
-- The app records the auth user id (from supabase.auth.getUser()) as the actor, the same
-- value it stores in bill_line_items.ordered_by / service_charges.created_by (which are not
-- FK-enforced). Enforcing a users(id) FK here rejected valid inserts. Drop the constraint;
-- performed_by stays a plain uuid audit reference. Idempotent for envs that never had it.
ALTER TABLE public.ed_charge_items
  DROP CONSTRAINT IF EXISTS ed_charge_items_performed_by_fkey;
