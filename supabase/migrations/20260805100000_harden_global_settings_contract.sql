-- Club-wide settings are singleton records. The application reads them with
-- maybeSingle(), so duplicate rows make the entire settings screen fail.

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.organisation_settings
) delete from public.organisation_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.calendar_settings
) delete from public.calendar_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.notification_settings
) delete from public.notification_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.portal_ux_settings
) delete from public.portal_ux_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.resource_settings
) delete from public.resource_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.safety_compliance_settings
) delete from public.safety_compliance_settings where id in (select id from ranked where position > 1);

with ranked as (
  select id, row_number() over (order by updated_at desc nulls last, id desc) as position
  from public.training_syllabus_settings
) delete from public.training_syllabus_settings where id in (select id from ranked where position > 1);

create unique index if not exists organisation_settings_singleton_key
  on public.organisation_settings ((true));
create unique index if not exists calendar_settings_singleton_key
  on public.calendar_settings ((true));
create unique index if not exists notification_settings_singleton_key
  on public.notification_settings ((true));
create unique index if not exists portal_ux_settings_singleton_key
  on public.portal_ux_settings ((true));
create unique index if not exists resource_settings_singleton_key
  on public.resource_settings ((true));
create unique index if not exists safety_compliance_settings_singleton_key
  on public.safety_compliance_settings ((true));
create unique index if not exists training_syllabus_settings_singleton_key
  on public.training_syllabus_settings ((true));

-- Repair legacy values before enforcing the choices offered by the UI.
update public.organisation_settings
set default_slot_length = 30
where default_slot_length not in (15, 30, 60, 90);

update public.organisation_settings
set currency = 'AUD',
    timezone = 'Australia/Melbourne'
where currency is distinct from 'AUD'
   or timezone is distinct from 'Australia/Melbourne';

update public.organisation_settings
set booking_day_start = '06:00'
where booking_day_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';

update public.organisation_settings
set booking_day_end = '22:00'
where booking_day_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
   or booking_day_end <= booking_day_start;

alter table public.organisation_settings
  drop constraint if exists organisation_settings_currency_check,
  add constraint organisation_settings_currency_check check (currency = 'AUD'),
  drop constraint if exists organisation_settings_timezone_check,
  add constraint organisation_settings_timezone_check check (timezone = 'Australia/Melbourne'),
  drop constraint if exists organisation_settings_default_slot_length_check,
  add constraint organisation_settings_default_slot_length_check
    check (default_slot_length in (15, 30, 60, 90)),
  drop constraint if exists organisation_settings_booking_hours_check,
  add constraint organisation_settings_booking_hours_check
    check (
      booking_day_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and booking_day_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and booking_day_start < booking_day_end
    );

update public.calendar_settings
set default_view = 'day'
where default_view not in ('day', 'week', 'month');
update public.calendar_settings
set snap_duration = 15
where snap_duration not in (5, 15, 30);
update public.calendar_settings
set resource_display_order = 'aircraft-first'
where resource_display_order not in ('aircraft-first', 'instructors-first');
update public.calendar_settings
set conflict_rules = 'waitlist'
where conflict_rules not in ('block', 'approval', 'waitlist');
update public.calendar_settings
set week_starts_on = 'monday'
where week_starts_on not in ('sunday', 'monday');

alter table public.calendar_settings
  drop constraint if exists calendar_settings_default_view_check,
  add constraint calendar_settings_default_view_check check (default_view in ('day', 'week', 'month')),
  drop constraint if exists calendar_settings_snap_duration_check,
  add constraint calendar_settings_snap_duration_check check (snap_duration in (5, 15, 30)),
  drop constraint if exists calendar_settings_resource_display_order_check,
  add constraint calendar_settings_resource_display_order_check check (resource_display_order in ('aircraft-first', 'instructors-first')),
  drop constraint if exists calendar_settings_conflict_rules_check,
  add constraint calendar_settings_conflict_rules_check check (conflict_rules in ('block', 'approval', 'waitlist')),
  drop constraint if exists calendar_settings_week_starts_on_check,
  add constraint calendar_settings_week_starts_on_check check (week_starts_on in ('sunday', 'monday'));

