CREATE OR REPLACE FUNCTION public.validate_flight_review_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  config jsonb := COALESCE(NEW.template_snapshot->'review_configuration', '{}'::jsonb);
  minimum_ground integer := COALESCE((config->>'minimum_ground_minutes')::integer, 0);
  minimum_flight integer := COALESCE((config->>'minimum_flight_minutes')::integer, 0);
  validity_months integer := COALESCE((config->>'validity_months')::integer, 0);
  missing_required integer;
  evidence_type text;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT count(*) INTO missing_required
    FROM jsonb_array_elements(COALESCE(config->'checklist', '[]'::jsonb)) expected
    WHERE COALESCE((expected->>'required')::boolean, false)
      AND NOT EXISTS (
        SELECT 1
        FROM public.flight_review_record_items item
        WHERE item.review_record_id = NEW.id
          AND item.template_item_key = expected->>'key'
          AND item.required
          AND item.result = 'satisfactory'
      );

    IF missing_required > 0 THEN
      RAISE EXCEPTION '% required review items are missing or not satisfactory', missing_required;
    END IF;
    IF NEW.completion_date IS NULL THEN
      RAISE EXCEPTION 'Completion date is required';
    END IF;
    IF nullif(trim(NEW.reviewer_sign_name), '') IS NULL OR NEW.reviewer_sign_at IS NULL THEN
      RAISE EXCEPTION 'Reviewer signature is required';
    END IF;
    IF (NEW.ground_minutes < minimum_ground OR NEW.flight_minutes < minimum_flight)
       AND nullif(trim(NEW.minimums_override_reason), '') IS NULL THEN
      RAISE EXCEPTION 'Review duration is below the template minimum; record an override reason';
    END IF;
    IF NEW.review_type = 'raaus_bfr'
       AND (NOT NEW.logbook_entry_confirmed OR NOT NEW.authority_submission_confirmed) THEN
      RAISE EXCEPTION 'RAAus BFR completion requires the logbook entry and RAAus submission confirmations';
    END IF;

    FOR evidence_type IN
      SELECT jsonb_array_elements_text(COALESCE(config->'required_evidence', '[]'::jsonb))
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM public.flight_review_attachments attachment
        WHERE attachment.review_record_id = NEW.id
          AND attachment.category = evidence_type
      ) THEN
        RAISE EXCEPTION 'Required evidence is missing: %', evidence_type;
      END IF;
    END LOOP;

    IF validity_months > 0 AND NEW.next_review_due IS NULL THEN
      NEW.next_review_due := NEW.completion_date + make_interval(months => validity_months);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_flight_review_completion() IS
  'Validates completion against the immutable template snapshot, including deleted or missing required checklist rows.';
