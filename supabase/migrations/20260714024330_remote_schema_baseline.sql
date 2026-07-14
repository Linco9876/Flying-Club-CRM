


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."admin_audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  old_payload jsonb;
  new_payload jsonb;
  changed text[];
  audit_area text;
  row_id text;
begin
  if tg_op not in ('UPDATE', 'DELETE') then
    return coalesce(new, old);
  end if;

  old_payload := to_jsonb(old);
  new_payload := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  changed := case when tg_op = 'UPDATE' then public.audit_changed_fields(old_payload, new_payload) else '{}'::text[] end;

  if tg_op = 'UPDATE' and coalesce(array_length(changed, 1), 0) = 0 then
    return new;
  end if;

  audit_area := tg_argv[0];
  row_id := coalesce(old_payload->>'id', new_payload->>'id');

  insert into public.admin_audit_log (
    actor_id,
    action,
    area,
    table_name,
    record_id,
    record_label,
    old_data,
    new_data,
    changed_fields,
    metadata
  )
  values (
    auth.uid(),
    tg_op,
    audit_area,
    tg_table_name,
    row_id,
    public.audit_record_label(tg_table_name, coalesce(new_payload, old_payload)),
    old_payload,
    new_payload,
    changed,
    jsonb_build_object(
      'schema', tg_table_schema,
      'trigger', tg_name,
      'captured_by', 'admin_audit_trigger'
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."admin_audit_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_trial_voucher_account_after_logged_flight"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  voucher_user_id uuid;
BEGIN
  IF NEW.booking_id IS NULL OR NEW.student_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tv.redeemed_by_user_id
  INTO voucher_user_id
  FROM public.trial_flight_vouchers tv
  WHERE tv.booked_booking_id = NEW.booking_id
    AND tv.redeemed_by_user_id = NEW.student_id
  LIMIT 1;

  IF voucher_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.users
  SET
    is_active = false,
    portal_access_scope = 'trial_voucher',
    updated_at = now()
  WHERE id = voucher_user_id
    AND COALESCE(portal_access_scope, 'full') = 'trial_voucher';

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."archive_trial_voucher_account_after_logged_flight"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_changed_fields"("old_row" "jsonb", "new_row" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(array_agg(key order by key), '{}')
  from (
    select key
    from jsonb_object_keys(old_row || new_row) as keys(key)
    where coalesce(old_row -> key, 'null'::jsonb) is distinct from coalesce(new_row -> key, 'null'::jsonb)
  ) changed;
$$;


ALTER FUNCTION "public"."audit_changed_fields"("old_row" "jsonb", "new_row" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_record_label"("table_name" "text", "row_data" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
begin
  case table_name
    when 'bookings' then
      return concat_ws(' ',
        'Booking',
        row_data->>'start_time',
        row_data->>'student_id',
        row_data->>'aircraft_id'
      );
    when 'flight_logs' then
      return concat_ws(' ',
        'Flight log',
        row_data->>'start_time',
        row_data->>'student_id',
        row_data->>'aircraft_id'
      );
    when 'account_transactions' then
      return concat_ws(' ',
        row_data->>'type',
        row_data->>'amount',
        row_data->>'description'
      );
    when 'invoices' then
      return concat_ws(' ', 'Invoice', row_data->>'invoice_number', row_data->>'student_id');
    when 'invoice_items' then
      return concat_ws(' ', 'Invoice item', row_data->>'description');
    when 'training_records' then
      return concat_ws(' ', 'Training record', row_data->>'date', row_data->>'student_id');
    when 'training_sequence_results' then
      return concat_ws(' ', row_data->>'sequence_code', row_data->>'sequence_title');
    when 'users' then
      return concat_ws(' ', row_data->>'name', row_data->>'email');
    when 'students' then
      return concat_ws(' ', 'Student profile', row_data->>'id');
    when 'user_roles' then
      return concat_ws(' ', 'Role', row_data->>'role', row_data->>'user_id');
    else
      return concat_ws(' ', table_name, row_data->>'id');
  end case;
end;
$$;


ALTER FUNCTION "public"."audit_record_label"("table_name" "text", "row_data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."book_trial_flight_voucher_slot"("p_voucher_id" "uuid", "p_student_id" "uuid", "p_aircraft_id" "uuid", "p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_notes" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_voucher public.trial_flight_vouchers%ROWTYPE;
  v_product public.trial_flight_voucher_products%ROWTYPE;
  v_aircraft public.aircraft%ROWTYPE;
  v_required_endorsement text;
  v_booking_id uuid;
BEGIN
  IF p_start_time IS NULL
    OR p_end_time IS NULL
    OR p_end_time <= p_start_time
    OR p_voucher_id IS NULL
    OR p_student_id IS NULL
    OR p_aircraft_id IS NULL
    OR p_instructor_id IS NULL
  THEN
    RAISE EXCEPTION 'A valid voucher, student, aircraft, instructor, start time and end time are required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-aircraft:' || p_aircraft_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-instructor:' || p_instructor_id::text, 0));

  SELECT *
  INTO v_voucher
  FROM public.trial_flight_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher.status <> 'redeemed'
    OR v_voucher.redeemed_by_user_id IS DISTINCT FROM p_student_id
    OR v_voucher.booked_booking_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'This voucher is not available for booking'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_product
  FROM public.trial_flight_voucher_products
  WHERE id = v_voucher.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher product was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_product.duration_minutes, 0) <= 0
    OR p_end_time <> p_start_time + ((v_product.duration_minutes + 30) * interval '1 minute')
  THEN
    RAISE EXCEPTION 'Voucher booking duration must match the voucher flight time plus 30 minutes'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.trial_voucher_instructor_available_for_slot(p_instructor_id, p_start_time, p_end_time) THEN
    RAISE EXCEPTION 'Selected instructor is not available for that voucher booking time'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_aircraft
  FROM public.aircraft
  WHERE id = p_aircraft_id;

  IF NOT FOUND OR v_aircraft.status <> 'serviceable' THEN
    RAISE EXCEPTION 'Selected aircraft is not available for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.aircraft_ids, 1), 0) = 0
    OR p_aircraft_id <> ALL(v_product.aircraft_ids)
  THEN
    RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.instructor_ids, 1), 0) = 0
    OR p_instructor_id <> ALL(v_product.instructor_ids)
  THEN
    RAISE EXCEPTION 'Selected instructor is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  v_required_endorsement := lower(trim(coalesce(v_aircraft.required_endorsement_type, '')));

  IF v_required_endorsement <> '' AND NOT EXISTS (
    SELECT 1
    FROM public.endorsements e
    WHERE e.student_id = p_instructor_id
      AND e.is_active IS NOT FALSE
      AND lower(trim(e.type)) = v_required_endorsement
      AND (e.expiry_date IS NULL OR e.expiry_date >= current_date)
  ) THEN
    RAISE EXCEPTION 'Selected instructor does not hold the required aircraft endorsement'
      USING ERRCODE = '23514';
  END IF;

  PERFORM 1
  FROM public.bookings b
  WHERE b.deleted_at IS NULL
    AND b.status IN ('confirmed', 'pending_approval')
    AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)')
    AND (
      b.aircraft_id = p_aircraft_id
      OR b.instructor_id = p_instructor_id
    )
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'That time is no longer available'
      USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.bookings (
    student_id,
    aircraft_id,
    instructor_id,
    start_time,
    end_time,
    payment_type,
    status,
    has_conflict,
    notes,
    trial_flight_voucher_id
  )
  VALUES (
    p_student_id,
    p_aircraft_id,
    p_instructor_id,
    p_start_time,
    p_end_time,
    'Gift Voucher',
    'confirmed',
    false,
    p_notes,
    p_voucher_id
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.trial_flight_vouchers
  SET status = 'booked',
      booked_booking_id = v_booking_id,
      updated_at = now()
  WHERE id = p_voucher_id;

  RETURN v_booking_id;
END;
$$;


ALTER FUNCTION "public"."book_trial_flight_voucher_slot"("p_voucher_id" "uuid", "p_student_id" "uuid", "p_aircraft_id" "uuid", "p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer DEFAULT 45, "max_calls_per_day" integer DEFAULT 4500, "spacing_ms" integer DEFAULT 1200) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  state_row public.xero_rate_limit_state%ROWTYPE;
  now_at timestamptz := clock_timestamp();
  wait_until timestamptz;
  wait_ms integer;
BEGIN
  INSERT INTO public.xero_rate_limit_state (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT *
  INTO state_row
  FROM public.xero_rate_limit_state
  WHERE id IS TRUE
  FOR UPDATE;

  IF state_row.minute_window_started_at <= now_at - interval '60 seconds' THEN
    state_row.minute_window_started_at := now_at;
    state_row.minute_calls := 0;
  END IF;

  IF state_row.daily_window_started_on < CURRENT_DATE THEN
    state_row.daily_window_started_on := CURRENT_DATE;
    state_row.daily_calls := 0;
  END IF;

  IF state_row.paused_until IS NOT NULL AND state_row.paused_until > now_at THEN
    wait_until := state_row.paused_until;
  ELSIF state_row.daily_calls >= GREATEST(max_calls_per_day, 1) THEN
    wait_until := (CURRENT_DATE + 1)::timestamptz;
  ELSIF state_row.minute_calls >= GREATEST(max_calls_per_minute, 1) THEN
    wait_until := state_row.minute_window_started_at + interval '60 seconds';
  ELSIF state_row.next_available_at > now_at THEN
    wait_until := state_row.next_available_at;
  ELSE
    UPDATE public.xero_rate_limit_state
    SET minute_window_started_at = state_row.minute_window_started_at,
        minute_calls = state_row.minute_calls + 1,
        daily_window_started_on = state_row.daily_window_started_on,
        daily_calls = state_row.daily_calls + 1,
        next_available_at = now_at + make_interval(secs => GREATEST(spacing_ms, 0)::double precision / 1000.0),
        updated_at = now_at
    WHERE id IS TRUE;

    RETURN jsonb_build_object(
      'granted', true,
      'waitMs', 0,
      'minuteCalls', state_row.minute_calls + 1,
      'dailyCalls', state_row.daily_calls + 1
    );
  END IF;

  wait_ms := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (wait_until - now_at)) * 1000)::integer);

  UPDATE public.xero_rate_limit_state
  SET minute_window_started_at = state_row.minute_window_started_at,
      minute_calls = state_row.minute_calls,
      daily_window_started_on = state_row.daily_window_started_on,
      daily_calls = state_row.daily_calls,
      updated_at = now_at
  WHERE id IS TRUE;

  RETURN jsonb_build_object(
    'granted', false,
    'waitMs', wait_ms,
    'waitUntil', wait_until,
    'minuteCalls', state_row.minute_calls,
    'dailyCalls', state_row.daily_calls
  );
END;
$$;


ALTER FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer, "max_calls_per_day" integer, "spacing_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_has_full_portal_access"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND COALESCE(portal_access_scope, 'full') = 'full'
      AND COALESCE(is_active, true) = true
  );
$$;


ALTER FUNCTION "public"."current_user_has_full_portal_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_has_staff_role"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    COALESCE(((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ?| ARRAY['admin','instructor','senior_instructor'], false)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND (
          u.role = ANY (ARRAY['admin','instructor','senior_instructor'])
          OR COALESCE(u.is_senior_instructor, false) = true
        )
    );
$$;


ALTER FUNCTION "public"."current_user_has_staff_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    COALESCE(((SELECT auth.jwt()) -> 'app_metadata' -> 'roles') ? 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    );
$$;


ALTER FUNCTION "public"."current_user_is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_declaration_signing_request"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_token public.declaration_signing_tokens%rowtype;
  v_result jsonb;
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('valid', false, 'error', 'Invalid signing link');
  end if;

  select *
  into v_token
  from public.declaration_signing_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Invalid signing link');
  end if;

  if v_token.used_at is not null then
    return jsonb_build_object('valid', false, 'error', 'This signing link has already been used');
  end if;

  if v_token.expires_at < now() then
    return jsonb_build_object('valid', false, 'error', 'This signing link has expired');
  end if;

  select jsonb_build_object(
    'valid', true,
    'tokenId', v_token.id,
    'recipientType', v_token.recipient_type,
    'expiresAt', v_token.expires_at,
    'enrolmentId', sce.id,
    'courseId', tc.id,
    'courseTitle', tc.title,
    'studentId', u.id,
    'studentName', u.name,
    'studentEmail', u.email,
    'studentDateOfBirth', coalesce(u.date_of_birth, s.date_of_birth),
    'memberNumber', s.raaus_id,
    'studentDeclarationTitle', tc.flying_declaration_title,
    'studentDeclarationText', tc.flying_declaration_text,
    'guardianDeclarationTitle', tc.guardian_declaration_title,
    'guardianDeclarationText', tc.guardian_declaration_text,
    'declarationVersion', tc.flying_declaration_version,
    'studentSigned', sce.declaration_signed_at is not null
      and coalesce(sce.declaration_version, 0) >= coalesce(tc.flying_declaration_version, 1),
    'guardianSigned', sce.guardian_declaration_signed_at is not null
      and coalesce(sce.guardian_declaration_version, 0) >= coalesce(tc.flying_declaration_version, 1),
    'guardianRequired', coalesce(tc.requires_guardian_declaration_for_minors, true)
      and coalesce(u.date_of_birth, s.date_of_birth) is not null
      and (coalesce(u.date_of_birth, s.date_of_birth) + interval '18 years')::date > current_date,
    'recipientEmail', v_token.recipient_email,
    'recipientPhone', v_token.recipient_phone
  )
  into v_result
  from public.student_course_enrolments sce
  join public.training_courses tc on tc.id = sce.course_id
  join public.users u on u.id = sce.student_id
  left join public.students s on s.id = sce.student_id
  where sce.id = v_token.enrolment_id
    and coalesce(tc.requires_flying_declaration, false) = true;

  if v_result is null then
    return jsonb_build_object('valid', false, 'error', 'Declaration is no longer required');
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_declaration_signing_request"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_and_audit_training_record_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_is_staff boolean;
  v_actor_is_student boolean;
  v_changed_fields text[];
  v_disallowed_fields text[];
  v_allowed_student_fields text[] := array[
    'student_ack',
    'student_ack_name',
    'student_ack_timestamp',
    'student_comments',
    'status'
  ];
  v_material_fields text[];
  v_latest_revision jsonb;
  v_action text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  select coalesce(array_agg(key order by key), '{}')
  into v_changed_fields
  from jsonb_object_keys(to_jsonb(old) || to_jsonb(new)) as keys(key)
  where coalesce(to_jsonb(old) -> key, 'null'::jsonb) is distinct from coalesce(to_jsonb(new) -> key, 'null'::jsonb);

  if coalesce(array_length(v_changed_fields, 1), 0) = 0 then
    return new;
  end if;

  v_is_staff := public.current_user_has_staff_role();
  v_actor_is_student := auth.uid() = old.student_id;

  if not v_is_staff then
    if not v_actor_is_student then
      raise exception 'Only staff or the student can update this training record'
        using errcode = '42501';
    end if;

    select coalesce(array_agg(field), '{}')
    into v_disallowed_fields
    from unnest(v_changed_fields) as changed(field)
    where field <> all(v_allowed_student_fields);

    if coalesce(array_length(v_disallowed_fields, 1), 0) > 0 then
      raise exception 'Students can only acknowledge or comment on their own training records. Disallowed fields: %', array_to_string(v_disallowed_fields, ', ')
        using errcode = '42501';
    end if;

    if 'status' = any(v_changed_fields)
       and not (
         old.status = 'submitted'
         and new.status in ('submitted', 'locked')
         and coalesce(new.student_ack, false) = true
       ) then
      raise exception 'Students can only lock a submitted record while acknowledging it'
        using errcode = '42501';
    end if;

    if old.student_id is distinct from new.student_id then
      raise exception 'Students cannot move training records between students'
        using errcode = '42501';
    end if;

    if coalesce(old.student_ack, false) = true and coalesce(new.student_ack, false) = false then
      raise exception 'Students cannot remove their acknowledgement from a training record'
        using errcode = '42501';
    end if;

    if coalesce(old.student_ack, false) = false and coalesce(new.student_ack, false) = true then
      v_latest_revision := (
        select entry
        from jsonb_array_elements(case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end) as entries(entry)
        where entry->>'action' = 'record_revised_after_student_acknowledgement'
        order by (entry->>'timestamp')::timestamptz desc nulls last
        limit 1
      );

      v_action := case
        when v_latest_revision is null then 'student_acknowledged_record'
        else 'student_acknowledged_revised_record'
      end;

      new.audit_log := (case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end)
        || jsonb_build_array(public.training_record_audit_entry(
          v_action,
          case
            when v_latest_revision is null then jsonb_build_object('recordAcknowledged', true)
            else jsonb_build_object(
              'revisedRecordAcknowledged', true,
              'revisionTimestamp', v_latest_revision->>'timestamp'
            )
          end
        ));
    end if;

    return new;
  end if;

  if coalesce(old.student_ack, false) = true then
    select coalesce(array_agg(field), '{}')
    into v_material_fields
    from unnest(v_changed_fields) as changed(field)
    where field not in ('audit_log', 'updated_at');

    if coalesce(array_length(v_material_fields, 1), 0) > 0
       and new.audit_log is not distinct from old.audit_log then
      new.audit_log := (case when jsonb_typeof(old.audit_log) = 'array' then old.audit_log else '[]'::jsonb end)
        || jsonb_build_array(public.training_record_audit_entry(
          'record_revised_after_student_acknowledgement',
          jsonb_build_object(
            'changedFields', to_jsonb(v_material_fields),
            'studentAcknowledgementRequired', true,
            'databaseCaptured', true
          )
        ));
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."guard_and_audit_training_record_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_students_self_service_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null
     and old.id = auth.uid()
     and not public.current_user_has_staff_role() then
    if new.id is distinct from old.id
       or new.prepaid_balance is distinct from old.prepaid_balance
       or new.last_flight_review is distinct from old.last_flight_review
       or new.created_at is distinct from old.created_at then
      raise exception 'Only staff can change protected student fields';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_students_self_service_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_users_self_service_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF auth.uid() = OLD.id AND NOT public.current_user_has_staff_role() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.role IS DISTINCT FROM OLD.role
      OR NEW.is_senior_instructor IS DISTINCT FROM OLD.is_senior_instructor
      OR NEW.is_active IS DISTINCT FROM OLD.is_active
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Only staff can change protected member fields';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_users_self_service_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_aircraft_grounding"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
IF NEW.severity IN ('Major', 'Critical') AND NEW.status = 'open' THEN
UPDATE public.aircraft SET status = 'unserviceable' WHERE id = NEW.aircraft_id;
END IF;
RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_aircraft_grounding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_endorsement_flight_review_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.sync_member_flight_review_from_endorsements(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."handle_endorsement_flight_review_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_endorsement_role_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM public.sync_member_role_from_endorsements(COALESCE(NEW.student_id, OLD.student_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."handle_endorsement_role_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
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


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_calendar_instructors"() RETURNS TABLE("id" "uuid", "name" "text", "email" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    u.id,
    coalesce(nullif(u.name, ''), u.email, 'Instructor') as name,
    coalesce(u.email, '') as email
  from public.users u
  where auth.uid() is not null
    and coalesce(u.is_active, true) = true
    and coalesce(u.portal_access_scope, 'full') <> 'guest_placeholder'
    and (
      u.role in ('instructor', 'senior_instructor')
      or coalesce(u.is_senior_instructor, false) = true
      or exists (
        select 1
        from public.user_roles ur
        where ur.user_id = u.id
          and ur.role in ('instructor', 'senior_instructor')
      )
    )
  order by name;
$$;


ALTER FUNCTION "public"."list_calendar_instructors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  pause_seconds integer := GREATEST(COALESCE(retry_after_seconds, 300), 30);
BEGIN
  INSERT INTO public.xero_rate_limit_state (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.xero_rate_limit_state
  SET paused_until = clock_timestamp() + make_interval(secs => pause_seconds),
      last_retry_after_seconds = pause_seconds,
      last_rate_limited_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id IS TRUE;
END;
$$;


ALTER FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_instructor_booking_request"("booking_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
v_booking         bookings%ROWTYPE;
v_student_name    text;
v_aircraft_reg    text;
v_start_local     text;
v_recipient       uuid;
BEGIN
SELECT * INTO v_booking FROM bookings WHERE id = booking_id;
IF NOT FOUND THEN RETURN; END IF;

IF v_booking.instructor_id IS NULL THEN RETURN; END IF;

SELECT name        INTO v_student_name  FROM users   WHERE id = v_booking.student_id;
SELECT registration INTO v_aircraft_reg FROM aircraft WHERE id = v_booking.aircraft_id;
v_start_local := to_char(v_booking.start_time AT TIME ZONE 'UTC', 'FMDay DD Mon YYYY HH12:MI AM');

INSERT INTO notifications (user_id, type, title, message, booking_id, metadata, is_read)
VALUES (
v_booking.instructor_id,
'booking_approval',
'Booking Request – Approval Required',
v_student_name || ' has requested a booking on ' || COALESCE(v_aircraft_reg, 'an aircraft') || ' on ' || v_start_local || '. Please approve, edit, or deny.',
booking_id,
jsonb_build_object(
'booking_id',    booking_id::text,
'student_id',    v_booking.student_id::text,
'instructor_id', v_booking.instructor_id::text
),
false
);

FOR v_recipient IN
SELECT id FROM users WHERE role = 'admin'
LOOP
CONTINUE WHEN v_recipient = v_booking.instructor_id;

INSERT INTO notifications (user_id, type, title, message, booking_id, metadata, is_read)
VALUES (
v_recipient,
'booking_approval',
'Booking Request – Approval Required',
v_student_name || ' has requested a booking on ' || COALESCE(v_aircraft_reg, 'an aircraft') || ' on ' || v_start_local || '. Please approve, edit, or deny.',
booking_id,
jsonb_build_object(
'booking_id',    booking_id::text,
'student_id',    v_booking.student_id::text,
'instructor_id', v_booking.instructor_id::text
),
false
);
END LOOP;
END;
$$;


ALTER FUNCTION "public"."notify_instructor_booking_request"("booking_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_self_service_access_field_changes"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  acting_user uuid := auth.uid();
  acting_is_staff boolean := false;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF acting_user IS NULL OR acting_user <> OLD.id THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = acting_user
      AND ur.role = ANY (ARRAY['admin','instructor','senior_instructor'])
  ) INTO acting_is_staff;

  IF acting_is_staff THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
    OR COALESCE(NEW.portal_access_scope, 'full') IS DISTINCT FROM COALESCE(OLD.portal_access_scope, 'full')
    OR COALESCE(NEW.is_active, true) IS DISTINCT FROM COALESCE(OLD.is_active, true)
    OR COALESCE(NEW.is_senior_instructor, false) IS DISTINCT FROM COALESCE(OLD.is_senior_instructor, false)
  THEN
    RAISE EXCEPTION 'Protected account access fields can only be changed by staff';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_self_service_access_field_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_trial_voucher_booking_overlap"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_voucher public.trial_flight_vouchers%ROWTYPE;
  v_product public.trial_flight_voucher_products%ROWTYPE;
  v_aircraft public.aircraft%ROWTYPE;
  v_required_endorsement text;
BEGIN
  IF NEW.trial_flight_voucher_id IS NULL
    OR NEW.deleted_at IS NOT NULL
    OR NEW.status NOT IN ('confirmed', 'pending_approval')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.start_time IS NULL
    OR NEW.end_time IS NULL
    OR NEW.end_time <= NEW.start_time
    OR NEW.aircraft_id IS NULL
    OR NEW.instructor_id IS NULL
  THEN
    RAISE EXCEPTION 'A valid aircraft, instructor, start time and end time are required for voucher bookings'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-aircraft:' || NEW.aircraft_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trial-voucher-instructor:' || NEW.instructor_id::text, 0));

  SELECT *
  INTO v_voucher
  FROM public.trial_flight_vouchers
  WHERE id = NEW.trial_flight_voucher_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_voucher.redeemed_by_user_id IS NOT NULL
    AND v_voucher.redeemed_by_user_id IS DISTINCT FROM NEW.student_id
  THEN
    RAISE EXCEPTION 'Voucher booking must belong to the voucher holder'
      USING ERRCODE = '23514';
  END IF;

  IF v_voucher.redeemed_by_user_id IS NULL
    AND COALESCE(NEW.is_guest_booking, false) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Unredeemed vouchers can only be linked to guest bookings'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_product
  FROM public.trial_flight_voucher_products
  WHERE id = v_voucher.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher product was not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_product.duration_minutes, 0) <= 0
    OR NEW.end_time <> NEW.start_time + ((v_product.duration_minutes + 30) * interval '1 minute')
  THEN
    RAISE EXCEPTION 'Voucher booking duration must match the voucher flight time plus 30 minutes'
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.trial_voucher_instructor_available_for_slot(NEW.instructor_id, NEW.start_time, NEW.end_time) THEN
    RAISE EXCEPTION 'Selected instructor is not available for that voucher booking time'
      USING ERRCODE = '23514';
  END IF;

  SELECT *
  INTO v_aircraft
  FROM public.aircraft
  WHERE id = NEW.aircraft_id;

  IF NOT FOUND OR v_aircraft.status <> 'serviceable' THEN
    RAISE EXCEPTION 'Selected aircraft is not available for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.aircraft_ids, 1), 0) = 0
    OR NEW.aircraft_id <> ALL(v_product.aircraft_ids)
  THEN
    RAISE EXCEPTION 'Selected aircraft is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(v_product.instructor_ids, 1), 0) = 0
    OR NEW.instructor_id <> ALL(v_product.instructor_ids)
  THEN
    RAISE EXCEPTION 'Selected instructor is not eligible for this voucher'
      USING ERRCODE = '23514';
  END IF;

  v_required_endorsement := lower(trim(coalesce(v_aircraft.required_endorsement_type, '')));

  IF v_required_endorsement <> '' AND NOT EXISTS (
    SELECT 1
    FROM public.endorsements e
    WHERE e.student_id = NEW.instructor_id
      AND e.is_active IS NOT FALSE
      AND lower(trim(e.type)) = v_required_endorsement
      AND (e.expiry_date IS NULL OR e.expiry_date >= current_date)
  ) THEN
    RAISE EXCEPTION 'Selected instructor does not hold the required aircraft endorsement'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.id IS DISTINCT FROM NEW.id
      AND b.deleted_at IS NULL
      AND b.status IN ('confirmed', 'pending_approval')
      AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(NEW.start_time, NEW.end_time, '[)')
      AND (
        b.aircraft_id = NEW.aircraft_id
        OR b.instructor_id = NEW.instructor_id
      )
  ) THEN
    RAISE EXCEPTION 'That time is no longer available'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_trial_voucher_booking_overlap"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_pilot_after_passed_flight_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."promote_pilot_after_passed_flight_review"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."promote_pilot_after_passed_flight_review"() IS 'Maintains last flight review date only. Pilot role is granted by configured endorsements.';



