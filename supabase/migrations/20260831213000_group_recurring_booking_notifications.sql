-- Treat a recurring booking as one notification event while preserving the
-- ordinary per-booking notifications for changes made after creation.

alter table public.bookings
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_occurrence_index integer,
  add column if not exists recurrence_occurrence_count integer,
  add column if not exists recurrence_notifications_finalised_at timestamptz;

alter table public.bookings
  drop constraint if exists bookings_recurrence_occurrence_index_check,
  add constraint bookings_recurrence_occurrence_index_check
    check (recurrence_occurrence_index is null or recurrence_occurrence_index >= 1),
  drop constraint if exists bookings_recurrence_occurrence_count_check,
  add constraint bookings_recurrence_occurrence_count_check
    check (recurrence_occurrence_count is null or recurrence_occurrence_count >= 2),
  drop constraint if exists bookings_recurrence_fields_check,
  add constraint bookings_recurrence_fields_check check (
    (recurrence_series_id is null
      and recurrence_occurrence_index is null
      and recurrence_occurrence_count is null
      and recurrence_notifications_finalised_at is null)
    or
    (recurrence_series_id is not null
      and recurrence_occurrence_index is not null
      and recurrence_occurrence_count is not null
      and recurrence_occurrence_index <= recurrence_occurrence_count)
  );

create index if not exists idx_bookings_recurrence_series
  on public.bookings(recurrence_series_id, recurrence_occurrence_index)
  where recurrence_series_id is not null;

create unique index if not exists idx_notifications_recurring_series_recipient
  on public.notifications(user_id, ((metadata ->> 'recurrence_series_id')))
  where metadata ->> 'notification_kind' = 'recurring_booking_confirmation'
    and metadata ? 'recurrence_series_id';

create or replace function public.apply_notification_delivery_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config public.notification_settings%rowtype;
  preference public.user_preferences%rowtype;
  notification_kind text := coalesce(new.metadata ->> 'notification_kind', '');
  is_maintenance boolean := (
    new.type in ('reminder', 'conflict', 'system')
    and (
      new.metadata ? 'aircraft_id'
      or new.metadata ? 'milestone_id'
      or new.metadata ? 'defect_id'
    )
  );
  booking_series_id uuid;
  booking_series_finalised_at timestamptz;
  booking_created_at timestamptz;
begin
  -- Every notification-producing booking trigger runs while each occurrence
  -- is inserted. Hold those messages until the client finalises the series and
  -- emits one summary. The age guard prevents a partially-created series from
  -- suppressing a genuine edit forever if the browser disappears mid-save.
  if new.booking_id is not null
     and notification_kind <> 'recurring_booking_confirmation' then
    select b.recurrence_series_id,
           b.recurrence_notifications_finalised_at,
           b.created_at
      into booking_series_id, booking_series_finalised_at, booking_created_at
      from public.bookings b
     where b.id = new.booking_id;

    if booking_series_id is not null
       and booking_series_finalised_at is null
       and booking_created_at >= now() - interval '1 hour' then
      return null;
    end if;
  end if;

  -- Protect every notification source from accidental rapid re-insertion.
  -- This also prevents one person who occupies two booking roles from
  -- receiving the same alert twice.
  if exists (
    select 1
      from public.notifications existing
     where existing.user_id = new.user_id
       and existing.type = new.type
       and existing.title = new.title
       and existing.message = new.message
       and existing.booking_id is not distinct from new.booking_id
       and existing.created_at >= now() - interval '5 minutes'
  ) then
    return null;
  end if;

  select * into config
  from public.notification_settings
  order by updated_at desc nulls last
  limit 1;

  if config.id is null then
    return new;
  end if;

  if not config.in_app_notifications_enabled then
    return null;
  end if;

  if notification_kind in ('booking_confirmation', 'recurring_booking_confirmation')
     and not config.booking_confirmation_enabled then return null; end if;
  if notification_kind = 'booking_change' and not config.booking_change_notification_enabled then return null; end if;
  if notification_kind = 'booking_cancellation' and not config.cancellation_notification_enabled then return null; end if;
  if notification_kind = 'booking_waitlist' and not config.waitlist_notification_enabled then return null; end if;

  if new.type in ('booking_approval', 'licence_verification', 'supervision_required')
     and not config.approval_request_notification_enabled then
    return null;
  end if;

  if new.type in ('supervision_assigned', 'supervision_changed')
     and not config.booking_change_notification_enabled then
    return null;
  end if;

  if is_maintenance and not config.maintenance_alert_enabled then
    return null;
  end if;

  if is_maintenance and new.metadata ? 'defect_id' and not config.defect_report_notification_enabled then
    return null;
  end if;

  select * into preference
  from public.user_preferences
  where user_id = new.user_id
  limit 1;

  if is_maintenance and preference.id is not null and not preference.maintenance_alerts then
    return null;
  end if;

  return new;
