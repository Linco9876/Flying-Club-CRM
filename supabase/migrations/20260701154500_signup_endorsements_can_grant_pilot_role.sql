/*
  # Allow sign-up endorsements to grant pilot status

  1. Changes
    - Update the auth signup trigger to read endorsement metadata supplied at sign-up
    - Create endorsement rows during auth user creation
    - Grant Pilot role immediately when an active, current endorsement matches
      the organisation's Pilot status endorsement list

  2. Notes
    - Student records are still created for every member so pilot/student files keep working
    - If no settings row exists yet, sensible default pilot-granting endorsements are used
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  endorsement_item jsonb;
  pilot_status_endorsement_types text[];
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
          (SELECT pilot_status_endorsement_types FROM public.training_syllabus_settings LIMIT 1),
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
  INTO pilot_status_endorsement_types;

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
          FROM unnest(pilot_status_endorsement_types) AS allowed_type
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