CREATE OR REPLACE FUNCTION "public"."protect_system_payment_methods"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stripe_connected boolean;
  v_xero_connected boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system IS TRUE THEN
      RAISE EXCEPTION 'System payment methods cannot be deleted. Deactivate them instead.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.system_key = 'stripe_card' THEN
    NEW.name := 'Stripe Card Payment';
    NEW.description := coalesce(
      nullif(trim(NEW.description), ''),
      'Card payment through the connected Stripe account. Enable this only if flight charges or account top-ups should be paid by card.'
    );
    NEW.is_system := true;

    IF (NEW.active IS TRUE OR NEW.allow_account_topup IS TRUE) THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.stripe_connect_settings
        WHERE id IS TRUE
          AND stripe_user_id IS NOT NULL
          AND trim(stripe_user_id) <> ''
      )
      INTO v_stripe_connected;

      IF v_stripe_connected IS NOT TRUE THEN
        RAISE EXCEPTION 'Connect Stripe before enabling Stripe Card Payment.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.system_key = 'pilot_account' THEN
    NEW.name := 'Pilot Account';
    NEW.description := coalesce(
      nullif(trim(NEW.description), ''),
      'Uses the member''s Xero overpayment balance when prepaid flying is allowed for that member.'
    );
    NEW.allow_account_topup := false;
    NEW.is_system := true;

    IF NEW.active IS TRUE THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.xero_connection_settings
        WHERE id IS TRUE
          AND tenant_id IS NOT NULL
          AND trim(tenant_id) <> ''
          AND disconnected_at IS NULL
      )
      INTO v_xero_connected;

      IF v_xero_connected IS NOT TRUE THEN
        RAISE EXCEPTION 'Connect Xero before enabling Pilot Account.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF OLD.is_system IS TRUE THEN
    NEW.is_system := true;
    NEW.system_key := OLD.system_key;

    IF OLD.system_key = 'stripe_card' THEN
      NEW.name := 'Stripe Card Payment';
    ELSIF OLD.system_key = 'pilot_account' THEN
      NEW.name := 'Pilot Account';
      NEW.allow_account_topup := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."protect_system_payment_methods"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_xero_contact_sync_on_user_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
  should_queue boolean := false;
  reason text := null;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF TG_OP = 'INSERT' AND COALESCE(settings_row.create_contacts, true) IS TRUE THEN
    should_queue := true;
    reason := 'new_member_created';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.xero_contact_id IS NOT NULL
    AND (
      NEW.email IS DISTINCT FROM OLD.email
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.phone IS DISTINCT FROM OLD.phone
      OR NEW.mobile_phone IS DISTINCT FROM OLD.mobile_phone
      OR NEW.address IS DISTINCT FROM OLD.address
    )
  THEN
    should_queue := true;
    reason := 'linked_member_profile_changed';
  END IF;

  IF should_queue THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'contact',
      NEW.id,
      'upsert_contact',
      'pending',
      50,
      jsonb_build_object(
        'reason', reason,
        'previous_email', CASE WHEN TG_OP = 'UPDATE' THEN OLD.email ELSE NULL END,
        'new_email', NEW.email
      )
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_contact_sync_status := 'queued';
    NEW.xero_contact_sync_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_xero_contact_sync_on_user_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_xero_flight_invoice_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
  billable_amount numeric := 0;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  billable_amount := COALESCE(NEW.calculated_cost, NEW.total_cost, 0);

  IF COALESCE(settings_row.sync_flight_charges, false) IS TRUE
     AND COALESCE(settings_row.auto_queue_flight_invoices, true) IS TRUE
     AND NEW.id IS NOT NULL
     AND billable_amount > 0
     AND NEW.payment_status <> 'free'
     AND NEW.xero_invoice_id IS NULL
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'flight_invoice',
      NEW.id,
      'create_invoice',
      'pending',
      70,
      jsonb_build_object('reason', 'billable_flight_log')
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_xero_flight_invoice_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_xero_verified_payment_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF NEW.type = 'flight_charge'
     AND NEW.flight_log_id IS NOT NULL
     AND NEW.verified_status = 'verified'
     AND (TG_OP = 'INSERT' OR NEW.verified_status IS DISTINCT FROM OLD.verified_status)
     AND COALESCE(settings_row.auto_apply_verified_payments, false) IS TRUE
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'flight_payment',
      NEW.flight_log_id,
      'apply_payment',
      'pending',
      80,
      jsonb_build_object('reason', 'verified_payment', 'account_transaction_id', NEW.id)
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  IF NEW.type = 'topup'
     AND NEW.verified_status = 'verified'
     AND (TG_OP = 'INSERT' OR NEW.verified_status IS DISTINCT FROM OLD.verified_status)
     AND COALESCE(settings_row.sync_account_topups, false) IS TRUE
  THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'account_transaction',
      NEW.id,
      'sync_transaction',
      'pending',
      75,
      jsonb_build_object('reason', 'verified_topup')
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_xero_verified_payment_sync"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_xero_voucher_sync_from_flight_log"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
  linked_voucher_id uuid;
  voucher_payment_status text;
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF COALESCE(settings_row.sync_gift_vouchers, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT v.id, v.payment_status
  INTO linked_voucher_id, voucher_payment_status
  FROM public.bookings b
  JOIN public.trial_flight_vouchers v
    ON v.id = b.trial_flight_voucher_id
  WHERE b.id = NEW.booking_id;

  IF linked_voucher_id IS NULL OR voucher_payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
  VALUES (
    'voucher',
    linked_voucher_id,
    'sync_voucher',
    'pending',
    74,
    jsonb_build_object('reason', 'flight_logged', 'flight_log_id', NEW.id)
  )
  ON CONFLICT (entity_type, entity_id, action, status)
  DO UPDATE SET
    payload = public.xero_sync_queue.payload || EXCLUDED.payload,
    updated_at = now(),
    next_attempt_at = now();

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_xero_voucher_sync_from_flight_log"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."queue_xero_voucher_sync_from_voucher"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  settings_row public.xero_sync_settings%ROWTYPE;
  should_queue boolean := false;
  queue_reason text := 'voucher_updated';
BEGIN
  SELECT * INTO settings_row
  FROM public.xero_sync_settings
  WHERE id = true;

  IF COALESCE(settings_row.sync_gift_vouchers, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status = 'paid' THEN
    IF TG_OP = 'INSERT' THEN
      should_queue := true;
      queue_reason := 'voucher_inserted_paid';
    ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      should_queue := true;
      queue_reason := 'voucher_paid';
    ELSIF NEW.payment_source IS DISTINCT FROM OLD.payment_source
       OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.booked_booking_id IS DISTINCT FROM OLD.booked_booking_id
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      should_queue := true;
      queue_reason := 'voucher_updated';
    END IF;
  END IF;

  IF should_queue THEN
    INSERT INTO public.xero_sync_queue(entity_type, entity_id, action, status, priority, payload)
    VALUES (
      'voucher',
      NEW.id,
      'sync_voucher',
      'pending',
      75,
      jsonb_build_object('reason', queue_reason, 'payment_source', NEW.payment_source)
    )
    ON CONFLICT (entity_type, entity_id, action, status)
    DO UPDATE SET
      payload = public.xero_sync_queue.payload || EXCLUDED.payload,
      updated_at = now(),
      next_attempt_at = now();

    NEW.xero_sync_status := 'queued';
    NEW.xero_sync_error := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."queue_xero_voucher_sync_from_voucher"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_flight_review_endorsements"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."reconcile_flight_review_endorsements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_trial_voucher_when_booking_cancelled"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.trial_flight_voucher_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.flight_logged, false)
    OR EXISTS (
      SELECT 1
      FROM public.flight_logs fl
      WHERE fl.booking_id = NEW.id
    )
  THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NOT NULL OR NEW.status = 'cancelled' THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = 'redeemed',
      booked_booking_id = NULL,
      updated_at = now(),
      notes = trim(both ' ' from concat_ws(
        ' ',
        nullif(notes, ''),
        'Linked booking released because booking was cancelled/deleted at ' || now()::text || '.'
      ))
    WHERE id = NEW.trial_flight_voucher_id
      AND booked_booking_id = NEW.id
      AND status = 'booked';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."release_trial_voucher_when_booking_cancelled"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_aircraft_endorsement_requirement"("old_value" "text", "new_value" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.aircraft
  SET required_endorsement_types = (
        SELECT COALESCE(
          array_agg(CASE WHEN item = old_value THEN new_value ELSE item END),
          '{}'
        )
        FROM unnest(required_endorsement_types) AS item
      ),
      required_endorsement_type = CASE
        WHEN required_endorsement_type = old_value THEN new_value
        ELSE required_endorsement_type
      END
  WHERE old_value = ANY(required_endorsement_types)
     OR required_endorsement_type = old_value;
END;
$$;


ALTER FUNCTION "public"."rename_aircraft_endorsement_requirement"("old_value" "text", "new_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text" DEFAULT NULL::"text", "p_guardian_relationship" "text" DEFAULT NULL::"text", "p_guardian_email" "text" DEFAULT NULL::"text", "p_guardian_phone" "text" DEFAULT NULL::"text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_token public.declaration_signing_tokens%rowtype;
  v_enrolment public.student_course_enrolments%rowtype;
  v_course public.training_courses%rowtype;
  v_now timestamptz := now();
  v_name text := trim(coalesce(p_signature_name, ''));
begin
  if length(coalesce(p_token, '')) < 32 then
    return jsonb_build_object('success', false, 'error', 'Invalid signing link');
  end if;

  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Signature name is required');
  end if;

  select *
  into v_token
  from public.declaration_signing_tokens
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid signing link');
  end if;

  if v_token.used_at is not null then
    return jsonb_build_object('success', false, 'error', 'This signing link has already been used');
  end if;

  if v_token.expires_at < v_now then
    return jsonb_build_object('success', false, 'error', 'This signing link has expired');
  end if;

  select * into v_enrolment
  from public.student_course_enrolments
  where id = v_token.enrolment_id
  for update;

  select * into v_course
  from public.training_courses
  where id = v_enrolment.course_id;

  if not coalesce(v_course.requires_flying_declaration, false) then
    return jsonb_build_object('success', false, 'error', 'Declaration is no longer required');
  end if;

  if v_token.recipient_type = 'student' then
    update public.student_course_enrolments
    set
      declaration_signed_at = v_now,
      declaration_signed_name = v_name,
      declaration_member_number = nullif(trim(coalesce(p_member_number, '')), ''),
      declaration_text_snapshot = v_course.flying_declaration_text,
      declaration_version = coalesce(v_course.flying_declaration_version, 1),
      updated_at = v_now
    where id = v_token.enrolment_id;
  elsif v_token.recipient_type = 'guardian' then
    if trim(coalesce(p_guardian_relationship, '')) = '' then
      return jsonb_build_object('success', false, 'error', 'Parent/guardian relationship is required');
    end if;

    update public.student_course_enrolments
    set
      guardian_declaration_signed_at = v_now,
      guardian_declaration_signed_name = v_name,
      guardian_declaration_relationship = trim(p_guardian_relationship),
      guardian_declaration_email = coalesce(nullif(trim(coalesce(p_guardian_email, '')), ''), v_token.recipient_email, guardian_declaration_email),
      guardian_declaration_phone = coalesce(nullif(trim(coalesce(p_guardian_phone, '')), ''), v_token.recipient_phone, guardian_declaration_phone),
      guardian_declaration_text_snapshot = v_course.guardian_declaration_text,
      guardian_declaration_version = coalesce(v_course.flying_declaration_version, 1),
      updated_at = v_now
    where id = v_token.enrolment_id;
  end if;

  update public.declaration_signing_tokens
  set
    used_at = v_now,
    metadata = metadata || jsonb_build_object(
      'signedUserAgent', nullif(left(coalesce(p_user_agent, ''), 500), ''),
      'signedAt', v_now
    )
  where id = v_token.id;

  return jsonb_build_object(
    'success', true,
    'recipientType', v_token.recipient_type,
    'signedAt', v_now
  );
end;
$$;


ALTER FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text", "p_guardian_relationship" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_instructor_absence_identity_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.user_id := NEW.instructor_id;
  END IF;

  IF NEW.instructor_id IS NULL THEN
    NEW.instructor_id := NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_instructor_absence_identity_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_member_role_from_endorsements"("target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."sync_member_role_from_endorsements"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_public_user_email_from_auth"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.users
    SET email = NEW.email,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_public_user_email_from_auth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_trial_voucher_booking_link"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.trial_flight_voucher_id IS NOT NULL
    AND OLD.trial_flight_voucher_id IS DISTINCT FROM NEW.trial_flight_voucher_id
    AND COALESCE(OLD.flight_logged, false) IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.flight_logs fl
      WHERE fl.booking_id = OLD.id
    )
  THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = CASE WHEN status = 'booked' THEN 'redeemed' ELSE status END,
      booked_booking_id = NULL,
      updated_at = now()
    WHERE id = OLD.trial_flight_voucher_id
      AND booked_booking_id = OLD.id;
  END IF;

  IF NEW.trial_flight_voucher_id IS NOT NULL
    AND NEW.deleted_at IS NULL
    AND NEW.status IN ('confirmed', 'pending_approval')
    AND COALESCE(NEW.flight_logged, false) IS NOT TRUE
  THEN
    UPDATE public.trial_flight_vouchers
    SET
      status = 'booked',
      booked_booking_id = NEW.id,
      updated_at = now()
    WHERE id = NEW.trial_flight_voucher_id
      AND status IN ('issued', 'redeemed', 'booked')
      AND (booked_booking_id IS NULL OR booked_booking_id = NEW.id);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_trial_voucher_booking_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_user_primary_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
target_user_id uuid;
new_role text;
BEGIN
IF TG_OP = 'DELETE' THEN
target_user_id := OLD.user_id;
ELSE
target_user_id := NEW.user_id;
END IF;

SELECT CASE
WHEN bool_or(role = 'admin') THEN 'admin'
WHEN bool_or(role = 'senior_instructor') THEN 'senior_instructor'
WHEN bool_or(role = 'instructor') THEN 'instructor'
WHEN bool_or(role = 'pilot') THEN 'pilot'
ELSE 'student'
END INTO new_role
FROM user_roles
WHERE user_id = target_user_id;

IF new_role IS NULL THEN
new_role := 'student';
END IF;

UPDATE users SET role = new_role WHERE id = target_user_id;

RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_user_primary_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."training_record_audit_entry"("p_action" "text", "p_changes" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_name text;
begin
  select coalesce(nullif(name, ''), nullif(email, ''), 'Unknown user')
  into v_user_name
  from public.users
  where id = auth.uid();

  return jsonb_build_object(
    'id', gen_random_uuid()::text,
    'timestamp', now(),
    'userId', auth.uid(),
    'userName', coalesce(v_user_name, 'Unknown user'),
    'action', p_action,
    'changes', coalesce(p_changes, '{}'::jsonb)
  );
end;
$$;


ALTER FUNCTION "public"."training_record_audit_entry"("p_action" "text", "p_changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trial_voucher_instructor_available_for_slot"("p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_local_start timestamp;
  v_local_end timestamp;
  v_slot_date date;
  v_day_of_week integer;
  v_schedule record;
  v_start_time time;
  v_end_time time;
BEGIN
  IF p_instructor_id IS NULL OR p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RETURN false;
  END IF;

  v_local_start := p_start_time AT TIME ZONE 'Australia/Sydney';
  v_local_end := p_end_time AT TIME ZONE 'Australia/Sydney';

  IF v_local_start::date IS DISTINCT FROM v_local_end::date THEN
    RETURN false;
  END IF;

  v_slot_date := v_local_start::date;
  v_day_of_week := extract(dow from v_slot_date)::integer;
  v_start_time := v_local_start::time;
  v_end_time := v_local_end::time;

  IF EXISTS (
    SELECT 1
    FROM public.instructor_absences a
    WHERE (a.user_id = p_instructor_id OR a.instructor_id = p_instructor_id)
      AND v_slot_date >= a.start_date
      AND v_slot_date <= a.end_date
      AND (a.start_time IS NULL OR a.end_time IS NULL OR (v_start_time < a.end_time AND v_end_time > a.start_time))
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_schedule
  FROM public.instructor_schedule_changes c
  WHERE (c.user_id = p_instructor_id OR c.instructor_id = p_instructor_id)
    AND c.day_of_week = v_day_of_week
    AND coalesce(c.effective_from, c.change_date) <= v_slot_date
  ORDER BY coalesce(c.effective_from, c.change_date) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_schedule
    FROM public.instructor_weekly_schedules s
    WHERE (s.user_id = p_instructor_id OR s.instructor_id = p_instructor_id)
      AND s.day_of_week = v_day_of_week
    LIMIT 1;
  END IF;

  IF NOT FOUND OR v_schedule.is_available IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_schedule.start_time IS NOT NULL AND v_schedule.end_time IS NOT NULL AND v_start_time >= v_schedule.start_time AND v_end_time <= v_schedule.end_time THEN
    RETURN true;
  END IF;

  IF coalesce(v_schedule.afternoon_start_time, v_schedule.start_time_2) IS NOT NULL
    AND coalesce(v_schedule.afternoon_end_time, v_schedule.end_time_2) IS NOT NULL
    AND v_start_time >= coalesce(v_schedule.afternoon_start_time, v_schedule.start_time_2)
    AND v_end_time <= coalesce(v_schedule.afternoon_end_time, v_schedule.end_time_2)
  THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;


ALTER FUNCTION "public"."trial_voucher_instructor_available_for_slot"("p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."account_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "flight_log_id" "uuid",
    "payment_method_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "balance_after" numeric,
    "verified_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "rejection_notes" "text",
    "xero_payment_id" "text",
    "xero_contact_id" "text",
    "xero_invoice_id" "text",
    "xero_synced_at" timestamp with time zone,
    "xero_sync_status" "text" DEFAULT 'not_synced'::"text" NOT NULL,
    "xero_sync_error" "text",
    "xero_fee_bank_transaction_id" "text",
    "xero_fee_synced_at" timestamp with time zone,
    "xero_fee_sync_error" "text",
    "xero_bank_transaction_id" "text",
    "stripe_checkout_session_id" "text",
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    "ground_session_log_id" "uuid",
    CONSTRAINT "account_transactions_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"]))),
    CONSTRAINT "account_transactions_type_check" CHECK (("type" = ANY (ARRAY['topup'::"text", 'flight_charge'::"text", 'refund'::"text", 'adjustment'::"text"]))),
    CONSTRAINT "account_transactions_verified_status_check" CHECK (("verified_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"]))),
    CONSTRAINT "account_transactions_xero_sync_status_check" CHECK (("xero_sync_status" = ANY (ARRAY['not_synced'::"text", 'queued'::"text", 'syncing'::"text", 'synced'::"text", 'needs_review'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."account_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "area" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "record_label" "text",
    "old_data" "jsonb",
    "new_data" "jsonb",
    "changed_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "admin_audit_log_action_check" CHECK (("action" = ANY (ARRAY['UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aircraft" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "registration" "text" NOT NULL,
    "make" "text" NOT NULL,
    "model" "text" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'serviceable'::"text" NOT NULL,
    "hourly_rate" numeric(8,2) DEFAULT 0.00 NOT NULL,
    "total_hours" numeric(8,1) DEFAULT 0.0,
    "last_maintenance" "date",
    "next_maintenance" "date",
    "fuel_capacity" numeric(6,1),
    "empty_weight" numeric(8,1),
    "max_weight" numeric(8,1),
    "seat_capacity" integer DEFAULT 2,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "required_endorsement_type" "text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "archive_reason" "text",
    "icon_key" "text",
    "xero_tracking_category_id" "text",
    "xero_tracking_category_name" "text",
    "xero_tracking_option_id" "text",
    "xero_tracking_option_name" "text",
    "xero_tracking_last_synced_at" timestamp with time zone,
    "xero_tracking_sync_error" "text",
    "required_endorsement_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "aircraft_status_check" CHECK (("status" = ANY (ARRAY['serviceable'::"text", 'unserviceable'::"text", 'maintenance'::"text"]))),
    CONSTRAINT "aircraft_type_check" CHECK (("type" = ANY (ARRAY['single-engine'::"text", 'multi-engine'::"text", 'helicopter'::"text"])))
);

ALTER TABLE ONLY "public"."aircraft" REPLICA IDENTITY FULL;


ALTER TABLE "public"."aircraft" OWNER TO "postgres";


COMMENT ON COLUMN "public"."aircraft"."required_endorsement_type" IS 'Optional endorsement type required for solo hire without instructor. Missing endorsement creates a pending approval booking.';



COMMENT ON COLUMN "public"."aircraft"."required_endorsement_types" IS 'Optional endorsement types that allow solo hire without instructor. If none are held, the booking becomes pending approval.';



CREATE TABLE IF NOT EXISTS "public"."aircraft_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aircraft_id" "uuid" NOT NULL,
    "filename" "text" NOT NULL,
    "file_path" "text" NOT NULL,
    "file_type" "text",
    "file_size" integer,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "document_type" "text"
);


ALTER TABLE "public"."aircraft_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."aircraft_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aircraft_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "flight_type_id" "uuid",
    "charge_type" "text" DEFAULT 'not_used'::"text" NOT NULL,
    "solo_rate" numeric DEFAULT 0,
    "dual_rate" numeric DEFAULT 0,
    "flat_surcharge" numeric DEFAULT 0,
    "weekend_surcharge" numeric DEFAULT 0,
    "default_payment_method_id" "uuid",
    "included_taxes" numeric DEFAULT 0,
    CONSTRAINT "aircraft_rates_charge_type_check" CHECK (("charge_type" = ANY (ARRAY['tach'::"text", 'flat'::"text", 'per_pax'::"text", 'free'::"text", 'not_used'::"text"])))
);


ALTER TABLE "public"."aircraft_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_conflicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "conflicting_booking_id" "uuid",
    "conflict_type" "text",
    "resolved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_conflicts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_field_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_name" "text" NOT NULL,
    "label" "text" NOT NULL,
    "is_required" boolean DEFAULT false,
    "is_visible" boolean DEFAULT true,
    "applies_to_roles" "text"[] DEFAULT ARRAY['admin'::"text", 'instructor'::"text", 'student'::"text"],
    "display_order" integer,
    "help_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."booking_field_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."booking_rules_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "min_booking_notice_hours" integer DEFAULT 2 NOT NULL,
    "max_booking_advance_days" integer DEFAULT 30 NOT NULL,
    "allow_double_booking" boolean DEFAULT true NOT NULL,
    "require_instructor_approval" boolean DEFAULT false NOT NULL,
    "cancellation_notice_hours" integer DEFAULT 24 NOT NULL,
    "enforce_min_notice" boolean DEFAULT true NOT NULL,
    "enforce_max_advance" boolean DEFAULT true NOT NULL,
    "enforce_cancellation_notice" boolean DEFAULT true NOT NULL,
    "prevent_past_bookings" boolean DEFAULT true NOT NULL,
    "enforce_max_duration" boolean DEFAULT true NOT NULL,
    "max_booking_duration_hours" integer DEFAULT 8 NOT NULL,
    "updated_by" "uuid",
    "fatigue_rules_enabled" boolean DEFAULT true NOT NULL,
    "fatigue_late_finish_time" "text" DEFAULT '22:00'::"text" NOT NULL,
    "fatigue_early_start_time" "text" DEFAULT '07:00'::"text" NOT NULL,
    "fatigue_min_rest_hours" numeric DEFAULT 12 NOT NULL,
    "fatigue_max_duty_hours_per_day" numeric DEFAULT 11 NOT NULL,
    "fatigue_max_flight_hours_per_day" numeric DEFAULT 7 NOT NULL,
    "fatigue_max_late_finishes_7_days" integer DEFAULT 3 NOT NULL,
    "fatigue_include_supervision" boolean DEFAULT true NOT NULL,
    "fatigue_block_on_breach" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."booking_rules_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_rules_enabled" IS 'Enables configurable instructor fatigue checks for bookings.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_late_finish_time" IS 'Local time at or after which an instructor duty is treated as a late finish.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_early_start_time" IS 'Local time before which an instructor duty is treated as an early start.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_min_rest_hours" IS 'Minimum off-duty hours required between instructor duties. Default 12 hours aligns with CASA CAO 48.1 Appendix 6 flight training controls.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_max_duty_hours_per_day" IS 'Local maximum instructor duty span. The application also applies the CASA Appendix 6 FDP start-time table.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_max_flight_hours_per_day" IS 'Maximum booked instructor flight/supervision hours in a local day.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_max_late_finishes_7_days" IS 'Maximum late finishes allowed for an instructor in a rolling 7-day window.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_include_supervision" IS 'Counts supervision/instructor allocations as duty for fatigue limits.';



COMMENT ON COLUMN "public"."booking_rules_settings"."fatigue_block_on_breach" IS 'Blocks bookings when true; otherwise client code may warn only.';



CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "instructor_id" "uuid",
    "aircraft_id" "uuid",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "payment_type" "text" NOT NULL,
    "notes" "text",
    "status" "text" DEFAULT 'confirmed'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "deleted_at" timestamp with time zone,
    "flight_logged" boolean DEFAULT false,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "flight_type_id" "uuid",
    "has_conflict" boolean DEFAULT false,
    "trial_flight_voucher_id" "uuid",
    "is_guest_booking" boolean DEFAULT false NOT NULL,
    "guest_name" "text",
    "guest_email" "text",
    "guest_phone" "text",
    "booking_kind" "text" DEFAULT 'flight'::"text" NOT NULL,
    "ground_session_logged" boolean DEFAULT false NOT NULL,
    CONSTRAINT "bookings_booking_kind_check" CHECK (("booking_kind" = ANY (ARRAY['flight'::"text", 'ground'::"text"]))),
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['confirmed'::"text", 'cancelled'::"text", 'completed'::"text", 'no-show'::"text", 'pending_approval'::"text"])))
);