update public.booking_rules_settings set
  min_booking_notice_hours = greatest(0, least(48, min_booking_notice_hours)),
  max_booking_advance_days = greatest(1, least(365, max_booking_advance_days)),
  cancellation_notice_hours = greatest(0, least(72, cancellation_notice_hours)),
  max_booking_duration_hours = greatest(1, least(24, max_booking_duration_hours)),
  fatigue_late_finish_time = case when fatigue_late_finish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then fatigue_late_finish_time else '22:00' end,
  fatigue_early_start_time = case when fatigue_early_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then fatigue_early_start_time else '07:00' end,
  fatigue_min_rest_hours = greatest(0, least(24, fatigue_min_rest_hours)),
  fatigue_max_duty_hours_per_day = greatest(1, least(16, fatigue_max_duty_hours_per_day)),
  fatigue_max_flight_hours_per_day = greatest(1, least(12, fatigue_max_flight_hours_per_day)),
  fatigue_max_late_finishes_7_days = greatest(0, least(7, fatigue_max_late_finishes_7_days));

update public.booking_rules_settings
set fatigue_max_flight_hours_per_day = fatigue_max_duty_hours_per_day
where fatigue_max_flight_hours_per_day > fatigue_max_duty_hours_per_day;

alter table public.booking_rules_settings
  drop constraint if exists booking_rules_min_notice_check,
  add constraint booking_rules_min_notice_check check (min_booking_notice_hours between 0 and 48),
  drop constraint if exists booking_rules_max_advance_check,
  add constraint booking_rules_max_advance_check check (max_booking_advance_days between 1 and 365),
  drop constraint if exists booking_rules_cancellation_notice_check,
  add constraint booking_rules_cancellation_notice_check check (cancellation_notice_hours between 0 and 72),
  drop constraint if exists booking_rules_max_duration_check,
  add constraint booking_rules_max_duration_check check (max_booking_duration_hours between 1 and 24),
  drop constraint if exists booking_rules_fatigue_times_check,
  add constraint booking_rules_fatigue_times_check check (
    fatigue_late_finish_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and fatigue_early_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ),
  drop constraint if exists booking_rules_fatigue_rest_check,
  add constraint booking_rules_fatigue_rest_check check (fatigue_min_rest_hours between 0 and 24),
  drop constraint if exists booking_rules_fatigue_duty_check,
  add constraint booking_rules_fatigue_duty_check check (fatigue_max_duty_hours_per_day between 1 and 16),
  drop constraint if exists booking_rules_fatigue_flight_check,
  add constraint booking_rules_fatigue_flight_check check (
    fatigue_max_flight_hours_per_day between 1 and 12
    and fatigue_max_flight_hours_per_day <= fatigue_max_duty_hours_per_day
  ),
  drop constraint if exists booking_rules_fatigue_late_finishes_check,
  add constraint booking_rules_fatigue_late_finishes_check check (fatigue_max_late_finishes_7_days between 0 and 7);

update public.notification_settings set
  maintenance_due_alert_days = greatest(1, least(180, maintenance_due_alert_days)),
  maintenance_due_alert_hours = greatest(1, least(100, maintenance_due_alert_hours)),
  currency_expiry_alert_days = greatest(1, least(365, currency_expiry_alert_days)),
  overdue_flight_record_alert_hours = greatest(1, least(168, overdue_flight_record_alert_hours));

alter table public.notification_settings
  drop constraint if exists notification_settings_maintenance_days_check,
  add constraint notification_settings_maintenance_days_check check (maintenance_due_alert_days between 1 and 180),
  drop constraint if exists notification_settings_maintenance_hours_check,
  add constraint notification_settings_maintenance_hours_check check (maintenance_due_alert_hours between 1 and 100),
  drop constraint if exists notification_settings_currency_days_check,
  add constraint notification_settings_currency_days_check check (currency_expiry_alert_days between 1 and 365),
  drop constraint if exists notification_settings_overdue_record_hours_check,
  add constraint notification_settings_overdue_record_hours_check check (overdue_flight_record_alert_hours between 1 and 168);

