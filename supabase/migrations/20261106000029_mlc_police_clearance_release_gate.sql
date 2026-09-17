-- Server-side enforcement of the MLC police-clearance gate on body release.
--
-- WHY. The only check on this today is client-side, in MortuaryPage.tsx's handleRelease:
--   if (mort?.is_mlc && !releaseForm.police_clearance) {
--     toast.error("Police clearance is required for MLC cases"); return;
--   }
-- A direct insert into body_releases — a batch script, a future screen, a client bug — has
-- nothing in the schema stopping an MLC body from being released with no police clearance on
-- record. Found live while building Phase 8's MCCD/mortuary regression test.

CREATE OR REPLACE FUNCTION public.enforce_mlc_police_clearance()
RETURNS TRIGGER AS $$
DECLARE
  v_is_mlc boolean;
BEGIN
  SELECT is_mlc INTO v_is_mlc FROM public.mortuary_admissions WHERE id = NEW.mortuary_id;
  IF v_is_mlc AND NOT COALESCE(NEW.police_clearance, false) THEN
    RAISE EXCEPTION 'Police clearance is required before releasing an MLC case (mortuary_admissions.id = %)', NEW.mortuary_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_mlc_police_clearance ON public.body_releases;
CREATE TRIGGER trg_enforce_mlc_police_clearance
  BEFORE INSERT OR UPDATE ON public.body_releases
  FOR EACH ROW EXECUTE FUNCTION public.enforce_mlc_police_clearance();
