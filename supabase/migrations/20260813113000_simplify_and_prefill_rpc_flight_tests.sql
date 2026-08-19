-- Make the RPC flight-test workspace a practical examiner record rather than a
-- second copy of the RAAus application pack. The portal does not require an
-- authority-form upload, while the signed student logbook remains confirmed.

update public.training_courses course
set description = replace(
      course.description,
      'examiner notes and RPC001 evidence',
      'examiner notes and a ready-to-copy student logbook entry'
    ),
    review_configuration = jsonb_set(
      jsonb_set(
        jsonb_set(
          course.review_configuration,
          '{required_evidence}',
          '[]'::jsonb,
          true
        ),
        '{requires_authority_submission_confirmation}',
        'false'::jsonb,
        true
      ),
      '{checklist}',
      coalesce((
        select jsonb_agg(
          case
            when item->>'key' = 'RPC-ADM-04' then item || jsonb_build_object(
              'title', 'Record endorsements sought',
              'guidance', 'Select every endorsement assessed or recommended for issue.'
            )
            else item
          end
          order by ordinal
        )
        from jsonb_array_elements(coalesce(course.review_configuration->'checklist', '[]'::jsonb))
          with ordinality as checklist(item, ordinal)
      ), '[]'::jsonb),
      true
    ),
    last_updated = now()
where course.review_configuration->>'review_type' = 'raaus_rpc_flight_test';

-- Existing open drafts retain their captured checklist, but should immediately
-- receive the same streamlined requirements as the published template.
update public.flight_review_records record
set template_snapshot = jsonb_set(
      record.template_snapshot,
      '{review_configuration}',
      jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(record.template_snapshot->'review_configuration', '{}'::jsonb),
            '{required_evidence}',
            '[]'::jsonb,
            true
          ),
          '{requires_authority_submission_confirmation}',
          'false'::jsonb,
          true
        ),
        '{checklist}',
        coalesce((
          select jsonb_agg(
            case
              when item->>'key' = 'RPC-ADM-04' then item || jsonb_build_object(
                'title', 'Record endorsements sought',
                'guidance', 'Select every endorsement assessed or recommended for issue.'
              )
              else item
            end
            order by ordinal
          )
          from jsonb_array_elements(coalesce(record.template_snapshot->'review_configuration'->'checklist', '[]'::jsonb))
            with ordinality as checklist(item, ordinal)
        ), '[]'::jsonb),
        true
      ),
      true
    )
where record.review_type = 'raaus_rpc_flight_test'
  and record.status in ('draft', 'in_progress', 'further_training_required');

update public.flight_review_record_items item
set title = 'Record endorsements sought',
    guidance = 'Select every endorsement assessed or recommended for issue.',
    updated_at = now()
from public.flight_review_records record
where record.id = item.review_record_id
  and record.review_type = 'raaus_rpc_flight_test'
  and record.status in ('draft', 'in_progress', 'further_training_required')
  and item.template_item_key = 'RPC-ADM-04';

create or replace function public.prefill_rpc_flight_review_record()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  details jsonb := coalesce(new.assessment_details, '{}'::jsonb);
  candidate_membership_number text;
  candidate_membership_expiry date;
  examiner_membership_number text;
  total_hours numeric := 0;
  dual_hours numeric := 0;
  command_hours numeric := 0;
  raaus_hours numeric := 0;
  linked_booking_id uuid;
  linked_aircraft_id uuid;
  linked_aircraft_type text;
  linked_registration text;
  linked_start timestamptz;
  linked_duration numeric;
