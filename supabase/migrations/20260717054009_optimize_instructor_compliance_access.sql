CREATE INDEX IF NOT EXISTS instructor_compliance_records_course_idx
  ON public.instructor_compliance_records(course_id);

CREATE INDEX IF NOT EXISTS instructor_compliance_records_booking_idx
  ON public.instructor_compliance_records(booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS instructor_compliance_records_voided_by_idx
  ON public.instructor_compliance_records(voided_by)
  WHERE voided_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS instructor_compliance_audit_actor_idx
  ON public.instructor_compliance_record_audit(actor_id)
  WHERE actor_id IS NOT NULL;

DROP POLICY IF EXISTS "CFIs can read instructor compliance courses"
  ON public.instructor_compliance_courses;
DROP POLICY IF EXISTS "CFIs can manage instructor compliance courses"
  ON public.instructor_compliance_courses;
DROP POLICY IF EXISTS "Instructors can read compliance courses"
  ON public.instructor_compliance_courses;

CREATE POLICY "Instructional users can read compliance courses"
ON public.instructor_compliance_courses FOR SELECT TO authenticated
USING (
  public.current_user_is_cfi()
  OR EXISTS (
    SELECT 1
    FROM public.user_roles role_row
    WHERE role_row.user_id = (SELECT auth.uid())
      AND role_row.role IN ('instructor', 'senior_instructor')
  )
);

CREATE POLICY "CFIs can create instructor compliance courses"
ON public.instructor_compliance_courses FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can update instructor compliance courses"
ON public.instructor_compliance_courses FOR UPDATE TO authenticated
USING (public.current_user_is_cfi())
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can delete instructor compliance courses"
ON public.instructor_compliance_courses FOR DELETE TO authenticated
USING (public.current_user_is_cfi());

DROP POLICY IF EXISTS "CFIs can read instructor compliance course items"
  ON public.instructor_compliance_course_items;
DROP POLICY IF EXISTS "CFIs can manage instructor compliance course items"
  ON public.instructor_compliance_course_items;
DROP POLICY IF EXISTS "Instructors can read compliance course items"
  ON public.instructor_compliance_course_items;

CREATE POLICY "Instructional users can read compliance course items"
ON public.instructor_compliance_course_items FOR SELECT TO authenticated
USING (
  public.current_user_is_cfi()
  OR EXISTS (
    SELECT 1
    FROM public.user_roles role_row
    WHERE role_row.user_id = (SELECT auth.uid())
      AND role_row.role IN ('instructor', 'senior_instructor')
  )
);

CREATE POLICY "CFIs can create instructor compliance course items"
ON public.instructor_compliance_course_items FOR INSERT TO authenticated
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can update instructor compliance course items"
ON public.instructor_compliance_course_items FOR UPDATE TO authenticated
USING (public.current_user_is_cfi())
WITH CHECK (public.current_user_is_cfi());

CREATE POLICY "CFIs can delete instructor compliance course items"
ON public.instructor_compliance_course_items FOR DELETE TO authenticated
USING (public.current_user_is_cfi());

DROP POLICY IF EXISTS "CFIs can read instructor compliance records"
  ON public.instructor_compliance_records;
DROP POLICY IF EXISTS "Instructors can read own compliance records"
  ON public.instructor_compliance_records;

CREATE POLICY "CFIs and candidates can read instructor compliance records"
ON public.instructor_compliance_records FOR SELECT TO authenticated
USING (
  public.current_user_is_cfi()
  OR candidate_instructor_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "CFIs can insert own instructor compliance records"
  ON public.instructor_compliance_records;
CREATE POLICY "CFIs can insert own instructor compliance records"
ON public.instructor_compliance_records FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_is_cfi()
  AND examiner_cfi_id = (SELECT auth.uid())
);

DROP POLICY IF EXISTS "Examining CFIs can update instructor compliance records"
  ON public.instructor_compliance_records;
CREATE POLICY "Examining CFIs can update instructor compliance records"
ON public.instructor_compliance_records FOR UPDATE TO authenticated
USING (
  public.current_user_is_cfi()
  AND examiner_cfi_id = (SELECT auth.uid())
)
WITH CHECK (
  public.current_user_is_cfi()
  AND examiner_cfi_id = (SELECT auth.uid())
);
