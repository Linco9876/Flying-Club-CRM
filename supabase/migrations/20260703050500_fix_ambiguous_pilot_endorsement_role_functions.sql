/*
  Fix ambiguous pilot endorsement settings references inside
  endorsement role sync and signup role assignment functions.
*/

CREATE OR REPLACE FUNCTION public.sync_member_role_from_endorsements(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pilot_status_endorsement_types text[];
  has_staff_role boolean := false;
  should_be_pilot boolean := false;
BEGIN
  IF target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = target_user_id
      AND role IN ('admin', 'senior_instructor', 'instructor')
  )
  INTO has_staff_role;

  IF has_staff_role THEN
    RETURN;
  END IF;

  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT trim(value)
      FROM unnest(
        COALESCE(
          (
            SELECT tss.pilot_status_endorsement_types
            FROM public.training_syllabus_settings AS tss
            LIMIT 1
          ),
          ARRAY[
            'Pilot Certificate',
            'Recreational Pilots Licence RPL (A)',
            'RPL(A) Aeroplane Category Rating'
          ]::text[]
        )
      ) AS value
      WHERE trim(value) <> ''
    ),
    ARRAY[
      'Pilot Certificate',
      'Recreational Pilots Licence RPL (A)',
      'RPL(A) Aeroplane Category Rating'
    ]::text[]
  )
  INTO v_pilot_status_endorsement_types;

  SELECT EXISTS (
    SELECT 1
    FROM public.endorsements AS endorsement
    WHERE endorsement.student_id = target_user_id
      AND COALESCE(endorsement.is_active, true)
      AND (
        endorsement.expiry_date IS NULL
        OR endorsement.expiry_date >= CURRENT_DATE
      )
      AND EXISTS (
        SELECT 1
        FROM unnest(v_pilot_status_endorsement_types) AS allowed_type
        WHERE lower(trim(allowed_type)) = lower(trim(endorsement.type))
      )
  )
  INTO should_be_pilot;

  IF should_be_pilot THEN
    UPDATE public.users
    SET role = 'pilot',
        updated_at = now()
    WHERE id = target_user_id
      AND role IS DISTINCT FROM 'pilot';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, 'pilot')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = 'student';
  ELSE
    UPDATE public.users
    SET role = 'student',
        updated_at = now()
    WHERE id = target_user_id
      AND role IS DISTINCT FROM 'student';

    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;

    DELETE FROM public.user_roles
    WHERE user_id = target_user_id
      AND role = 'pilot';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  endorsement_item jsonb;
  v_pilot_status_endorsement_types text[];
  requested_endorsements jsonb := COALESCE(NEW.raw_user_meta_data->'endorsements', '[]'::jsonb);
  should_be_pilot boolean := false;
  endorsement_type text;
  endorsement_is_active boolean;
  endorsement_expiry date;
  primary_role text := 'student';
BEGIN
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT trim(value)
      FROM unnest(
        COALESCE(
          (
            SELECT tss.pilot_status_endorsement_types
            FROM public.training_syllabus_settings AS tss
            LIMIT 1
          ),
          ARRAY[
            'Pilot Certificate',
            'Recreational Pilots Licence RPL (A)',
            'RPL(A) Aeroplane Category Rating'
          ]::text[]
        )
      ) AS value
      WHERE trim(value) <> ''
    ),
    ARRAY[
      'Pilot Certificate',
      'Recreational Pilots Licence RPL (A)',
      'RPL(A) Aeroplane Category Rating'
    ]::text[]
  )
  INTO v_pilot_status_endorsement_types;

  IF jsonb_typeof(requested_endorsements) = 'array' THEN
    FOR endorsement_item IN
      SELECT value
      FROM jsonb_array_elements(requested_endorsements)
    LOOP
      endorsement_type := trim(COALESCE(endorsement_item->>'type', ''));
      endorsement_is_active := COALESCE((endorsement_item->>'isActive')::boolean, true);
      endorsement_expiry := NULLIF(endorsement_item->>'expiryDate', '')::date;

      IF endorsement_type <> ''
        AND endorsement_is_active
        AND (
          endorsement_expiry IS NULL
          OR endorsement_expiry >= CURRENT_DATE
        )
        AND EXISTS (
          SELECT 1
          FROM unnest(v_pilot_status_endorsement_types) AS allowed_type
          WHERE lower(trim(allowed_type)) = lower(endorsement_type)
        )
      THEN
        should_be_pilot := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  primary_role := CASE WHEN should_be_pilot THEN 'pilot' ELSE 'student' END;

  INSERT INTO public.users (id, email, name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    primary_role
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    phone = COALESCE(EXCLUDED.phone, users.phone),
    role = EXCLUDED.role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, primary_role::public.user_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = NEW.id
    AND role = CASE WHEN should_be_pilot THEN 'student' ELSE 'pilot' END::public.user_role;

  INSERT INTO public.students (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  IF jsonb_typeof(requested_endorsements) = 'array' THEN
    FOR endorsement_item IN
      SELECT value
      FROM jsonb_array_elements(requested_endorsements)
    LOOP
      endorsement_type := trim(COALESCE(endorsement_item->>'type', ''));

      IF endorsement_type <> '' THEN
        INSERT INTO public.endorsements (
          student_id,
          type,
          date_obtained,
          expiry_date,
          instructor_id,
          is_active
        )
        VALUES (
          NEW.id,
          endorsement_type,
          NULLIF(endorsement_item->>'dateObtained', '')::date,
          NULLIF(endorsement_item->>'expiryDate', '')::date,
          NULL,
          COALESCE((endorsement_item->>'isActive')::boolean, true)
        );
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
