-- Maintenance safety and integrity hardening.
-- Serious defects and overdue maintenance remain fail-safe until explicitly resolved.

alter table public.defects
  add column if not exists summary text,
  add column if not exists reported_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists grounding_source text;

alter table public.defects
  drop constraint if exists defects_grounding_source_check;
alter table public.defects
  add constraint defects_grounding_source_check
  check (grounding_source is null or grounding_source in ('manual', 'automatic'));

alter table public.maintenance_completions
  add column if not exists operation_id uuid,
  add column if not exists created_at timestamptz not null default now();

create unique index if not exists maintenance_completions_operation_id_key
  on public.maintenance_completions(operation_id)
  where operation_id is not null;
create unique index if not exists maintenance_completions_business_idempotency_key
  on public.maintenance_completions(milestone_id, completed_date, completed_tach)
  where milestone_id is not null and completed_date is not null and completed_tach is not null;
create unique index if not exists maintenance_settings_singleton_key
  on public.maintenance_settings ((true));
create unique index if not exists maintenance_template_name_casefold_key
  on public.maintenance_milestone_templates (lower(btrim(name)));
create unique index if not exists maintenance_milestone_aircraft_title_casefold_key
  on public.maintenance_milestones (aircraft_id, lower(btrim(title)));

alter table public.maintenance_milestones
  drop constraint if exists maintenance_milestones_due_condition_check;
alter table public.maintenance_milestones
  add constraint maintenance_milestones_due_condition_check
  check (due_condition in ('hours', 'date', 'both'));

alter table public.maintenance_milestones
  drop constraint if exists maintenance_milestones_type_check;
alter table public.maintenance_milestones
  add constraint maintenance_milestones_type_check
  check (type in ('hours', 'calendar', 'both'));

alter table public.maintenance_milestone_templates
  drop constraint if exists maintenance_milestone_templates_type_check;
alter table public.maintenance_milestone_templates
  add constraint maintenance_milestone_templates_type_check
  check (type in ('hours', 'calendar', 'both'));

alter table public.maintenance_completions
  drop constraint if exists maintenance_completions_milestone_id_fkey;
alter table public.maintenance_completions
  add constraint maintenance_completions_milestone_id_fkey
  foreign key (milestone_id) references public.maintenance_milestones(id) on delete restrict;

alter table public.aircraft
  add column if not exists maintenance_grounded boolean not null default false,
  add column if not exists maintenance_grounded_milestone_id uuid
    references public.maintenance_milestones(id) on delete set null;

alter table public.bookings
  add column if not exists waitlisted_by_milestone_id uuid
    references public.maintenance_milestones(id) on delete set null;

alter table public.maintenance_audit_log
  add column if not exists defect_id uuid references public.defects(id) on delete set null,
  add column if not exists milestone_id uuid references public.maintenance_milestones(id) on delete set null,
  add column if not exists completion_id uuid references public.maintenance_completions(id) on delete set null;

create table if not exists public.maintenance_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.maintenance_milestones(id) on delete cascade,
  alert_level text not null check (alert_level in ('upcoming', 'urgent', 'overdue')),
  snapshot_key text not null,
  sent_at timestamptz not null default now(),
  unique (milestone_id, alert_level, snapshot_key)
);

alter table public.maintenance_alert_deliveries enable row level security;
drop policy if exists "Admins can read maintenance alert deliveries" on public.maintenance_alert_deliveries;
create policy "Admins can read maintenance alert deliveries"
  on public.maintenance_alert_deliveries for select to authenticated
  using (public.current_user_is_admin());

create index if not exists idx_defects_aircraft_active_grounding
  on public.defects(aircraft_id, status, grounded_aircraft);
create index if not exists idx_maintenance_milestones_aircraft_status
  on public.maintenance_milestones(aircraft_id, status);
create index if not exists idx_bookings_waitlisted_milestone
  on public.bookings(waitlisted_by_milestone_id, start_time)
  where waitlisted_by_milestone_id is not null;
create index if not exists idx_maintenance_audit_aircraft_created
  on public.maintenance_audit_log(aircraft_id, created_at desc);
create index if not exists idx_maintenance_alert_deliveries_sent
  on public.maintenance_alert_deliveries(sent_at desc);

comment on column public.aircraft.auto_grounded_until is
  'Next staff review reminder for an active grounding. Expiry never returns an unresolved aircraft to service.';
comment on column public.defects.grounding_source is
  'Whether grounding was requested by the reporter or automatically applied by a maintenance safety rule.';

-- Replace legacy single-role policies with the multi-role helpers and enforce
-- the existing staff AAL2 boundary on maintenance writes.
drop policy if exists "Admins and instructors can update defects" on public.defects;
create policy "Staff can update defects"
  on public.defects for update to authenticated
  using (public.current_user_has_staff_role() and public.staff_session_has_required_assurance())
  with check (public.current_user_has_staff_role() and public.staff_session_has_required_assurance());

drop policy if exists "Admins can delete defects" on public.defects;
create policy "Admins can delete defects"
  on public.defects for delete to authenticated
  using (public.current_user_is_admin());

drop policy if exists "Admins and instructors can insert defect_history" on public.defect_history;
drop policy if exists "Full portal users can read defect history" on public.defect_history;
create policy "Staff can read defect history"
  on public.defect_history for select to authenticated
  using (public.current_user_has_staff_role() and public.staff_session_has_required_assurance());