ALTER TABLE ONLY "public"."bookings" REPLICA IDENTITY FULL;


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bookings"."aircraft_id" IS 'Aircraft booked for flight bookings. Nullable for instructor-only ground session bookings.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "phone" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_senior_instructor" boolean DEFAULT false,
    "date_of_birth" "date",
    "mobile_phone" "text",
    "home_phone" "text",
    "work_phone" "text",
    "address" "text",
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "emergency_contact_relationship" "text",
    "preferred_aircraft_id" "uuid",
    "is_active" boolean DEFAULT true NOT NULL,
    "cover_url" "text",
    "portal_access_scope" "text" DEFAULT 'full'::"text" NOT NULL,
    "trial_voucher_password_set_at" timestamp with time zone,
    "xero_contact_id" "text",
    "xero_contact_name" "text",
    "xero_contact_email" "text",
    "xero_contact_linked_at" timestamp with time zone,
    "xero_contact_sync_status" "text" DEFAULT 'not_linked'::"text" NOT NULL,
    "xero_contact_sync_error" "text",
    "xero_contact_last_synced_at" timestamp with time zone,
    CONSTRAINT "users_portal_access_scope_check" CHECK (("portal_access_scope" = ANY (ARRAY['full'::"text", 'trial_voucher'::"text", 'guest_placeholder'::"text"]))),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text", 'pilot'::"text", 'student'::"text"]))),
    CONSTRAINT "users_xero_contact_sync_status_check" CHECK (("xero_contact_sync_status" = ANY (ARRAY['not_linked'::"text", 'linked'::"text", 'queued'::"text", 'syncing'::"text", 'synced'::"text", 'needs_review'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."calendar_booking_public" WITH ("security_invoker"='true') AS
 WITH "viewer" AS (
         SELECT ( SELECT "auth"."uid"() AS "uid") AS "uid",
            "public"."current_user_has_staff_role"() AS "is_staff",
            "public"."current_user_has_full_portal_access"() AS "has_full_access"
        )
 SELECT "b"."id",
    "b"."student_id",
    "b"."instructor_id",
    "b"."aircraft_id",
    "b"."start_time",
    "b"."end_time",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."payment_type"
            ELSE NULL::"text"
        END AS "payment_type",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."notes"
            ELSE NULL::"text"
        END AS "notes",
    "b"."status",
    COALESCE("b"."has_conflict", false) AS "has_conflict",
    "b"."deleted_at",
    COALESCE("b"."flight_logged", false) AS "flight_logged",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."flight_type_id"
            ELSE NULL::"uuid"
        END AS "flight_type_id",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."trial_flight_voucher_id"
            ELSE NULL::"uuid"
        END AS "trial_flight_voucher_id",
    "b"."is_guest_booking",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."guest_name"
            ELSE NULL::"text"
        END AS "guest_name",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."guest_email"
            ELSE NULL::"text"
        END AS "guest_email",
        CASE
            WHEN ("viewer"."is_staff" OR ("b"."student_id" = "viewer"."uid")) THEN "b"."guest_phone"
            ELSE NULL::"text"
        END AS "guest_phone",
    COALESCE("b"."guest_name", "hirer"."name") AS "hirer_name",
    "instructor"."name" AS "instructor_name"
   FROM ((("public"."bookings" "b"
     CROSS JOIN "viewer")
     LEFT JOIN "public"."users" "hirer" ON (("hirer"."id" = "b"."student_id")))
     LEFT JOIN "public"."users" "instructor" ON (("instructor"."id" = "b"."instructor_id")))
  WHERE "viewer"."has_full_access";


ALTER VIEW "public"."calendar_booking_public" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hidden_resources" "jsonb" DEFAULT '[]'::"jsonb",
    "resource_order" "jsonb" DEFAULT '[]'::"jsonb",
    "default_view" "text" DEFAULT 'day'::"text" NOT NULL,
    "show_current_time_indicator" boolean DEFAULT true NOT NULL,
    "snap_duration" integer DEFAULT 15 NOT NULL,
    "double_height_slots" boolean DEFAULT false NOT NULL,
    "resource_display_order" "text" DEFAULT 'aircraft-first'::"text" NOT NULL,
    "conflict_rules" "text" DEFAULT 'waitlist'::"text" NOT NULL,
    "week_starts_on" "text" DEFAULT 'monday'::"text" NOT NULL,
    "show_weekends" boolean DEFAULT true NOT NULL,
    "highlight_unlogged_bookings" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."calendar_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."declaration_signing_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "enrolment_id" "uuid" NOT NULL,
    "recipient_type" "text" NOT NULL,
    "delivery_method" "text" DEFAULT 'email'::"text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "recipient_email" "text",
    "recipient_phone" "text",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '14 days'::interval) NOT NULL,
    "used_at" timestamp with time zone,
    "sent_at" timestamp with time zone,
    "send_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "declaration_signing_tokens_delivery_method_check" CHECK (("delivery_method" = ANY (ARRAY['email'::"text", 'sms'::"text", 'manual'::"text"]))),
    CONSTRAINT "declaration_signing_tokens_recipient_type_check" CHECK (("recipient_type" = ANY (ARRAY['student'::"text", 'guardian'::"text"])))
);


ALTER TABLE "public"."declaration_signing_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."defect_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "defect_id" "uuid" NOT NULL,
    "changed_by" "uuid",
    "field_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."defect_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."defects" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "aircraft_id" "uuid" NOT NULL,
    "reported_by" "text" NOT NULL,
    "date_reported" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "photos" "text"[] DEFAULT '{}'::"text"[],
    "mel_notes" "text",
    "severity" "text",
    "location" "text",
    "tach_hours" numeric(8,1),
    "hobbs_hours" numeric(8,1),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "fix_notes" "text",
    "grounded_aircraft" boolean DEFAULT false,
    CONSTRAINT "defects_severity_check" CHECK (("severity" = ANY (ARRAY['Minor'::"text", 'Major'::"text", 'Critical'::"text"]))),
    CONSTRAINT "defects_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'mel'::"text", 'fixed'::"text", 'deferred'::"text"])))
);


ALTER TABLE "public"."defects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."endorsements" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "date_obtained" "date" NOT NULL,
    "expiry_date" "date",
    "instructor_id" "uuid",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "endorsements_type_not_blank" CHECK (("length"(TRIM(BOTH FROM "type")) > 0))
);


ALTER TABLE "public"."endorsements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flight_log_field_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "field_name" "text",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "is_mandatory" boolean DEFAULT false NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "aircraft_id" "uuid"
);


ALTER TABLE "public"."flight_log_field_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flight_log_stripe_events" (
    "id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "flight_log_id" "uuid",
    "stripe_checkout_session_id" "text",
    "payload" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "flight_log_stripe_events_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."flight_log_stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flight_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "landings" integer DEFAULT 0,
    "duration" numeric(4,2) DEFAULT 0 NOT NULL,
    "tach_start" numeric(8,1) DEFAULT 0 NOT NULL,
    "tach_end" numeric(8,1) DEFAULT 0 NOT NULL,
    "engine_start" numeric(8,1),
    "engine_end" numeric(8,1),
    "total_cost" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "aircraft_id" "uuid",
    "student_id" "uuid",
    "instructor_id" "uuid",
    "start_time" timestamp with time zone,
    "end_time" timestamp with time zone,
    "start_tach" numeric,
    "end_tach" numeric,
    "flight_duration" numeric DEFAULT 0,
    "dual_time" numeric DEFAULT 0,
    "solo_time" numeric DEFAULT 0,
    "takeoffs" integer DEFAULT 0,
    "comments" "text",
    "payment_type" "text",
    "observations" "text",
    "oil_added" numeric,
    "fuel_added" numeric,
    "passengers" integer,
    "created_by" "uuid",
    "flight_type_id" "uuid",
    "calculated_cost" numeric DEFAULT 0,
    "payment_status" "text" DEFAULT 'pending'::"text",
    "training_record_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "hobbs_start" numeric,
    "hobbs_end" numeric,
    "fuel_start" numeric,
    "fuel_end" numeric,
    "oil_start" numeric,
    "oil_end" numeric,
    "fuel_type" "text",
    "aircraft_condition" "text",
    "maintenance_notes" "text",
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "stripe_payment_status" "text",
    "stripe_checkout_created_at" timestamp with time zone,
    "stripe_paid_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "stripe_payment_error" "text",
    "stripe_charge_attempted_at" timestamp with time zone,
    "training_record_overdue_email_sent_at" timestamp with time zone,
    "xero_invoice_id" "text",
    "xero_invoice_number" "text",
    "xero_invoice_status" "text",
    "xero_invoice_synced_at" timestamp with time zone,
    "xero_payment_id" "text",
    "xero_payment_synced_at" timestamp with time zone,
    "xero_sync_status" "text" DEFAULT 'not_synced'::"text" NOT NULL,
    "xero_sync_error" "text",
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "flight_logs_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['free'::"text", 'pending'::"text", 'paid'::"text"]))),
    CONSTRAINT "flight_logs_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"]))),
    CONSTRAINT "flight_logs_training_record_status_check" CHECK (("training_record_status" = ANY (ARRAY['pending'::"text", 'dismissed'::"text", 'recorded'::"text"]))),
    CONSTRAINT "flight_logs_xero_sync_status_check" CHECK (("xero_sync_status" = ANY (ARRAY['not_synced'::"text", 'queued'::"text", 'syncing'::"text", 'synced'::"text", 'needs_review'::"text", 'failed'::"text"])))
);

ALTER TABLE ONLY "public"."flight_logs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."flight_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."flight_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "allowed_roles" "text"[] DEFAULT ARRAY['student'::"text", 'pilot'::"text", 'instructor'::"text", 'admin'::"text"],
    "display_order" integer DEFAULT 0,
    "forced_payment_method_id" "uuid",
    "ground_session_hourly_rate" numeric DEFAULT 0 NOT NULL,
    "xero_item_code" "text"
);


ALTER TABLE "public"."flight_types" OWNER TO "postgres";


COMMENT ON COLUMN "public"."flight_types"."ground_session_hourly_rate" IS 'Hourly ground instruction rate used for instructor-only bookings. Logs bill in 15 minute increments.';



COMMENT ON COLUMN "public"."flight_types"."xero_item_code" IS 'Xero sales item code used on invoices for this booking or flight type.';



CREATE TABLE IF NOT EXISTS "public"."ground_session_description_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "display_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pricing_mode" "text" DEFAULT 'flight_type_hourly'::"text" NOT NULL,
    "fixed_rate" numeric DEFAULT 0 NOT NULL,
    "flight_type_id" "uuid",
    CONSTRAINT "ground_session_description_options_pricing_mode_check" CHECK (("pricing_mode" = ANY (ARRAY['fixed'::"text", 'flight_type_hourly'::"text"])))
);


ALTER TABLE "public"."ground_session_description_options" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ground_session_description_options"."pricing_mode" IS 'fixed charges fixed_rate once; flight_type_hourly charges the linked/selected flight type ground hourly rate in 15 minute increments.';



COMMENT ON COLUMN "public"."ground_session_description_options"."fixed_rate" IS 'Fixed total charge used when pricing_mode is fixed.';



COMMENT ON COLUMN "public"."ground_session_description_options"."flight_type_id" IS 'Optional flight type whose ground_session_hourly_rate is used when pricing_mode is flight_type_hourly.';



CREATE TABLE IF NOT EXISTS "public"."ground_session_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "student_id" "uuid" NOT NULL,
    "instructor_id" "uuid" NOT NULL,
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "duration_hours" numeric NOT NULL,
    "flight_type_id" "uuid",
    "payment_type" "text" NOT NULL,
    "description_option_id" "uuid",
    "description_text" "text",
    "notes" "text",
    "calculated_cost" numeric DEFAULT 0 NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "xero_invoice_id" "text",
    "xero_invoice_number" "text",
    "xero_invoice_status" "text",
    "xero_sync_status" "text",
    "xero_sync_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ground_session_logs_duration_hours_check" CHECK (("duration_hours" > (0)::numeric)),
    CONSTRAINT "ground_session_logs_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['free'::"text", 'pending'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."ground_session_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ground_session_logs"."duration_hours" IS 'Billable ground session duration, stored in 0.25 hour / 15 minute increments.';



CREATE TABLE IF NOT EXISTS "public"."instructor_absences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instructor_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid"
);

ALTER TABLE ONLY "public"."instructor_absences" REPLICA IDENTITY FULL;


ALTER TABLE "public"."instructor_absences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instructor_schedule_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instructor_id" "uuid" NOT NULL,
    "change_date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "start_time_2" time without time zone,
    "end_time_2" time without time zone,
    "is_available" boolean DEFAULT true,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "effective_from" "date",
    "day_of_week" integer DEFAULT 0,
    "afternoon_start_time" time without time zone,
    "afternoon_end_time" time without time zone,
    "updated_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."instructor_schedule_changes" REPLICA IDENTITY FULL;


ALTER TABLE "public"."instructor_schedule_changes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."instructor_weekly_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instructor_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "start_time_2" time without time zone,
    "end_time_2" time without time zone,
    "is_available" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "afternoon_start_time" time without time zone,
    "afternoon_end_time" time without time zone
);

ALTER TABLE ONLY "public"."instructor_weekly_schedules" REPLICA IDENTITY FULL;


ALTER TABLE "public"."instructor_weekly_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "role" "text" DEFAULT 'student'::"text" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "accepted_at" timestamp with time zone,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric(8,2) NOT NULL,
    "rate" numeric(8,2) NOT NULL,
    "total" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "date" "date" NOT NULL,
    "total" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'paid'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_program_enrolments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "invited_email" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "due_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_program_enrolments_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['not_required'::"text", 'unpaid'::"text", 'paid'::"text", 'waived'::"text"]))),
    CONSTRAINT "learning_program_enrolments_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'pending_approval'::"text", 'active'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."learning_program_enrolments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_program_lesson_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "training_course_id" "uuid" NOT NULL,
    "training_lesson_id" "uuid",
    "visibility_timing" "text" DEFAULT 'at_or_before_lesson'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_program_lesson_links_visibility_timing_check" CHECK (("visibility_timing" = ANY (ARRAY['always'::"text", 'at_or_before_lesson'::"text", 'after_lesson'::"text"])))
);


ALTER TABLE "public"."learning_program_lesson_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_program_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."learning_program_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_program_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "section_id" "uuid",
    "step_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "content_blocks" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "video_url" "text",
    "video_storage_path" "text",
    "video_duration_seconds" integer,
    "quiz_questions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "passing_score_percent" integer,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_required" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_program_steps_passing_score_percent_check" CHECK ((("passing_score_percent" IS NULL) OR (("passing_score_percent" >= 0) AND ("passing_score_percent" <= 100)))),
    CONSTRAINT "learning_program_steps_step_type_check" CHECK (("step_type" = ANY (ARRAY['article'::"text", 'video'::"text", 'quiz'::"text"])))
);


ALTER TABLE "public"."learning_program_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'General'::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "cover_photo_url" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "schedule_type" "text" DEFAULT 'self_paced'::"text" NOT NULL,
    "self_paced_limit_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "duration_days" integer,
    "scheduled_start_at" timestamp with time zone,
    "scheduled_end_at" timestamp with time zone,
    "price_type" "text" DEFAULT 'free'::"text" NOT NULL,
    "price_cents" integer DEFAULT 0 NOT NULL,
    "payment_notes" "text",
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "participant_limit" integer,
    "step_order_mode" "text" DEFAULT 'in_order'::"text" NOT NULL,
    "future_steps_visible" boolean DEFAULT true NOT NULL,
    "video_watch_required" boolean DEFAULT false NOT NULL,
    "video_required_percent" integer DEFAULT 90 NOT NULL,
    "autoplay_next_video" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_programs_participant_limit_check" CHECK ((("participant_limit" IS NULL) OR ("participant_limit" > 0))),
    CONSTRAINT "learning_programs_price_cents_check" CHECK (("price_cents" >= 0)),
    CONSTRAINT "learning_programs_price_type_check" CHECK (("price_type" = ANY (ARRAY['free'::"text", 'paid'::"text"]))),
    CONSTRAINT "learning_programs_schedule_type_check" CHECK (("schedule_type" = ANY (ARRAY['self_paced'::"text", 'scheduled'::"text"]))),
    CONSTRAINT "learning_programs_self_paced_limit_type_check" CHECK (("self_paced_limit_type" = ANY (ARRAY['none'::"text", 'duration_days'::"text", 'fixed_end'::"text"]))),
    CONSTRAINT "learning_programs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"]))),
    CONSTRAINT "learning_programs_step_order_mode_check" CHECK (("step_order_mode" = ANY (ARRAY['any_order'::"text", 'in_order'::"text"]))),
    CONSTRAINT "learning_programs_video_required_percent_check" CHECK ((("video_required_percent" >= 0) AND ("video_required_percent" <= 100))),
    CONSTRAINT "learning_programs_visibility_check" CHECK (("visibility" = ANY (ARRAY['public'::"text", 'private'::"text", 'secret'::"text"])))
);


ALTER TABLE "public"."learning_programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learning_step_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "step_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "video_watch_percent" integer DEFAULT 0 NOT NULL,
    "quiz_score_percent" integer,
    "quiz_answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_step_progress_quiz_score_percent_check" CHECK ((("quiz_score_percent" IS NULL) OR (("quiz_score_percent" >= 0) AND ("quiz_score_percent" <= 100)))),
    CONSTRAINT "learning_step_progress_status_check" CHECK (("status" = ANY (ARRAY['not_started'::"text", 'in_progress'::"text", 'completed'::"text"]))),
    CONSTRAINT "learning_step_progress_video_watch_percent_check" CHECK ((("video_watch_percent" >= 0) AND ("video_watch_percent" <= 100)))
);


ALTER TABLE "public"."learning_step_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lesson_id" "uuid",
    "course_id" "uuid",
    "lesson_code" "text" DEFAULT ''::"text" NOT NULL,
    "lesson_name" "text" DEFAULT ''::"text" NOT NULL,
    "objective" "text" DEFAULT ''::"text" NOT NULL,
    "flight_exercises" "text" DEFAULT ''::"text" NOT NULL,
    "theory" "text" DEFAULT ''::"text" NOT NULL,
    "assessment_criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "snapshotted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lesson_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aircraft_id" "uuid",
    "action" "text" NOT NULL,
    "performed_by" "uuid",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."maintenance_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_completions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "milestone_id" "uuid",
    "aircraft_id" "uuid",
    "completed_by" "uuid",
    "completed_at" timestamp with time zone DEFAULT "now"(),
    "notes" "text",
    "tach_hours" numeric,
    "hobbs_hours" numeric,
    "completed_date" "date",
    "completed_tach" numeric,
    "next_due_hours" numeric,
    "next_due_date" "date"
);


