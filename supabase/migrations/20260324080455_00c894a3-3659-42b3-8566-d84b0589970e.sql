-- Create shift_master table
CREATE TABLE IF NOT EXISTS public.shift_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  shift_name text NOT NULL,
  shift_code text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_hours numeric(4,2) DEFAULT 8,
  shift_type text DEFAULT 'regular',
  color_code text DEFAULT '#3B82F6',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create duty_roster table
CREATE TABLE IF NOT EXISTS public.duty_roster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) NOT NULL,
  user_id uuid REFERENCES public.users(id) NOT NULL,
  roster_date date NOT NULL,
  shift_id uuid REFERENCES public.shift_master(id) NULL,
  department_id uuid REFERENCES public.departments(id) NULL,
  ward_id uuid REFERENCES public.wards(id) NULL,
  is_off boolean DEFAULT false,
  is_holiday boolean DEFAULT false,
  notes text NULL,
  created_by uuid REFERENCES public.users(id) NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hospital_id, user_id, roster_date)
);

-- Add missing columns to staff_attendance
ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS in_time time NULL,
  ADD COLUMN IF NOT EXISTS out_time time NULL,
  ADD COLUMN IF NOT EXISTS hours_worked numeric(4,2) NULL,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS overtime_hours numeric(4,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text NULL,
  ADD COLUMN IF NOT EXISTS marked_by uuid REFERENCES public.users(id) NULL;

-- Add unique constraint to staff_attendance
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_attendance_hospital_user_date_unique'
  ) THEN
    ALTER TABLE public.staff_attendance
      ADD CONSTRAINT staff_attendance_hospital_user_date_unique
      UNIQUE (hospital_id, user_id, attendance_date);
  END IF;
END $$;

-- RLS policies for shift_master
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_master' AND policyname = 'Users can view own hospital shift_master') THEN
    CREATE POLICY "Users can view own hospital shift_master" ON public.shift_master FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'shift_master' AND policyname = 'Users can manage own hospital shift_master') THEN
    CREATE POLICY "Users can manage own hospital shift_master" ON public.shift_master FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;

-- RLS policies for duty_roster
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'duty_roster' AND policyname = 'Users can view own hospital duty_roster') THEN
    CREATE POLICY "Users can view own hospital duty_roster" ON public.duty_roster FOR SELECT TO authenticated USING (hospital_id = get_user_hospital_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'duty_roster' AND policyname = 'Users can manage own hospital duty_roster') THEN
    CREATE POLICY "Users can manage own hospital duty_roster" ON public.duty_roster FOR ALL TO authenticated USING (hospital_id = get_user_hospital_id()) WITH CHECK (hospital_id = get_user_hospital_id());
  END IF;
END $$;

-- Seed default shifts for all hospitals
INSERT INTO public.shift_master (hospital_id, shift_name, shift_code, start_time, end_time, duration_hours, shift_type, color_code)
SELECT h.id, s.shift_name, s.shift_code, s.start_time::time, s.end_time::time, s.duration_hours, s.shift_type, s.color_code
FROM public.hospitals h
CROSS JOIN (VALUES
  ('Morning', 'M', '06:00', '14:00', 8, 'regular', '#10B981'),
  ('Evening', 'E', '14:00', '22:00', 8, 'regular', '#F59E0B'),
  ('Night', 'N', '22:00', '06:00', 8, 'regular', '#6366F1'),
  ('General', 'G', '09:00', '17:00', 8, 'regular', '#3B82F6')
) AS s(shift_name, shift_code, start_time, end_time, duration_hours, shift_type, color_code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.shift_master sm WHERE sm.hospital_id = h.id AND sm.shift_code = s.shift_code
);