begin
  if new.review_type <> 'raaus_rpc_flight_test' then
    return new;
  end if;

  if new.flight_log_id is not null then
    select
      flight.booking_id,
      flight.aircraft_id,
      nullif(btrim(concat_ws(' ', aircraft.make, aircraft.model)), ''),
      aircraft.registration,
      flight.start_time,
      greatest(
        coalesce(flight.flight_duration, 0),
        coalesce(flight.dual_time, 0) + coalesce(flight.solo_time, 0)
      )
    into
      linked_booking_id,
      linked_aircraft_id,
      linked_aircraft_type,
      linked_registration,
      linked_start,
      linked_duration
    from public.flight_logs flight
    left join public.aircraft aircraft on aircraft.id = flight.aircraft_id
    where flight.id = new.flight_log_id;

    if found then
      new.booking_id := coalesce(linked_booking_id, new.booking_id);
      new.aircraft_id := linked_aircraft_id;
      new.aircraft_type := coalesce(linked_aircraft_type, '');
      new.registration := coalesce(linked_registration, '');
      new.flight_minutes := greatest(0, round(coalesce(linked_duration, 0) * 60)::integer);
      new.review_date := (linked_start at time zone 'Australia/Melbourne')::date;
    end if;
  end if;

  select student.raaus_id, student.licence_expiry
  into candidate_membership_number, candidate_membership_expiry
  from public.students student
  where student.id = new.candidate_id;

  if new.external_examiner_name is null then
    select student.raaus_id
    into examiner_membership_number
    from public.students student
    where student.id = new.reviewer_user_id;
  else
    examiner_membership_number := new.external_examiner_identifier;
  end if;

  select
    coalesce(sum(greatest(
      coalesce(flight.flight_duration, 0),
      coalesce(flight.dual_time, 0) + coalesce(flight.solo_time, 0)
    )), 0),
    coalesce(sum(coalesce(flight.dual_time, 0)), 0),
    coalesce(sum(coalesce(flight.solo_time, 0)), 0),
    coalesce(sum(
      case
        when aircraft.registration is null
          or upper(aircraft.registration) not like 'VH-%'
        then greatest(
          coalesce(flight.flight_duration, 0),
          coalesce(flight.dual_time, 0) + coalesce(flight.solo_time, 0)
        )
        else 0
      end
    ), 0)
  into total_hours, dual_hours, command_hours, raaus_hours
  from public.flight_logs flight
  left join public.aircraft aircraft on aircraft.id = flight.aircraft_id
  where flight.student_id = new.candidate_id
    and flight.start_time < ((new.review_date + 1)::timestamp at time zone 'Australia/Melbourne');

  if nullif(btrim(details->>'applicantMembershipNumber'), '') is null
     and nullif(btrim(candidate_membership_number), '') is not null then
    details := jsonb_set(details, '{applicantMembershipNumber}', to_jsonb(candidate_membership_number), true);
  end if;
  if nullif(btrim(details->>'applicantMembershipExpiry'), '') is null
     and candidate_membership_expiry is not null then
    details := jsonb_set(details, '{applicantMembershipExpiry}', to_jsonb(candidate_membership_expiry::text), true);
  end if;
  if nullif(btrim(details->>'examinerMembershipNumber'), '') is null
     and nullif(btrim(examiner_membership_number), '') is not null then
    details := jsonb_set(details, '{examinerMembershipNumber}', to_jsonb(examiner_membership_number), true);
  end if;
  if nullif(btrim(details->>'totalFlightHours'), '') is null then
    details := jsonb_set(details, '{totalFlightHours}', to_jsonb(round(total_hours, 1)), true);
  end if;
  if nullif(btrim(details->>'dualFlightHours'), '') is null then
    details := jsonb_set(details, '{dualFlightHours}', to_jsonb(round(dual_hours, 1)), true);
  end if;
  if nullif(btrim(details->>'commandFlightHours'), '') is null then
    details := jsonb_set(details, '{commandFlightHours}', to_jsonb(round(command_hours, 1)), true);
  end if;
  if nullif(btrim(details->>'raausFlightHours'), '') is null then
    details := jsonb_set(details, '{raausFlightHours}', to_jsonb(round(raaus_hours, 1)), true);
  end if;

  new.assessment_details := details;
  return new;
end
$function$;

revoke all on function public.prefill_rpc_flight_review_record()
  from public, anon, authenticated, service_role;

drop trigger if exists prefill_rpc_flight_review_on_insert on public.flight_review_records;
create trigger prefill_rpc_flight_review_on_insert
before insert on public.flight_review_records
for each row execute function public.prefill_rpc_flight_review_record();

drop trigger if exists prefill_rpc_flight_review_on_change on public.flight_review_records;
create trigger prefill_rpc_flight_review_on_change
before update of candidate_id, reviewer_user_id, external_examiner_identifier,
  flight_log_id, aircraft_id, aircraft_type, registration, assessment_details
on public.flight_review_records
for each row execute function public.prefill_rpc_flight_review_record();