ALTER TABLE "public"."maintenance_completions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_milestone_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "due_condition" "text",
    "due_value" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" DEFAULT ''::"text",
    "type" "text" DEFAULT 'hours'::"text",
    "interval_hours" numeric DEFAULT 0,
    "interval_months" integer DEFAULT 0,
    "description" "text",
    "is_default" boolean DEFAULT false,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."maintenance_milestone_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_milestones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aircraft_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "due_condition" "text" NOT NULL,
    "due_value" "text" NOT NULL,
    "warning_threshold" "text",
    "notes" "text",
    "status" "text" DEFAULT 'upcoming'::"text",
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "completion_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" DEFAULT 'hours'::"text",
    "interval_hours" numeric DEFAULT 0,
    "interval_months" integer DEFAULT 0,
    "last_completed_date" "date",
    "last_completed_tach" numeric,
    "next_due_hours" numeric,
    "next_due_date" "date",
    "description" "text",
    "is_one_time" boolean DEFAULT false NOT NULL,
    CONSTRAINT "maintenance_milestones_due_condition_check" CHECK (("due_condition" = ANY (ARRAY['hours'::"text", 'date'::"text"]))),
    CONSTRAINT "maintenance_milestones_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'due'::"text", 'overdue'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."maintenance_milestones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."maintenance_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_stripe_card_setup_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_checkout_session_id" "text",
    "consent_text" "text" NOT NULL,
    "consent_accepted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "consent_ip" "text",
    "consent_user_agent" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "member_stripe_card_setup_sessions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'expired'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "member_stripe_card_setup_sessions_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."member_stripe_card_setup_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_stripe_payment_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text" NOT NULL,
    "stripe_payment_method_id" "text" NOT NULL,
    "stripe_setup_intent_id" "text",
    "card_brand" "text",
    "card_last4" "text",
    "card_exp_month" integer,
    "card_exp_year" integer,
    "active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT true NOT NULL,
    "consent_text" "text" NOT NULL,
    "consent_accepted_at" timestamp with time zone NOT NULL,
    "consent_ip" "text",
    "consent_user_agent" "text",
    "removed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "member_stripe_payment_methods_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."member_stripe_payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_topup_link_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "checkout_session_id" "text",
    "amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "trigger_reason" "text" DEFAULT 'manual'::"text" NOT NULL,
    "email_to" "text",
    "email_sent" boolean DEFAULT false NOT NULL,
    "email_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "member_topup_link_notifications_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."member_topup_link_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email_notifications_enabled" boolean DEFAULT true NOT NULL,
    "sms_notifications_enabled" boolean DEFAULT false NOT NULL,
    "in_app_notifications_enabled" boolean DEFAULT true NOT NULL,
    "booking_change_notification_enabled" boolean DEFAULT true NOT NULL,
    "waitlist_notification_enabled" boolean DEFAULT true NOT NULL,
    "instructor_absence_notification_enabled" boolean DEFAULT true NOT NULL,
    "maintenance_due_alert_days" integer DEFAULT 14 NOT NULL,
    "maintenance_due_alert_hours" integer DEFAULT 10 NOT NULL,
    "defect_report_notification_enabled" boolean DEFAULT true NOT NULL,
    "safety_report_notification_enabled" boolean DEFAULT true NOT NULL,
    "approval_request_notification_enabled" boolean DEFAULT true NOT NULL,
    "overdue_flight_record_alert_hours" integer DEFAULT 24 NOT NULL,
    "daily_ops_digest_enabled" boolean DEFAULT false NOT NULL,
    "daily_ops_digest_time" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
    "quiet_hours_start" time without time zone DEFAULT '20:00:00'::time without time zone NOT NULL,
    "quiet_hours_end" time without time zone DEFAULT '07:00:00'::time without time zone NOT NULL,
    "booking_confirmation_enabled" boolean DEFAULT true NOT NULL,
    "booking_reminder_24h_enabled" boolean DEFAULT true NOT NULL,
    "booking_reminder_2h_enabled" boolean DEFAULT true NOT NULL,
    "cancellation_notification_enabled" boolean DEFAULT true NOT NULL,
    "maintenance_alert_enabled" boolean DEFAULT true NOT NULL,
    "currency_expiry_alert_days" integer DEFAULT 30 NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."notification_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "booking_id" "uuid",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "metadata" "jsonb"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organisation_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "club_name" "text" DEFAULT 'My Flying Club'::"text" NOT NULL,
    "address" "text" DEFAULT ''::"text" NOT NULL,
    "timezone" "text" DEFAULT 'Australia/Melbourne'::"text" NOT NULL,
    "currency" "text" DEFAULT 'AUD'::"text" NOT NULL,
    "contact_email" "text" DEFAULT ''::"text" NOT NULL,
    "contact_phone" "text" DEFAULT ''::"text" NOT NULL,
    "website" "text" DEFAULT ''::"text" NOT NULL,
    "student_portal_url" "text" DEFAULT ''::"text" NOT NULL,
    "booking_day_start" "text" DEFAULT '06:00'::"text" NOT NULL,
    "booking_day_end" "text" DEFAULT '22:00'::"text" NOT NULL,
    "default_slot_length" integer DEFAULT 30 NOT NULL,
    "logo_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "updated_by" "uuid"
);


ALTER TABLE "public"."organisation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_methods" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "display_order" integer DEFAULT 0,
    "allow_account_topup" boolean DEFAULT true NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "system_key" "text"
);


ALTER TABLE "public"."payment_methods" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."portal_ux_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "theme" "text" DEFAULT 'light'::"text" NOT NULL,
    "date_format" "text" DEFAULT 'dd/MM/yyyy'::"text" NOT NULL,
    "time_format" "text" DEFAULT '24h'::"text" NOT NULL,
    "flight_time_decimals" integer DEFAULT 1 NOT NULL,
    "currency_decimals" integer DEFAULT 2 NOT NULL,
    "show_invoices_in_portal" boolean DEFAULT true NOT NULL,
    "show_study_tasks_in_portal" boolean DEFAULT true NOT NULL,
    "show_progress_tracking" boolean DEFAULT true NOT NULL,
    "allow_self_booking" boolean DEFAULT true NOT NULL,
    "allow_booking_cancellation" boolean DEFAULT true NOT NULL,
    "max_advance_booking_days" integer DEFAULT 30 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "kiosk_theme" "text" DEFAULT 'day-night'::"text" NOT NULL,
    CONSTRAINT "portal_ux_settings_currency_decimals_check" CHECK (("currency_decimals" = ANY (ARRAY[0, 2]))),
    CONSTRAINT "portal_ux_settings_flight_time_decimals_check" CHECK (("flight_time_decimals" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "portal_ux_settings_kiosk_theme_check" CHECK (("kiosk_theme" = ANY (ARRAY['light'::"text", 'dark'::"text", 'day-night'::"text", 'auto'::"text"]))),
    CONSTRAINT "portal_ux_settings_max_advance_booking_days_check" CHECK ((("max_advance_booking_days" >= 1) AND ("max_advance_booking_days" <= 365))),
    CONSTRAINT "portal_ux_settings_theme_check" CHECK (("theme" = ANY (ARRAY['light'::"text", 'semi-dark'::"text", 'dark'::"text", 'day-night'::"text", 'auto'::"text"]))),
    CONSTRAINT "portal_ux_settings_time_format_check" CHECK (("time_format" = ANY (ARRAY['24h'::"text", '12h'::"text"])))
);


ALTER TABLE "public"."portal_ux_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "aircraft_fields" "jsonb" DEFAULT '[{"id": "registration", "name": "Registration", "locked": true, "visible": true, "required": true}, {"id": "make", "name": "Make", "locked": true, "visible": true, "required": true}, {"id": "model", "name": "Model", "locked": true, "visible": true, "required": true}, {"id": "type", "name": "Aircraft Type", "locked": true, "visible": true, "required": true}, {"id": "tachStart", "name": "Tach Start", "visible": true, "required": false}, {"id": "seatCapacity", "name": "Seat Capacity", "visible": true, "required": false}, {"id": "fuelCapacity", "name": "Fuel Capacity", "visible": true, "required": false}, {"id": "emptyWeight", "name": "Empty Weight", "visible": true, "required": false}, {"id": "maxWeight", "name": "Max Weight", "visible": true, "required": false}]'::"jsonb" NOT NULL,
    "aircraft_document_types" "jsonb" DEFAULT '[{"id": "poh", "name": "Pilot Operating Handbook (POH)", "required": true}, {"id": "insurance", "name": "Insurance Certificate", "required": true}, {"id": "airworthiness", "name": "Certificate of Airworthiness", "required": true}, {"id": "weight-balance", "name": "Weight & Balance Sheet", "required": false}, {"id": "maintenance-log", "name": "Maintenance Log", "required": false}]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."resource_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "location" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "capacity" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "is_bookable" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "rooms_capacity_check" CHECK (("capacity" > 0)),
    CONSTRAINT "rooms_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'unavailable'::"text", 'maintenance'::"text"])))
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_compliance_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "recency_days" integer DEFAULT 90 NOT NULL,
    "medical_warning_days" integer DEFAULT 60 NOT NULL,
    "licence_warning_days" integer DEFAULT 60 NOT NULL,
    "bfr_warning_days" integer DEFAULT 60 NOT NULL,
    "instructor_sop_check_months" integer DEFAULT 3 NOT NULL,
    "senior_instructor_sop_check_months" integer DEFAULT 12 NOT NULL,
    "default_safety_officer" "text" DEFAULT 'Safety Officer'::"text" NOT NULL,
    "auto_assign_incidents" boolean DEFAULT true NOT NULL,
    "require_photos_for_defects" boolean DEFAULT false NOT NULL,
    "auto_ground_on_major_defect" boolean DEFAULT true NOT NULL,
    "auto_block_expired_medical" boolean DEFAULT true NOT NULL,
    "auto_block_expired_licence" boolean DEFAULT true NOT NULL,
    "require_bfr_for_solo" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."safety_compliance_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "filename" "text" NOT NULL,
    "category" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."safety_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_report_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "display_order" integer DEFAULT 0,
    "default_assignee" "text" DEFAULT ''::"text"
);


ALTER TABLE "public"."safety_report_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."safety_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "report_type" "text" NOT NULL,
    "severity" "text" DEFAULT 'low'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "location" "text",
    "immediate_actions" "text",
    "involved_user_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assigned_to" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "occurrence_at" timestamp with time zone,
    "aircraft_id" "uuid",
    "phase_of_flight" "text",
    "witnesses" "text",
    "injury_reported" boolean DEFAULT false NOT NULL,
    "damage_reported" boolean DEFAULT false NOT NULL,
    "reportable_to_authority" boolean DEFAULT false NOT NULL,
    "corrective_action" "text",
    "closed_at" timestamp with time zone,
    CONSTRAINT "safety_reports_report_type_check" CHECK (("report_type" = ANY (ARRAY['incident'::"text", 'hazard'::"text", 'risk_assessment'::"text", 'near_miss'::"text", 'accident'::"text"]))),
    CONSTRAINT "safety_reports_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "safety_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'under_review'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."safety_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_connect_oauth_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "state" "text" NOT NULL,
    "requested_by" "uuid",
    "redirect_to" "text",
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stripe_connect_oauth_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_connect_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "stripe_user_id" "text",
    "stripe_publishable_key" "text",
    "scope" "text",
    "livemode" boolean DEFAULT false NOT NULL,
    "connected_by" "uuid",
    "connected_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "allow_test_mode_xero_sync" boolean DEFAULT false NOT NULL,
    "mode_updated_by" "uuid",
    "mode_updated_at" timestamp with time zone,
    CONSTRAINT "stripe_connect_settings_id_check" CHECK ("id"),
    CONSTRAINT "stripe_connect_settings_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."stripe_connect_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_course_enrolments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "enrolled_by" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "declaration_signed_at" timestamp with time zone,
    "declaration_signed_name" "text",
    "declaration_member_number" "text",
    "declaration_text_snapshot" "text",
    "declaration_version" integer,
    "guardian_declaration_signed_at" timestamp with time zone,
    "guardian_declaration_signed_name" "text",
    "guardian_declaration_relationship" "text",
    "guardian_declaration_email" "text",
    "guardian_declaration_phone" "text",
    "guardian_declaration_text_snapshot" "text",
    "guardian_declaration_version" integer,
    CONSTRAINT "student_course_enrolments_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."student_course_enrolments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint DEFAULT 0 NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_documents_display_name_check" CHECK (("length"(TRIM(BOTH FROM "display_name")) > 0))
);


