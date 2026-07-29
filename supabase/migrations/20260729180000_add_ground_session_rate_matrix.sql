create table if not exists public.ground_session_rates (
  id uuid primary key default gen_random_uuid(),
  description_option_id uuid not null
    references public.ground_session_description_options(id) on delete cascade,
  flight_type_id uuid not null
    references public.flight_types(id) on delete cascade,
  enabled boolean not null default false,
  hourly_rate numeric(10, 2) not null default 0
    check (hourly_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ground_session_rates_description_payment_type_key
    unique (description_option_id, flight_type_id)
);

comment on table public.ground_session_rates is
  'GST-inclusive hourly prices for each Ground Session Type and Payment Type combination.';

comment on column public.ground_session_rates.description_option_id is
  'The Ground Session Type this rate applies to.';

comment on column public.ground_session_rates.flight_type_id is
  'The Payment Type this rate applies to. The legacy flight_types table name is retained for compatibility.';

comment on column public.ground_session_rates.enabled is
  'Whether this Payment Type may be selected when logging this Ground Session Type.';

comment on column public.ground_session_rates.hourly_rate is
  'GST-inclusive hourly rate, billed in 15-minute increments.';

create index if not exists idx_ground_session_rates_description
  on public.ground_session_rates(description_option_id);

create index if not exists idx_ground_session_rates_payment_type
  on public.ground_session_rates(flight_type_id);

insert into public.ground_session_rates (
  description_option_id,
  flight_type_id,
  enabled,
  hourly_rate
)
select
  description.id,
  payment_type.id,
  payment_type.ground_session_enabled
    and payment_type.ground_session_hourly_rate > 0,
  greatest(payment_type.ground_session_hourly_rate, 0)
from public.ground_session_description_options description
cross join public.flight_types payment_type
where description.pricing_mode = 'flight_type_hourly'
on conflict (description_option_id, flight_type_id) do nothing;

alter table public.ground_session_rates enable row level security;

drop policy if exists "Authenticated users can view ground session rates"
  on public.ground_session_rates;
create policy "Authenticated users can view ground session rates"
  on public.ground_session_rates
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can manage ground session rates"
  on public.ground_session_rates;
create policy "Admins can manage ground session rates"
  on public.ground_session_rates
  for all
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

revoke all on table public.ground_session_rates from anon;
grant select, insert, update, delete on table public.ground_session_rates to authenticated;
grant all on table public.ground_session_rates to service_role;

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

  select pricing_mode, fixed_rate
  into selected_pricing_mode, selected_fixed_rate
  from public.ground_session_description_options
  where id = new.description_option_id
    and active = true;

  if selected_pricing_mode is null then
    raise exception 'The selected Ground Session Type is unavailable.';
  end if;

  billable_hours := greatest(0.25, ceil(greatest(new.duration_hours, 0) * 4) / 4);
  new.duration_hours := billable_hours;

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

revoke all on function public.apply_ground_session_rate_matrix() from public, anon, authenticated;
grant execute on function public.apply_ground_session_rate_matrix() to service_role;

drop trigger if exists ground_session_logs_apply_rate_matrix
  on public.ground_session_logs;
create trigger ground_session_logs_apply_rate_matrix
before insert or update of duration_hours, description_option_id, flight_type_id
on public.ground_session_logs
for each row
execute function public.apply_ground_session_rate_matrix();

comment on column public.flight_types.ground_session_enabled is
  'Legacy default retained for migration compatibility. New ground-session availability is stored per Ground Session Type in ground_session_rates.';

comment on column public.flight_types.ground_session_hourly_rate is
  'Legacy default retained for migration compatibility. New hourly prices are stored per Ground Session Type and Payment Type in ground_session_rates.';
