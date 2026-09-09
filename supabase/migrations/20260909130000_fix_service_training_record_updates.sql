-- Allow trusted backend history transfers while preserving student restrictions and audits.
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

  -- Service-only history transfers have no auth.uid(); retain the staff audit path.
  v_is_staff := coalesce(auth.role(), '') = 'service_role'
    or coalesce(public.current_user_has_staff_role(), false);
  v_actor_is_student := coalesce(auth.uid() = old.student_id, false);

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

revoke all on function public.guard_and_audit_training_record_update() from public, anon, authenticated, service_role;
select private.assert_function_permission_manifest();
