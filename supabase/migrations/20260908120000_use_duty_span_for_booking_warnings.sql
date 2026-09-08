-- Booking-time fatigue planning is based on the instructor's duty span. The
-- Duty Clock is authoritative; without a clock record, the span remains first
-- booking minus 30 minutes through last booking plus 30 minutes. Do not add an
-- independent warning by summing overlapping bookings and supervision inside
-- that same span. Recorded flight minutes remain subject to the rolling flight
-- limits already calculated by the underlying assessment.

do $migration$
begin
  if to_regprocedure(
    'private.assess_instructor_duty_booking_span_base(uuid,timestamp with time zone,timestamp with time zone,uuid)'
  ) is null then
    execute 'alter function public.assess_instructor_duty_booking(uuid, timestamptz, timestamptz, uuid) rename to assess_instructor_duty_booking_span_base';
    execute 'alter function public.assess_instructor_duty_booking_span_base(uuid, timestamptz, timestamptz, uuid) set schema private';
  end if;
end;
$migration$;

revoke all on function private.assess_instructor_duty_booking_span_base(
  uuid, timestamptz, timestamptz, uuid
) from public, anon, authenticated, service_role;

create or replace function public.assess_instructor_duty_booking(
  p_instructor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_assessment jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rule_codes jsonb := '[]'::jsonb;
begin
  v_assessment := private.assess_instructor_duty_booking_span_base(
    p_instructor_id,
    p_start,
    p_end,
    p_exclude_booking_id
  );

  if v_assessment->>'result' not in ('clear', 'warning') then
    return (v_assessment - 'forecastBookedHours') || jsonb_build_object(
      'engineVersion', 'duty-v4-span-only',
      'planningModel', 'first-start-to-last-finish'
    );
  end if;

  select coalesce(jsonb_agg(warning_item.item), '[]'::jsonb)
  into v_warnings
  from jsonb_array_elements(
    coalesce(v_assessment->'warnings', '[]'::jsonb)
  ) as warning_item(item)
  where warning_item.item->>'code' <> 'MAX_DAILY_BOOKED_FLIGHT';

  select coalesce(jsonb_agg(rule_code.code), '[]'::jsonb)
  into v_rule_codes
  from jsonb_array_elements_text(
    coalesce(v_assessment->'ruleCodes', '[]'::jsonb)
  ) as rule_code(code)
  where rule_code.code <> 'MAX_DAILY_BOOKED_FLIGHT';

  return (v_assessment - 'forecastBookedHours') || jsonb_build_object(
    'result', case
      when jsonb_array_length(v_warnings) > 0 then 'warning'
      else 'clear'
    end,
    'warnings', v_warnings,
    'ruleCodes', v_rule_codes,
    'engineVersion', 'duty-v4-span-only',
    'planningModel', 'first-start-to-last-finish'
  );
end;
$$;

revoke all on function public.assess_instructor_duty_booking(
  uuid, timestamptz, timestamptz, uuid
) from public, anon;
grant execute on function public.assess_instructor_duty_booking(
  uuid, timestamptz, timestamptz, uuid
) to authenticated, service_role;

update private.function_permission_manifest
set rationale = 'Authenticated duty assessment uses Duty Clock time or the first-to-last booking span, preserves duty/rest and recorded rolling-flight controls, and does not sum overlapping activity inside the span.',
    reviewed_at = date '2026-09-08'
where signature = 'public.assess_instructor_duty_booking(p_instructor_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_exclude_booking_id uuid)';

comment on function public.assess_instructor_duty_booking(
  uuid, timestamptz, timestamptz, uuid
) is 'Assesses planned duty from the authoritative Duty Clock or first-start-to-last-finish fallback. Overlapping activity inside the duty span is not summed into a separate warning.';

comment on column public.booking_rules_settings.fatigue_max_flight_hours_per_day is
  'Legacy compatibility/report value. Prospective booking warnings use duty span; recorded flight minutes remain subject to rolling flight-time controls.';

select private.assert_function_permission_manifest();
