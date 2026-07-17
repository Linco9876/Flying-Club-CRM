CREATE OR REPLACE FUNCTION public.save_instructor_compliance_template(
  p_course_id uuid,
  p_name text,
  p_description text,
  p_version text,
  p_source_documents jsonb,
  p_is_active boolean,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_course_id uuid;
  v_item jsonb;
  v_position bigint;
  v_code text;
  v_levels text[];
  v_check_types text[];
  v_seen_codes text[] := ARRAY[]::text[];
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.current_user_is_cfi() THEN
    RAISE EXCEPTION 'CFI authority is required to edit instructor review forms';
  END IF;

  IF nullif(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Form name is required';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one checklist item is required';
  END IF;

  IF p_source_documents IS NULL OR jsonb_typeof(p_source_documents) <> 'array' THEN
    RAISE EXCEPTION 'Source documents must be an array';
  END IF;

  IF p_course_id IS NULL THEN
    INSERT INTO public.instructor_compliance_courses (
      name,
      description,
      version,
      source_documents,
      is_active,
      updated_at
    )
    VALUES (
      btrim(p_name),
      coalesce(btrim(p_description), ''),
      coalesce(nullif(btrim(p_version), ''), '1.0'),
      p_source_documents,
      coalesce(p_is_active, true),
      now()
    )
    RETURNING id INTO v_course_id;
  ELSE
    UPDATE public.instructor_compliance_courses
    SET
      name = btrim(p_name),
      description = coalesce(btrim(p_description), ''),
      version = coalesce(nullif(btrim(p_version), ''), '1.0'),
      source_documents = p_source_documents,
      is_active = coalesce(p_is_active, true),
      updated_at = now()
    WHERE id = p_course_id
    RETURNING id INTO v_course_id;

    IF v_course_id IS NULL THEN
      RAISE EXCEPTION 'Instructor review form was not found';
    END IF;

    DELETE FROM public.instructor_compliance_course_items
    WHERE course_id = v_course_id;
  END IF;

  FOR v_item, v_position IN
    SELECT entry.value, entry.ordinality
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS entry(value, ordinality)
  LOOP
    v_code := upper(btrim(coalesce(v_item->>'code', '')));
    IF v_code = '' THEN
      RAISE EXCEPTION 'Every checklist item requires a code';
    END IF;
    IF nullif(btrim(coalesce(v_item->>'section', '')), '') IS NULL
       OR nullif(btrim(coalesce(v_item->>'title', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Every checklist item requires a section and title';
    END IF;
    IF v_code = ANY(v_seen_codes) THEN
      RAISE EXCEPTION 'Checklist item code % is duplicated', v_code;
    END IF;

    SELECT coalesce(array_agg(value), ARRAY[]::text[])
    INTO v_levels
    FROM jsonb_array_elements_text(coalesce(v_item->'applicable_levels', '[]'::jsonb));

    SELECT coalesce(array_agg(value), ARRAY[]::text[])
    INTO v_check_types
    FROM jsonb_array_elements_text(coalesce(v_item->'applicable_check_types', '[]'::jsonb));

    IF cardinality(v_levels) = 0 OR NOT (v_levels <@ ARRAY['instructor', 'senior_instructor']::text[]) THEN
      RAISE EXCEPTION 'Checklist item % has invalid instructor applicability', v_code;
    END IF;
    IF cardinality(v_check_types) = 0 OR NOT (v_check_types <@ ARRAY['initial_issue', 'sp_check', 'renewal']::text[]) THEN
      RAISE EXCEPTION 'Checklist item % has invalid check-type applicability', v_code;
    END IF;

    INSERT INTO public.instructor_compliance_course_items (
      course_id,
      section,
      code,
      title,
      guidance,
      sort_order,
      required,
      applicable_levels,
      applicable_check_types
    )
    VALUES (
      v_course_id,
      btrim(v_item->>'section'),
      v_code,
      btrim(v_item->>'title'),
      coalesce(btrim(v_item->>'guidance'), ''),
      ((v_position - 1) * 10)::integer,
      coalesce((v_item->>'required')::boolean, true),
      v_levels,
      v_check_types
    );

    v_seen_codes := array_append(v_seen_codes, v_code);
  END LOOP;

  RETURN v_course_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_instructor_compliance_template(uuid, text, text, text, jsonb, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_instructor_compliance_template(uuid, text, text, text, jsonb, boolean, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_instructor_compliance_template(uuid, text, text, text, jsonb, boolean, jsonb) TO service_role;
