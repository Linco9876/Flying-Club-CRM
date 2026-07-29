-- Preserve legacy Aircraft-form milestones while retaining strict maintenance validation.
-- Also ensure mixed hours/calendar alerts describe the limit that triggered the alert.

drop trigger if exists prepare_maintenance_milestone_trigger on public.maintenance_milestones;

create or replace function public.try_parse_legacy_maintenance_numeric(value text)
returns numeric
language plpgsql
immutable
strict
set search_path = public
as $$
begin
  return value::numeric;
exception when others then
  return null;
end;
$$;

create or replace function public.try_parse_legacy_maintenance_date(value text)
returns date
language plpgsql
immutable
strict
set search_path = public
as $$
begin
  return value::date;
exception when others then
  return null;
end;
$$;

update public.maintenance_milestones milestone
set
  type = 'hours',
  is_one_time = case
    when coalesce(milestone.interval_hours, 0) <= 0 then true
    else milestone.is_one_time
  end,
  next_due_hours = coalesce(
    public.try_parse_legacy_maintenance_numeric(nullif(btrim(milestone.due_value), '')),
    aircraft.total_hours,
    0
  ),
  description = case
    when public.try_parse_legacy_maintenance_numeric(nullif(btrim(milestone.due_value), '')) is null
    then concat_ws(
      E'\n',
      nullif(btrim(milestone.description), ''),
      'Legacy due tach value could not be read; it was set due immediately for staff review.'
    )
    else milestone.description
  end
from public.aircraft aircraft
where aircraft.id = milestone.aircraft_id
  and milestone.due_condition = 'hours'
  and milestone.next_due_hours is null;

update public.maintenance_milestones milestone
set
  type = 'calendar',
  is_one_time = case
    when coalesce(milestone.interval_months, 0) <= 0 then true
    else milestone.is_one_time
  end,
  next_due_date = coalesce(
    public.try_parse_legacy_maintenance_date(nullif(btrim(milestone.due_value), '')),
    current_date
  ),
  description = case
    when public.try_parse_legacy_maintenance_date(nullif(btrim(milestone.due_value), '')) is null
    then concat_ws(
      E'\n',
      nullif(btrim(milestone.description), ''),
      'Legacy due date could not be read; it was set due immediately for staff review.'
    )
    else milestone.description
  end
where milestone.due_condition = 'date'
  and milestone.next_due_date is null;

drop function public.try_parse_legacy_maintenance_numeric(text);
drop function public.try_parse_legacy_maintenance_date(text);

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
  new.is_one_time := coalesce(new.is_one_time, false);

  -- Older Aircraft-form clients supplied only due_condition and due_value.
  -- Normalize that shape into an explicit one-time milestone before validating.
  if new.next_due_hours is null
    and new.next_due_date is null
    and nullif(btrim(coalesce(new.due_value, '')), '') is not null
  then
    if new.due_condition = 'date' then
      begin
        new.next_due_date := new.due_value::date;
      exception when others then
        raise exception 'Maintenance due date must be a valid date';
      end;
      new.type := 'calendar';
      if coalesce(new.interval_months, 0) <= 0 then
        new.is_one_time := true;
      end if;
    else
      begin
        new.next_due_hours := new.due_value::numeric;
      exception when others then
        raise exception 'Maintenance due tach value must be a valid number';
      end;
      new.type := 'hours';
      if coalesce(new.interval_hours, 0) <= 0 then
        new.is_one_time := true;
      end if;
    end if;
  end if;

  new.due_condition := case new.type when 'calendar' then 'date' else 'hours' end;
  new.updated_at := now();

  if new.title = '' then
    raise exception 'Maintenance milestone name is required';
  end if;
  if new.next_due_hours is not null and new.next_due_hours < 0 then
    raise exception 'Maintenance due tach value cannot be negative';
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

create trigger prepare_maintenance_milestone_trigger
before insert or update on public.maintenance_milestones
for each row execute function public.prepare_maintenance_milestone();

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
  v_hours_triggered boolean;
  v_days_triggered boolean;
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

    v_hours_triggered := milestone_row.hours_remaining is not null
      and case v_level
        when 'urgent' then milestone_row.hours_remaining <= v_urgent_hours
        when 'upcoming' then milestone_row.hours_remaining <= v_upcoming_hours
        else false
      end;
    v_days_triggered := milestone_row.days_remaining is not null
      and case v_level
        when 'urgent' then milestone_row.days_remaining <= v_urgent_days
        when 'upcoming' then milestone_row.days_remaining <= v_upcoming_days
        else false
      end;

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
        when v_hours_triggered and v_days_triggered
        then 'due in ' || greatest(milestone_row.hours_remaining, 0)::numeric(10,1)
          || ' tach hours or ' || greatest(milestone_row.days_remaining, 0) || ' days, whichever occurs first.'
        when v_hours_triggered
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

revoke all on function public.send_maintenance_due_notifications() from public, anon, authenticated;
grant execute on function public.send_maintenance_due_notifications() to service_role;
