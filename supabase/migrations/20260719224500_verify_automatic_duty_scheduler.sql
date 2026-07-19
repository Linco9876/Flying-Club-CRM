-- Fail deployment if the scheduler was not registered or if the reconciliation
-- function cannot execute. The historical timestamp makes this a read-only
-- verification run for this club's data.
do $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1
      from cron.job
     where jobname = 'reconcile-automatic-instructor-duty'
       and schedule = '* * * * *'
       and active
  ) then
    raise exception 'Automatic instructor duty cron job is not active';
  end if;

  v_result := public.reconcile_automatic_duty_periods('2000-01-01 00:00:00+00'::timestamptz);
  if v_result is null or not (v_result ? 'started') or not (v_result ? 'closed') then
    raise exception 'Automatic instructor duty reconciliation self-check failed';
  end if;
end;
$$;