ALTER TABLE "public"."student_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_exam_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "course_id" "uuid",
    "exam_id" "text" NOT NULL,
    "exam_name" "text" NOT NULL,
    "score" numeric(6,2) DEFAULT 0 NOT NULL,
    "pass_mark" numeric(6,2) DEFAULT 0 NOT NULL,
    "result" "text" DEFAULT 'fail'::"text" NOT NULL,
    "exam_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "instructor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "file_name" "text",
    "file_type" "text",
    "file_size" bigint DEFAULT 0 NOT NULL,
    "storage_path" "text",
    "answer_sheet_only" boolean DEFAULT true NOT NULL,
    "kdr_required" boolean DEFAULT true NOT NULL,
    "kdr_completed" boolean DEFAULT false NOT NULL,
    "kdr_completion_method" "text" DEFAULT 'verbal'::"text" NOT NULL,
    "kdr_notes" "text",
    "kdr_signed_off_by" "uuid",
    "kdr_signed_off_at" timestamp with time zone,
    CONSTRAINT "student_exam_results_kdr_completion_method_check" CHECK (("kdr_completion_method" = ANY (ARRAY['verbal'::"text", 'written'::"text", 'not_required'::"text"]))),
    CONSTRAINT "student_exam_results_result_check" CHECK (("result" = ANY (ARRAY['pass'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."student_exam_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_matrix_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lesson_id" "uuid",
    "training_record_id" "uuid",
    "matrix_row_id" "uuid" NOT NULL,
    "achieved_standard" integer,
    "comments" "text" DEFAULT ''::"text" NOT NULL,
    "instructor_id" "uuid",
    "assessed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_matrix_assessments_achieved_standard_check" CHECK (("achieved_standard" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."student_matrix_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_syllabi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "syllabus_id" "uuid" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."student_syllabi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."students" (
    "id" "uuid" NOT NULL,
    "raaus_id" "text",
    "casa_id" "text",
    "medical_type" "text",
    "medical_expiry" "date",
    "licence_expiry" "date",
    "date_of_birth" "date",
    "prepaid_balance" numeric(10,2) DEFAULT 0.00,
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "emergency_contact_relationship" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "occupation" "text",
    "alternate_phone" "text",
    "last_flight_review" "date"
);


ALTER TABLE "public"."students" OWNER TO "postgres";


COMMENT ON COLUMN "public"."students"."licence_expiry" IS 'Membership expiry date (e.g., RAAus membership)';



COMMENT ON COLUMN "public"."students"."prepaid_balance" IS 'Deprecated legacy CRM prepaid balance. Xero credit/overpayments are the source of truth for account balance.';



COMMENT ON COLUMN "public"."students"."last_flight_review" IS 'Date of last biennial flight review (BFR)';



CREATE TABLE IF NOT EXISTS "public"."syllabi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."syllabi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."syllabus_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "syllabus_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."syllabus_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."syllabus_matrix_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lesson_id" "uuid",
    "matrix_row_id" "uuid" NOT NULL,
    "lesson_sequence_code" "text" NOT NULL,
    "lesson_column_title" "text" NOT NULL,
    "required_standard" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assessment_criterion_id" "text",
    CONSTRAINT "syllabus_matrix_requirements_required_standard_check" CHECK (("required_standard" = ANY (ARRAY[1, 2, 3])))
);


ALTER TABLE "public"."syllabus_matrix_requirements" OWNER TO "postgres";


COMMENT ON COLUMN "public"."syllabus_matrix_requirements"."assessment_criterion_id" IS 'Optional course assessment criterion id this matrix requirement contributes to.';



CREATE TABLE IF NOT EXISTS "public"."syllabus_matrix_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "row_type" "text" NOT NULL,
    "unit_code" "text",
    "element_code" "text",
    "parent_code" "text",
    "description" "text" NOT NULL,
    "source_row_number" integer,
    "sort_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "syllabus_matrix_rows_row_type_check" CHECK (("row_type" = ANY (ARRAY['unit'::"text", 'element'::"text", 'criterion'::"text"])))
);


ALTER TABLE "public"."syllabus_matrix_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."syllabus_sequences" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "code" "text" NOT NULL,
    "title" "text" NOT NULL,
    "group_name" "text" NOT NULL,
    "order_index" integer NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."syllabus_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "category" "text" DEFAULT 'Custom'::"text" NOT NULL,
    "version" "text" DEFAULT '1.0'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "estimated_duration_hours" integer DEFAULT 6 NOT NULL,
    "prerequisites" "text"[] DEFAULT '{}'::"text"[],
    "objectives" "text"[] DEFAULT '{}'::"text"[],
    "evaluation_criteria" "text"[] DEFAULT '{}'::"text"[],
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "created_by" "uuid",
    "last_updated" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "assessment_criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "exam_requirements" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "requires_student_acknowledgement" boolean DEFAULT true NOT NULL,
    "completion_endorsement_enabled" boolean DEFAULT false NOT NULL,
    "completion_endorsement_type" "text",
    "completion_endorsement_expiry_months" integer,
    "requires_flying_declaration" boolean DEFAULT false NOT NULL,
    "flying_declaration_title" "text" DEFAULT 'Flying Declaration'::"text" NOT NULL,
    "flying_declaration_text" "text" DEFAULT ''::"text" NOT NULL,
    "flying_declaration_version" integer DEFAULT 1 NOT NULL,
    "requires_guardian_declaration_for_minors" boolean DEFAULT true NOT NULL,
    "guardian_declaration_title" "text" DEFAULT 'Under 18 Years - Parent/Guardian Declaration'::"text" NOT NULL,
    "guardian_declaration_text" "text" DEFAULT ''::"text" NOT NULL,
    "resources" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "two_occasion_competency_rule_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "training_courses_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."training_courses" OWNER TO "postgres";


COMMENT ON COLUMN "public"."training_courses"."completion_endorsement_enabled" IS 'When true, 100% course completion can automatically grant the configured endorsement.';



COMMENT ON COLUMN "public"."training_courses"."completion_endorsement_type" IS 'Endorsement name/type granted when the course is completed.';



COMMENT ON COLUMN "public"."training_courses"."completion_endorsement_expiry_months" IS 'Optional expiry period for the granted endorsement. Null means no expiry.';



COMMENT ON COLUMN "public"."training_courses"."resources" IS 'Course reference resources shown in the training course editor and exports.';



CREATE TABLE IF NOT EXISTS "public"."training_lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "name" "text" NOT NULL,
    "objective" "text" DEFAULT ''::"text" NOT NULL,
    "flight_exercises" "text" DEFAULT ''::"text",
    "theory" "text" DEFAULT ''::"text",
    "sequence_id" "text" DEFAULT ''::"text",
    "sequence_code" "text" DEFAULT ''::"text",
    "sequence_title" "text" DEFAULT ''::"text",
    "stage" "text" DEFAULT 'flight'::"text" NOT NULL,
    "duration_minutes" integer DEFAULT 60 NOT NULL,
    "min_competency" "text" DEFAULT 'Introduce'::"text" NOT NULL,
    "key_exercises" "text"[] DEFAULT '{}'::"text"[],
    "student_preparation" "text" DEFAULT ''::"text",
    "instructor_notes" "text" DEFAULT ''::"text",
    "assessment_criteria" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "pass_marks" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_flight_test" boolean DEFAULT false NOT NULL,
    "pass_mark_repeat_requirements" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "study_guide" "text" DEFAULT ''::"text" NOT NULL,
    "study_assets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "training_lessons_min_competency_check" CHECK (("min_competency" = ANY (ARRAY['Introduce'::"text", 'Practice'::"text", 'Assess'::"text"]))),
    CONSTRAINT "training_lessons_stage_check" CHECK (("stage" = ANY (ARRAY['ground'::"text", 'flight'::"text", 'simulator'::"text"])))
);


ALTER TABLE "public"."training_lessons" OWNER TO "postgres";


COMMENT ON COLUMN "public"."training_lessons"."is_flight_test" IS 'Marks this lesson as a course-defined flight test/check flight rather than a normal lesson.';



COMMENT ON COLUMN "public"."training_lessons"."pass_mark_repeat_requirements" IS 'Per-lesson map of assessment criterion id to whether two consecutive passing records are required before recommending the next lesson.';



CREATE TABLE IF NOT EXISTS "public"."training_records" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid",
    "student_id" "uuid" NOT NULL,
    "instructor_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "aircraft_id" "uuid",
    "aircraft_type" "text" DEFAULT ''::"text" NOT NULL,
    "registration" "text" DEFAULT ''::"text" NOT NULL,
    "dual_time_min" integer DEFAULT 0,
    "solo_time_min" integer DEFAULT 0,
    "comments" "text" NOT NULL,
    "formal_briefing" boolean DEFAULT false,
    "lesson_codes" "text"[] DEFAULT '{}'::"text"[],
    "next_lesson" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "instructor_signature_url" "text",
    "student_ack" boolean DEFAULT false,
    "student_ack_name" "text",
    "instructor_sign_timestamp" timestamp with time zone,
    "student_ack_timestamp" timestamp with time zone,
    "attachments" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "course_id" "uuid",
    "lesson_id" "uuid",
    "briefing_comments" "text" DEFAULT ''::"text" NOT NULL,
    "criteria_grades" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "flight_log_id" "uuid",
    "student_comments" "text" DEFAULT ''::"text",
    "audit_log" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_flight_review" boolean DEFAULT false NOT NULL,
    "flight_review_type" "text",
    "flight_review_result" "text",
    "flight_review_notes" "text",
    "pilot_role_granted" boolean DEFAULT false NOT NULL,
    CONSTRAINT "training_records_flight_review_result_check" CHECK ((("flight_review_result" IS NULL) OR ("flight_review_result" = ANY (ARRAY['pass'::"text", 'fail'::"text", 'not_assessed'::"text"])))),
    CONSTRAINT "training_records_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."training_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_sequence_results" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "training_record_id" "uuid" NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "sequence_code" "text" NOT NULL,
    "sequence_title" "text" NOT NULL,
    "competence" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "training_sequence_results_competence_check" CHECK (("competence" = ANY (ARRAY['NC'::"text", 'S'::"text", 'C'::"text", '-'::"text"])))
);


ALTER TABLE "public"."training_sequence_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_syllabus_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "default_grading_system" "text" DEFAULT 'NC/S/C/-'::"text" NOT NULL,
    "require_student_acknowledgement" boolean DEFAULT true NOT NULL,
    "lock_record_after_student_ack" boolean DEFAULT true NOT NULL,
    "allow_submitted_record_editing" boolean DEFAULT false NOT NULL,
    "require_flight_comments" boolean DEFAULT true NOT NULL,
    "require_briefing_comments_when_formal" boolean DEFAULT true NOT NULL,
    "default_formal_briefing" boolean DEFAULT false NOT NULL,
    "prefill_highest_grades" boolean DEFAULT true NOT NULL,
    "next_lesson_rule" "text" DEFAULT 'advance_on_pass'::"text" NOT NULL,
    "auto_notify_student_on_submit" boolean DEFAULT true NOT NULL,
    "auto_mark_flight_log_recorded" boolean DEFAULT true NOT NULL,
    "course_completion_rule" "text" DEFAULT 'all_required_criteria'::"text" NOT NULL,
    "show_pass_mark_guidance" boolean DEFAULT true NOT NULL,
    "show_best_grade_guidance" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "force_student_acknowledgement_for_all_courses" boolean DEFAULT false NOT NULL,
    "pilot_status_endorsement_types" "text"[] DEFAULT ARRAY['Pilot Certificate'::"text", 'Recreational Pilots Licence RPL (A)'::"text", 'RPL(A) Aeroplane Category Rating'::"text"] NOT NULL,
    "endorsement_types" "text"[] DEFAULT ARRAY['Pilot Certificate'::"text", 'Recreational Pilots Licence RPL (A)'::"text", 'RPL(A) Aeroplane Category Rating'::"text", 'Passenger Carrying'::"text", 'Flight Radio'::"text", 'Cross Country'::"text", 'Low Level'::"text", 'Formation'::"text", 'Tailwheel'::"text"] NOT NULL,
    CONSTRAINT "training_syllabus_settings_course_completion_rule_check" CHECK (("course_completion_rule" = ANY (ARRAY['all_required_criteria'::"text", 'all_lessons_attempted'::"text", 'criteria_or_lessons'::"text"]))),
    CONSTRAINT "training_syllabus_settings_default_grading_system_check" CHECK (("default_grading_system" = ANY (ARRAY['NC/S/C/-'::"text", 'Pass or Fail'::"text", 'Out of 100'::"text"]))),
    CONSTRAINT "training_syllabus_settings_next_lesson_rule_check" CHECK (("next_lesson_rule" = ANY (ARRAY['advance_on_pass'::"text", 'always_advance'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."training_syllabus_settings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."training_syllabus_settings"."pilot_status_endorsement_types" IS 'Active endorsements with these exact names grant Pilot status to student accounts.';



COMMENT ON COLUMN "public"."training_syllabus_settings"."endorsement_types" IS 'Organisation-managed list of endorsement names available to courses and member profiles.';



CREATE TABLE IF NOT EXISTS "public"."training_template_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."training_template_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."training_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."training_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_flight_voucher_addons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "price" numeric(12,2) DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trial_flight_voucher_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_flight_voucher_product_addons" (
    "product_id" "uuid" NOT NULL,
    "addon_id" "uuid" NOT NULL
);


ALTER TABLE "public"."trial_flight_voucher_product_addons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_flight_voucher_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "aircraft_mode" "text" DEFAULT 'tecnam'::"text" NOT NULL,
    "aircraft_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "instructor_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "duration_minutes" integer NOT NULL,
    "price" numeric(12,2) DEFAULT 0 NOT NULL,
    "email_subject" "text" DEFAULT 'Your Bendigo Flying Club trial flight voucher'::"text" NOT NULL,
    "email_body" "text" DEFAULT ''::"text" NOT NULL,
    "booking_instructions" "text" DEFAULT ''::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_price_id" "text",
    CONSTRAINT "trial_flight_voucher_products_aircraft_mode_check" CHECK (("aircraft_mode" = ANY (ARRAY['tecnam'::"text", 'archer'::"text", 'specific'::"text"]))),
    CONSTRAINT "trial_flight_voucher_products_duration_minutes_check" CHECK (("duration_minutes" > 0))
);


ALTER TABLE "public"."trial_flight_voucher_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_flight_voucher_stripe_events" (
    "id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "voucher_id" "uuid",
    "stripe_checkout_session_id" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_error" "text",
    "payload" "jsonb",
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "trial_flight_voucher_stripe_events_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."trial_flight_voucher_stripe_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_flight_vouchers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "purchaser_name" "text" NOT NULL,
    "purchaser_email" "text" NOT NULL,
    "purchaser_phone" "text",
    "recipient_name" "text",
    "recipient_email" "text",
    "send_to_recipient" boolean DEFAULT false NOT NULL,
    "recipient_delivery_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "status" "text" DEFAULT 'issued'::"text" NOT NULL,
    "expires_at" timestamp with time zone,
    "redeemed_at" timestamp with time zone,
    "redeemed_by_user_id" "uuid",
    "booked_booking_id" "uuid",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payment_status" "text" DEFAULT 'manual'::"text" NOT NULL,
    "payment_amount" numeric(12,2),
    "payment_currency" "text" DEFAULT 'AUD'::"text" NOT NULL,
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "paid_at" timestamp with time zone,
    "email_delivery_claimed_at" timestamp with time zone,
    "selected_addons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payment_source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "payer_user_id" "uuid",
    "xero_sale_journal_id" "text",
    "xero_redemption_journal_id" "text",
    "xero_sale_synced_at" timestamp with time zone,
    "xero_redemption_synced_at" timestamp with time zone,
    "xero_sync_status" "text" DEFAULT 'not_synced'::"text" NOT NULL,
    "xero_sync_error" "text",
    "xero_last_synced_at" timestamp with time zone,
    "checkout_intent" "text" DEFAULT 'gift_certificate'::"text" NOT NULL,
    "held_aircraft_id" "uuid",
    "held_instructor_id" "uuid",
    "held_start_time" timestamp with time zone,
    "held_end_time" timestamp with time zone,
    "hold_expires_at" timestamp with time zone,
    "purchaser_confirmation_sent_at" timestamp with time zone,
    "purchaser_confirmation_error" "text",
    "recipient_confirmation_sent_at" timestamp with time zone,
    "recipient_confirmation_error" "text",
    "stripe_checkout_url" "text",
    "checkout_abandoned_email_sent_at" timestamp with time zone,
    "checkout_abandoned_email_error" "text",
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "trial_flight_vouchers_checkout_intent_check" CHECK (("checkout_intent" = ANY (ARRAY['gift_certificate'::"text", 'book_now'::"text"]))),
    CONSTRAINT "trial_flight_vouchers_payment_source_check" CHECK (("payment_source" = ANY (ARRAY['manual'::"text", 'stripe'::"text", 'prepaid'::"text", 'waived'::"text", 'unknown'::"text"]))),
    CONSTRAINT "trial_flight_vouchers_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['manual'::"text", 'pending'::"text", 'paid'::"text", 'failed'::"text", 'refunded'::"text", 'waived'::"text"]))),
    CONSTRAINT "trial_flight_vouchers_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'redeemed'::"text", 'booked'::"text", 'expired'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "trial_flight_vouchers_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"]))),
    CONSTRAINT "trial_flight_vouchers_xero_sync_status_check" CHECK (("xero_sync_status" = ANY (ARRAY['not_synced'::"text", 'queued'::"text", 'syncing'::"text", 'synced'::"text", 'needs_review'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."trial_flight_vouchers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trial_voucher_cron_auth" (
    "id" boolean DEFAULT true NOT NULL,
    "secret_hash" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trial_voucher_cron_auth_id_check" CHECK ("id")
);


ALTER TABLE "public"."trial_voucher_cron_auth" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "preferences" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "email_notifications" boolean DEFAULT true NOT NULL,
    "sms_notifications" boolean DEFAULT false NOT NULL,
    "booking_reminders" boolean DEFAULT true NOT NULL,
    "currency_alerts" boolean DEFAULT true NOT NULL,
    "maintenance_alerts" boolean DEFAULT true NOT NULL,
    "timezone" "text" DEFAULT 'Australia/Melbourne'::"text" NOT NULL,
    "date_format" "text" DEFAULT 'dd/MM/yyyy'::"text" NOT NULL,
    "time_format" "text" DEFAULT '24h'::"text" NOT NULL,
    "default_calendar_view" "text" DEFAULT 'day'::"text" NOT NULL,
    "theme" "text" DEFAULT 'auto'::"text" NOT NULL,
    "show_progress_dashboard" boolean DEFAULT true NOT NULL,
    "show_upcoming_bookings" boolean DEFAULT true NOT NULL,
    "show_recent_activity" boolean DEFAULT true NOT NULL,
    "compact_view" boolean DEFAULT false NOT NULL,
    "background_image_url" "text" DEFAULT ''::"text",
    "background_filter_color" "text" DEFAULT '#0f172a'::"text",
    "background_filter_opacity" integer DEFAULT 72,
    "background_color" "text" DEFAULT '#f3f4f6'::"text"
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text", 'pilot'::"text", 'student'::"text"])))
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_connection_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "tenant_id" "text",
    "tenant_name" "text",
    "tenant_type" "text",
    "token_type" "text",
    "scope" "text",
    "access_token" "text",
    "refresh_token" "text",
    "id_token" "text",
    "expires_at" timestamp with time zone,
    "connected_by" "uuid",
    "connected_at" timestamp with time zone,
    "disconnected_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "xero_connection_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."xero_connection_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_invoice_portal_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "xero_contact_id" "text" NOT NULL,
    "xero_invoice_id" "text" NOT NULL,
    "xero_invoice_number" "text",
    "amount" numeric NOT NULL,
    "currency" "text" DEFAULT 'AUD'::"text" NOT NULL,
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "xero_payment_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_mode" "text" DEFAULT 'live'::"text" NOT NULL,
    "is_test_mode" boolean DEFAULT false NOT NULL,
    CONSTRAINT "xero_invoice_portal_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "xero_invoice_portal_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text", 'failed'::"text", 'cancelled'::"text", 'needs_review'::"text"]))),
    CONSTRAINT "xero_invoice_portal_payments_stripe_mode_check" CHECK (("stripe_mode" = ANY (ARRAY['test'::"text", 'live'::"text"])))
);


ALTER TABLE "public"."xero_invoice_portal_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_oauth_states" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "state" "text" NOT NULL,
    "requested_by" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."xero_oauth_states" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_rate_limit_state" (
    "id" boolean DEFAULT true NOT NULL,
    "paused_until" timestamp with time zone,
    "minute_window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "minute_calls" integer DEFAULT 0 NOT NULL,
    "daily_window_started_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "daily_calls" integer DEFAULT 0 NOT NULL,
    "next_available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_retry_after_seconds" integer,
    "last_rate_limited_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "xero_rate_limit_state_singleton" CHECK (("id" IS TRUE))
);


ALTER TABLE "public"."xero_rate_limit_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_sync_queue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "xero_contact_id" "text",
    "xero_invoice_id" "text",
    "xero_payment_id" "text",
    "requested_by" "uuid",
    "processed_by" "uuid",
    "processed_at" timestamp with time zone,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "xero_sync_queue_action_check" CHECK (("action" = ANY (ARRAY['upsert_contact'::"text", 'create_invoice'::"text", 'apply_payment'::"text", 'sync_transaction'::"text", 'sync_voucher'::"text"]))),
    CONSTRAINT "xero_sync_queue_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['contact'::"text", 'flight_invoice'::"text", 'flight_payment'::"text", 'account_transaction'::"text", 'voucher'::"text"]))),
    CONSTRAINT "xero_sync_queue_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'synced'::"text", 'needs_review'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."xero_sync_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."xero_sync_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "create_contacts" boolean DEFAULT true NOT NULL,
    "sync_flight_charges" boolean DEFAULT true NOT NULL,
    "sync_account_topups" boolean DEFAULT false NOT NULL,
    "sync_gift_vouchers" boolean DEFAULT false NOT NULL,
    "default_sync_mode" "text" DEFAULT 'manual-review'::"text" NOT NULL,
    "default_invoice_status" "text" DEFAULT 'DRAFT'::"text" NOT NULL,
    "revenue_account_code" "text",
    "topup_account_code" "text",
    "voucher_account_code" "text",
    "tax_type" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "stripe_payment_account_code" "text",
    "prepaid_payment_account_code" "text",
    "auto_queue_flight_invoices" boolean DEFAULT true NOT NULL,
    "auto_apply_verified_payments" boolean DEFAULT false NOT NULL,
    "stripe_fee_expense_account_code" "text",
    "topup_receipt_account_code" "text",
    CONSTRAINT "xero_sync_settings_default_invoice_status_check" CHECK (("default_invoice_status" = ANY (ARRAY['DRAFT'::"text", 'SUBMITTED'::"text", 'AUTHORISED'::"text"]))),
    CONSTRAINT "xero_sync_settings_default_sync_mode_check" CHECK (("default_sync_mode" = ANY (ARRAY['manual-review'::"text", 'auto-draft'::"text", 'auto-approved'::"text"]))),
    CONSTRAINT "xero_sync_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."xero_sync_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aircraft_documents"
    ADD CONSTRAINT "aircraft_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aircraft"
    ADD CONSTRAINT "aircraft_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aircraft_rates"
    ADD CONSTRAINT "aircraft_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."aircraft"
    ADD CONSTRAINT "aircraft_registration_key" UNIQUE ("registration");



ALTER TABLE ONLY "public"."booking_conflicts"
    ADD CONSTRAINT "booking_conflicts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_field_settings"
    ADD CONSTRAINT "booking_field_settings_field_name_key" UNIQUE ("field_name");



ALTER TABLE ONLY "public"."booking_field_settings"
    ADD CONSTRAINT "booking_field_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."booking_rules_settings"
    ADD CONSTRAINT "booking_rules_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_settings"
    ADD CONSTRAINT "calendar_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."declaration_signing_tokens"
    ADD CONSTRAINT "declaration_signing_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."declaration_signing_tokens"
    ADD CONSTRAINT "declaration_signing_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."defect_history"
    ADD CONSTRAINT "defect_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."defects"
    ADD CONSTRAINT "defects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."endorsements"
    ADD CONSTRAINT "endorsements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flight_log_field_settings"
    ADD CONSTRAINT "flight_log_field_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flight_log_stripe_events"
    ADD CONSTRAINT "flight_log_stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."flight_types"
    ADD CONSTRAINT "flight_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ground_session_description_options"
    ADD CONSTRAINT "ground_session_description_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instructor_absences"
    ADD CONSTRAINT "instructor_absences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instructor_schedule_changes"
    ADD CONSTRAINT "instructor_schedule_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instructor_weekly_schedules"
    ADD CONSTRAINT "instructor_weekly_schedules_instructor_id_day_of_week_key" UNIQUE ("instructor_id", "day_of_week");



ALTER TABLE ONLY "public"."instructor_weekly_schedules"
    ADD CONSTRAINT "instructor_weekly_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instructor_weekly_schedules"
    ADD CONSTRAINT "instructor_weekly_schedules_user_id_day_of_week_key" UNIQUE ("user_id", "day_of_week");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_program_id_invited_email_key" UNIQUE ("program_id", "invited_email");



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_program_id_user_id_key" UNIQUE ("program_id", "user_id");



ALTER TABLE ONLY "public"."learning_program_lesson_links"
    ADD CONSTRAINT "learning_program_lesson_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_program_lesson_links"
    ADD CONSTRAINT "learning_program_lesson_links_program_id_training_course_id_key" UNIQUE ("program_id", "training_course_id", "training_lesson_id");



ALTER TABLE ONLY "public"."learning_program_sections"
    ADD CONSTRAINT "learning_program_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_program_steps"
    ADD CONSTRAINT "learning_program_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_programs"
    ADD CONSTRAINT "learning_programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_step_progress"
    ADD CONSTRAINT "learning_step_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learning_step_progress"
    ADD CONSTRAINT "learning_step_progress_step_id_user_id_key" UNIQUE ("step_id", "user_id");



ALTER TABLE ONLY "public"."lesson_snapshots"
    ADD CONSTRAINT "lesson_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_audit_log"
    ADD CONSTRAINT "maintenance_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_completions"
    ADD CONSTRAINT "maintenance_completions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_milestone_templates"
    ADD CONSTRAINT "maintenance_milestone_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_milestones"
    ADD CONSTRAINT "maintenance_milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_settings"
    ADD CONSTRAINT "maintenance_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_stripe_card_setup_sessions"
    ADD CONSTRAINT "member_stripe_card_setup_session_stripe_checkout_session_id_key" UNIQUE ("stripe_checkout_session_id");



ALTER TABLE ONLY "public"."member_stripe_card_setup_sessions"
    ADD CONSTRAINT "member_stripe_card_setup_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_stripe_payment_methods"
    ADD CONSTRAINT "member_stripe_payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_stripe_payment_methods"
    ADD CONSTRAINT "member_stripe_payment_methods_stripe_payment_method_id_key" UNIQUE ("stripe_payment_method_id");



ALTER TABLE ONLY "public"."member_topup_link_notifications"
    ADD CONSTRAINT "member_topup_link_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organisation_settings"
    ADD CONSTRAINT "organisation_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_methods"
    ADD CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portal_ux_settings"
    ADD CONSTRAINT "portal_ux_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resource_settings"
    ADD CONSTRAINT "resource_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safety_compliance_settings"
    ADD CONSTRAINT "safety_compliance_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safety_documents"
    ADD CONSTRAINT "safety_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safety_documents"
    ADD CONSTRAINT "safety_documents_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."safety_report_categories"
    ADD CONSTRAINT "safety_report_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."safety_reports"
    ADD CONSTRAINT "safety_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_connect_oauth_states"
    ADD CONSTRAINT "stripe_connect_oauth_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_connect_oauth_states"
    ADD CONSTRAINT "stripe_connect_oauth_states_state_key" UNIQUE ("state");



ALTER TABLE ONLY "public"."stripe_connect_settings"
    ADD CONSTRAINT "stripe_connect_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_course_enrolments"
    ADD CONSTRAINT "student_course_enrolments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_course_enrolments"
    ADD CONSTRAINT "student_course_enrolments_student_id_course_id_key" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."student_documents"
    ADD CONSTRAINT "student_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_documents"
    ADD CONSTRAINT "student_documents_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_training_record_id_matrix_row_id_key" UNIQUE ("training_record_id", "matrix_row_id");



ALTER TABLE ONLY "public"."student_syllabi"
    ADD CONSTRAINT "student_syllabi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_syllabi"
    ADD CONSTRAINT "student_syllabi_student_id_syllabus_id_key" UNIQUE ("student_id", "syllabus_id");



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syllabi"
    ADD CONSTRAINT "syllabi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syllabus_items"
    ADD CONSTRAINT "syllabus_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syllabus_matrix_requirements"
    ADD CONSTRAINT "syllabus_matrix_requirements_course_id_lesson_sequence_code_key" UNIQUE ("course_id", "lesson_sequence_code", "matrix_row_id");



ALTER TABLE ONLY "public"."syllabus_matrix_requirements"
    ADD CONSTRAINT "syllabus_matrix_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syllabus_matrix_rows"
    ADD CONSTRAINT "syllabus_matrix_rows_course_id_code_key" UNIQUE ("course_id", "code");



ALTER TABLE ONLY "public"."syllabus_matrix_rows"
    ADD CONSTRAINT "syllabus_matrix_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."syllabus_sequences"
    ADD CONSTRAINT "syllabus_sequences_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."syllabus_sequences"
    ADD CONSTRAINT "syllabus_sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_courses"
    ADD CONSTRAINT "training_courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_lessons"
    ADD CONSTRAINT "training_lessons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_sequence_results"
    ADD CONSTRAINT "training_sequence_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_syllabus_settings"
    ADD CONSTRAINT "training_syllabus_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_template_items"
    ADD CONSTRAINT "training_template_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."training_templates"
    ADD CONSTRAINT "training_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_flight_voucher_addons"
    ADD CONSTRAINT "trial_flight_voucher_addons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_flight_voucher_product_addons"
    ADD CONSTRAINT "trial_flight_voucher_product_addons_pkey" PRIMARY KEY ("product_id", "addon_id");



ALTER TABLE ONLY "public"."trial_flight_voucher_products"
    ADD CONSTRAINT "trial_flight_voucher_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_flight_voucher_stripe_events"
    ADD CONSTRAINT "trial_flight_voucher_stripe_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trial_voucher_cron_auth"
    ADD CONSTRAINT "trial_voucher_cron_auth_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_key" UNIQUE ("user_id", "role");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_connection_settings"
    ADD CONSTRAINT "xero_connection_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_invoice_portal_payments"
    ADD CONSTRAINT "xero_invoice_portal_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_invoice_portal_payments"
    ADD CONSTRAINT "xero_invoice_portal_payments_stripe_checkout_session_id_key" UNIQUE ("stripe_checkout_session_id");



ALTER TABLE ONLY "public"."xero_oauth_states"
    ADD CONSTRAINT "xero_oauth_states_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_oauth_states"
    ADD CONSTRAINT "xero_oauth_states_state_key" UNIQUE ("state");



ALTER TABLE ONLY "public"."xero_rate_limit_state"
    ADD CONSTRAINT "xero_rate_limit_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_sync_queue"
    ADD CONSTRAINT "xero_sync_queue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."xero_sync_settings"
    ADD CONSTRAINT "xero_sync_settings_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_audit_log_actor_id_idx" ON "public"."admin_audit_log" USING "btree" ("actor_id");



CREATE INDEX "admin_audit_log_area_idx" ON "public"."admin_audit_log" USING "btree" ("area");



CREATE INDEX "admin_audit_log_occurred_at_idx" ON "public"."admin_audit_log" USING "btree" ("occurred_at" DESC);



CREATE INDEX "admin_audit_log_table_record_idx" ON "public"."admin_audit_log" USING "btree" ("table_name", "record_id");



CREATE UNIQUE INDEX "flight_log_field_settings_aircraft_field_name_key" ON "public"."flight_log_field_settings" USING "btree" ("aircraft_id", "field_name") WHERE ("aircraft_id" IS NOT NULL);



CREATE INDEX "flight_log_field_settings_aircraft_id_idx" ON "public"."flight_log_field_settings" USING "btree" ("aircraft_id");



CREATE UNIQUE INDEX "flight_log_field_settings_global_field_name_key" ON "public"."flight_log_field_settings" USING "btree" ("field_name") WHERE ("aircraft_id" IS NULL);



CREATE INDEX "idx_account_transactions_created_at" ON "public"."account_transactions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_account_transactions_flight_log_id" ON "public"."account_transactions" USING "btree" ("flight_log_id");



CREATE INDEX "idx_account_transactions_ground_session_log" ON "public"."account_transactions" USING "btree" ("ground_session_log_id") WHERE ("ground_session_log_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_account_transactions_stripe_checkout_session" ON "public"."account_transactions" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE INDEX "idx_account_transactions_user_created" ON "public"."account_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_account_transactions_user_id" ON "public"."account_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_aircraft_archive_status_registration" ON "public"."aircraft" USING "btree" ("is_archived", "registration");



CREATE UNIQUE INDEX "idx_aircraft_rates_aircraft_flight_type_unique" ON "public"."aircraft_rates" USING "btree" ("aircraft_id", "flight_type_id") WHERE ("flight_type_id" IS NOT NULL);



CREATE INDEX "idx_aircraft_xero_tracking_category_name" ON "public"."aircraft" USING "btree" ("xero_tracking_category_name") WHERE ("xero_tracking_category_name" IS NOT NULL);



CREATE INDEX "idx_aircraft_xero_tracking_option_name" ON "public"."aircraft" USING "btree" ("xero_tracking_option_name") WHERE ("xero_tracking_option_name" IS NOT NULL);



CREATE INDEX "idx_booking_field_settings_order" ON "public"."booking_field_settings" USING "btree" ("display_order");



CREATE INDEX "idx_bookings_aircraft_id" ON "public"."bookings" USING "btree" ("aircraft_id");



CREATE INDEX "idx_bookings_deleted_at" ON "public"."bookings" USING "btree" ("deleted_at");



CREATE INDEX "idx_bookings_flight_logged" ON "public"."bookings" USING "btree" ("flight_logged");



CREATE INDEX "idx_bookings_ground_session_logged" ON "public"."bookings" USING "btree" ("ground_session_logged") WHERE ("ground_session_logged" = true);



CREATE INDEX "idx_bookings_instructor_id" ON "public"."bookings" USING "btree" ("instructor_id");



CREATE INDEX "idx_bookings_is_guest_booking" ON "public"."bookings" USING "btree" ("is_guest_booking");



CREATE INDEX "idx_bookings_start_time" ON "public"."bookings" USING "btree" ("start_time");



CREATE INDEX "idx_bookings_student_id" ON "public"."bookings" USING "btree" ("student_id");



CREATE INDEX "idx_bookings_trial_flight_voucher_id" ON "public"."bookings" USING "btree" ("trial_flight_voucher_id");



CREATE UNIQUE INDEX "idx_bookings_trial_voucher_one_active" ON "public"."bookings" USING "btree" ("trial_flight_voucher_id") WHERE (("trial_flight_voucher_id" IS NOT NULL) AND ("deleted_at" IS NULL) AND (COALESCE("status", ''::"text") <> 'cancelled'::"text"));



CREATE INDEX "idx_declaration_signing_tokens_enrolment" ON "public"."declaration_signing_tokens" USING "btree" ("enrolment_id");



CREATE INDEX "idx_declaration_signing_tokens_token_hash" ON "public"."declaration_signing_tokens" USING "btree" ("token_hash") WHERE ("used_at" IS NULL);



CREATE INDEX "idx_defects_aircraft_id" ON "public"."defects" USING "btree" ("aircraft_id");



CREATE INDEX "idx_defects_status" ON "public"."defects" USING "btree" ("status");



CREATE INDEX "idx_flight_log_stripe_events_flight_log" ON "public"."flight_log_stripe_events" USING "btree" ("flight_log_id", "created_at" DESC);



CREATE INDEX "idx_flight_logs_aircraft_id" ON "public"."flight_logs" USING "btree" ("aircraft_id");



CREATE INDEX "idx_flight_logs_billing_status" ON "public"."flight_logs" USING "btree" ("payment_status", "payment_type", "student_id");



CREATE INDEX "idx_flight_logs_booking_id" ON "public"."flight_logs" USING "btree" ("booking_id");



CREATE INDEX "idx_flight_logs_instructor_id" ON "public"."flight_logs" USING "btree" ("instructor_id");



CREATE INDEX "idx_flight_logs_payment_status" ON "public"."flight_logs" USING "btree" ("payment_status");



CREATE INDEX "idx_flight_logs_start_time" ON "public"."flight_logs" USING "btree" ("start_time");



CREATE UNIQUE INDEX "idx_flight_logs_stripe_checkout_session_id" ON "public"."flight_logs" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE INDEX "idx_flight_logs_stripe_mode" ON "public"."flight_logs" USING "btree" ("stripe_mode", "stripe_payment_status") WHERE (("stripe_checkout_session_id" IS NOT NULL) OR ("stripe_payment_intent_id" IS NOT NULL));



CREATE INDEX "idx_flight_logs_stripe_payment_intent_id" ON "public"."flight_logs" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_flight_logs_student_id" ON "public"."flight_logs" USING "btree" ("student_id");



CREATE INDEX "idx_flight_types_active_order" ON "public"."flight_types" USING "btree" ("active", "display_order");



CREATE INDEX "idx_flight_types_xero_item_code" ON "public"."flight_types" USING "btree" ("upper"("xero_item_code")) WHERE (("xero_item_code" IS NOT NULL) AND ("btrim"("xero_item_code") <> ''::"text"));



CREATE INDEX "idx_ground_session_description_options_active" ON "public"."ground_session_description_options" USING "btree" ("active", "display_order");



CREATE INDEX "idx_ground_session_description_options_flight_type" ON "public"."ground_session_description_options" USING "btree" ("flight_type_id") WHERE ("flight_type_id" IS NOT NULL);



CREATE INDEX "idx_ground_session_logs_booking" ON "public"."ground_session_logs" USING "btree" ("booking_id");



CREATE INDEX "idx_ground_session_logs_instructor_start" ON "public"."ground_session_logs" USING "btree" ("instructor_id", "start_time" DESC);



CREATE INDEX "idx_ground_session_logs_member_start" ON "public"."ground_session_logs" USING "btree" ("student_id", "start_time" DESC);



CREATE INDEX "idx_learning_enrolments_user" ON "public"."learning_program_enrolments" USING "btree" ("user_id", "status");



CREATE INDEX "idx_learning_lesson_links_lesson" ON "public"."learning_program_lesson_links" USING "btree" ("training_course_id", "training_lesson_id");



CREATE INDEX "idx_learning_programs_status_visibility" ON "public"."learning_programs" USING "btree" ("status", "visibility");



CREATE INDEX "idx_learning_progress_user" ON "public"."learning_step_progress" USING "btree" ("user_id", "program_id");



CREATE INDEX "idx_learning_sections_program" ON "public"."learning_program_sections" USING "btree" ("program_id", "sort_order");



CREATE INDEX "idx_learning_steps_program" ON "public"."learning_program_steps" USING "btree" ("program_id", "sort_order");



CREATE INDEX "idx_learning_steps_section" ON "public"."learning_program_steps" USING "btree" ("section_id", "sort_order");



CREATE INDEX "idx_member_stripe_card_setup_sessions_user" ON "public"."member_stripe_card_setup_sessions" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_member_stripe_payment_methods_one_default" ON "public"."member_stripe_payment_methods" USING "btree" ("user_id") WHERE (("active" IS TRUE) AND ("is_default" IS TRUE));



CREATE INDEX "idx_member_stripe_payment_methods_user" ON "public"."member_stripe_payment_methods" USING "btree" ("user_id", "active", "is_default");



CREATE INDEX "idx_member_topup_link_notifications_user_created" ON "public"."member_topup_link_notifications" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_payment_methods_active_order" ON "public"."payment_methods" USING "btree" ("active", "display_order");



CREATE UNIQUE INDEX "idx_payment_methods_system_key_unique" ON "public"."payment_methods" USING "btree" ("system_key") WHERE ("system_key" IS NOT NULL);



CREATE INDEX "idx_payment_methods_topup_order" ON "public"."payment_methods" USING "btree" ("active", "allow_account_topup", "display_order");



CREATE INDEX "idx_safety_reports_aircraft_id" ON "public"."safety_reports" USING "btree" ("aircraft_id");



CREATE INDEX "idx_safety_reports_created_at" ON "public"."safety_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_safety_reports_involved_user_ids" ON "public"."safety_reports" USING "gin" ("involved_user_ids");



CREATE INDEX "idx_safety_reports_occurrence_at" ON "public"."safety_reports" USING "btree" ("occurrence_at" DESC);



CREATE INDEX "idx_safety_reports_reporter_id" ON "public"."safety_reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_stripe_connect_oauth_states_expires_at" ON "public"."stripe_connect_oauth_states" USING "btree" ("expires_at");



CREATE INDEX "idx_stripe_connect_oauth_states_state" ON "public"."stripe_connect_oauth_states" USING "btree" ("state");



CREATE INDEX "idx_student_course_enrolments_course_id" ON "public"."student_course_enrolments" USING "btree" ("course_id");



CREATE INDEX "idx_student_course_enrolments_student_id" ON "public"."student_course_enrolments" USING "btree" ("student_id");



CREATE INDEX "idx_student_documents_student_id" ON "public"."student_documents" USING "btree" ("student_id");



CREATE INDEX "idx_student_documents_uploaded_by" ON "public"."student_documents" USING "btree" ("uploaded_by");



CREATE INDEX "idx_student_matrix_assessments_record" ON "public"."student_matrix_assessments" USING "btree" ("training_record_id");



CREATE INDEX "idx_student_matrix_assessments_student_course" ON "public"."student_matrix_assessments" USING "btree" ("student_id", "course_id");



CREATE INDEX "idx_syllabus_matrix_requirements_assessment_criterion" ON "public"."syllabus_matrix_requirements" USING "btree" ("course_id", "assessment_criterion_id");



CREATE INDEX "idx_syllabus_matrix_requirements_course_lesson" ON "public"."syllabus_matrix_requirements" USING "btree" ("course_id", "lesson_sequence_code");



CREATE INDEX "idx_syllabus_matrix_requirements_row" ON "public"."syllabus_matrix_requirements" USING "btree" ("matrix_row_id");



CREATE INDEX "idx_syllabus_matrix_rows_course_sort" ON "public"."syllabus_matrix_rows" USING "btree" ("course_id", "sort_order");



CREATE INDEX "idx_training_records_date" ON "public"."training_records" USING "btree" ("date");



CREATE INDEX "idx_training_records_instructor_id" ON "public"."training_records" USING "btree" ("instructor_id");



CREATE INDEX "idx_training_records_student_id" ON "public"."training_records" USING "btree" ("student_id");



CREATE INDEX "idx_trial_flight_voucher_addons_active" ON "public"."trial_flight_voucher_addons" USING "btree" ("is_active");



CREATE INDEX "idx_trial_flight_voucher_product_addons_addon" ON "public"."trial_flight_voucher_product_addons" USING "btree" ("addon_id");



CREATE INDEX "idx_trial_flight_voucher_products_active" ON "public"."trial_flight_voucher_products" USING "btree" ("is_active");



CREATE INDEX "idx_trial_flight_voucher_products_stripe_price_id" ON "public"."trial_flight_voucher_products" USING "btree" ("stripe_price_id") WHERE ("stripe_price_id" IS NOT NULL);



CREATE INDEX "idx_trial_flight_voucher_stripe_events_processed_at" ON "public"."trial_flight_voucher_stripe_events" USING "btree" ("processed_at");



CREATE INDEX "idx_trial_flight_voucher_stripe_events_session_id" ON "public"."trial_flight_voucher_stripe_events" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE INDEX "idx_trial_flight_voucher_stripe_events_voucher_id" ON "public"."trial_flight_voucher_stripe_events" USING "btree" ("voucher_id");



CREATE INDEX "idx_trial_flight_vouchers_code" ON "public"."trial_flight_vouchers" USING "btree" ("code");



CREATE INDEX "idx_trial_flight_vouchers_email_delivery_claim" ON "public"."trial_flight_vouchers" USING "btree" ("email_delivery_claimed_at") WHERE (("delivered_at" IS NULL) AND ("email_delivery_claimed_at" IS NOT NULL));



CREATE INDEX "idx_trial_flight_vouchers_payer_user_id" ON "public"."trial_flight_vouchers" USING "btree" ("payer_user_id");



CREATE INDEX "idx_trial_flight_vouchers_payment_status" ON "public"."trial_flight_vouchers" USING "btree" ("payment_status");



CREATE INDEX "idx_trial_flight_vouchers_status" ON "public"."trial_flight_vouchers" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_trial_flight_vouchers_stripe_checkout_session_id" ON "public"."trial_flight_vouchers" USING "btree" ("stripe_checkout_session_id") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE INDEX "idx_trial_flight_vouchers_stripe_mode" ON "public"."trial_flight_vouchers" USING "btree" ("stripe_mode", "payment_status") WHERE ("stripe_checkout_session_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_trial_flight_vouchers_stripe_payment_intent_id" ON "public"."trial_flight_vouchers" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_trial_flight_vouchers_xero_sync_status" ON "public"."trial_flight_vouchers" USING "btree" ("xero_sync_status", "payment_status");



CREATE INDEX "idx_trial_voucher_active_checkout_holds" ON "public"."trial_flight_vouchers" USING "btree" ("product_id", "held_start_time", "held_end_time", "hold_expires_at") WHERE (("checkout_intent" = 'book_now'::"text") AND ("payment_status" = 'pending'::"text") AND ("held_start_time" IS NOT NULL) AND ("held_end_time" IS NOT NULL) AND ("hold_expires_at" IS NOT NULL));



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_is_active" ON "public"."users" USING "btree" ("is_active");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



CREATE INDEX "idx_users_trial_voucher_password_set" ON "public"."users" USING "btree" ("portal_access_scope", "trial_voucher_password_set_at") WHERE ("portal_access_scope" = 'trial_voucher'::"text");



CREATE UNIQUE INDEX "idx_users_xero_contact_id_unique" ON "public"."users" USING "btree" ("xero_contact_id") WHERE ("xero_contact_id" IS NOT NULL);



CREATE INDEX "idx_xero_invoice_portal_payments_invoice_id" ON "public"."xero_invoice_portal_payments" USING "btree" ("xero_invoice_id");



CREATE INDEX "idx_xero_invoice_portal_payments_user_id" ON "public"."xero_invoice_portal_payments" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_xero_oauth_states_expires_at" ON "public"."xero_oauth_states" USING "btree" ("expires_at");



CREATE INDEX "idx_xero_oauth_states_state" ON "public"."xero_oauth_states" USING "btree" ("state");



CREATE INDEX "idx_xero_sync_queue_entity" ON "public"."xero_sync_queue" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_xero_sync_queue_status" ON "public"."xero_sync_queue" USING "btree" ("status", "next_attempt_at", "priority", "created_at");



CREATE UNIQUE INDEX "idx_xero_sync_queue_unique_open_status" ON "public"."xero_sync_queue" USING "btree" ("entity_type", "entity_id", "action", "status");



CREATE INDEX "lesson_snapshots_course_id_idx" ON "public"."lesson_snapshots" USING "btree" ("course_id");



CREATE INDEX "lesson_snapshots_lesson_id_idx" ON "public"."lesson_snapshots" USING "btree" ("lesson_id");



CREATE UNIQUE INDEX "maintenance_milestones_aircraft_title_key" ON "public"."maintenance_milestones" USING "btree" ("aircraft_id", "title");



CREATE INDEX "student_exam_results_course_idx" ON "public"."student_exam_results" USING "btree" ("course_id");



CREATE INDEX "student_exam_results_student_idx" ON "public"."student_exam_results" USING "btree" ("student_id", "exam_date" DESC);



CREATE INDEX "training_lessons_course_id_idx" ON "public"."training_lessons" USING "btree" ("course_id");



CREATE INDEX "training_lessons_sort_order_idx" ON "public"."training_lessons" USING "btree" ("course_id", "sort_order");



CREATE OR REPLACE TRIGGER "archive_trial_voucher_account_after_logged_flight" AFTER INSERT OR UPDATE OF "booking_id", "student_id" ON "public"."flight_logs" FOR EACH ROW EXECUTE FUNCTION "public"."archive_trial_voucher_account_after_logged_flight"();



CREATE OR REPLACE TRIGGER "audit_account_transactions_edits_deletes" AFTER DELETE OR UPDATE ON "public"."account_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Billing');



CREATE OR REPLACE TRIGGER "audit_bookings_edits_deletes" AFTER DELETE OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Bookings');



CREATE OR REPLACE TRIGGER "audit_flight_logs_edits_deletes" AFTER DELETE OR UPDATE ON "public"."flight_logs" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Flight Logs');



CREATE OR REPLACE TRIGGER "audit_invoice_items_edits_deletes" AFTER DELETE OR UPDATE ON "public"."invoice_items" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Billing');



CREATE OR REPLACE TRIGGER "audit_invoices_edits_deletes" AFTER DELETE OR UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Billing');



CREATE OR REPLACE TRIGGER "audit_students_edits_deletes" AFTER DELETE OR UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Member Profiles');



CREATE OR REPLACE TRIGGER "audit_training_records_edits_deletes" AFTER DELETE OR UPDATE ON "public"."training_records" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Training Records');



CREATE OR REPLACE TRIGGER "audit_training_sequence_results_edits_deletes" AFTER DELETE OR UPDATE ON "public"."training_sequence_results" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Training Records');



CREATE OR REPLACE TRIGGER "audit_user_roles_edits_deletes" AFTER DELETE OR UPDATE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Member Profiles');



CREATE OR REPLACE TRIGGER "audit_users_edits_deletes" AFTER DELETE OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."admin_audit_trigger"('Member Profiles');



CREATE OR REPLACE TRIGGER "guard_and_audit_training_record_update" BEFORE UPDATE ON "public"."training_records" FOR EACH ROW EXECUTE FUNCTION "public"."guard_and_audit_training_record_update"();



CREATE OR REPLACE TRIGGER "guard_students_self_service_update" BEFORE UPDATE ON "public"."students" FOR EACH ROW EXECUTE FUNCTION "public"."guard_students_self_service_update"();



CREATE OR REPLACE TRIGGER "guard_users_self_service_update" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."guard_users_self_service_update"();



CREATE OR REPLACE TRIGGER "prevent_self_service_access_field_changes" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_self_service_access_field_changes"();



CREATE OR REPLACE TRIGGER "prevent_trial_voucher_booking_overlap" BEFORE INSERT OR UPDATE OF "aircraft_id", "instructor_id", "start_time", "end_time", "status", "deleted_at", "trial_flight_voucher_id" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_trial_voucher_booking_overlap"();



CREATE OR REPLACE TRIGGER "promote_pilot_after_passed_flight_review_trigger" BEFORE INSERT OR UPDATE OF "is_flight_review", "flight_review_result", "student_id", "date" ON "public"."training_records" FOR EACH ROW EXECUTE FUNCTION "public"."promote_pilot_after_passed_flight_review"();



CREATE OR REPLACE TRIGGER "queue_xero_contact_sync_on_user_change_trigger" BEFORE INSERT OR UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_contact_sync_on_user_change"();



CREATE OR REPLACE TRIGGER "queue_xero_flight_invoice_sync_trigger" BEFORE INSERT OR UPDATE ON "public"."flight_logs" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_flight_invoice_sync"();



CREATE OR REPLACE TRIGGER "queue_xero_verified_payment_sync_trigger" BEFORE INSERT OR UPDATE ON "public"."account_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_verified_payment_sync"();



CREATE OR REPLACE TRIGGER "queue_xero_voucher_sync_from_flight_log_trigger" BEFORE INSERT OR UPDATE ON "public"."flight_logs" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_voucher_sync_from_flight_log"();



CREATE OR REPLACE TRIGGER "queue_xero_voucher_sync_from_voucher_trigger" BEFORE INSERT OR UPDATE ON "public"."trial_flight_vouchers" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_voucher_sync_from_voucher"();



CREATE OR REPLACE TRIGGER "release_trial_voucher_when_booking_cancelled" AFTER UPDATE OF "status", "deleted_at", "flight_logged" ON "public"."bookings" FOR EACH ROW WHEN ((("new"."trial_flight_voucher_id" IS NOT NULL) AND (("new"."deleted_at" IS NOT NULL) OR ("new"."status" = 'cancelled'::"text")))) EXECUTE FUNCTION "public"."release_trial_voucher_when_booking_cancelled"();



CREATE OR REPLACE TRIGGER "sync_instructor_absence_identity_columns_trigger" BEFORE INSERT OR UPDATE ON "public"."instructor_absences" FOR EACH ROW EXECUTE FUNCTION "public"."sync_instructor_absence_identity_columns"();



CREATE OR REPLACE TRIGGER "sync_member_role_after_endorsement_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."endorsements" FOR EACH ROW EXECUTE FUNCTION "public"."handle_endorsement_role_sync"();



CREATE OR REPLACE TRIGGER "sync_trial_voucher_booking_link" AFTER INSERT OR UPDATE OF "trial_flight_voucher_id", "status", "deleted_at", "flight_logged" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_trial_voucher_booking_link"();



CREATE OR REPLACE TRIGGER "trg_protect_system_payment_methods_delete" BEFORE DELETE ON "public"."payment_methods" FOR EACH ROW EXECUTE FUNCTION "public"."protect_system_payment_methods"();



CREATE OR REPLACE TRIGGER "trg_protect_system_payment_methods_update" BEFORE UPDATE ON "public"."payment_methods" FOR EACH ROW EXECUTE FUNCTION "public"."protect_system_payment_methods"();



CREATE OR REPLACE TRIGGER "trg_queue_xero_flight_invoice_sync" BEFORE INSERT OR UPDATE OF "calculated_cost", "total_cost", "payment_status", "xero_invoice_id" ON "public"."flight_logs" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_flight_invoice_sync"();



CREATE OR REPLACE TRIGGER "trg_queue_xero_verified_payment_sync" BEFORE INSERT OR UPDATE OF "verified_status" ON "public"."account_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."queue_xero_verified_payment_sync"();



CREATE OR REPLACE TRIGGER "trg_sync_endorsement_flight_review" AFTER INSERT OR UPDATE OF "type", "date_obtained", "expiry_date", "is_active", "student_id" ON "public"."endorsements" FOR EACH ROW EXECUTE FUNCTION "public"."handle_endorsement_flight_review_sync"();



CREATE OR REPLACE TRIGGER "trg_sync_user_primary_role" AFTER INSERT OR DELETE ON "public"."user_roles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_user_primary_role"();



CREATE OR REPLACE TRIGGER "trigger_aircraft_grounding" AFTER INSERT OR UPDATE ON "public"."defects" FOR EACH ROW EXECUTE FUNCTION "public"."handle_aircraft_grounding"();



ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_flight_log_id_fkey" FOREIGN KEY ("flight_log_id") REFERENCES "public"."flight_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_ground_session_log_id_fkey" FOREIGN KEY ("ground_session_log_id") REFERENCES "public"."ground_session_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."account_transactions"
    ADD CONSTRAINT "account_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aircraft"
    ADD CONSTRAINT "aircraft_archived_by_fkey" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."aircraft_documents"
    ADD CONSTRAINT "aircraft_documents_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aircraft_documents"
    ADD CONSTRAINT "aircraft_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."aircraft_rates"
    ADD CONSTRAINT "aircraft_rates_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."aircraft_rates"
    ADD CONSTRAINT "aircraft_rates_default_payment_method_id_fkey" FOREIGN KEY ("default_payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."aircraft_rates"
    ADD CONSTRAINT "aircraft_rates_flight_type_id_fkey" FOREIGN KEY ("flight_type_id") REFERENCES "public"."flight_types"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_conflicts"
    ADD CONSTRAINT "booking_conflicts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_conflicts"
    ADD CONSTRAINT "booking_conflicts_conflicting_booking_id_fkey" FOREIGN KEY ("conflicting_booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_rules_settings"
    ADD CONSTRAINT "booking_rules_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_flight_type_id_fkey" FOREIGN KEY ("flight_type_id") REFERENCES "public"."flight_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_trial_flight_voucher_id_fkey" FOREIGN KEY ("trial_flight_voucher_id") REFERENCES "public"."trial_flight_vouchers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_settings"
    ADD CONSTRAINT "calendar_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."declaration_signing_tokens"
    ADD CONSTRAINT "declaration_signing_tokens_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."declaration_signing_tokens"
    ADD CONSTRAINT "declaration_signing_tokens_enrolment_id_fkey" FOREIGN KEY ("enrolment_id") REFERENCES "public"."student_course_enrolments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."defect_history"
    ADD CONSTRAINT "defect_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."defect_history"
    ADD CONSTRAINT "defect_history_defect_id_fkey" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."defects"
    ADD CONSTRAINT "defects_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."defects"
    ADD CONSTRAINT "defects_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."endorsements"
    ADD CONSTRAINT "endorsements_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."endorsements"
    ADD CONSTRAINT "endorsements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flight_log_field_settings"
    ADD CONSTRAINT "flight_log_field_settings_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flight_log_stripe_events"
    ADD CONSTRAINT "flight_log_stripe_events_flight_log_id_fkey" FOREIGN KEY ("flight_log_id") REFERENCES "public"."flight_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_flight_type_id_fkey" FOREIGN KEY ("flight_type_id") REFERENCES "public"."flight_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_logs"
    ADD CONSTRAINT "flight_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."flight_types"
    ADD CONSTRAINT "flight_types_forced_payment_method_id_fkey" FOREIGN KEY ("forced_payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_description_options"
    ADD CONSTRAINT "ground_session_description_options_flight_type_id_fkey" FOREIGN KEY ("flight_type_id") REFERENCES "public"."flight_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_description_option_id_fkey" FOREIGN KEY ("description_option_id") REFERENCES "public"."ground_session_description_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_flight_type_id_fkey" FOREIGN KEY ("flight_type_id") REFERENCES "public"."flight_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ground_session_logs"
    ADD CONSTRAINT "ground_session_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."instructor_absences"
    ADD CONSTRAINT "instructor_absences_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructor_absences"
    ADD CONSTRAINT "instructor_absences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructor_schedule_changes"
    ADD CONSTRAINT "instructor_schedule_changes_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructor_schedule_changes"
    ADD CONSTRAINT "instructor_schedule_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructor_weekly_schedules"
    ADD CONSTRAINT "instructor_weekly_schedules_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instructor_weekly_schedules"
    ADD CONSTRAINT "instructor_weekly_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."learning_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_enrolments"
    ADD CONSTRAINT "learning_program_enrolments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_lesson_links"
    ADD CONSTRAINT "learning_program_lesson_links_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."learning_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_lesson_links"
    ADD CONSTRAINT "learning_program_lesson_links_training_course_id_fkey" FOREIGN KEY ("training_course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_lesson_links"
    ADD CONSTRAINT "learning_program_lesson_links_training_lesson_id_fkey" FOREIGN KEY ("training_lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_sections"
    ADD CONSTRAINT "learning_program_sections_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."learning_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_steps"
    ADD CONSTRAINT "learning_program_steps_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."learning_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_program_steps"
    ADD CONSTRAINT "learning_program_steps_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."learning_program_sections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."learning_programs"
    ADD CONSTRAINT "learning_programs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."learning_programs"
    ADD CONSTRAINT "learning_programs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."learning_step_progress"
    ADD CONSTRAINT "learning_step_progress_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."learning_programs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_step_progress"
    ADD CONSTRAINT "learning_step_progress_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."learning_program_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_step_progress"
    ADD CONSTRAINT "learning_step_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_snapshots"
    ADD CONSTRAINT "lesson_snapshots_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lesson_snapshots"
    ADD CONSTRAINT "lesson_snapshots_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."maintenance_audit_log"
    ADD CONSTRAINT "maintenance_audit_log_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_audit_log"
    ADD CONSTRAINT "maintenance_audit_log_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."maintenance_completions"
    ADD CONSTRAINT "maintenance_completions_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_completions"
    ADD CONSTRAINT "maintenance_completions_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."maintenance_completions"
    ADD CONSTRAINT "maintenance_completions_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "public"."maintenance_milestones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_milestones"
    ADD CONSTRAINT "maintenance_milestones_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_milestones"
    ADD CONSTRAINT "maintenance_milestones_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."member_stripe_card_setup_sessions"
    ADD CONSTRAINT "member_stripe_card_setup_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_stripe_payment_methods"
    ADD CONSTRAINT "member_stripe_payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_topup_link_notifications"
    ADD CONSTRAINT "member_topup_link_notifications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."member_topup_link_notifications"
    ADD CONSTRAINT "member_topup_link_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_settings"
    ADD CONSTRAINT "notification_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organisation_settings"
    ADD CONSTRAINT "organisation_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."portal_ux_settings"
    ADD CONSTRAINT "portal_ux_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."resource_settings"
    ADD CONSTRAINT "resource_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."safety_documents"
    ADD CONSTRAINT "safety_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."safety_reports"
    ADD CONSTRAINT "safety_reports_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."safety_reports"
    ADD CONSTRAINT "safety_reports_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."safety_report_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."safety_reports"
    ADD CONSTRAINT "safety_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."stripe_connect_oauth_states"
    ADD CONSTRAINT "stripe_connect_oauth_states_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stripe_connect_settings"
    ADD CONSTRAINT "stripe_connect_settings_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."stripe_connect_settings"
    ADD CONSTRAINT "stripe_connect_settings_mode_updated_by_fkey" FOREIGN KEY ("mode_updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_course_enrolments"
    ADD CONSTRAINT "student_course_enrolments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_course_enrolments"
    ADD CONSTRAINT "student_course_enrolments_enrolled_by_fkey" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_course_enrolments"
    ADD CONSTRAINT "student_course_enrolments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_documents"
    ADD CONSTRAINT "student_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_documents"
    ADD CONSTRAINT "student_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_kdr_signed_off_by_fkey" FOREIGN KEY ("kdr_signed_off_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_exam_results"
    ADD CONSTRAINT "student_exam_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_matrix_row_id_fkey" FOREIGN KEY ("matrix_row_id") REFERENCES "public"."syllabus_matrix_rows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_matrix_assessments"
    ADD CONSTRAINT "student_matrix_assessments_training_record_id_fkey" FOREIGN KEY ("training_record_id") REFERENCES "public"."training_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_syllabi"
    ADD CONSTRAINT "student_syllabi_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_syllabi"
    ADD CONSTRAINT "student_syllabi_syllabus_id_fkey" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."students"
    ADD CONSTRAINT "students_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syllabus_items"
    ADD CONSTRAINT "syllabus_items_syllabus_id_fkey" FOREIGN KEY ("syllabus_id") REFERENCES "public"."syllabi"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syllabus_matrix_requirements"
    ADD CONSTRAINT "syllabus_matrix_requirements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syllabus_matrix_requirements"
    ADD CONSTRAINT "syllabus_matrix_requirements_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syllabus_matrix_requirements"
    ADD CONSTRAINT "syllabus_matrix_requirements_matrix_row_id_fkey" FOREIGN KEY ("matrix_row_id") REFERENCES "public"."syllabus_matrix_rows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."syllabus_matrix_rows"
    ADD CONSTRAINT "syllabus_matrix_rows_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_courses"
    ADD CONSTRAINT "training_courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_lessons"
    ADD CONSTRAINT "training_lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_aircraft_id_fkey" FOREIGN KEY ("aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_flight_log_id_fkey" FOREIGN KEY ("flight_log_id") REFERENCES "public"."flight_logs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_instructor_id_fkey" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."training_lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."training_records"
    ADD CONSTRAINT "training_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_sequence_results"
    ADD CONSTRAINT "training_sequence_results_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."syllabus_sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_sequence_results"
    ADD CONSTRAINT "training_sequence_results_training_record_id_fkey" FOREIGN KEY ("training_record_id") REFERENCES "public"."training_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."training_syllabus_settings"
    ADD CONSTRAINT "training_syllabus_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."training_template_items"
    ADD CONSTRAINT "training_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."training_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trial_flight_voucher_product_addons"
    ADD CONSTRAINT "trial_flight_voucher_product_addons_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "public"."trial_flight_voucher_addons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trial_flight_voucher_product_addons"
    ADD CONSTRAINT "trial_flight_voucher_product_addons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."trial_flight_voucher_products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trial_flight_voucher_stripe_events"
    ADD CONSTRAINT "trial_flight_voucher_stripe_events_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "public"."trial_flight_vouchers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_held_aircraft_id_fkey" FOREIGN KEY ("held_aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_held_instructor_id_fkey" FOREIGN KEY ("held_instructor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."trial_flight_voucher_products"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."trial_flight_vouchers"
    ADD CONSTRAINT "trial_flight_vouchers_redeemed_by_user_id_fkey" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_preferred_aircraft_id_fkey" FOREIGN KEY ("preferred_aircraft_id") REFERENCES "public"."aircraft"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."xero_connection_settings"
    ADD CONSTRAINT "xero_connection_settings_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."xero_invoice_portal_payments"
    ADD CONSTRAINT "xero_invoice_portal_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."xero_oauth_states"
    ADD CONSTRAINT "xero_oauth_states_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."xero_sync_queue"
    ADD CONSTRAINT "xero_sync_queue_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."xero_sync_queue"
    ADD CONSTRAINT "xero_sync_queue_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."xero_sync_settings"
    ADD CONSTRAINT "xero_sync_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



CREATE POLICY "Admins and instructors can delete instructor_schedule_changes" ON "public"."instructor_schedule_changes" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can delete instructor_weekly_schedules" ON "public"."instructor_weekly_schedules" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can delete student_syllabi" ON "public"."student_syllabi" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert booking_conflicts" ON "public"."booking_conflicts" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert defect_history" ON "public"."defect_history" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert instructor_schedule_changes" ON "public"."instructor_schedule_changes" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can insert instructor_weekly_schedules" ON "public"."instructor_weekly_schedules" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can insert lesson_snapshots" ON "public"."lesson_snapshots" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert maintenance_audit_log" ON "public"."maintenance_audit_log" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert maintenance_completions" ON "public"."maintenance_completions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert student_syllabi" ON "public"."student_syllabi" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert training_courses" ON "public"."training_courses" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert training_lessons" ON "public"."training_lessons" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert training_sequence_results" ON "public"."training_sequence_results" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can insert transactions" ON "public"."account_transactions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can manage syllabus" ON "public"."syllabus_sequences" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can read all transactions" ON "public"."account_transactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update booking_conflicts" ON "public"."booking_conflicts" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update defects" ON "public"."defects" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update flight logs" ON "public"."flight_logs" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update instructor_schedule_changes" ON "public"."instructor_schedule_changes" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can update instructor_weekly_schedules" ON "public"."instructor_weekly_schedules" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"()))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR ("instructor_id" = "auth"."uid"())));



CREATE POLICY "Admins and instructors can update lesson_snapshots" ON "public"."lesson_snapshots" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update maintenance_completions" ON "public"."maintenance_completions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update student_syllabi" ON "public"."student_syllabi" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update training records" ON "public"."training_records" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update training_courses" ON "public"."training_courses" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update training_lessons" ON "public"."training_lessons" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can update training_sequence_results" ON "public"."training_sequence_results" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Admins and instructors can view all transactions" ON "public"."account_transactions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins can delete aircraft" ON "public"."aircraft" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete aircraft documents" ON "public"."aircraft_documents" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete aircraft rates" ON "public"."aircraft_rates" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete any instructor absence" ON "public"."instructor_absences" FOR DELETE TO "authenticated" USING ("public"."current_user_is_admin"());



CREATE POLICY "Admins can delete booking field settings" ON "public"."booking_field_settings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete bookings" ON "public"."bookings" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete defects" ON "public"."defects" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete flight logs" ON "public"."flight_logs" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete flight_types" ON "public"."flight_types" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete invitations" ON "public"."invitations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete invoice items" ON "public"."invoice_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete invoices" ON "public"."invoices" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete maintenance milestones" ON "public"."maintenance_milestones" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete maintenance_milestone_templates" ON "public"."maintenance_milestone_templates" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete members" ON "public"."users" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete payment_methods" ON "public"."payment_methods" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete rooms" ON "public"."rooms" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete safety_report_categories" ON "public"."safety_report_categories" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete syllabi" ON "public"."syllabi" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete syllabus sequences" ON "public"."syllabus_sequences" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete syllabus_items" ON "public"."syllabus_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training records" ON "public"."training_records" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training_courses" ON "public"."training_courses" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training_lessons" ON "public"."training_lessons" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training_sequence_results" ON "public"."training_sequence_results" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training_template_items" ON "public"."training_template_items" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete training_templates" ON "public"."training_templates" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete transactions" ON "public"."account_transactions" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = "auth"."uid"()) AND ("u"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete user_roles" ON "public"."user_roles" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert aircraft" ON "public"."aircraft" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert aircraft documents" ON "public"."aircraft_documents" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert aircraft rates" ON "public"."aircraft_rates" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert any instructor absence" ON "public"."instructor_absences" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins can insert booking field settings" ON "public"."booking_field_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert booking_rules_settings" ON "public"."booking_rules_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert calendar_settings" ON "public"."calendar_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert flight_log_field_settings" ON "public"."flight_log_field_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert flight_types" ON "public"."flight_types" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert invitations" ON "public"."invitations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert invoice items" ON "public"."invoice_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert invoices" ON "public"."invoices" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert maintenance milestones" ON "public"."maintenance_milestones" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert maintenance_milestone_templates" ON "public"."maintenance_milestone_templates" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert maintenance_settings" ON "public"."maintenance_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert notification_settings" ON "public"."notification_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert payment_methods" ON "public"."payment_methods" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert portal UX settings" ON "public"."portal_ux_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert resource settings" ON "public"."resource_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert rooms" ON "public"."rooms" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert safety_compliance_settings" ON "public"."safety_compliance_settings" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert safety_report_categories" ON "public"."safety_report_categories" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert student records" ON "public"."students" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert syllabi" ON "public"."syllabi" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert syllabus sequences" ON "public"."syllabus_sequences" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert syllabus_items" ON "public"."syllabus_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert training syllabus settings" ON "public"."training_syllabus_settings" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Admins can insert training_template_items" ON "public"."training_template_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert training_templates" ON "public"."training_templates" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert transactions" ON "public"."account_transactions" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins can insert user_roles" ON "public"."user_roles" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can manage ground session descriptions" ON "public"."ground_session_description_options" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins can manage invoices" ON "public"."invoices" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can manage xero sync queue" ON "public"."xero_sync_queue" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can read admin audit log" ON "public"."admin_audit_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can read xero sync queue" ON "public"."xero_sync_queue" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update aircraft" ON "public"."aircraft" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update aircraft documents" ON "public"."aircraft_documents" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update aircraft rates" ON "public"."aircraft_rates" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update any instructor absence" ON "public"."instructor_absences" FOR UPDATE TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins can update booking field settings" ON "public"."booking_field_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update booking_rules_settings" ON "public"."booking_rules_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update calendar_settings" ON "public"."calendar_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update flight_log_field_settings" ON "public"."flight_log_field_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update flight_types" ON "public"."flight_types" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update invitations" ON "public"."invitations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update invoice items" ON "public"."invoice_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update invoices" ON "public"."invoices" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update maintenance milestones" ON "public"."maintenance_milestones" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update maintenance_milestone_templates" ON "public"."maintenance_milestone_templates" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update maintenance_settings" ON "public"."maintenance_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update member archive status" ON "public"."users" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update notification_settings" ON "public"."notification_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update organisation settings" ON "public"."organisation_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update payment_methods" ON "public"."payment_methods" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update portal UX settings" ON "public"."portal_ux_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update resource settings" ON "public"."resource_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update rooms" ON "public"."rooms" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update safety_compliance_settings" ON "public"."safety_compliance_settings" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update safety_report_categories" ON "public"."safety_report_categories" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update student records" ON "public"."students" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update syllabi" ON "public"."syllabi" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update syllabus sequences" ON "public"."syllabus_sequences" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update syllabus_items" ON "public"."syllabus_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update training syllabus settings" ON "public"."training_syllabus_settings" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text")))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Admins can update training_template_items" ON "public"."training_template_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update training_templates" ON "public"."training_templates" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update transactions" ON "public"."account_transactions" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text"]))))));



CREATE POLICY "Admins can update user_roles" ON "public"."user_roles" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can view Xero rate limit state" ON "public"."xero_rate_limit_state" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = 'admin'::"text")))) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role" = 'admin'::"text"))))));



CREATE POLICY "Admins manage trial flight voucher addons" ON "public"."trial_flight_voucher_addons" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins manage trial flight voucher product addons" ON "public"."trial_flight_voucher_product_addons" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins manage trial flight voucher products" ON "public"."trial_flight_voucher_products" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins manage trial flight vouchers" ON "public"."trial_flight_vouchers" TO "authenticated" USING ("public"."current_user_is_admin"()) WITH CHECK ("public"."current_user_is_admin"());



CREATE POLICY "Admins read trial flight voucher stripe events" ON "public"."trial_flight_voucher_stripe_events" FOR SELECT TO "authenticated" USING ("public"."current_user_is_admin"());



CREATE POLICY "Authenticated users can view ground session descriptions" ON "public"."ground_session_description_options" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Creators can delete own training_courses" ON "public"."training_courses" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "Flight instructor or admin can insert training records" ON "public"."training_records" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text")))) OR (("flight_log_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."flight_logs"
  WHERE (("flight_logs"."id" = "training_records"."flight_log_id") AND ("flight_logs"."instructor_id" = "auth"."uid"()))))) OR (("flight_log_id" IS NULL) AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['instructor'::"text", 'senior_instructor'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Full members can insert own endorsements" ON "public"."endorsements" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()) AND ("instructor_id" IS NULL)));



CREATE POLICY "Full portal users can create defects" ON "public"."defects" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can create safety reports" ON "public"."safety_reports" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_has_full_portal_access"() AND ("reporter_id" = "auth"."uid"())));



