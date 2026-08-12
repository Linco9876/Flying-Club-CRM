-- The split-currency migration was first applied before its two internal helper
-- functions were registered in the central permission manifest. Register them
-- idempotently and immediately re-audit the live function grants.
INSERT INTO private.function_permission_manifest (
  signature, function_name, classification, allowed_roles,
  security_definer, fixed_search_path, rationale, reviewed_at
) VALUES
  (
    'public.flight_review_authority(explicit_authority text, review_type text, template_snapshot jsonb)',
    'flight_review_authority', 'service_worker', ARRAY['service_role']::text[],
    false, true,
    'Internal authority classifier used by protected flight-review currency functions.',
    CURRENT_DATE
  ),
  (
    'public.normalise_student_review_currency()',
    'normalise_student_review_currency', 'trigger_internal', ARRAY[]::text[],
    false, true,
    'Invoked only by the student review-currency normalisation trigger; client EXECUTE is unnecessary.',
    CURRENT_DATE
  )
ON CONFLICT (signature) DO UPDATE
SET function_name = EXCLUDED.function_name,
    classification = EXCLUDED.classification,
    allowed_roles = EXCLUDED.allowed_roles,
    security_definer = EXCLUDED.security_definer,
    fixed_search_path = EXCLUDED.fixed_search_path,
    rationale = EXCLUDED.rationale,
    reviewed_at = EXCLUDED.reviewed_at;

SELECT private.assert_function_permission_manifest();
