
-- Fix overly permissive RLS on ot_team_members by joining through ot_schedules
DROP POLICY IF EXISTS "Users can view ot_team_members" ON public.ot_team_members;
DROP POLICY IF EXISTS "Users can manage ot_team_members" ON public.ot_team_members;

CREATE POLICY "Users can view ot_team_members" ON public.ot_team_members
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ot_schedules s
    WHERE s.id = ot_schedule_id AND s.hospital_id = get_user_hospital_id()
  ));

CREATE POLICY "Users can manage ot_team_members" ON public.ot_team_members
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ot_schedules s
    WHERE s.id = ot_schedule_id AND s.hospital_id = get_user_hospital_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ot_schedules s
    WHERE s.id = ot_schedule_id AND s.hospital_id = get_user_hospital_id()
  ));
