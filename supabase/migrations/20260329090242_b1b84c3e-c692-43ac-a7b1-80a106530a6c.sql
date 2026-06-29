
-- ══════════════════════════════════════════════
-- LMS / Staff Training Tables (NABH HRM.6)
-- ══════════════════════════════════════════════

CREATE TABLE public.lms_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  course_name text NOT NULL,
  course_code text UNIQUE NOT NULL,
  category text NOT NULL,
  description text,
  duration_minutes integer DEFAULT 30,
  passing_score integer DEFAULT 80,
  validity_months integer,
  target_roles text[] DEFAULT '{}',
  content_type text DEFAULT 'quiz_only',
  content_url text,
  is_active boolean DEFAULT true,
  is_system_course boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.lms_quiz_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid REFERENCES public.lms_courses(id) ON DELETE CASCADE NOT NULL,
  question_text text NOT NULL,
  question_type text DEFAULT 'mcq',
  options jsonb NOT NULL,
  explanation text,
  marks integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.lms_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES public.lms_courses(id) ON DELETE CASCADE NOT NULL,
  enrolled_at timestamptz DEFAULT now(),
  due_date date,
  status text DEFAULT 'enrolled',
  completed_at timestamptz,
  score_percent integer,
  attempts integer DEFAULT 0,
  last_attempt_at timestamptz,
  certificate_url text,
  UNIQUE(hospital_id, user_id, course_id)
);

CREATE TABLE public.lms_quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES public.lms_enrollments(id) ON DELETE CASCADE NOT NULL,
  attempt_number integer NOT NULL,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  score_percent integer,
  answers jsonb DEFAULT '[]',
  passed boolean DEFAULT false
);

CREATE TABLE public.lms_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  course_id uuid REFERENCES public.lms_courses(id) ON DELETE CASCADE NOT NULL,
  enrollment_id uuid REFERENCES public.lms_enrollments(id) ON DELETE CASCADE NOT NULL,
  issued_at date NOT NULL DEFAULT current_date,
  expires_at date,
  certificate_number text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_lms_course()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.category NOT IN ('mandatory_annual','mandatory_biannual','mandatory_once','clinical','administrative','safety','compliance','custom') THEN
    RAISE EXCEPTION 'Invalid category: %', NEW.category;
  END IF;
  IF NEW.content_type NOT IN ('quiz_only','video','document','mixed') THEN
    RAISE EXCEPTION 'Invalid content_type: %', NEW.content_type;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_lms_course
  BEFORE INSERT OR UPDATE ON public.lms_courses
  FOR EACH ROW EXECUTE FUNCTION public.validate_lms_course();

CREATE OR REPLACE FUNCTION public.validate_lms_quiz_question()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.question_type NOT IN ('mcq','true_false') THEN
    RAISE EXCEPTION 'Invalid question_type: %', NEW.question_type;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_lms_quiz_question
  BEFORE INSERT OR UPDATE ON public.lms_quiz_questions
  FOR EACH ROW EXECUTE FUNCTION public.validate_lms_quiz_question();

CREATE OR REPLACE FUNCTION public.validate_lms_enrollment()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('enrolled','in_progress','completed','failed','expired','waived') THEN
    RAISE EXCEPTION 'Invalid enrollment status: %', NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_lms_enrollment
  BEFORE INSERT OR UPDATE ON public.lms_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.validate_lms_enrollment();

-- Indexes
CREATE INDEX idx_lms_courses_hospital ON public.lms_courses(hospital_id);
CREATE INDEX idx_lms_quiz_questions_course ON public.lms_quiz_questions(course_id);
CREATE INDEX idx_lms_enrollments_hospital ON public.lms_enrollments(hospital_id);
CREATE INDEX idx_lms_enrollments_user ON public.lms_enrollments(user_id);
CREATE INDEX idx_lms_enrollments_status ON public.lms_enrollments(status);
CREATE INDEX idx_lms_quiz_attempts_enrollment ON public.lms_quiz_attempts(enrollment_id);
CREATE INDEX idx_lms_certificates_hospital ON public.lms_certificates(hospital_id);
CREATE INDEX idx_lms_certificates_user ON public.lms_certificates(user_id);