CREATE POLICY "Full portal users can read aircraft" ON "public"."aircraft" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read booking conflicts" ON "public"."booking_conflicts" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read booking field settings" ON "public"."booking_field_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read booking rules settings" ON "public"."booking_rules_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read calendar settings" ON "public"."calendar_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read defect history" ON "public"."defect_history" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read flight log field settings" ON "public"."flight_log_field_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read flight types" ON "public"."flight_types" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read instructor absences" ON "public"."instructor_absences" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read instructor schedule changes" ON "public"."instructor_schedule_changes" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read instructor weekly schedules" ON "public"."instructor_weekly_schedules" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read lesson snapshots" ON "public"."lesson_snapshots" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read maintenance completions" ON "public"."maintenance_completions" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read maintenance milestone templates" ON "public"."maintenance_milestone_templates" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read maintenance settings" ON "public"."maintenance_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read notification settings" ON "public"."notification_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read organisation settings" ON "public"."organisation_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"())));



CREATE POLICY "Full portal users can read payment methods" ON "public"."payment_methods" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read portal UX settings" ON "public"."portal_ux_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read relevant safety reports" ON "public"."safety_reports" FOR SELECT TO "authenticated" USING (("public"."current_user_has_full_portal_access"() AND (("reporter_id" = "auth"."uid"()) OR ("auth"."uid"() = ANY ("involved_user_ids")) OR "public"."current_user_has_staff_role"())));



