-- Private, revocable calendar subscriptions and stable links for booking emails.
-- External calendars are read-only mirrors. The CRM remains the source of truth.

create table if not exists public.calendar_feed_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  feed_key uuid not null default gen_random_uuid() unique,
  enabled boolean not null default true,
  include_pending boolean not null default true,
  include_supervision boolean not null default true,
  include_duty boolean not null default false,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.calendar_feed_settings is
  'User-owned, read-only calendar subscriptions. feed_key is a bearer secret and may be rotated.';
comment on column public.calendar_feed_settings.feed_key is
  'Bearer secret used by calendar clients that cannot send a Supabase session token.';

create table if not exists public.booking_calendar_links (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.booking_calendar_links is
  'Opaque links for one booking, used in guest and trial-flight confirmation emails.';

create or replace function public.touch_calendar_integration_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_calendar_feed_settings_updated_at on public.calendar_feed_settings;
create trigger touch_calendar_feed_settings_updated_at
before update on public.calendar_feed_settings
for each row execute function public.touch_calendar_integration_updated_at();

drop trigger if exists touch_booking_calendar_links_updated_at on public.booking_calendar_links;
create trigger touch_booking_calendar_links_updated_at
before update on public.booking_calendar_links
for each row execute function public.touch_calendar_integration_updated_at();

alter table public.calendar_feed_settings enable row level security;
alter table public.booking_calendar_links enable row level security;

drop policy if exists "Users read own calendar feed" on public.calendar_feed_settings;
create policy "Users read own calendar feed"
on public.calendar_feed_settings for select to authenticated
using (user_id = auth.uid() and public.current_user_has_full_portal_access());

drop policy if exists "Users create own calendar feed" on public.calendar_feed_settings;
create policy "Users create own calendar feed"
on public.calendar_feed_settings for insert to authenticated
with check (user_id = auth.uid() and public.current_user_has_full_portal_access());

drop policy if exists "Users update own calendar feed" on public.calendar_feed_settings;
create policy "Users update own calendar feed"
on public.calendar_feed_settings for update to authenticated
using (user_id = auth.uid() and public.current_user_has_full_portal_access())
with check (user_id = auth.uid() and public.current_user_has_full_portal_access());

grant select, insert, update on public.calendar_feed_settings to authenticated;

-- No anon/authenticated policy is intentionally created for booking_calendar_links.
-- Only service-role Edge Functions can exchange an opaque token for booking details.
revoke all on public.booking_calendar_links from anon, authenticated;

create index if not exists calendar_feed_settings_enabled_key_idx
  on public.calendar_feed_settings(feed_key) where enabled;
create index if not exists booking_calendar_links_active_token_idx
  on public.booking_calendar_links(token) where revoked_at is null;