drop policy if exists "Admins and instructors can insert maintenance_completions" on public.maintenance_completions;
drop policy if exists "Admins and instructors can update maintenance_completions" on public.maintenance_completions;
create policy "Admins can insert maintenance completions"
  on public.maintenance_completions for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update maintenance completions"
  on public.maintenance_completions for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can insert maintenance milestones" on public.maintenance_milestones;
drop policy if exists "Admins can update maintenance milestones" on public.maintenance_milestones;
drop policy if exists "Admins can delete maintenance milestones" on public.maintenance_milestones;
create policy "Admins can insert maintenance milestones"
  on public.maintenance_milestones for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update maintenance milestones"
  on public.maintenance_milestones for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
create policy "Admins can delete maintenance milestones"
  on public.maintenance_milestones for delete to authenticated
  using (public.current_user_is_admin());

drop policy if exists "Admins can insert maintenance_milestone_templates" on public.maintenance_milestone_templates;
drop policy if exists "Admins can update maintenance_milestone_templates" on public.maintenance_milestone_templates;
drop policy if exists "Admins can delete maintenance_milestone_templates" on public.maintenance_milestone_templates;
create policy "Admins can insert maintenance templates"
  on public.maintenance_milestone_templates for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update maintenance templates"
  on public.maintenance_milestone_templates for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
create policy "Admins can delete maintenance templates"
  on public.maintenance_milestone_templates for delete to authenticated
  using (public.current_user_is_admin());

drop policy if exists "Admins can insert maintenance_settings" on public.maintenance_settings;
drop policy if exists "Admins can update maintenance_settings" on public.maintenance_settings;
create policy "Admins can insert maintenance settings"
  on public.maintenance_settings for insert to authenticated
  with check (public.current_user_is_admin());
create policy "Admins can update maintenance settings"
  on public.maintenance_settings for update to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

alter table public.maintenance_audit_log enable row level security;
drop policy if exists "Staff can read maintenance audit log" on public.maintenance_audit_log;
create policy "Staff can read maintenance audit log"
  on public.maintenance_audit_log for select to authenticated
  using (public.current_user_has_staff_role() and public.staff_session_has_required_assurance());

drop policy if exists "Defect uploaders can delete own attachments" on storage.objects;
create policy "Defect uploaders can delete own attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'defect-attachments'
    and (
      owner_id = (select auth.uid())::text
      or public.current_user_has_staff_role()
    )
  );

create or replace function public.prepare_defect_write()
returns trigger
language plpgsql
security definer
set search_path = public, storage, auth
as $$
declare
  v_reporter_name text;
  v_auto_ground boolean := true;
  v_require_photo boolean := false;
  v_require_approval boolean := true;
  v_manual_grounding boolean := false;
  v_photo text;
begin
  select
    coalesce((settings ->> 'autoGroundOnMajorDefect')::boolean, true),
    coalesce((settings ->> 'defectPhotoRequired')::boolean, false),
    coalesce((settings ->> 'requireMaintenanceApproval')::boolean, true)
  into v_auto_ground, v_require_photo, v_require_approval
  from public.maintenance_settings
  order by updated_at desc nulls last
  limit 1;

  v_auto_ground := coalesce(v_auto_ground, true);
  v_require_photo := coalesce(v_require_photo, false);
  v_require_approval := coalesce(v_require_approval, true);

  if tg_op = 'INSERT' then
    new.summary := nullif(btrim(coalesce(new.summary, '')), '');
    new.description := btrim(coalesce(new.description, ''));
    new.location := nullif(btrim(coalesce(new.location, '')), '');
    new.mel_notes := nullif(btrim(coalesce(new.mel_notes, '')), '');
    new.fix_notes := nullif(btrim(coalesce(new.fix_notes, '')), '');
    new.status := 'open';
    new.updated_at := now();
    v_manual_grounding := coalesce(new.grounded_aircraft, false);

    if auth.uid() is not null and auth.role() <> 'service_role' then
      select nullif(btrim(name), '') into v_reporter_name
      from public.users where id = auth.uid();
      new.reported_by_user_id := auth.uid();
      new.reported_by := coalesce(v_reporter_name, 'Portal user');
      new.updated_by := auth.uid();
    end if;
  else
    new.aircraft_id := old.aircraft_id;
    new.reported_by := old.reported_by;
    new.reported_by_user_id := old.reported_by_user_id;
    new.date_reported := old.date_reported;
    new.photos := old.photos;
    new.summary := nullif(btrim(coalesce(new.summary, '')), '');
    new.description := btrim(coalesce(new.description, ''));
    new.location := nullif(btrim(coalesce(new.location, '')), '');
    new.mel_notes := nullif(btrim(coalesce(new.mel_notes, '')), '');
    new.fix_notes := nullif(btrim(coalesce(new.fix_notes, '')), '');
    new.updated_at := now();
    if auth.uid() is not null and auth.role() <> 'service_role' then
      new.updated_by := auth.uid();
    end if;
    v_manual_grounding := old.grounding_source = 'manual' and old.status = 'open';
  end if;

  if new.description = '' then
    raise exception 'A detailed defect description is required';
  end if;
  if new.summary is null then
    new.summary := left(new.description, 120);
  end if;
  if new.severity is null then
    raise exception 'Defect severity is required';
  end if;
  if new.date_reported > now() + interval '5 minutes' then
    raise exception 'The defect discovery time cannot be in the future';
  end if;
  if coalesce(new.tach_hours, 0) < 0 or coalesce(new.hobbs_hours, 0) < 0 then
    raise exception 'Aircraft hours cannot be negative';
  end if;
  if cardinality(coalesce(new.photos, array[]::text[])) > 10 then
    raise exception 'A defect report can have at most 10 attachments';
  end if;
  if v_require_photo and cardinality(coalesce(new.photos, array[]::text[])) = 0 then
    raise exception 'At least one attachment is required for defect reports';
  end if;

  foreach v_photo in array coalesce(new.photos, array[]::text[])
  loop
    if v_photo not like (new.aircraft_id::text || '/%') then
      raise exception 'Defect attachment path does not match the selected aircraft';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'defect-attachments' and name = v_photo
    ) then
      raise exception 'Defect attachment was not found in secure storage';
    end if;
  end loop;

  if new.status = 'fixed' then
    if new.fix_notes is null then
      raise exception 'Fix notes are required before a defect can be marked fixed';
    end if;
    if tg_op = 'UPDATE'
      and old.status is distinct from 'fixed'
      and v_require_approval
      and auth.role() <> 'service_role'
      and not public.current_user_is_admin() then
      raise exception 'Administrator approval is required to return this aircraft to service';
    end if;
  end if;

  if new.status in ('mel', 'deferred') and new.mel_notes is null then
    raise exception 'Operational limitations or a deferral reason are required';
  end if;

  if new.status <> 'open' then
    new.grounded_aircraft := false;
    new.grounding_source := null;
  elsif v_manual_grounding then
    new.grounded_aircraft := true;
    new.grounding_source := 'manual';
  elsif v_auto_ground and new.severity in ('Major', 'Critical') then
    new.grounded_aircraft := true;
    new.grounding_source := 'automatic';
  else
    new.grounded_aircraft := false;
    new.grounding_source := null;
  end if;

  return new;
