-- Instructor compliance evidence remains hidden from ordinary administrators.
-- A candidate may read only their own record and renewal attachment, while any
-- CFI retains the existing organisation-wide read access.
CREATE POLICY "Instructors can read own compliance records"
ON public.instructor_compliance_records FOR SELECT TO authenticated
USING (candidate_instructor_id = auth.uid());

-- The course/checklist is not personal information, but it is still restricted
-- to CFIs and users who hold an instructional role.
CREATE POLICY "Instructors can read compliance courses"
ON public.instructor_compliance_courses FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('instructor', 'senior_instructor')
  )
);

CREATE POLICY "Instructors can read compliance course items"
ON public.instructor_compliance_course_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('instructor', 'senior_instructor')
  )
);

CREATE POLICY "Instructors can read own compliance forms"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'instructor-compliance-forms'
  AND split_part(name, '/', 1) = auth.uid()::text
);