CREATE POLICY "Full portal users can read safety compliance settings" ON "public"."safety_compliance_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read safety documents" ON "public"."safety_documents" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read safety report categories" ON "public"."safety_report_categories" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read syllabi" ON "public"."syllabi" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read syllabus items" ON "public"."syllabus_items" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read syllabus matrix requirements" ON "public"."syllabus_matrix_requirements" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read syllabus matrix rows" ON "public"."syllabus_matrix_rows" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read syllabus sequences" ON "public"."syllabus_sequences" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read training courses" ON "public"."training_courses" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read training lessons" ON "public"."training_lessons" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read training syllabus settings" ON "public"."training_syllabus_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read training template items" ON "public"."training_template_items" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can read training templates" ON "public"."training_templates" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view aircraft documents" ON "public"."aircraft_documents" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view aircraft rates" ON "public"."aircraft_rates" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view defects" ON "public"."defects" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view maintenance milestones" ON "public"."maintenance_milestones" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view resource settings" ON "public"."resource_settings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full portal users can view rooms" ON "public"."rooms" FOR SELECT TO "authenticated" USING ("public"."current_user_has_full_portal_access"());



CREATE POLICY "Full students and staff can create student documents" ON "public"."student_documents" FOR INSERT TO "authenticated" WITH CHECK ((("uploaded_by" = "auth"."uid"()) AND ("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"())))));



CREATE POLICY "Full students and staff can delete student documents" ON "public"."student_documents" FOR DELETE TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full students and staff can read matrix assessments" ON "public"."student_matrix_assessments" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("student_id" = "auth"."uid"()) OR ("instructor_id" = "auth"."uid"())))));



CREATE POLICY "Full students and staff can read relevant student syllabi" ON "public"."student_syllabi" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full students and staff can read student documents" ON "public"."student_documents" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full students and staff can update student documents" ON "public"."student_documents" FOR UPDATE TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"())))) WITH CHECK (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full students instructors and staff can read relevant sequence " ON "public"."training_sequence_results" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."training_records" "tr"
  WHERE (("tr"."id" = "training_sequence_results"."training_record_id") AND ("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("tr"."student_id" = "auth"."uid"()) OR ("tr"."instructor_id" = "auth"."uid"()))))))));



CREATE POLICY "Full students instructors and staff can read relevant training " ON "public"."training_records" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("student_id" = "auth"."uid"()) OR ("instructor_id" = "auth"."uid"())))));



CREATE POLICY "Full users and admins can read relevant invoice items" ON "public"."invoice_items" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (EXISTS ( SELECT 1
   FROM "public"."invoices" "i"
  WHERE (("i"."id" = "invoice_items"."invoice_id") AND ("i"."student_id" = "auth"."uid"())))))));



CREATE POLICY "Full users and admins can read relevant invoices" ON "public"."invoices" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full users and staff can read relevant endorsements" ON "public"."endorsements" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Full users and staff can read relevant flight logs" ON "public"."flight_logs" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("student_id" = "auth"."uid"()) OR ("instructor_id" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())))));



CREATE POLICY "Full users and staff can read relevant student exam results" ON "public"."student_exam_results" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("student_id" = "auth"."uid"()) OR ("instructor_id" = "auth"."uid"())))));



CREATE POLICY "Full users can insert own flight logs" ON "public"."flight_logs" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Instructors can delete own instructor absences" ON "public"."instructor_absences" FOR DELETE TO "authenticated" USING (((COALESCE("user_id", "instructor_id") = ( SELECT "auth"."uid"() AS "uid")) AND "public"."current_user_has_staff_role"()));



CREATE POLICY "Instructors can insert own instructor absences" ON "public"."instructor_absences" FOR INSERT TO "authenticated" WITH CHECK (((COALESCE("user_id", "instructor_id") = ( SELECT "auth"."uid"() AS "uid")) AND "public"."current_user_has_staff_role"()));



CREATE POLICY "Instructors can manage endorsements" ON "public"."endorsements" TO "authenticated" USING ((("instructor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))));



CREATE POLICY "Instructors can manage flight logs" ON "public"."flight_logs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "flight_logs"."booking_id") AND (("b"."instructor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."users"
          WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))))))));



CREATE POLICY "Instructors can manage sequence results" ON "public"."training_sequence_results" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."training_records" "tr"
  WHERE (("tr"."id" = "training_sequence_results"."training_record_id") AND (("tr"."instructor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."users"
          WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))))))));



CREATE POLICY "Instructors can manage training records" ON "public"."training_records" TO "authenticated" USING ((("instructor_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))));



CREATE POLICY "Instructors can update own instructor absences" ON "public"."instructor_absences" FOR UPDATE TO "authenticated" USING (((COALESCE("user_id", "instructor_id") = ( SELECT "auth"."uid"() AS "uid")) AND "public"."current_user_has_staff_role"())) WITH CHECK (((COALESCE("user_id", "instructor_id") = ( SELECT "auth"."uid"() AS "uid")) AND "public"."current_user_has_staff_role"()));



CREATE POLICY "Instructors can update training_record_status on own logs" ON "public"."flight_logs" FOR UPDATE TO "authenticated" USING (("instructor_id" = "auth"."uid"())) WITH CHECK (("instructor_id" = "auth"."uid"()));



CREATE POLICY "Members and staff can create permitted bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK ((((COALESCE("is_guest_booking", false) = false) AND "public"."current_user_has_full_portal_access"() AND ("student_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ((COALESCE("is_guest_booking", false) = false) AND "public"."current_user_has_staff_role"()) OR ((COALESCE("is_guest_booking", false) = true) AND "public"."current_user_is_admin"())));



CREATE POLICY "Members can read own Xero invoice portal payments" ON "public"."xero_invoice_portal_payments" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can read own stripe card setup sessions" ON "public"."member_stripe_card_setup_sessions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can read own stripe payment methods" ON "public"."member_stripe_payment_methods" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Members can read own top-up link notifications" ON "public"."member_topup_link_notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Members can request learning enrolment" ON "public"."learning_program_enrolments" FOR INSERT TO "authenticated" WITH CHECK (("public"."current_user_has_staff_role"() OR (("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."learning_programs" "p"
  WHERE (("p"."id" = "learning_program_enrolments"."program_id") AND ("p"."status" = 'published'::"text") AND ("p"."visibility" = ANY (ARRAY['public'::"text", 'private'::"text"]))))))));



CREATE POLICY "Members can update own learning progress" ON "public"."learning_step_progress" TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("user_id" = "auth"."uid"()))) WITH CHECK (("public"."current_user_has_staff_role"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Members can view available learning programs" ON "public"."learning_programs" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR (("status" = 'published'::"text") AND ("visibility" = ANY (ARRAY['public'::"text", 'private'::"text"]))) OR (EXISTS ( SELECT 1
   FROM "public"."learning_program_enrolments" "e"
  WHERE (("e"."program_id" = "learning_programs"."id") AND ("e"."user_id" = "auth"."uid"()) AND ("e"."status" = ANY (ARRAY['invited'::"text", 'pending_approval'::"text", 'active'::"text", 'completed'::"text"])))))));



CREATE POLICY "Members can view learning lesson links" ON "public"."learning_program_lesson_links" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR (EXISTS ( SELECT 1
   FROM "public"."learning_programs" "p"
  WHERE (("p"."id" = "learning_program_lesson_links"."program_id") AND ("p"."status" = 'published'::"text") AND ("p"."visibility" = ANY (ARRAY['public'::"text", 'private'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."learning_program_enrolments" "e"
  WHERE (("e"."program_id" = "learning_program_lesson_links"."program_id") AND ("e"."user_id" = "auth"."uid"()))))));



CREATE POLICY "Members can view learning sections" ON "public"."learning_program_sections" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR (EXISTS ( SELECT 1
   FROM "public"."learning_programs" "p"
  WHERE (("p"."id" = "learning_program_sections"."program_id") AND ("p"."status" = 'published'::"text") AND (("p"."visibility" = ANY (ARRAY['public'::"text", 'private'::"text"])) OR (EXISTS ( SELECT 1
           FROM "public"."learning_program_enrolments" "e"
          WHERE (("e"."program_id" = "p"."id") AND ("e"."user_id" = "auth"."uid"()))))))))));



CREATE POLICY "Members can view learning steps" ON "public"."learning_program_steps" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR (EXISTS ( SELECT 1
   FROM "public"."learning_programs" "p"
  WHERE (("p"."id" = "learning_program_steps"."program_id") AND ("p"."status" = 'published'::"text") AND (("p"."visibility" = ANY (ARRAY['public'::"text", 'private'::"text"])) OR (EXISTS ( SELECT 1
           FROM "public"."learning_program_enrolments" "e"
          WHERE (("e"."program_id" = "p"."id") AND ("e"."user_id" = "auth"."uid"()))))))))));



CREATE POLICY "Members can view own learning enrolments" ON "public"."learning_program_enrolments" FOR SELECT TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Owner instructor or admin can delete student exam results" ON "public"."student_exam_results" FOR DELETE TO "authenticated" USING ((("instructor_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Owner instructor or admin can update student exam results" ON "public"."student_exam_results" FOR UPDATE TO "authenticated" USING ((("instructor_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text")))))) WITH CHECK ((("instructor_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))));



CREATE POLICY "Redeemed voucher holders can read own voucher" ON "public"."trial_flight_vouchers" FOR SELECT TO "authenticated" USING (("redeemed_by_user_id" = "auth"."uid"()));



