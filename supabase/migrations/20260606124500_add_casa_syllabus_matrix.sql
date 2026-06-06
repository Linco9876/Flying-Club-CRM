-- CASA RPL(A) v1.2 planning matrix tables and imported requirements.

CREATE TABLE IF NOT EXISTS public.syllabus_matrix_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  code text NOT NULL,
  row_type text NOT NULL CHECK (row_type IN ('unit', 'element', 'criterion')),
  unit_code text,
  element_code text,
  parent_code text,
  description text NOT NULL,
  source_row_number integer,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, code)
);

CREATE TABLE IF NOT EXISTS public.syllabus_matrix_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  matrix_row_id uuid NOT NULL REFERENCES public.syllabus_matrix_rows(id) ON DELETE CASCADE,
  lesson_sequence_code text NOT NULL,
  lesson_column_title text NOT NULL,
  required_standard integer NOT NULL CHECK (required_standard IN (1, 2, 3)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, lesson_sequence_code, matrix_row_id)
);

CREATE TABLE IF NOT EXISTS public.student_matrix_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.training_lessons(id) ON DELETE SET NULL,
  training_record_id uuid REFERENCES public.training_records(id) ON DELETE CASCADE,
  matrix_row_id uuid NOT NULL REFERENCES public.syllabus_matrix_rows(id) ON DELETE CASCADE,
  achieved_standard integer CHECK (achieved_standard IN (1, 2, 3)),
  comments text NOT NULL DEFAULT '',
  instructor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_record_id, matrix_row_id)
);

CREATE INDEX IF NOT EXISTS idx_syllabus_matrix_rows_course_sort ON public.syllabus_matrix_rows(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_syllabus_matrix_requirements_course_lesson ON public.syllabus_matrix_requirements(course_id, lesson_sequence_code);
CREATE INDEX IF NOT EXISTS idx_syllabus_matrix_requirements_row ON public.syllabus_matrix_requirements(matrix_row_id);
CREATE INDEX IF NOT EXISTS idx_student_matrix_assessments_student_course ON public.student_matrix_assessments(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_student_matrix_assessments_record ON public.student_matrix_assessments(training_record_id);

ALTER TABLE public.syllabus_matrix_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_matrix_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_matrix_assessments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.syllabus_matrix_rows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.syllabus_matrix_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_matrix_assessments TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can read syllabus matrix rows" ON public.syllabus_matrix_rows;
CREATE POLICY "Authenticated users can read syllabus matrix rows"
  ON public.syllabus_matrix_rows FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage syllabus matrix rows" ON public.syllabus_matrix_rows;
CREATE POLICY "Staff can manage syllabus matrix rows"
  ON public.syllabus_matrix_rows FOR ALL TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Authenticated users can read syllabus matrix requirements" ON public.syllabus_matrix_requirements;
CREATE POLICY "Authenticated users can read syllabus matrix requirements"
  ON public.syllabus_matrix_requirements FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Staff can manage syllabus matrix requirements" ON public.syllabus_matrix_requirements;
CREATE POLICY "Staff can manage syllabus matrix requirements"
  ON public.syllabus_matrix_requirements FOR ALL TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Students and staff can read matrix assessments" ON public.student_matrix_assessments;
CREATE POLICY "Students and staff can read matrix assessments"
  ON public.student_matrix_assessments FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR instructor_id = auth.uid() OR public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Staff can manage matrix assessments" ON public.student_matrix_assessments;
CREATE POLICY "Staff can manage matrix assessments"
  ON public.student_matrix_assessments FOR ALL TO authenticated
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