end;
$$;

create or replace function public.notify_booking_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_kind text;
  event_title text;
  event_message text;
  local_timezone text := 'Australia/Sydney';
  aircraft_registration text;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.status = 'cancelled' then return new; end if;
    event_kind := 'booking_confirmation';
    event_title := case when new.status = 'pending_approval' then 'Booking request received' else 'Booking confirmed' end;
  elsif (old.deleted_at is null and new.deleted_at is not null)
     or (old.status is distinct from 'cancelled' and new.status = 'cancelled') then
    event_kind := 'booking_cancellation';
    event_title := 'Booking cancelled';
  elsif coalesce(old.has_conflict, false) is distinct from coalesce(new.has_conflict, false) then
    event_kind := 'booking_waitlist';
    event_title := case when coalesce(new.has_conflict, false) then 'Booking needs attention' else 'Booking conflict cleared' end;
  elsif old.start_time is distinct from new.start_time
     or old.end_time is distinct from new.end_time
     or old.aircraft_id is distinct from new.aircraft_id
     or old.instructor_id is distinct from new.instructor_id
     or old.status is distinct from new.status then
    event_kind := 'booking_change';
    event_title := 'Booking updated';
  else
    return new;
  end if;

  select coalesce(nullif(timezone, ''), local_timezone)
  into local_timezone
  from public.organisation_settings
  order by updated_at desc nulls last
  limit 1;

  select registration into aircraft_registration
  from public.aircraft
  where id = new.aircraft_id;

  event_message := case event_kind
    when 'booking_cancellation' then
      format('The booking for %s on %s has been cancelled.',
        coalesce(aircraft_registration, 'your session'),
        to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
    when 'booking_waitlist' then
      case when coalesce(new.has_conflict, false) then
        format('The booking for %s on %s has a resource conflict and needs review.',
          coalesce(aircraft_registration, 'your session'),
          to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
      else
        format('The resource conflict for %s on %s has been cleared.',
          coalesce(aircraft_registration, 'your session'),
          to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'))
      end
    else
      format('%s is scheduled for %s to %s.',
        coalesce(aircraft_registration, case when new.booking_kind = 'ground' then 'Your ground session' else 'Your booking' end),
        to_char(new.start_time at time zone local_timezone, 'DD Mon YYYY HH24:MI'),
        to_char(new.end_time at time zone local_timezone, 'HH24:MI'))
  end;

  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
    select distinct recipient_id,
      'booking',
      event_title,
      event_message,
      new.id,
      jsonb_build_object(
        'notification_kind', event_kind,
        'booking_id', new.id,
        'route', '/calendar'
      ),
      false
    from (
      values (new.student_id), (new.instructor_id)
    ) recipients(recipient_id)
    where recipient_id is not null;
  else
    insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
    select recipient_id,
      'booking',
      event_title,
      event_message,
      new.id,
      jsonb_build_object(
        'notification_kind', event_kind,
        'booking_id', new.id,
        'route', '/calendar'
      ),
      false
    from (
      select new.student_id as recipient_id
      union select new.instructor_id
      union select old.student_id
      union select old.instructor_id
    ) recipients
    where recipient_id is not null;
  end if;

  return new;
end;
$$;

create or replace function public.finalise_recurring_booking_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  local_timezone text := 'Australia/Sydney';
  occurrence_count integer;
  pending_approval_count integer;
  pending_supervision_count integer;
  first_booking_id uuid;
  first_start timestamptz;
  last_start timestamptz;
  summary_message text;
  already_finalised boolean;
  expected_occurrence_count integer;
  distinct_occurrence_indexes integer;
begin
  if p_series_id is null then
    raise exception 'A recurrence series id is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_series_id::text, 0));

  select count(*)::integer,
         count(*) filter (where b.status = 'pending_approval')::integer,
         count(*) filter (where b.status = 'pending_supervision')::integer,
         (array_agg(b.id order by b.start_time))[1],
         min(b.start_time),
         max(b.start_time),
         bool_and(b.recurrence_notifications_finalised_at is not null),
         max(b.recurrence_occurrence_count),
         count(distinct b.recurrence_occurrence_index)::integer
    into occurrence_count,
         pending_approval_count,
         pending_supervision_count,
         first_booking_id,
         first_start,
         last_start,
         already_finalised,
         expected_occurrence_count,
         distinct_occurrence_indexes
    from public.bookings b
   where b.recurrence_series_id = p_series_id
     and b.deleted_at is null
     and b.status <> 'cancelled';

  if occurrence_count < 2
     or expected_occurrence_count is null
     or occurrence_count <> expected_occurrence_count
     or distinct_occurrence_indexes <> expected_occurrence_count then
    raise exception 'The recurring booking series is incomplete' using errcode = '22023';
  end if;

  if actor_id is null and auth.role() <> 'service_role' then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if auth.role() <> 'service_role'
     and not exists (
       select 1 from public.bookings b
        where b.recurrence_series_id = p_series_id
          and actor_id in (b.student_id, b.instructor_id)
     )
     and not exists (
       select 1 from public.user_roles ur
        where ur.user_id = actor_id
          and ur.role = any(array['admin', 'cfi', 'instructor', 'senior_instructor'])
     )
     and not exists (
       select 1 from public.users u
        where u.id = actor_id
          and u.role = any(array['admin', 'cfi', 'instructor', 'senior_instructor'])
     ) then
    raise exception 'You cannot finalise notifications for this booking series' using errcode = '42501';
  end if;

  if already_finalised then
    return jsonb_build_object(
      'seriesId', p_series_id,
      'occurrenceCount', occurrence_count,
      'alreadyFinalised', true
    );
  end if;

  select coalesce(nullif(timezone, ''), local_timezone)
    into local_timezone
    from public.organisation_settings
   order by updated_at desc nulls last
   limit 1;

  summary_message := format(
    '%s recurring bookings were created from %s to %s.',
    occurrence_count,
    to_char(first_start at time zone local_timezone, 'DD Mon YYYY HH24:MI'),
    to_char(last_start at time zone local_timezone, 'DD Mon YYYY HH24:MI')
  );

  if pending_approval_count > 0 then
    summary_message := summary_message || format(' %s require approval.', pending_approval_count);
  end if;
  if pending_supervision_count > 0 then
    summary_message := summary_message || format(' %s require supervision.', pending_supervision_count);
  end if;

  update public.bookings
     set recurrence_notifications_finalised_at = now()
   where recurrence_series_id = p_series_id
     and recurrence_notifications_finalised_at is null;

  with series_bookings as materialized (
    select b.*
      from public.bookings b
     where b.recurrence_series_id = p_series_id
       and b.deleted_at is null
       and b.status <> 'cancelled'
  ), recipients as (
    select b.student_id as user_id from series_bookings b
    union
    select b.instructor_id from series_bookings b
    union
    select b.supervising_instructor_id from series_bookings b
    union
    select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (select 1 from series_bookings b where b.status = 'pending_approval')
       and (
         u.role = 'admin'
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role = 'admin')
       )
    union
    select u.id
      from public.users u
     where coalesce(u.is_active, true)
       and exists (select 1 from series_bookings b where b.status = 'pending_supervision')
       and (
         u.role = 'admin'
         or exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role in ('admin', 'cfi'))
         or exists (
           select 1 from public.senior_instructor_authorisations authorisation
            where authorisation.instructor_id = u.id
              and authorisation.is_active
         )
       )
  )
  insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
  select recipient.user_id,
         'booking',
         'Recurring booking series created',
         summary_message,
         first_booking_id,
         jsonb_build_object(
           'notification_kind', 'recurring_booking_confirmation',
           'recurrence_series_id', p_series_id::text,
           'occurrence_count', occurrence_count,
           'booking_id', first_booking_id::text,
           'route', '/calendar'
         ),
         false
    from recipients recipient
   where recipient.user_id is not null
  on conflict do nothing;

  return jsonb_build_object(
    'seriesId', p_series_id,
    'occurrenceCount', occurrence_count,
    'alreadyFinalised', false
  );
end;
$$;

create or replace function public.auto_finalise_recurring_booking_series()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- This trigger is deliberately named with a zz_ prefix so it runs after the
  -- existing notification-producing AFTER INSERT triggers. Their per-booking
  -- messages are suppressed while the series remains unfinalised.
  if new.recurrence_series_id is not null
     and new.recurrence_occurrence_index = new.recurrence_occurrence_count then
    perform public.finalise_recurring_booking_series(new.recurrence_series_id);
  end if;
  return new;
end;
$$;

drop trigger if exists zz_auto_finalise_recurring_booking_series_trigger on public.bookings;
create trigger zz_auto_finalise_recurring_booking_series_trigger
after insert on public.bookings
for each row execute function public.auto_finalise_recurring_booking_series();

revoke all on function public.finalise_recurring_booking_series(uuid) from public, anon;
grant execute on function public.finalise_recurring_booking_series(uuid) to authenticated, service_role;
revoke all on function public.auto_finalise_recurring_booking_series() from public, anon, authenticated, service_role;

comment on column public.bookings.recurrence_series_id is
  'Client-generated id shared by all bookings created in one recurrence operation.';
comment on column public.bookings.recurrence_notifications_finalised_at is
  'Set only after the complete series has been saved and its single summary notification has been created.';
comment on function public.finalise_recurring_booking_series(uuid) is
  'Idempotently finalises a recurring booking series and emits one summary per affected user.';
comment on function public.apply_notification_delivery_policy() is
  'Enforces notification settings, groups recurring booking creation, and suppresses rapid duplicate inserts.';

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values
(
  'public.finalise_recurring_booking_series(p_series_id uuid)',
  'finalise_recurring_booking_series',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Finalises only a recurrence series owned by the caller or managed by authorised staff.',
  date '2026-08-31'
),
(
  'public.auto_finalise_recurring_booking_series()',
  'auto_finalise_recurring_booking_series',
  'trigger_internal',
  array[]::text[],
  true,
  true,
  'Automatically finalises a complete recurring series after its last occurrence is inserted.',
  date '2026-08-31'
)
on conflict(signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

-- Collapse any very recent booking-confirmation burst that predates the new
-- recurrence metadata. This targets bulk bursts only (at least five distinct
-- bookings and ten notifications in one minute), leaving normal alerts alone.
do $$
declare
  burst record;
  burst_first_booking uuid;
  burst_first_start timestamptz;
  burst_last_start timestamptz;
  burst_occurrences integer;
  local_timezone text := 'Australia/Sydney';
begin
  select coalesce(nullif(timezone, ''), local_timezone)
    into local_timezone
    from public.organisation_settings
   order by updated_at desc nulls last
   limit 1;

  for burst in
    select n.user_id,
           date_trunc('minute', n.created_at) as burst_minute,
           array_agg(n.id) as notification_ids
      from public.notifications n
     where n.created_at >= now() - interval '24 hours'
       and n.type = 'booking'
       and n.metadata ->> 'notification_kind' = 'booking_confirmation'
       and n.booking_id is not null
     group by n.user_id, date_trunc('minute', n.created_at)
    having count(*) >= 10
       and count(distinct n.booking_id) >= 5
  loop
    select (array_agg(b.id order by b.start_time))[1],
           min(b.start_time),
           max(b.start_time),
           count(distinct b.id)::integer
      into burst_first_booking,
           burst_first_start,
           burst_last_start,
           burst_occurrences
      from public.bookings b
      join public.notifications n on n.booking_id = b.id
     where n.id = any(burst.notification_ids);

    delete from public.notifications
     where id = any(burst.notification_ids);

    if burst_occurrences >= 2 then
      insert into public.notifications(user_id, type, title, message, booking_id, metadata, is_read)
      values (
        burst.user_id,
        'booking',
        'Recurring booking series created',
        format(
          '%s recurring bookings were created from %s to %s.',
          burst_occurrences,
          to_char(burst_first_start at time zone local_timezone, 'DD Mon YYYY HH24:MI'),
          to_char(burst_last_start at time zone local_timezone, 'DD Mon YYYY HH24:MI')
        ),
        burst_first_booking,
        jsonb_build_object(
          'notification_kind', 'recurring_booking_confirmation',
          'occurrence_count', burst_occurrences,
          'booking_id', burst_first_booking::text,
          'route', '/calendar',
          'suppress_push', true,
          'collapsed_legacy_burst', true
        ),
        false
      );
    end if;
  end loop;
end;
$$;

select private.assert_function_permission_manifest();
