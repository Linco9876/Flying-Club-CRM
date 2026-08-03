-- Operational flight and ground-session records must remain usable while both
-- financial providers are disconnected. Null financial columns distinguish an
-- intentionally non-financial record from a genuine zero-dollar transaction.

alter table public.flight_logs
  add column if not exists financial_capture_suppressed boolean not null default false;

alter table public.flight_logs
  alter column total_cost drop not null,
  alter column total_cost drop default,
  alter column calculated_cost drop default,
  alter column payment_status drop default,
  alter column xero_sync_status drop not null,
  alter column xero_sync_status drop default;

alter table public.ground_session_logs
  add column if not exists financial_capture_suppressed boolean not null default false;

alter table public.ground_session_logs
  alter column payment_type drop not null,
  alter column calculated_cost drop not null,
  alter column calculated_cost drop default,
  alter column payment_status drop not null,
  alter column payment_status drop default;

comment on column public.flight_logs.financial_capture_suppressed is
  'True when the operational record was created while neither Stripe nor Xero was connected; payment selection, pricing and payment status remain null.';

comment on column public.ground_session_logs.financial_capture_suppressed is
  'True when the operational record was created while neither Stripe nor Xero was connected; payment selection, pricing and payment status remain null.';

alter table public.flight_logs
  drop constraint if exists flight_logs_suppressed_financial_fields_check,
  add constraint flight_logs_suppressed_financial_fields_check check (
    not financial_capture_suppressed
    or (
      flight_type_id is null
      and payment_type is null
      and total_cost is null
      and calculated_cost is null
      and payment_status is null
      and stripe_checkout_session_id is null
      and stripe_payment_intent_id is null
      and stripe_payment_status is null
      and xero_invoice_id is null
      and xero_payment_id is null
      and xero_sync_status is null
    )
  );

alter table public.ground_session_logs
  drop constraint if exists ground_session_logs_suppressed_financial_fields_check,
  add constraint ground_session_logs_suppressed_financial_fields_check check (
    not financial_capture_suppressed
    or (
      flight_type_id is null
      and payment_type is null
      and calculated_cost is null
      and payment_status is null
      and xero_invoice_id is null
      and xero_sync_status is null
    )
  );

create or replace function public.apply_ground_session_rate_matrix()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_pricing_mode text;
  selected_fixed_rate numeric;
  selected_hourly_rate numeric;
  selected_rate_enabled boolean;
  billable_hours numeric;
begin
  if new.description_option_id is null then
    raise exception 'A Ground Session Type is required.';
  end if;

  billable_hours := greatest(0.25, ceil(greatest(new.duration_hours, 0) * 4) / 4);
  new.duration_hours := billable_hours;

  if coalesce(new.financial_capture_suppressed, false) then
    new.flight_type_id := null;
    new.payment_type := null;
    new.calculated_cost := null;
    new.payment_status := null;
    return new;
  end if;

  select pricing_mode, fixed_rate
  into selected_pricing_mode, selected_fixed_rate
  from public.ground_session_description_options
  where id = new.description_option_id
    and active = true;

  if selected_pricing_mode is null then
    raise exception 'The selected Ground Session Type is unavailable.';
  end if;

  if selected_pricing_mode = 'fixed' then
    new.calculated_cost := round(greatest(coalesce(selected_fixed_rate, 0), 0), 2);
    return new;
  end if;

  if new.flight_type_id is null then
    raise exception 'A Payment Type is required for hourly ground sessions.';
  end if;

  select rate.enabled, rate.hourly_rate
  into selected_rate_enabled, selected_hourly_rate
  from public.ground_session_rates rate
  join public.flight_types payment_type
    on payment_type.id = rate.flight_type_id
   and payment_type.active = true
  where rate.description_option_id = new.description_option_id
    and rate.flight_type_id = new.flight_type_id;

  if coalesce(selected_rate_enabled, false) is not true
    or coalesce(selected_hourly_rate, 0) <= 0 then
    raise exception
      'This Payment Type does not have an hourly rate configured for the selected Ground Session Type.';
  end if;

  new.calculated_cost := round(selected_hourly_rate * billable_hours, 2);
  return new;
end;
$$;

revoke all on function public.apply_ground_session_rate_matrix() from public, anon, authenticated, service_role;

select private.assert_function_permission_manifest();
