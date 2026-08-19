-- Align external logbook date checks with Bendigo local time. Supabase database
-- sessions commonly use UTC, which otherwise rejects valid same-day entries
-- during the Australian morning. Also enforce the dual-flight PIC requirement
-- below the application layer.

alter table public.logbook_baselines
  drop constraint if exists logbook_baselines_date_check,
  drop constraint if exists logbook_baselines_last_flight_check;

alter table public.logbook_baselines
  add constraint logbook_baselines_date_check check (
    as_of_date <= (timezone('Australia/Melbourne', now()))::date
  ),
  add constraint logbook_baselines_last_flight_check check (
    last_flight_date is null
    or (
      last_flight_date <= as_of_date
      and last_flight_date <= (timezone('Australia/Melbourne', now()))::date
    )
  );

alter table public.external_logbook_entries
  drop constraint if exists external_logbook_entries_date_check,
  drop constraint if exists external_logbook_entries_dual_pic_check;

alter table public.external_logbook_entries
  add constraint external_logbook_entries_date_check check (
    flight_date <= (timezone('Australia/Melbourne', now()))::date
  ),
  add constraint external_logbook_entries_dual_pic_check check (
    dual_hours = 0 or nullif(btrim(pilot_in_command_name), '') is not null
  );
