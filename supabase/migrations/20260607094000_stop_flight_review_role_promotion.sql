/*
  Flight tests/reviews can update the review date, but Pilot status is now
  controlled only by configured active endorsements.
*/

CREATE OR REPLACE FUNCTION public.promote_pilot_after_passed_flight_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_flight_review IS TRUE
     AND NEW.flight_review_result = 'pass' THEN
    UPDATE public.students
    SET last_flight_review = COALESCE(NEW.date, CURRENT_DATE)
    WHERE id = NEW.student_id;

    NEW.pilot_role_granted := false;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.promote_pilot_after_passed_flight_review() IS
  'Maintains last flight review date only. Pilot role is granted by configured endorsements.';