CREATE POLICY "Staff can create ground session logs" ON "public"."ground_session_logs" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can create safety documents" ON "public"."safety_documents" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can delete bookings and full students can delete own" ON "public"."bookings" FOR DELETE TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Staff can delete endorsements" ON "public"."endorsements" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can delete ground session logs" ON "public"."ground_session_logs" FOR DELETE TO "authenticated" USING ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can delete safety documents" ON "public"."safety_documents" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can delete safety reports" ON "public"."safety_reports" FOR DELETE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can insert endorsements" ON "public"."endorsements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can insert student exam results" ON "public"."student_exam_results" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can insert student profile rows" ON "public"."students" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can manage course enrolments" ON "public"."student_course_enrolments" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can manage matrix assessments" ON "public"."student_matrix_assessments" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can manage syllabus matrix requirements" ON "public"."syllabus_matrix_requirements" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can manage syllabus matrix rows" ON "public"."syllabus_matrix_rows" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can manage top-up link notifications" ON "public"."member_topup_link_notifications" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can read all Xero invoice portal payments" ON "public"."xero_invoice_portal_payments" FOR SELECT TO "authenticated" USING ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can read all bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can read declaration signing tokens" ON "public"."declaration_signing_tokens" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can read flight log stripe events" ON "public"."flight_log_stripe_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can read invitations" ON "public"."invitations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can read maintenance audit log" ON "public"."maintenance_audit_log" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can read stripe card setup sessions" ON "public"."member_stripe_card_setup_sessions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can read stripe payment methods" ON "public"."member_stripe_payment_methods" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can read trial flight voucher addons" ON "public"."trial_flight_voucher_addons" FOR SELECT TO "authenticated" USING ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can read trial flight voucher product addons" ON "public"."trial_flight_voucher_product_addons" FOR SELECT TO "authenticated" USING ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can read trial flight voucher products" ON "public"."trial_flight_voucher_products" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR "public"."current_user_has_staff_role"()));



CREATE POLICY "Staff can update bookings and full students can update own" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"())))) WITH CHECK (("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND ("student_id" = "auth"."uid"()))));



CREATE POLICY "Staff can update endorsements" ON "public"."endorsements" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can update ground session logs" ON "public"."ground_session_logs" FOR UPDATE TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff can update member profile rows" ON "public"."users" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff can update safety documents" ON "public"."safety_documents" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can update safety reports" ON "public"."safety_reports" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Staff can update student profile rows" ON "public"."students" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))));



CREATE POLICY "Staff manage learning enrolments" ON "public"."learning_program_enrolments" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff manage learning lesson links" ON "public"."learning_program_lesson_links" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff manage learning programs" ON "public"."learning_programs" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff manage learning sections" ON "public"."learning_program_sections" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Staff manage learning steps" ON "public"."learning_program_steps" TO "authenticated" USING ("public"."current_user_has_staff_role"()) WITH CHECK ("public"."current_user_has_staff_role"());



CREATE POLICY "Students can acknowledge and comment on own records" ON "public"."training_records" FOR UPDATE TO "authenticated" USING (("student_id" = "auth"."uid"())) WITH CHECK (("student_id" = "auth"."uid"()));



CREATE POLICY "Students can acknowledge own submitted training records" ON "public"."training_records" FOR UPDATE TO "authenticated" USING ((("student_id" = "auth"."uid"()) AND ("status" = 'submitted'::"text"))) WITH CHECK (("student_id" = "auth"."uid"()));



CREATE POLICY "Students can sign own course declarations" ON "public"."student_course_enrolments" FOR UPDATE TO "authenticated" USING (("student_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("student_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Trial voucher holders can read own voucher bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) AND ("trial_flight_voucher_id" IS NOT NULL)));



CREATE POLICY "Users can delete own notifications" ON "public"."notifications" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own preferences" ON "public"."user_preferences" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own safe student profile row" ON "public"."students" FOR INSERT TO "authenticated" WITH CHECK ((("id" = "auth"."uid"()) AND (COALESCE("prepaid_balance", (0)::numeric) = (0)::numeric) AND ("last_flight_review" IS NULL)));



CREATE POLICY "Users can insert own student or pilot user record" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK ((("id" = "auth"."uid"()) AND (COALESCE("role", 'student'::"text") = ANY (ARRAY['student'::"text", 'pilot'::"text"])) AND (COALESCE("is_senior_instructor", false) = false) AND (COALESCE("is_active", true) = true)));



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own preferences" ON "public"."user_preferences" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own profile and staff can read members" ON "public"."users" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Users can read own roles and staff can read roles" ON "public"."user_roles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."current_user_has_staff_role"() OR "public"."current_user_is_admin"()));



CREATE POLICY "Users can read own student profile and staff can read students" ON "public"."students" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles" "ur"
  WHERE (("ur"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("ur"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Users can read own transactions" ON "public"."account_transactions" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read relevant course enrolments" ON "public"."student_course_enrolments" FOR SELECT TO "authenticated" USING ((("student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));



CREATE POLICY "Users can submit own pending topups" ON "public"."account_transactions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("type" = 'topup'::"text") AND ("amount" > (0)::numeric) AND ("verified_status" = 'pending'::"text") AND ("balance_after" IS NULL) AND ("flight_log_id" IS NULL)));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own preferences" ON "public"."user_preferences" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users can update own student record" ON "public"."students" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own user record" ON "public"."users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own transactions" ON "public"."account_transactions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view relevant ground session logs" ON "public"."ground_session_logs" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR ("instructor_id" = "auth"."uid"()) OR "public"."current_user_has_staff_role"()));



ALTER TABLE "public"."account_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aircraft" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aircraft_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."aircraft_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_conflicts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_field_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."booking_rules_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."declaration_signing_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."defect_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."defects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."endorsements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flight_log_field_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flight_log_stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flight_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."flight_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ground_session_description_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ground_session_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instructor_absences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instructor_schedule_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."instructor_weekly_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_program_enrolments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_program_lesson_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_program_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_program_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_programs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learning_step_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lesson_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_completions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_milestone_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_milestones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_stripe_card_setup_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_stripe_payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_topup_link_notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organisation_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."portal_ux_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resource_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safety_compliance_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safety_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safety_report_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."safety_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_connect_oauth_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stripe_connect_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_course_enrolments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_exam_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_matrix_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_syllabi" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."students" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."syllabi" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."syllabus_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."syllabus_matrix_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."syllabus_matrix_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."syllabus_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_lessons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_sequence_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_syllabus_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_template_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."training_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_flight_voucher_addons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_flight_voucher_product_addons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_flight_voucher_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_flight_voucher_stripe_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_flight_vouchers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trial_voucher_cron_auth" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_connection_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_invoice_portal_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_oauth_states" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_rate_limit_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_sync_queue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."xero_sync_settings" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."aircraft";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bookings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."flight_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."instructor_absences";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."instructor_schedule_changes";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."instructor_weekly_schedules";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."training_records";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."training_sequence_results";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."admin_audit_trigger"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_audit_trigger"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."archive_trial_voucher_account_after_logged_flight"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_trial_voucher_account_after_logged_flight"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_changed_fields"("old_row" "jsonb", "new_row" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_changed_fields"("old_row" "jsonb", "new_row" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_record_label"("table_name" "text", "row_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_record_label"("table_name" "text", "row_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."book_trial_flight_voucher_slot"("p_voucher_id" "uuid", "p_student_id" "uuid", "p_aircraft_id" "uuid", "p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."book_trial_flight_voucher_slot"("p_voucher_id" "uuid", "p_student_id" "uuid", "p_aircraft_id" "uuid", "p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer, "max_calls_per_day" integer, "spacing_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer, "max_calls_per_day" integer, "spacing_ms" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer, "max_calls_per_day" integer, "spacing_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_xero_api_slot"("max_calls_per_minute" integer, "max_calls_per_day" integer, "spacing_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_has_full_portal_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_full_portal_access"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_full_portal_access"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_has_staff_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_staff_role"() TO "service_role";
GRANT ALL ON FUNCTION "public"."current_user_has_staff_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."current_user_is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_declaration_signing_request"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_declaration_signing_request"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_declaration_signing_request"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_declaration_signing_request"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_and_audit_training_record_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_and_audit_training_record_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_and_audit_training_record_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_students_self_service_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_students_self_service_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_users_self_service_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_users_self_service_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_aircraft_grounding"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_aircraft_grounding"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_endorsement_flight_review_sync"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_endorsement_flight_review_sync"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_endorsement_flight_review_sync"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_endorsement_flight_review_sync"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_endorsement_role_sync"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_endorsement_role_sync"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_endorsement_role_sync"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_calendar_instructors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_calendar_instructors"() TO "anon";
GRANT ALL ON FUNCTION "public"."list_calendar_instructors"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_calendar_instructors"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."note_xero_rate_limit"("retry_after_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_instructor_booking_request"("booking_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_instructor_booking_request"("booking_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_self_service_access_field_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_self_service_access_field_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_trial_voucher_booking_overlap"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_trial_voucher_booking_overlap"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."promote_pilot_after_passed_flight_review"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_pilot_after_passed_flight_review"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protect_system_payment_methods"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protect_system_payment_methods"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_xero_contact_sync_on_user_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_xero_flight_invoice_sync"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_xero_verified_payment_sync"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_xero_voucher_sync_from_flight_log"() TO "service_role";



GRANT ALL ON FUNCTION "public"."queue_xero_voucher_sync_from_voucher"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_flight_review_endorsements"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_flight_review_endorsements"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_flight_review_endorsements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_flight_review_endorsements"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."release_trial_voucher_when_booking_cancelled"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."release_trial_voucher_when_booking_cancelled"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rename_aircraft_endorsement_requirement"("old_value" "text", "new_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_aircraft_endorsement_requirement"("old_value" "text", "new_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_aircraft_endorsement_requirement"("old_value" "text", "new_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text", "p_guardian_relationship" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text", "p_guardian_relationship" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_user_agent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text", "p_guardian_relationship" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sign_course_declaration_with_token"("p_token" "text", "p_signature_name" "text", "p_member_number" "text", "p_guardian_relationship" "text", "p_guardian_email" "text", "p_guardian_phone" "text", "p_user_agent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_instructor_absence_identity_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_instructor_absence_identity_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_instructor_absence_identity_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_member_flight_review_from_endorsements"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_member_role_from_endorsements"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_member_role_from_endorsements"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_member_role_from_endorsements"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_public_user_email_from_auth"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_public_user_email_from_auth"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_trial_voucher_booking_link"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_trial_voucher_booking_link"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_user_primary_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_user_primary_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."training_record_audit_entry"("p_action" "text", "p_changes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."training_record_audit_entry"("p_action" "text", "p_changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."training_record_audit_entry"("p_action" "text", "p_changes" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."trial_voucher_instructor_available_for_slot"("p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trial_voucher_instructor_available_for_slot"("p_instructor_id" "uuid", "p_start_time" timestamp with time zone, "p_end_time" timestamp with time zone) TO "service_role";
























GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."account_transactions" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."account_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."account_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft" TO "authenticated";
GRANT ALL ON TABLE "public"."aircraft" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft_documents" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."aircraft_documents" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft_rates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."aircraft_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."aircraft_rates" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_conflicts" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_conflicts" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_conflicts" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_field_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_field_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_field_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_rules_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."booking_rules_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_rules_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."bookings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."users" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_booking_public" TO "anon";
GRANT ALL ON TABLE "public"."calendar_booking_public" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_booking_public" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."calendar_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."calendar_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_settings" TO "service_role";



GRANT ALL ON TABLE "public"."declaration_signing_tokens" TO "anon";
GRANT ALL ON TABLE "public"."declaration_signing_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."declaration_signing_tokens" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."defect_history" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."defect_history" TO "authenticated";
GRANT ALL ON TABLE "public"."defect_history" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."defects" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."defects" TO "authenticated";
GRANT ALL ON TABLE "public"."defects" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."endorsements" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."endorsements" TO "authenticated";
GRANT ALL ON TABLE "public"."endorsements" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_log_field_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_log_field_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."flight_log_field_settings" TO "service_role";



GRANT ALL ON TABLE "public"."flight_log_stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."flight_log_stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."flight_log_stripe_events" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_logs" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."flight_logs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_types" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."flight_types" TO "authenticated";
GRANT ALL ON TABLE "public"."flight_types" TO "service_role";



GRANT ALL ON TABLE "public"."ground_session_description_options" TO "anon";
GRANT ALL ON TABLE "public"."ground_session_description_options" TO "authenticated";
GRANT ALL ON TABLE "public"."ground_session_description_options" TO "service_role";



GRANT ALL ON TABLE "public"."ground_session_logs" TO "anon";
GRANT ALL ON TABLE "public"."ground_session_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."ground_session_logs" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_absences" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_absences" TO "authenticated";
GRANT ALL ON TABLE "public"."instructor_absences" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_schedule_changes" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_schedule_changes" TO "authenticated";
GRANT ALL ON TABLE "public"."instructor_schedule_changes" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_weekly_schedules" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."instructor_weekly_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."instructor_weekly_schedules" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invitations" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invoice_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invoices" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."learning_program_enrolments" TO "anon";
GRANT ALL ON TABLE "public"."learning_program_enrolments" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_program_enrolments" TO "service_role";



GRANT ALL ON TABLE "public"."learning_program_lesson_links" TO "anon";
GRANT ALL ON TABLE "public"."learning_program_lesson_links" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_program_lesson_links" TO "service_role";



GRANT ALL ON TABLE "public"."learning_program_sections" TO "anon";
GRANT ALL ON TABLE "public"."learning_program_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_program_sections" TO "service_role";



GRANT ALL ON TABLE "public"."learning_program_steps" TO "anon";
GRANT ALL ON TABLE "public"."learning_program_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_program_steps" TO "service_role";



GRANT ALL ON TABLE "public"."learning_programs" TO "anon";
GRANT ALL ON TABLE "public"."learning_programs" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_programs" TO "service_role";



GRANT ALL ON TABLE "public"."learning_step_progress" TO "anon";
GRANT ALL ON TABLE "public"."learning_step_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."learning_step_progress" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lesson_snapshots" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."lesson_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."lesson_snapshots" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_audit_log" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_audit_log" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_completions" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_completions" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_completions" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_milestone_templates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_milestone_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_milestone_templates" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_milestones" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_milestones" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."maintenance_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_settings" TO "service_role";



GRANT ALL ON TABLE "public"."member_stripe_card_setup_sessions" TO "anon";
GRANT ALL ON TABLE "public"."member_stripe_card_setup_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."member_stripe_card_setup_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."member_stripe_payment_methods" TO "anon";
GRANT ALL ON TABLE "public"."member_stripe_payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."member_stripe_payment_methods" TO "service_role";



GRANT ALL ON TABLE "public"."member_topup_link_notifications" TO "anon";
GRANT ALL ON TABLE "public"."member_topup_link_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."member_topup_link_notifications" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."notification_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."notification_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."organisation_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."organisation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."organisation_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."payment_methods" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."payment_methods" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_methods" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."portal_ux_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."portal_ux_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."portal_ux_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."resource_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."resource_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_settings" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."rooms" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."safety_compliance_settings" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."safety_compliance_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_compliance_settings" TO "service_role";



GRANT ALL ON TABLE "public"."safety_documents" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."safety_documents" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."safety_report_categories" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."safety_report_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_report_categories" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."safety_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."safety_reports" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_connect_oauth_states" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_connect_settings" TO "service_role";



GRANT ALL ON TABLE "public"."student_course_enrolments" TO "anon";
GRANT ALL ON TABLE "public"."student_course_enrolments" TO "authenticated";
GRANT ALL ON TABLE "public"."student_course_enrolments" TO "service_role";



GRANT ALL ON TABLE "public"."student_documents" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."student_documents" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."student_exam_results" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."student_exam_results" TO "authenticated";
GRANT ALL ON TABLE "public"."student_exam_results" TO "service_role";



GRANT ALL ON TABLE "public"."student_matrix_assessments" TO "anon";
GRANT ALL ON TABLE "public"."student_matrix_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."student_matrix_assessments" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."student_syllabi" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."student_syllabi" TO "authenticated";
GRANT ALL ON TABLE "public"."student_syllabi" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."students" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."students" TO "authenticated";
GRANT ALL ON TABLE "public"."students" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabi" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabi" TO "authenticated";
GRANT ALL ON TABLE "public"."syllabi" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabus_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabus_items" TO "authenticated";
GRANT ALL ON TABLE "public"."syllabus_items" TO "service_role";



GRANT ALL ON TABLE "public"."syllabus_matrix_requirements" TO "anon";
GRANT ALL ON TABLE "public"."syllabus_matrix_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."syllabus_matrix_requirements" TO "service_role";



GRANT ALL ON TABLE "public"."syllabus_matrix_rows" TO "anon";
GRANT ALL ON TABLE "public"."syllabus_matrix_rows" TO "authenticated";
GRANT ALL ON TABLE "public"."syllabus_matrix_rows" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabus_sequences" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."syllabus_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."syllabus_sequences" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_courses" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."training_courses" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_lessons" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."training_lessons" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_records" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_records" TO "authenticated";
GRANT ALL ON TABLE "public"."training_records" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_sequence_results" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_sequence_results" TO "authenticated";
GRANT ALL ON TABLE "public"."training_sequence_results" TO "service_role";



GRANT ALL ON TABLE "public"."training_syllabus_settings" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."training_syllabus_settings" TO "authenticated";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_template_items" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_template_items" TO "authenticated";
GRANT ALL ON TABLE "public"."training_template_items" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_templates" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."training_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."training_templates" TO "service_role";



GRANT ALL ON TABLE "public"."trial_flight_voucher_addons" TO "anon";
GRANT ALL ON TABLE "public"."trial_flight_voucher_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_flight_voucher_addons" TO "service_role";



GRANT ALL ON TABLE "public"."trial_flight_voucher_product_addons" TO "anon";
GRANT ALL ON TABLE "public"."trial_flight_voucher_product_addons" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_flight_voucher_product_addons" TO "service_role";



GRANT ALL ON TABLE "public"."trial_flight_voucher_products" TO "anon";
GRANT ALL ON TABLE "public"."trial_flight_voucher_products" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_flight_voucher_products" TO "service_role";



GRANT ALL ON TABLE "public"."trial_flight_voucher_stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."trial_flight_voucher_stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_flight_voucher_stripe_events" TO "service_role";



GRANT ALL ON TABLE "public"."trial_flight_vouchers" TO "anon";
GRANT ALL ON TABLE "public"."trial_flight_vouchers" TO "authenticated";
GRANT ALL ON TABLE "public"."trial_flight_vouchers" TO "service_role";



GRANT ALL ON TABLE "public"."trial_voucher_cron_auth" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_preferences" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_roles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,MAINTAIN,UPDATE ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."xero_connection_settings" TO "service_role";



GRANT ALL ON TABLE "public"."xero_invoice_portal_payments" TO "anon";
GRANT ALL ON TABLE "public"."xero_invoice_portal_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."xero_invoice_portal_payments" TO "service_role";



GRANT ALL ON TABLE "public"."xero_oauth_states" TO "service_role";



GRANT ALL ON TABLE "public"."xero_rate_limit_state" TO "anon";
GRANT ALL ON TABLE "public"."xero_rate_limit_state" TO "authenticated";
GRANT ALL ON TABLE "public"."xero_rate_limit_state" TO "service_role";



GRANT ALL ON TABLE "public"."xero_sync_queue" TO "anon";
GRANT ALL ON TABLE "public"."xero_sync_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."xero_sync_queue" TO "service_role";



GRANT ALL ON TABLE "public"."xero_sync_settings" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































-- Storage buckets and access policies are part of the CRM baseline but the
-- managed storage schema itself remains owned by Supabase.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('aircraft-documents', 'aircraft-documents', false, 26214400, null),
  ('defect-attachments', 'defect-attachments', false, 26214400, null),
  ('org-logos', 'org-logos', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/svg+xml']),
  ('safety-documents', 'safety-documents', false, 26214400, null),
  ('student-documents', 'student-documents', false, 26214400, null),
  ('student-exam-uploads', 'student-exam-uploads', false, 26214400, null),
  ('training-lesson-assets', 'training-lesson-assets', false, null, null),
  ('user-avatars', 'user-avatars', true, 5242880, ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif','image/avif'])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "Admins can delete aircraft document files" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'aircraft-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))));

CREATE POLICY "Admins can update aircraft document files" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'aircraft-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))))) WITH CHECK ((("bucket_id" = 'aircraft-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))));

CREATE POLICY "Admins can update org logo" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'org-logos'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))));

CREATE POLICY "Admins can upload aircraft document files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'aircraft-documents'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text"))))));

CREATE POLICY "Admins can upload org logo" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'org-logos'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = "auth"."uid"()) AND ("user_roles"."role" = 'admin'::"text"))))));

CREATE POLICY "Authenticated users can read training lesson assets" ON "storage"."objects" FOR SELECT TO "authenticated" USING (("bucket_id" = 'training-lesson-assets'::"text"));

CREATE POLICY "Full portal users can read aircraft document files" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'aircraft-documents'::"text") AND "public"."current_user_has_full_portal_access"()));

CREATE POLICY "Full portal users can read defect attachments" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'defect-attachments'::"text") AND "public"."current_user_has_full_portal_access"()));

CREATE POLICY "Full portal users can read safety document files" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'safety-documents'::"text") AND "public"."current_user_has_full_portal_access"()));

CREATE POLICY "Full portal users can upload defect attachments" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'defect-attachments'::"text") AND "public"."current_user_has_full_portal_access"()));

CREATE POLICY "Full students and staff can delete student document files" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'student-documents'::"text") AND ("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")))));

CREATE POLICY "Full students and staff can read student document files" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'student-documents'::"text") AND ("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")))));

CREATE POLICY "Full students and staff can upload student document files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'student-documents'::"text") AND ("public"."current_user_has_staff_role"() OR ("public"."current_user_has_full_portal_access"() AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")))));

CREATE POLICY "Owner instructor or admin can delete student exam files" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'student-exam-uploads'::"text") AND ((EXISTS ( SELECT 1
   FROM "public"."student_exam_results"
  WHERE (("student_exam_results"."storage_path" = "objects"."name") AND ("student_exam_results"."instructor_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text")))))));

CREATE POLICY "Owner instructor or admin can update student exam files" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'student-exam-uploads'::"text") AND ((EXISTS ( SELECT 1
   FROM "public"."student_exam_results"
  WHERE (("student_exam_results"."storage_path" = "objects"."name") AND ("student_exam_results"."instructor_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = 'admin'::"text"))))))) WITH CHECK ((("bucket_id" = 'student-exam-uploads'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));

CREATE POLICY "Staff can delete defect attachments" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'defect-attachments'::"text") AND "public"."current_user_has_staff_role"()));

CREATE POLICY "Staff can delete safety document files" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'safety-documents'::"text") AND ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))))));

CREATE POLICY "Staff can delete training lesson assets" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'training-lesson-assets'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text"])))))));

CREATE POLICY "Staff can update defect attachments" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'defect-attachments'::"text") AND "public"."current_user_has_staff_role"())) WITH CHECK ((("bucket_id" = 'defect-attachments'::"text") AND "public"."current_user_has_staff_role"()));

CREATE POLICY "Staff can update training lesson assets" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'training-lesson-assets'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text"]))))))) WITH CHECK ((("bucket_id" = 'training-lesson-assets'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text"])))))));

CREATE POLICY "Staff can upload safety document files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'safety-documents'::"text") AND ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))) OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))))));

CREATE POLICY "Staff can upload student exam files" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'student-exam-uploads'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"])))))));

CREATE POLICY "Staff can upload training lesson assets" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'training-lesson-assets'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'senior_instructor'::"text", 'instructor'::"text"])))))));

CREATE POLICY "Students and staff can read student exam files" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'student-exam-uploads'::"text") AND ((("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text") OR (EXISTS ( SELECT 1
   FROM "public"."user_roles"
  WHERE (("user_roles"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("user_roles"."role" = ANY (ARRAY['admin'::"text", 'instructor'::"text", 'senior_instructor'::"text"]))))))));

CREATE POLICY "Users can delete their own avatar" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'user-avatars'::"text") AND (("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text")));

CREATE POLICY "Users can read their own avatar" ON "storage"."objects" FOR SELECT TO "authenticated" USING ((("bucket_id" = 'user-avatars'::"text") AND (("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text")));

CREATE POLICY "Users can update their own avatar" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'user-avatars'::"text") AND (("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text"))) WITH CHECK ((("bucket_id" = 'user-avatars'::"text") AND (("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text")));

CREATE POLICY "Users can upload their own avatar" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'user-avatars'::"text") AND (("storage"."foldername"("name"))[1] = (( SELECT "auth"."uid"() AS "uid"))::"text")));

