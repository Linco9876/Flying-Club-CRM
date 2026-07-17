CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_manage_flight_reviews()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    public.current_user_has_staff_role()
    OR COALESCE(((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ? 'cfi', false)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles role_row
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role = 'cfi'
    );
$$;

REVOKE ALL ON FUNCTION private.can_manage_flight_reviews() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_flight_reviews() TO authenticated, service_role;

DROP POLICY IF EXISTS "Candidates and staff can read review records" ON public.flight_review_records;
CREATE POLICY "Candidates and staff can read review records"
ON public.flight_review_records FOR SELECT TO authenticated
USING (candidate_id = (SELECT auth.uid()) OR private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Staff can create review records" ON public.flight_review_records;
CREATE POLICY "Staff can create review records"
ON public.flight_review_records FOR INSERT TO authenticated
WITH CHECK (private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Staff can update review records" ON public.flight_review_records;
CREATE POLICY "Staff can update review records"
ON public.flight_review_records FOR UPDATE TO authenticated
USING (private.can_manage_flight_reviews())
WITH CHECK (private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Candidates and staff can read review items" ON public.flight_review_record_items;
CREATE POLICY "Candidates and staff can read review items"
ON public.flight_review_record_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.flight_review_records record
    WHERE record.id = review_record_id
      AND (record.candidate_id = (SELECT auth.uid()) OR private.can_manage_flight_reviews())
  )
);

DROP POLICY IF EXISTS "Staff can create review items" ON public.flight_review_record_items;
CREATE POLICY "Staff can create review items"
ON public.flight_review_record_items FOR INSERT TO authenticated
WITH CHECK (private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Staff can update review items" ON public.flight_review_record_items;
CREATE POLICY "Staff can update review items"
ON public.flight_review_record_items FOR UPDATE TO authenticated
USING (private.can_manage_flight_reviews())
WITH CHECK (private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Staff can delete review items" ON public.flight_review_record_items;
CREATE POLICY "Staff can delete review items"
ON public.flight_review_record_items FOR DELETE TO authenticated
USING (private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Candidates and staff can read review attachments" ON public.flight_review_attachments;
CREATE POLICY "Candidates and staff can read review attachments"
ON public.flight_review_attachments FOR SELECT TO authenticated
USING (candidate_id = (SELECT auth.uid()) OR private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Candidates and staff can add review attachments" ON public.flight_review_attachments;
CREATE POLICY "Candidates and staff can add review attachments"
ON public.flight_review_attachments FOR INSERT TO authenticated
WITH CHECK (
  private.can_manage_flight_reviews()
  OR (
    candidate_id = (SELECT auth.uid())
    AND uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.flight_review_records record
      WHERE record.id = review_record_id
        AND record.candidate_id = (SELECT auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Uploaders and staff can delete review attachments" ON public.flight_review_attachments;
CREATE POLICY "Uploaders and staff can delete review attachments"
ON public.flight_review_attachments FOR DELETE TO authenticated
USING (uploaded_by = (SELECT auth.uid()) OR private.can_manage_flight_reviews());

DROP POLICY IF EXISTS "Candidates and staff can read review audit" ON public.flight_review_record_audit;
CREATE POLICY "Candidates and staff can read review audit"
ON public.flight_review_record_audit FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.flight_review_records record
    WHERE record.id = review_record_id
      AND (record.candidate_id = (SELECT auth.uid()) OR private.can_manage_flight_reviews())
  )
);

CREATE POLICY "Review managers can read review templates"
ON public.training_courses FOR SELECT TO authenticated
USING (
  course_purpose IN ('flight_review', 'flight_test', 'proficiency_check')
  AND private.can_manage_flight_reviews()
);

CREATE POLICY "Review managers can create review templates"
ON public.training_courses FOR INSERT TO authenticated
WITH CHECK (
  course_purpose IN ('flight_review', 'flight_test', 'proficiency_check')
  AND private.can_manage_flight_reviews()
);

CREATE POLICY "Review managers can update review templates"
ON public.training_courses FOR UPDATE TO authenticated
USING (
  course_purpose IN ('flight_review', 'flight_test', 'proficiency_check')
  AND private.can_manage_flight_reviews()
)
WITH CHECK (
  course_purpose IN ('flight_review', 'flight_test', 'proficiency_check')
  AND private.can_manage_flight_reviews()
);

DROP POLICY IF EXISTS "Candidates and staff can read review evidence files" ON storage.objects;
CREATE POLICY "Candidates and staff can read review evidence files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR private.can_manage_flight_reviews())
);

DROP POLICY IF EXISTS "Candidates and staff can upload review evidence files" ON storage.objects;
CREATE POLICY "Candidates and staff can upload review evidence files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'flight-review-evidence'
  AND ((storage.foldername(name))[1] = (SELECT auth.uid())::text OR private.can_manage_flight_reviews())
);

DROP POLICY IF EXISTS "Upload owners and staff can update review evidence files" ON storage.objects;
CREATE POLICY "Upload owners and staff can update review evidence files"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR private.can_manage_flight_reviews())
)
WITH CHECK (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR private.can_manage_flight_reviews())
);

DROP POLICY IF EXISTS "Upload owners and staff can delete review evidence files" ON storage.objects;
CREATE POLICY "Upload owners and staff can delete review evidence files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'flight-review-evidence'
  AND (owner_id = (SELECT auth.uid())::text OR private.can_manage_flight_reviews())
);

CREATE OR REPLACE FUNCTION public.protect_candidate_flight_review_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT auth.uid()) = OLD.candidate_id AND NOT private.can_manage_flight_reviews() THEN
    IF (to_jsonb(NEW) - ARRAY['candidate_ack', 'candidate_ack_name', 'candidate_ack_at', 'updated_at', 'version'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['candidate_ack', 'candidate_ack_name', 'candidate_ack_at', 'updated_at', 'version']) THEN
      RAISE EXCEPTION 'Candidates can only acknowledge their own flight review record';
    END IF;
    IF NEW.candidate_ack
       AND (nullif(trim(NEW.candidate_ack_name), '') IS NULL OR NEW.candidate_ack_at IS NULL) THEN
      RAISE EXCEPTION 'Acknowledgement name and timestamp are required';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;