-- RLS
ALTER TABLE public.lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Courses visible to hospital or system" ON public.lms_courses
  FOR SELECT TO authenticated
  USING (hospital_id IS NULL OR hospital_id = public.get_user_hospital_id());

CREATE POLICY "Hospital can manage own courses" ON public.lms_courses
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Quiz questions follow course access" ON public.lms_quiz_questions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lms_courses c
    WHERE c.id = course_id
    AND (c.hospital_id IS NULL OR c.hospital_id = public.get_user_hospital_id())
  ));

CREATE POLICY "Hospital can manage quiz questions" ON public.lms_quiz_questions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lms_courses c
    WHERE c.id = course_id AND c.hospital_id = public.get_user_hospital_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lms_courses c
    WHERE c.id = course_id AND c.hospital_id = public.get_user_hospital_id()
  ));

CREATE POLICY "Enrollments hospital isolation" ON public.lms_enrollments
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

CREATE POLICY "Quiz attempts via enrollment" ON public.lms_quiz_attempts
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lms_enrollments e
    WHERE e.id = enrollment_id AND e.hospital_id = public.get_user_hospital_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lms_enrollments e
    WHERE e.id = enrollment_id AND e.hospital_id = public.get_user_hospital_id()
  ));

CREATE POLICY "Certificates hospital isolation" ON public.lms_certificates
  FOR ALL TO authenticated
  USING (hospital_id = public.get_user_hospital_id())
  WITH CHECK (hospital_id = public.get_user_hospital_id());

-- Seed 10 NABH mandatory courses
INSERT INTO public.lms_courses
  (course_name, course_code, category, description,
   duration_minutes, passing_score, validity_months,
   target_roles, is_system_course, is_active)
VALUES
('Hospital Orientation & Policy', 'NABH-HO-01', 'mandatory_once',
  'Hospital policies, patient rights, fire exits, emergency codes',
  45, 80, null, ARRAY['all'], true, true),
('Fire Safety & Evacuation', 'NABH-FS-01', 'mandatory_annual',
  'Fire prevention, evacuation procedures, extinguisher use, fire drills',
  30, 80, 12, ARRAY['all'], true, true),
('Biomedical Waste Management', 'NABH-BMW-01', 'mandatory_annual',
  'BMW Rules 2016, colour coding, segregation, disposal procedures',
  30, 80, 12, ARRAY['all'], true, true),
('Hand Hygiene & Infection Control', 'NABH-HH-01', 'mandatory_biannual',
  'WHO 5 moments, hand rub technique, standard precautions',
  20, 80, 6, ARRAY['all'], true, true),
('CPR & Basic Life Support', 'NABH-BLS-01', 'mandatory_annual',
  'BLS protocol, AED use, chain of survival for adults and children',
  60, 80, 12, ARRAY['doctor','nurse','paramedic'], true, true),
('Patient Safety & Fall Prevention', 'NABH-PS-01', 'mandatory_annual',
  'Patient identification, fall risk assessment, safe medication practices',
  30, 80, 12, ARRAY['doctor','nurse','paramedic'], true, true),
('NDPS Drug Handling', 'NABH-NDPS-01', 'mandatory_annual',
  'Schedule H/X drugs, dual register, storage, prescription rules',
  30, 80, 12, ARRAY['pharmacist','nurse'], true, true),
('Radiation Safety', 'NABH-RAD-01', 'mandatory_annual',
  'AERB guidelines, radiation protection, dose limits, ALARA principle',
  30, 80, 12, ARRAY['radiologist','lab_technician','ot_nurse'], true, true),
('Equipment Safety & Use', 'NABH-EQ-01', 'mandatory_annual',
  'Safe equipment use, reporting breakdowns, electrical safety',
  25, 80, 12, ARRAY['nurse','paramedic','biomedical_technician'], true, true),
('Infection Control Precautions', 'NABH-IC-01', 'mandatory_annual',
  'Standard and transmission-based precautions, PPE donning/doffing',
  30, 80, 12, ARRAY['all'], true, true);
