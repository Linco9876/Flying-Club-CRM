-- Run only in a NEW disposable PostgreSQL database. Helpers model the existing
-- application dependencies; the migration and private-aircraft logic run unmodified.
\set ON_ERROR_STOP on
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;
create function public.current_user_is_admin() returns boolean language sql as $$ select coalesce(current_setting('test.is_admin',true), 'true')::boolean $$;
create function public.current_user_has_staff_role() returns boolean language sql as $$ select true $$;
create function public.current_user_has_full_portal_access() returns boolean language sql as $$ select true $$;
create function private.assert_function_permission_manifest() returns void language plpgsql as $$ begin return; end $$;
create table private.function_permission_manifest(signature text primary key,function_name text,classification text,allowed_roles text[],security_definer boolean,fixed_search_path boolean,rationale text,reviewed_at date);
create table public.users(id uuid primary key,name text);
create table public.aircraft(id uuid primary key,registration text,make text,model text,type text,status text,total_hours numeric,is_archived boolean default false,maintenance_grounded boolean default false,auto_grounded_until timestamptz,updated_at timestamptz);
create table public.flight_types(id uuid primary key,active boolean default true);
create table public.aircraft_rates(id uuid default gen_random_uuid(),aircraft_id uuid references public.aircraft,flight_type_id uuid references public.flight_types,charge_type text,solo_rate numeric,dual_rate numeric,flat_surcharge numeric,weekend_surcharge numeric,default_payment_method_id uuid,included_taxes numeric,updated_at timestamptz);
create unique index on public.aircraft_rates(aircraft_id,flight_type_id) where flight_type_id is not null;
create table public.bookings(id uuid primary key default gen_random_uuid(),student_id uuid,instructor_id uuid,aircraft_id uuid references public.aircraft,start_time timestamptz,end_time timestamptz,payment_type text,notes text,status text default 'confirmed',booking_kind text,has_conflict boolean default false,deleted_at timestamptz,flight_logged boolean,flight_type_id uuid,trial_flight_voucher_id uuid,is_guest_booking boolean,guest_name text,guest_email text,guest_phone text,recurrence_series_id uuid,recurrence_occurrence_index int,recurrence_occurrence_count int,recurrence_notifications_finalised_at timestamptz,waitlist_reason text,waitlisted_by_defect_id uuid,waitlisted_by_milestone_id uuid,created_at timestamptz default now(),updated_at timestamptz,location_id uuid);
create table public.flight_logs(id uuid primary key default gen_random_uuid(),booking_id uuid references public.bookings,aircraft_id uuid references public.aircraft,instructor_id uuid,student_id uuid,start_time timestamptz,end_time timestamptz,start_tach numeric,end_tach numeric,flight_duration numeric,dual_time numeric,solo_time numeric,financial_capture_suppressed boolean default false,flight_type_id uuid references public.flight_types,calculated_cost numeric,total_cost numeric,payment_status text,xero_invoice_id text,stripe_checkout_session_id text);
create table public.training_records(id uuid primary key default gen_random_uuid(),booking_id uuid,flight_log_id uuid,aircraft_id uuid,aircraft_type text,registration text);
create table public.calendar_settings(conflict_rules text,updated_at timestamptz);
insert into public.calendar_settings values ('block',now());
create function public.instructor_available_at_location_for_slot(uuid,timestamptz,timestamptz,uuid) returns boolean language sql as $$ select true $$;
\ir ../../supabase/migrations/20260909120000_private_aircraft_instruction.sql
create trigger test_conflicts before insert or update on public.bookings for each row execute function public.apply_booking_conflict_policy();
