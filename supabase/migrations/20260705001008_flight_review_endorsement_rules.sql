/*
  # Flight review endorsement rules

  Certain endorsements can be configured in Safety settings to count as a
  flight review. When one of those active/current endorsements is added or
  updated, the member's last_flight_review date is moved forward to the latest
  matching endorsement date.
*/

CREATE OR REPLACE FUNCTION public.sync_member_flight_review_from_endorsements(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flight_review_endorsement_types text[];
  v_latest_review_date date;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT trim(value)
      FROM jsonb_array_elements_text(
        COALESCE(scs.settings->'flight_review_endorsement_types', '[]'::jsonb)
      ) AS value
      WHERE trim(value) <> ''
    ),
    ARRAY[]::text[]
  )
  INTO v_flight_review_endorsement_types
  FROM public.safety_compliance_settings AS scs
  LIMIT 1;

  IF COALESCE(array_length(v_flight_review_endorsement_types, 1), 0) = 0 THEN
    RETURN;
  END IF;

  SELECT max(e.date_obtained)
  INTO v_latest_review_date
  FROM public.endorsements AS e
  WHERE e.student_id = target_user_id
    AND e.date_obtained IS NOT NULL
    AND COALESCE(e.is_active, true)
    AND (e.expiry_date IS NULL OR e.expiry_date >= CURRENT_DATE)
    AND EXISTS (
      SELECT 1
      FROM unnest(v_flight_review_endorsement_types) AS allowed_type
      WHERE lower(trim(allowed_type)) = lower(trim(e.type))
    );

  IF v_latest_review_date IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.students AS s
  SET last_flight_review = v_latest_review_date
  WHERE s.id = target_user_id
    AND (
      s.last_flight_review IS NULL
      OR s.last_flight_review < v_latest_review_date
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_endorsement_flight_review_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_member_flight_review_from_endorsements(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_endorsement_flight_review ON public.endorsements;
CREATE TRIGGER trg_sync_endorsement_flight_review
AFTER INSERT OR UPDATE OF type, date_obtained, expiry_date, is_active, student_id
ON public.endorsements
FOR EACH ROW
EXECUTE FUNCTION public.handle_endorsement_flight_review_sync();

CREATE OR REPLACE FUNCTION public.reconcile_flight_review_endorsements()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_member record;
BEGIN
  IF NOT public.current_user_has_staff_role() THEN
    RAISE EXCEPTION 'Only staff can reconcile flight review endorsements';
  END IF;

  FOR v_member IN
    SELECT DISTINCT e.student_id
    FROM public.endorsements AS e
    WHERE e.student_id IS NOT NULL
  LOOP
    PERFORM public.sync_member_flight_review_from_endorsements(v_member.student_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_member_flight_review_from_endorsements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_endorsement_flight_review_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_flight_review_endorsements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_flight_review_endorsements() TO authenticated;
