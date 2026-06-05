do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.bookings'::regclass
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;

  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.flight_logs'::regclass
  ) then
    alter publication supabase_realtime add table public.flight_logs;
  end if;

  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.instructor_absences'::regclass
  ) then
    alter publication supabase_realtime add table public.instructor_absences;
  end if;

  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.instructor_weekly_schedules'::regclass
  ) then
    alter publication supabase_realtime add table public.instructor_weekly_schedules;
  end if;

  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.instructor_schedule_changes'::regclass
  ) then
    alter publication supabase_realtime add table public.instructor_schedule_changes;
  end if;

  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime'
      and pr.prrelid = 'public.aircraft'::regclass
  ) then
    alter publication supabase_realtime add table public.aircraft;
  end if;
end $$;

alter table public.bookings replica identity full;
alter table public.flight_logs replica identity full;
alter table public.instructor_weekly_schedules replica identity full;
alter table public.instructor_absences replica identity full;
alter table public.instructor_schedule_changes replica identity full;
alter table public.aircraft replica identity full;