update public.safety_compliance_settings set
  recency_days = greatest(30, least(365, recency_days)),
  medical_warning_days = greatest(7, least(180, medical_warning_days)),
  licence_warning_days = greatest(7, least(180, licence_warning_days)),
  bfr_warning_days = greatest(7, least(90, bfr_warning_days)),
  instructor_sop_check_months = greatest(1, least(24, instructor_sop_check_months)),
  senior_instructor_sop_check_months = greatest(1, least(36, senior_instructor_sop_check_months));

alter table public.safety_compliance_settings
  drop constraint if exists safety_settings_recency_days_check,
  add constraint safety_settings_recency_days_check check (recency_days between 30 and 365),
  drop constraint if exists safety_settings_medical_warning_days_check,
  add constraint safety_settings_medical_warning_days_check check (medical_warning_days between 7 and 180),
  drop constraint if exists safety_settings_licence_warning_days_check,
  add constraint safety_settings_licence_warning_days_check check (licence_warning_days between 7 and 180),
  drop constraint if exists safety_settings_bfr_warning_days_check,
  add constraint safety_settings_bfr_warning_days_check check (bfr_warning_days between 7 and 90),
  drop constraint if exists safety_settings_instructor_sop_months_check,
  add constraint safety_settings_instructor_sop_months_check check (instructor_sop_check_months between 1 and 24),
  drop constraint if exists safety_settings_senior_sop_months_check,
  add constraint safety_settings_senior_sop_months_check check (senior_instructor_sop_check_months between 1 and 36);

comment on index public.organisation_settings_singleton_key is 'Enforces one authoritative club-wide organisation settings row.';
comment on index public.calendar_settings_singleton_key is 'Enforces one authoritative club-wide calendar settings row.';
comment on index public.notification_settings_singleton_key is 'Enforces one authoritative club-wide notification settings row.';
comment on index public.portal_ux_settings_singleton_key is 'Enforces one authoritative club-wide portal settings row.';
comment on index public.resource_settings_singleton_key is 'Enforces one authoritative club-wide resource settings row.';
comment on index public.safety_compliance_settings_singleton_key is 'Enforces one authoritative club-wide safety settings row.';
comment on index public.training_syllabus_settings_singleton_key is 'Enforces one authoritative club-wide training settings row.';

update public.rooms
set name = 'Room ' || left(id::text, 8)
where btrim(name) = '';

alter table public.rooms drop constraint if exists rooms_name_not_blank;
alter table public.rooms add constraint rooms_name_not_blank check (btrim(name) <> '');

alter table public.portal_ux_settings drop constraint if exists portal_ux_settings_date_format_check;
alter table public.portal_ux_settings add constraint portal_ux_settings_date_format_check
  check (date_format in ('dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'));

alter table public.resource_settings drop constraint if exists resource_settings_aircraft_fields_array;
alter table public.resource_settings add constraint resource_settings_aircraft_fields_array
  check (jsonb_typeof(aircraft_fields) = 'array' and jsonb_array_length(aircraft_fields) > 0);
alter table public.resource_settings drop constraint if exists resource_settings_document_types_array;
alter table public.resource_settings add constraint resource_settings_document_types_array
  check (jsonb_typeof(aircraft_document_types) = 'array' and jsonb_array_length(aircraft_document_types) > 0);

alter table public.training_syllabus_settings drop constraint if exists training_syllabus_settings_endorsements_not_empty;
alter table public.training_syllabus_settings add constraint training_syllabus_settings_endorsements_not_empty
  check (cardinality(endorsement_types) > 0);
alter table public.training_syllabus_settings drop constraint if exists training_syllabus_settings_licences_not_empty;
alter table public.training_syllabus_settings add constraint training_syllabus_settings_licences_not_empty
  check (cardinality(licence_types) > 0);