-- Re-run the prefill for drafts which were created before this migration,
-- including the current Lincoln test draft.
update public.flight_review_records
set assessment_details = assessment_details
where review_type = 'raaus_rpc_flight_test'
  and status in ('draft', 'in_progress', 'further_training_required');

create or replace function public.validate_flight_review_completion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $function$
declare
  config jsonb := coalesce(new.template_snapshot->'review_configuration', '{}'::jsonb);
  minimum_ground integer := coalesce((config->>'minimum_ground_minutes')::integer, 0);
  minimum_flight integer := coalesce((config->>'minimum_flight_minutes')::integer, 0);
  validity_months integer := coalesce((config->>'validity_months')::integer, 0);
  missing_required integer;
  evidence_type text;
  rpc_endorsements jsonb;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select count(*) into missing_required
    from public.flight_review_record_items item
    where item.review_record_id = new.id
      and item.required
      and item.result <> 'satisfactory';

    if missing_required > 0 then
      raise exception '% required review items have not been assessed as satisfactory', missing_required;
    end if;
    if new.completion_date is null then
      raise exception 'Completion date is required';
    end if;
    if nullif(trim(new.reviewer_sign_name), '') is null or new.reviewer_sign_at is null then
      raise exception 'Reviewer signature is required';
    end if;
    if coalesce((config->>'requires_reviewer_summary')::boolean, false)
       and nullif(trim(new.reviewer_summary), '') is null then
      raise exception 'Examiner notes and outcome summary are required';
    end if;
    if (new.ground_minutes < minimum_ground or new.flight_minutes < minimum_flight)
       and nullif(trim(new.minimums_override_reason), '') is null then
      raise exception 'Review duration is below the template minimum; record an override reason';
    end if;
    if (new.review_type = 'raaus_bfr'
        or coalesce((config->>'requires_logbook_confirmation')::boolean, false))
       and not new.logbook_entry_confirmed then
      raise exception 'The candidate logbook entry must be confirmed';
    end if;
    if (new.review_type = 'raaus_bfr'
        or coalesce((config->>'requires_authority_submission_confirmation')::boolean, false))
       and not new.authority_submission_confirmed then
      raise exception 'The RAAus form submission must be confirmed';
    end if;

    rpc_endorsements := new.assessment_details->'endorsementsSought';
    if new.review_type = 'raaus_rpc_flight_test' and (
      nullif(trim(new.assessment_details->>'applicantMembershipNumber'), '') is null
      or nullif(trim(new.assessment_details->>'applicantMembershipExpiry'), '') is null
      or nullif(trim(new.assessment_details->>'totalFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'dualFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'commandFlightHours'), '') is null
      or nullif(trim(new.assessment_details->>'raausFlightHours'), '') is null
      or rpc_endorsements is null
      or (jsonb_typeof(rpc_endorsements) = 'array' and jsonb_array_length(rpc_endorsements) = 0)
      or (jsonb_typeof(rpc_endorsements) = 'string' and nullif(trim(new.assessment_details->>'endorsementsSought'), '') is null)
    ) then
      raise exception 'Complete the RPC applicant and aeronautical experience details';
    end if;

    for evidence_type in
      select jsonb_array_elements_text(coalesce(config->'required_evidence', '[]'::jsonb))
    loop
      if not exists (
        select 1 from public.flight_review_attachments attachment
        where attachment.review_record_id = new.id
          and attachment.category = evidence_type
      ) then
        raise exception 'Required evidence is missing: %', evidence_type;
      end if;
    end loop;

    if validity_months > 0 and new.next_review_due is null then
      new.next_review_due := new.completion_date + make_interval(months => validity_months);
    end if;
  end if;
  return new;
end
$function$;

insert into private.function_permission_manifest (
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale
)
values (
  'public.prefill_rpc_flight_review_record()',
  'prefill_rpc_flight_review_record',
  'trigger_internal',
  array[]::text[],
  true,
  true,
  'Trigger-only RPC flight-test prefill; centralises protected member, flight-hour and linked-aircraft source data.'
)
on conflict (signature) do update
set function_name = excluded.function_name,
    classification = excluded.classification,
    allowed_roles = excluded.allowed_roles,
    security_definer = excluded.security_definer,
    fixed_search_path = excluded.fixed_search_path,
    rationale = excluded.rationale,
    reviewed_at = current_date;

select private.assert_function_permission_manifest();
