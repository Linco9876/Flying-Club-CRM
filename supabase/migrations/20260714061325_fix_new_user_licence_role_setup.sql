-- New members always begin as students. Endorsements are qualifications only;
-- an active licence is the sole path that promotes a member to Pilot.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  endorsement_item jsonb;
  requested_endorsements jsonb := COALESCE(NEW.raw_user_meta_data->'endorsements', '[]'::jsonb);
  endorsement_type text;
BEGIN
  INSERT INTO public.users (id, email, name, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    'student'
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, users.name),
    phone = COALESCE(EXCLUDED.phone, users.phone),
    role = EXCLUDED.role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
  WHERE user_id = NEW.id AND role = 'pilot';

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

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- auth-schema triggers are not included in the public schema baseline dump, so
-- declare this explicitly to keep fresh environments and production aligned.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
