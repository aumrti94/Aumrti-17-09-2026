-- Learned mappings from a phrasing a doctor actually used to the catalogue row it meant.
--
-- WHY THIS TABLE EXISTS
-- "Fever panel test" was reported as "not found in the lab catalogue — not ordered or billed"
-- while Fever Panel sat on screen as an orderable panel. src/lib/orderCatalogue.ts now
-- resolves that class of drift locally (noise words, spelling, word order) and
-- src/lib/orderAliases.ts ships the standard shorthand (CBC, KFT, CXR). What neither can do
-- is guess a phrasing peculiar to one hospital or one doctor.
--
-- Those go to the ai-resolve-orders edge function, which is the expensive path. Writing every
-- accepted answer here means a given phrase costs ONE model call for the whole hospital, ever.
-- A doctor correcting a match by hand writes here too, and outranks the model.
--
-- raw_name_norm is the caller-normalised key (lowercase alphanumerics, symbols expanded —
-- see normalizeTerm/expandSymbols). It is stored pre-normalised so the lookup is a plain map
-- build on the client with no per-row work.
--
-- canonical_name, not catalogue_id, is the payload: a hospital that re-seeds or renames its
-- masters would otherwise be left with aliases pointing at dead uuids. catalogue_id is kept
-- alongside as a hint only, and is nullable and ON DELETE SET NULL for the same reason.

CREATE TABLE IF NOT EXISTS public.order_name_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  raw_name_norm text NOT NULL,
  raw_name text NOT NULL,
  canonical_name text NOT NULL,
  catalogue_kind text NOT NULL CHECK (catalogue_kind IN ('lab', 'lab_group', 'radiology')),
  catalogue_id uuid,
  -- 'llm'    accepted answer from ai-resolve-orders
  -- 'doctor' a human-authored mapping. Reserved for the Settings-side editor; nothing writes
  --          it yet. It exists in the CHECK from the start because loadOrderCatalogue applies
  --          learned aliases last and a human mapping must be able to outrank the model's —
  --          adding the value later would mean a migration on a table already carrying rows.
  source text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'doctor')),
  confidence numeric,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One answer per phrase per hospital. The upsert on this constraint is what makes the second
-- occurrence of a phrase free.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_name_aliases_key
  ON public.order_name_aliases(hospital_id, raw_name_norm);

CREATE INDEX IF NOT EXISTS idx_order_name_aliases_hospital
  ON public.order_name_aliases(hospital_id);

ALTER TABLE public.order_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own hospital order_name_aliases" ON public.order_name_aliases
  FOR ALL TO authenticated
  USING (hospital_id = get_user_hospital_id())
  WITH CHECK (hospital_id = get_user_hospital_id());