end;
$$;

create or replace function public.audit_defect_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    if old.summary is distinct from new.summary then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'summary', old.summary, new.summary);
    end if;
    if old.description is distinct from new.description then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'description', old.description, new.description);
    end if;
    if old.severity is distinct from new.severity then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'severity', old.severity, new.severity);
    end if;
    if old.status is distinct from new.status then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'status', old.status, new.status);
    end if;
    if old.location is distinct from new.location then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'location', old.location, new.location);
    end if;
    if old.tach_hours is distinct from new.tach_hours then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'tach_hours', old.tach_hours::text, new.tach_hours::text);
    end if;
    if old.hobbs_hours is distinct from new.hobbs_hours then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'hobbs_hours', old.hobbs_hours::text, new.hobbs_hours::text);
    end if;
    if old.mel_notes is distinct from new.mel_notes then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'mel_notes', old.mel_notes, new.mel_notes);
    end if;
    if old.fix_notes is distinct from new.fix_notes then
      insert into public.defect_history(defect_id, changed_by, field_name, old_value, new_value)
      values (new.id, v_actor, 'fix_notes', old.fix_notes, new.fix_notes);
    end if;
  end if;

  insert into public.maintenance_audit_log(
    aircraft_id, defect_id, action, performed_by, details
  ) values (
    coalesce(new.aircraft_id, old.aircraft_id),
    case when tg_op = 'DELETE' then null else new.id end,
    'defect_' || lower(tg_op),
    v_actor,
    jsonb_build_object(
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.reconcile_aircraft_maintenance_status(
  p_aircraft_id uuid,
  p_cause text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_defect_id uuid;
  v_milestone_id uuid;
  v_duration_hours numeric := 24;
  v_auto_ground_overdue boolean := true;
  v_was_grounded boolean := false;
  v_is_grounded boolean := false;
  v_registration text;
  v_reason text;
begin
  if p_aircraft_id is null then return; end if;

  select
    greatest(1, coalesce((settings ->> 'autoGroundDurationHours')::numeric, 24)),
    coalesce((settings ->> 'autoGroundOnOverdueMaintenance')::boolean, true)
  into v_duration_hours, v_auto_ground_overdue
  from public.maintenance_settings
  order by updated_at desc nulls last
  limit 1;
  v_duration_hours := coalesce(v_duration_hours, 24);
  v_auto_ground_overdue := coalesce(v_auto_ground_overdue, true);

  select id into v_defect_id
  from public.defects
  where aircraft_id = p_aircraft_id
    and status = 'open'
    and coalesce(grounded_aircraft, false)
  order by
    case severity when 'Critical' then 0 when 'Major' then 1 else 2 end,
    date_reported
  limit 1;

  if v_auto_ground_overdue then
    select id into v_milestone_id
    from public.maintenance_milestones
    where aircraft_id = p_aircraft_id
      and status = 'overdue'
    order by coalesce(next_due_date, 'infinity'::date), coalesce(next_due_hours, 1e12)
    limit 1;
  end if;

  v_is_grounded := v_defect_id is not null or v_milestone_id is not null;

  select
    auto_grounded_by_defect_id is not null or coalesce(maintenance_grounded, false),
    registration
  into v_was_grounded, v_registration
  from public.aircraft
  where id = p_aircraft_id
  for update;

  if not found then return; end if;

  if v_is_grounded then
    update public.aircraft
    set status_before_auto_grounding = case
          when auto_grounded_by_defect_id is null
            and not coalesce(maintenance_grounded, false)
            and status_before_auto_grounding is null
          then status
          else status_before_auto_grounding
        end,
        status = 'unserviceable',
        auto_grounded_until = case
          when auto_grounded_until is null or auto_grounded_until <= now()
          then now() + make_interval(secs => (v_duration_hours * 3600)::integer)
          else auto_grounded_until
        end,
        auto_grounded_by_defect_id = v_defect_id,
        maintenance_grounded = v_milestone_id is not null,
        maintenance_grounded_milestone_id = v_milestone_id,
        updated_at = now()
    where id = p_aircraft_id;

    v_reason := case
      when v_defect_id is not null then 'aircraft_grounding'
      else 'maintenance_grounding'
    end;

    update public.bookings
    set has_conflict = true,
        waitlist_reason = v_reason,
        waitlisted_by_defect_id = v_defect_id,
        waitlisted_by_milestone_id = v_milestone_id,
        updated_at = now()
    where aircraft_id = p_aircraft_id
      and deleted_at is null
      and status in ('confirmed', 'pending_approval')
      and end_time > now();

    if not v_was_grounded then
      insert into public.notifications(user_id, type, title, message, metadata)
      select admin_id, 'conflict', 'Aircraft grounded',
        coalesce(v_registration, 'Aircraft') ||
          case
            when v_defect_id is not null then ' is unavailable because of an active grounding defect.'
            else ' is unavailable because a maintenance deadline is overdue.'
          end,
        jsonb_build_object(
          'aircraft_id', p_aircraft_id,
          'defect_id', v_defect_id,
          'milestone_id', v_milestone_id,
          'cause', p_cause,
          'route', '/maintenance'
        )
      from (
        select id as admin_id from public.users where role = 'admin'
        union
        select user_id from public.user_roles where role = 'admin'
      ) admins;
    end if;
  elsif v_was_grounded then
    update public.aircraft
    set status = coalesce(nullif(status_before_auto_grounding, ''), 'serviceable'),
        auto_grounded_until = null,
        auto_grounded_by_defect_id = null,
        maintenance_grounded = false,
        maintenance_grounded_milestone_id = null,
        status_before_auto_grounding = null,
        updated_at = now()
    where id = p_aircraft_id;

    update public.bookings candidate
    set has_conflict = exists (
          select 1
          from public.bookings confirmed
          where confirmed.id <> candidate.id
            and confirmed.deleted_at is null
            and confirmed.status = 'confirmed'
            and confirmed.start_time < candidate.end_time
            and confirmed.end_time > candidate.start_time
            and (
              confirmed.aircraft_id = candidate.aircraft_id
              or (
                candidate.instructor_id is not null
                and confirmed.instructor_id = candidate.instructor_id
              )
            )
        ),
        waitlist_reason = case when exists (
          select 1
          from public.bookings confirmed
          where confirmed.id <> candidate.id
            and confirmed.deleted_at is null
            and confirmed.status = 'confirmed'
            and confirmed.start_time < candidate.end_time
            and confirmed.end_time > candidate.start_time
            and (
              confirmed.aircraft_id = candidate.aircraft_id
              or (
                candidate.instructor_id is not null
                and confirmed.instructor_id = candidate.instructor_id
              )
            )
        ) then 'resource_conflict' else null end,
        waitlisted_by_defect_id = null,
        waitlisted_by_milestone_id = null,
        updated_at = now()
    where candidate.aircraft_id = p_aircraft_id
      and (
        candidate.waitlist_reason in ('aircraft_grounding', 'maintenance_grounding')
        or candidate.waitlisted_by_defect_id is not null
        or candidate.waitlisted_by_milestone_id is not null
      );

    insert into public.notifications(user_id, type, title, message, metadata)
    select admin_id, 'system', 'Aircraft grounding cleared',
      coalesce(v_registration, 'Aircraft') ||
        ' has no active grounding defects or overdue maintenance deadlines. Affected bookings were rechecked for conflicts.',
      jsonb_build_object('aircraft_id', p_aircraft_id, 'cause', p_cause, 'route', '/maintenance')
    from (
      select id as admin_id from public.users where role = 'admin'
      union
      select user_id from public.user_roles where role = 'admin'
    ) admins;
  end if;
end;
$$;

create or replace function public.prepare_maintenance_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := btrim(coalesce(nullif(new.name, ''), new.title));
  new.title := new.name;
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.type := coalesce(new.type, 'hours');
  new.due_condition := case new.type when 'calendar' then 'date' else new.type end;
  new.updated_at := now();

  if new.name = '' then
    raise exception 'Maintenance template name is required';
  end if;
  if new.type not in ('hours', 'calendar', 'both') then
    raise exception 'Unsupported maintenance template type';
  end if;
  if new.type in ('hours', 'both') and coalesce(new.interval_hours, 0) <= 0 then
    raise exception 'Hours-based templates need an interval greater than zero';
  end if;
  if new.type in ('calendar', 'both') and coalesce(new.interval_months, 0) <= 0 then
    raise exception 'Calendar-based templates need an interval greater than zero';
  end if;
  new.due_value := case
    when new.type = 'calendar' then new.interval_months::text
    when new.type = 'both' then concat_ws(' / ', new.interval_hours::text, new.interval_months::text)
    else new.interval_hours::text
  end;
  return new;
end;
$$;

create or replace function public.prepare_maintenance_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_urgent_hours numeric;
  v_upcoming_hours numeric;
  v_urgent_days integer;
  v_upcoming_days integer;
  v_review_hours numeric;
begin
  new.settings := coalesce(new.settings, '{}'::jsonb);
  v_urgent_hours := coalesce((new.settings ->> 'urgentReminderHours')::numeric, 10);
  v_upcoming_hours := coalesce((new.settings ->> 'upcomingReminderHours')::numeric, 25);
  v_urgent_days := coalesce((new.settings ->> 'urgentReminderDays')::integer, 7);
  v_upcoming_days := coalesce((new.settings ->> 'upcomingReminderDays')::integer, 30);
  v_review_hours := coalesce((new.settings ->> 'autoGroundDurationHours')::numeric, 24);

  if least(v_urgent_hours, v_upcoming_hours, v_urgent_days, v_upcoming_days) < 0 then
    raise exception 'Maintenance warning thresholds cannot be negative';
  end if;
  if v_upcoming_hours < v_urgent_hours or v_upcoming_days < v_urgent_days then
    raise exception 'Upcoming maintenance thresholds must not be below urgent thresholds';
  end if;
  if v_review_hours < 1 or v_review_hours > 336 then
    raise exception 'Grounding review reminders must be between 1 and 336 hours';
  end if;
  if coalesce(new.settings ->> 'defaultDefectFilter', 'open')
    not in ('all', 'open', 'mel', 'fixed', 'deferred') then
    raise exception 'Unsupported default defect filter';
  end if;

  new.settings := new.settings || jsonb_build_object(
    'autoGroundOnMajorDefect', coalesce((new.settings ->> 'autoGroundOnMajorDefect')::boolean, true),
    'autoGroundOnOverdueMaintenance', coalesce((new.settings ->> 'autoGroundOnOverdueMaintenance')::boolean, true),
    'requireMaintenanceApproval', coalesce((new.settings ->> 'requireMaintenanceApproval')::boolean, true),
    'defectPhotoRequired', coalesce((new.settings ->> 'defectPhotoRequired')::boolean, false),
    'urgentReminderHours', v_urgent_hours,
    'upcomingReminderHours', v_upcoming_hours,
    'urgentReminderDays', v_urgent_days,
    'upcomingReminderDays', v_upcoming_days,
    'autoGroundDurationHours', v_review_hours,
    'defaultDefectFilter', coalesce(new.settings ->> 'defaultDefectFilter', 'open')
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prepare_maintenance_template_trigger on public.maintenance_milestone_templates;
create trigger prepare_maintenance_template_trigger
before insert or update on public.maintenance_milestone_templates
for each row execute function public.prepare_maintenance_template();

drop trigger if exists prepare_maintenance_settings_trigger on public.maintenance_settings;
create trigger prepare_maintenance_settings_trigger
before insert or update on public.maintenance_settings
for each row execute function public.prepare_maintenance_settings();

create or replace function public.handle_aircraft_grounding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reconcile_aircraft_maintenance_status(old.aircraft_id, 'defect_deleted');
    return old;
  end if;
  perform public.reconcile_aircraft_maintenance_status(new.aircraft_id, 'defect_' || lower(tg_op));
  return new;
end;
$$;

create or replace function public.enforce_aircraft_maintenance_serviceability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_registration text;
begin
  if new.deleted_at is not null
    or new.status in ('cancelled', 'completed', 'no-show')
    or new.aircraft_id is null then
    return new;
  end if;

  select status, registration into v_status, v_registration
  from public.aircraft
  where id = new.aircraft_id;

  if v_status is distinct from 'serviceable' then
    raise exception '% is not serviceable and cannot be booked', coalesce(v_registration, 'Selected aircraft')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_defect_write_trigger on public.defects;
create trigger prepare_defect_write_trigger
before insert or update on public.defects
for each row execute function public.prepare_defect_write();

drop trigger if exists trigger_aircraft_grounding on public.defects;
create trigger trigger_aircraft_grounding
after insert or update or delete on public.defects
for each row execute function public.handle_aircraft_grounding();

drop trigger if exists audit_defect_change_trigger on public.defects;
create trigger audit_defect_change_trigger
after insert or update or delete on public.defects
for each row execute function public.audit_defect_change();

drop trigger if exists enforce_aircraft_maintenance_serviceability_trigger on public.bookings;
create trigger enforce_aircraft_maintenance_serviceability_trigger
before insert or update of aircraft_id, start_time, end_time, status, deleted_at on public.bookings
for each row execute function public.enforce_aircraft_maintenance_serviceability();

create or replace function public.prepare_maintenance_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aircraft_hours numeric;
begin
  new.title := btrim(coalesce(new.title, ''));
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.type := coalesce(new.type, 'hours');
  new.due_condition := case new.type when 'calendar' then 'date' else new.type end;
  new.updated_at := now();

  if new.title = '' then
    raise exception 'Maintenance milestone name is required';
  end if;
  if new.type in ('hours', 'both') and not new.is_one_time and coalesce(new.interval_hours, 0) <= 0 then
    raise exception 'An hours-based recurring milestone needs an interval greater than zero';
  end if;
  if new.type in ('calendar', 'both') and not new.is_one_time and coalesce(new.interval_months, 0) <= 0 then
    raise exception 'A calendar-based recurring milestone needs an interval greater than zero';
  end if;
  if new.type in ('hours', 'both') and new.next_due_hours is null and new.status <> 'completed' then
    raise exception 'An hours-based milestone needs a next due tach value';
  end if;
  if new.type in ('calendar', 'both') and new.next_due_date is null and new.status <> 'completed' then
    raise exception 'A calendar-based milestone needs a next due date';
  end if;

  select total_hours into v_aircraft_hours from public.aircraft where id = new.aircraft_id;
  if new.is_one_time and new.status = 'completed' then
    return new;
  end if;

  new.status := case
    when (new.next_due_hours is not null and new.next_due_hours < coalesce(v_aircraft_hours, 0))
      or (new.next_due_date is not null and new.next_due_date < current_date)
    then 'overdue'
    when (new.next_due_hours is not null and new.next_due_hours = coalesce(v_aircraft_hours, 0))
      or (new.next_due_date is not null and new.next_due_date = current_date)
    then 'due'
    else 'upcoming'
  end;

  new.due_value := case
    when new.type = 'calendar' then coalesce(new.next_due_date::text, '')
    when new.type = 'both' then concat_ws(' / ', new.next_due_hours::text, new.next_due_date::text)
    else coalesce(new.next_due_hours::text, '')
  end;
  return new;
end;
$$;

create or replace function public.audit_and_reconcile_maintenance_milestone()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.maintenance_audit_log(
    aircraft_id, milestone_id, action, performed_by, details
  ) values (
    coalesce(new.aircraft_id, old.aircraft_id),
    case when tg_op = 'DELETE' then null else new.id end,
    'milestone_' || lower(tg_op),
    auth.uid(),
    jsonb_build_object(
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );
  perform public.reconcile_aircraft_maintenance_status(
    coalesce(new.aircraft_id, old.aircraft_id),
    'milestone_' || lower(tg_op)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists prepare_maintenance_milestone_trigger on public.maintenance_milestones;
create trigger prepare_maintenance_milestone_trigger
before insert or update on public.maintenance_milestones
for each row execute function public.prepare_maintenance_milestone();

drop trigger if exists audit_maintenance_milestone_trigger on public.maintenance_milestones;
create trigger audit_maintenance_milestone_trigger
after insert or update or delete on public.maintenance_milestones
for each row execute function public.audit_and_reconcile_maintenance_milestone();

create or replace function public.refresh_maintenance_milestone_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.maintenance_milestones milestone
  set status = case
        when milestone.is_one_time and milestone.status = 'completed' then 'completed'
        when (milestone.next_due_hours is not null and milestone.next_due_hours < coalesce(aircraft.total_hours, 0))
          or (milestone.next_due_date is not null and milestone.next_due_date < current_date)
        then 'overdue'
        when (milestone.next_due_hours is not null and milestone.next_due_hours = coalesce(aircraft.total_hours, 0))
          or (milestone.next_due_date is not null and milestone.next_due_date = current_date)
        then 'due'
        else 'upcoming'
      end,
      updated_at = now()
  from public.aircraft aircraft
  where aircraft.id = milestone.aircraft_id
    and milestone.status is distinct from case
      when milestone.is_one_time and milestone.status = 'completed' then 'completed'
      when (milestone.next_due_hours is not null and milestone.next_due_hours < coalesce(aircraft.total_hours, 0))
        or (milestone.next_due_date is not null and milestone.next_due_date < current_date)
      then 'overdue'
      when (milestone.next_due_hours is not null and milestone.next_due_hours = coalesce(aircraft.total_hours, 0))
        or (milestone.next_due_date is not null and milestone.next_due_date = current_date)
      then 'due'
      else 'upcoming'
    end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.send_maintenance_due_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  milestone_row record;
  v_urgent_hours numeric := 10;
  v_upcoming_hours numeric := 25;
  v_urgent_days integer := 7;
  v_upcoming_days integer := 30;
  v_level text;
  v_snapshot text;
  v_inserted integer;
  v_sent integer := 0;
  v_message text;
begin
  perform public.refresh_maintenance_milestone_statuses();

  select
    coalesce((settings ->> 'urgentReminderHours')::numeric, 10),
    coalesce((settings ->> 'upcomingReminderHours')::numeric, 25),
    coalesce((settings ->> 'urgentReminderDays')::integer, 7),
    coalesce((settings ->> 'upcomingReminderDays')::integer, 30)
  into v_urgent_hours, v_upcoming_hours, v_urgent_days, v_upcoming_days
  from public.maintenance_settings
  order by updated_at desc nulls last
  limit 1;

  for milestone_row in
    select
      milestone.id,
      milestone.aircraft_id,
      milestone.title,
      milestone.status,
      milestone.next_due_hours,
      milestone.next_due_date,
      aircraft.registration,
      milestone.next_due_hours - coalesce(aircraft.total_hours, 0) as hours_remaining,
      milestone.next_due_date - current_date as days_remaining
    from public.maintenance_milestones milestone
    join public.aircraft aircraft on aircraft.id = milestone.aircraft_id
    where milestone.status <> 'completed'
      and not aircraft.is_archived
  loop
    v_level := case
      when milestone_row.status = 'overdue' then 'overdue'
      when milestone_row.status = 'due'
        or (milestone_row.hours_remaining is not null and milestone_row.hours_remaining <= v_urgent_hours)
        or (milestone_row.days_remaining is not null and milestone_row.days_remaining <= v_urgent_days)
      then 'urgent'
      when (milestone_row.hours_remaining is not null and milestone_row.hours_remaining <= v_upcoming_hours)
        or (milestone_row.days_remaining is not null and milestone_row.days_remaining <= v_upcoming_days)
      then 'upcoming'
      else null
    end;

    if v_level is null then continue; end if;

    v_snapshot := concat_ws(
      '|',
      coalesce(milestone_row.next_due_hours::text, '-'),
      coalesce(milestone_row.next_due_date::text, '-')
    );
    insert into public.maintenance_alert_deliveries(milestone_id, alert_level, snapshot_key)
    values (milestone_row.id, v_level, v_snapshot)
    on conflict do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then continue; end if;

    v_message := milestone_row.registration || ' — ' || milestone_row.title || ': ' ||
      case
        when v_level = 'overdue' then 'maintenance is overdue and the aircraft is unavailable.'
        when milestone_row.hours_remaining is not null
          and (
            milestone_row.days_remaining is null
            or milestone_row.hours_remaining <= v_urgent_hours
          )
        then 'due in ' || greatest(milestone_row.hours_remaining, 0)::numeric(10,1) || ' tach hours.'
        else 'due in ' || greatest(milestone_row.days_remaining, 0) || ' days.'
      end;

    insert into public.notifications(user_id, type, title, message, metadata)
    select admin_id, 'reminder',
      case v_level
        when 'overdue' then 'Maintenance overdue'
        when 'urgent' then 'Maintenance due soon'
        else 'Upcoming maintenance'
      end,
      v_message,
      jsonb_build_object(
        'aircraft_id', milestone_row.aircraft_id,
        'milestone_id', milestone_row.id,
        'maintenance_alert_level', v_level,
        'route', '/maintenance'
      )
    from (
      select id as admin_id from public.users where role = 'admin'
      union
      select user_id from public.user_roles where role = 'admin'
    ) admins;
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

create or replace function public.refresh_aircraft_milestones_after_hours_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.total_hours is distinct from new.total_hours then
    update public.maintenance_milestones set updated_at = now()
    where aircraft_id = new.id and status <> 'completed';
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_aircraft_milestones_after_hours_change_trigger on public.aircraft;
create trigger refresh_aircraft_milestones_after_hours_change_trigger
after update of total_hours on public.aircraft
for each row execute function public.refresh_aircraft_milestones_after_hours_change();

create or replace function public.complete_maintenance_milestone(
  p_milestone_id uuid,
  p_completed_date date,
  p_completed_tach numeric,
  p_next_due_hours numeric default null,
  p_next_due_date date default null,
  p_notes text default null,
  p_operation_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_milestone public.maintenance_milestones%rowtype;
  v_aircraft public.aircraft%rowtype;
  v_completion_id uuid;
  v_effective_next_hours numeric;
  v_effective_next_date date;
begin
  if auth.role() <> 'service_role' and not public.current_user_is_admin() then
    raise exception 'Administrator approval with MFA is required to complete maintenance';
  end if;

  select id into v_completion_id
  from public.maintenance_completions
  where operation_id = p_operation_id;
  if v_completion_id is not null then return v_completion_id; end if;

  select * into v_milestone
  from public.maintenance_milestones
  where id = p_milestone_id
  for update;
  if not found then raise exception 'Maintenance milestone not found'; end if;

  select id into v_completion_id
  from public.maintenance_completions
  where milestone_id = p_milestone_id
    and completed_date = p_completed_date
    and completed_tach = p_completed_tach;
  if v_completion_id is not null then return v_completion_id; end if;

  select * into v_aircraft
  from public.aircraft
  where id = v_milestone.aircraft_id
  for update;

  if v_milestone.is_one_time and v_milestone.status = 'completed' then
    raise exception 'This one-time milestone is already complete';
  end if;
  if p_completed_date is null or p_completed_date > current_date then
    raise exception 'Maintenance completion date must not be in the future';
  end if;
  if v_milestone.last_completed_date is not null
    and p_completed_date < v_milestone.last_completed_date then
    raise exception 'Maintenance completion date precedes the previous completion';
  end if;
  if p_completed_tach is null or p_completed_tach < 0
    or p_completed_tach > coalesce(v_aircraft.total_hours, 0) then
    raise exception 'Maintenance completion tach is outside the aircraft recorded hours';
  end if;
  if v_milestone.last_completed_tach is not null
    and p_completed_tach < v_milestone.last_completed_tach then
    raise exception 'Maintenance completion tach precedes the previous completion';
  end if;

  if not v_milestone.is_one_time then
    v_effective_next_hours := case
      when v_milestone.type in ('hours', 'both')
      then coalesce(p_next_due_hours, p_completed_tach + v_milestone.interval_hours)
      else null
    end;
    v_effective_next_date := case
      when v_milestone.type in ('calendar', 'both')
      then coalesce(
        p_next_due_date,
        (p_completed_date + make_interval(months => v_milestone.interval_months))::date
      )
      else null
    end;

    if v_effective_next_hours is not null and v_effective_next_hours <= p_completed_tach then
      raise exception 'Next due tach must be after the completion tach';
    end if;
    if v_effective_next_date is not null and v_effective_next_date <= p_completed_date then
      raise exception 'Next due date must be after the completion date';
    end if;
  end if;

  insert into public.maintenance_completions(
    milestone_id,
    aircraft_id,
    completed_by,
    completed_at,
    completed_date,
    tach_hours,
    completed_tach,
    next_due_hours,
    next_due_date,
    notes,
    operation_id
  ) values (
    v_milestone.id,
    v_milestone.aircraft_id,
    auth.uid(),
    p_completed_date::timestamptz,
    p_completed_date,
    p_completed_tach,
    p_completed_tach,
    v_effective_next_hours,
    v_effective_next_date,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_operation_id
  )
  returning id into v_completion_id;

  update public.maintenance_milestones
  set last_completed_date = p_completed_date,
      last_completed_tach = p_completed_tach,
      completed_at = now(),
      completed_by = auth.uid(),
      completion_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      next_due_hours = case when is_one_time then null else v_effective_next_hours end,
      next_due_date = case when is_one_time then null else v_effective_next_date end,
      status = case when is_one_time then 'completed' else 'upcoming' end,
      updated_at = now()
  where id = v_milestone.id;

  update public.aircraft
  set last_maintenance = greatest(coalesce(last_maintenance, p_completed_date), p_completed_date),
      updated_at = now()
  where id = v_milestone.aircraft_id;

  insert into public.maintenance_audit_log(
    aircraft_id, milestone_id, completion_id, action, performed_by, details
  ) values (
    v_milestone.aircraft_id,
    v_milestone.id,
    v_completion_id,
    'maintenance_completed',
    auth.uid(),
    jsonb_build_object(
      'operation_id', p_operation_id,
      'completed_date', p_completed_date,
      'completed_tach', p_completed_tach,
      'next_due_hours', v_effective_next_hours,
      'next_due_date', v_effective_next_date,
      'notes', nullif(btrim(coalesce(p_notes, '')), '')
    )
  );

  return v_completion_id;
end;
$$;

create or replace function public.release_aircraft_auto_grounding(
  p_aircraft_id uuid,
  p_defect_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.reconcile_aircraft_maintenance_status(p_aircraft_id, 'grounding_review');
end;
$$;

create or replace function public.release_expired_aircraft_auto_groundings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grounding record;
  v_duration_hours numeric := 24;
begin
  select greatest(1, coalesce((settings ->> 'autoGroundDurationHours')::numeric, 24))
  into v_duration_hours
  from public.maintenance_settings
  order by updated_at desc nulls last
  limit 1;
  v_duration_hours := coalesce(v_duration_hours, 24);

  for grounding in
    select id, registration
    from public.aircraft
    where auto_grounded_until is not null
      and auto_grounded_until <= now()
  loop
    perform public.reconcile_aircraft_maintenance_status(grounding.id, 'scheduled_grounding_review');
    if exists (
      select 1 from public.aircraft
      where id = grounding.id
        and (auto_grounded_by_defect_id is not null or maintenance_grounded)
    ) then
      update public.aircraft
      set auto_grounded_until = now() + make_interval(secs => (v_duration_hours * 3600)::integer)
      where id = grounding.id;

      insert into public.notifications(user_id, type, title, message, metadata)
      select admin_id, 'conflict', 'Grounded aircraft needs review',
        grounding.registration || ' remains grounded. Review the active defect or overdue maintenance deadline before returning it to service.',
        jsonb_build_object('aircraft_id', grounding.id, 'route', '/maintenance')
      from (
        select id as admin_id from public.users where role = 'admin'
        union
        select user_id from public.user_roles where role = 'admin'
      ) admins;
    end if;
  end loop;
end;
$$;

create or replace function public.handle_maintenance_settings_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  aircraft_row record;
begin
  perform public.refresh_maintenance_milestone_statuses();
  for aircraft_row in select id from public.aircraft loop
    perform public.reconcile_aircraft_maintenance_status(aircraft_row.id, 'maintenance_settings_changed');
  end loop;
  return new;
end;
$$;

drop trigger if exists maintenance_settings_reconciliation_trigger on public.maintenance_settings;
create trigger maintenance_settings_reconciliation_trigger
after insert or update on public.maintenance_settings
for each row execute function public.handle_maintenance_settings_reconciliation();

-- Refresh calendar milestones and reconcile serviceability every hour.
do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job where jobname = 'refresh-maintenance-milestones' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'refresh-maintenance-milestones',
    '7 * * * *',
    'select public.send_maintenance_due_notifications()'
  );
end;
$$;

revoke all on function public.prepare_defect_write() from public, anon, authenticated;
revoke all on function public.audit_defect_change() from public, anon, authenticated;
revoke all on function public.reconcile_aircraft_maintenance_status(uuid, text) from public, anon, authenticated;
revoke all on function public.handle_aircraft_grounding() from public, anon, authenticated;
revoke all on function public.enforce_aircraft_maintenance_serviceability() from public, anon, authenticated;
revoke all on function public.prepare_maintenance_milestone() from public, anon, authenticated;
revoke all on function public.prepare_maintenance_template() from public, anon, authenticated;
revoke all on function public.prepare_maintenance_settings() from public, anon, authenticated;
revoke all on function public.audit_and_reconcile_maintenance_milestone() from public, anon, authenticated;
revoke all on function public.refresh_maintenance_milestone_statuses() from public, anon, authenticated;
revoke all on function public.send_maintenance_due_notifications() from public, anon, authenticated;
revoke all on function public.refresh_aircraft_milestones_after_hours_change() from public, anon, authenticated;
revoke all on function public.handle_maintenance_settings_reconciliation() from public, anon, authenticated;
revoke all on function public.release_aircraft_auto_grounding(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_expired_aircraft_auto_groundings() from public, anon, authenticated;
revoke all on function public.complete_maintenance_milestone(uuid, date, numeric, numeric, date, text, uuid)
  from public, anon;

grant execute on function public.complete_maintenance_milestone(uuid, date, numeric, numeric, date, text, uuid)
  to authenticated, service_role;
grant execute on function public.refresh_maintenance_milestone_statuses() to service_role;
grant execute on function public.send_maintenance_due_notifications() to service_role;
grant execute on function public.release_aircraft_auto_grounding(uuid, uuid) to service_role;
grant execute on function public.release_expired_aircraft_auto_groundings() to service_role;

select public.refresh_maintenance_milestone_statuses();
