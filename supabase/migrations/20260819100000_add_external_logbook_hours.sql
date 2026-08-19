-- External logbook support.
-- A baseline is an opening balance through a nominated day. Individual
-- external flights remain separate so they can establish genuine recency.

create table if not exists public.logbook_baselines (
  user_id uuid primary key references public.users(id) on delete cascade,
  as_of_date date not null,
  last_flight_date date,
  total_hours numeric(10,1) not null default 0,
  pic_hours numeric(10,1) not null default 0,
  dual_hours numeric(10,1) not null default 0,
  takeoffs integer not null default 0,
  landings integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint logbook_baselines_date_check check (
    as_of_date <= (timezone('Australia/Melbourne', now()))::date
  ),
  constraint logbook_baselines_last_flight_check check (
    last_flight_date is null
    or (
      last_flight_date <= as_of_date
      and last_flight_date <= (timezone('Australia/Melbourne', now()))::date
    )
  ),
  constraint logbook_baselines_hours_check check (
    total_hours >= 0
    and total_hours <= 100000
    and pic_hours >= 0
    and pic_hours <= total_hours
    and dual_hours >= 0
    and dual_hours <= total_hours
    and pic_hours + dual_hours <= total_hours
  ),
  constraint logbook_baselines_movements_check check (
    takeoffs between 0 and 1000000
    and landings between 0 and 1000000
  )
);

comment on table public.logbook_baselines is
  'User-entered cumulative logbook totals through a nominated date. Portal and external flights on or before the baseline date are not added again.';
comment on column public.logbook_baselines.last_flight_date is
  'Optional actual most recent flight included in the baseline. The as-of date alone never establishes recency.';

create table if not exists public.external_logbook_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  flight_date date not null,
  aircraft_registration text not null,
  aircraft_type text not null,
  pilot_in_command_name text,
  other_crew_name text,
  dual_hours numeric(6,1) not null default 0,
  pic_hours numeric(6,1) not null default 0,
  takeoffs integer not null default 0,
  landings integer not null default 0,
  comments text not null default '',
  description text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_logbook_entries_date_check check (
    flight_date <= (timezone('Australia/Melbourne', now()))::date
  ),
  constraint external_logbook_entries_registration_check check (
    char_length(btrim(aircraft_registration)) between 1 and 20
  ),
  constraint external_logbook_entries_type_check check (
    char_length(btrim(aircraft_type)) between 1 and 120
  ),
  constraint external_logbook_entries_hours_check check (
    dual_hours >= 0
    and pic_hours >= 0
    and dual_hours + pic_hours > 0
    and dual_hours + pic_hours <= 24
  ),
  constraint external_logbook_entries_dual_pic_check check (
    dual_hours = 0 or nullif(btrim(pilot_in_command_name), '') is not null
  ),
  constraint external_logbook_entries_movements_check check (
    takeoffs between 0 and 1000
    and landings between 0 and 1000
  ),
  constraint external_logbook_entries_text_check check (
    char_length(coalesce(pilot_in_command_name, '')) <= 200
    and char_length(coalesce(other_crew_name, '')) <= 200
    and char_length(comments) <= 2000
    and char_length(description) <= 2000
    and char_length(notes) <= 2000
  )
);

comment on table public.external_logbook_entries is
  'Individual flights entered by a user from a logbook outside the portal. Owners control the record; authorised staff have read-only access.';

create index if not exists external_logbook_entries_user_date_idx
  on public.external_logbook_entries(user_id, flight_date desc);

create or replace function public.touch_external_logbook_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_logbook_baselines_updated_at on public.logbook_baselines;
create trigger touch_logbook_baselines_updated_at
before update on public.logbook_baselines
for each row execute function public.touch_external_logbook_updated_at();

drop trigger if exists touch_external_logbook_entries_updated_at on public.external_logbook_entries;
create trigger touch_external_logbook_entries_updated_at
before update on public.external_logbook_entries
for each row execute function public.touch_external_logbook_updated_at();

alter table public.logbook_baselines enable row level security;
alter table public.external_logbook_entries enable row level security;

create policy "Owners and staff can read logbook baselines"
  on public.logbook_baselines for select to authenticated
  using (user_id = (select auth.uid()) or public.current_user_has_staff_role());

create policy "Owners can create logbook baselines"
  on public.logbook_baselines for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owners can update logbook baselines"
  on public.logbook_baselines for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owners can delete logbook baselines"
  on public.logbook_baselines for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners and staff can read external logbook entries"
  on public.external_logbook_entries for select to authenticated
  using (user_id = (select auth.uid()) or public.current_user_has_staff_role());

create policy "Owners can create external logbook entries"
  on public.external_logbook_entries for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owners can update external logbook entries"
  on public.external_logbook_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Owners can delete external logbook entries"
  on public.external_logbook_entries for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.logbook_baselines to authenticated;
grant select, insert, update, delete on public.external_logbook_entries to authenticated;
grant all on public.logbook_baselines, public.external_logbook_entries to service_role;

revoke all on function public.touch_external_logbook_updated_at()
  from public, anon, authenticated, service_role;

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.touch_external_logbook_updated_at()',
  'touch_external_logbook_updated_at',
  'trigger_internal',
  array[]::text[],
  false,
  true,
  'Invoked only by the external logbook update triggers; client EXECUTE is unnecessary.',
  date '2026-08-19'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();
