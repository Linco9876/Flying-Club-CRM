\set ON_ERROR_STOP on
begin;
do $$
declare
  v_private uuid := '00000000-0000-4000-8000-000000000001';
  v_payment uuid := '20000000-0000-4000-8000-000000000001';
  v_first uuid; v_second uuid; v_log uuid; v_cost numeric;
  v_rejected boolean;
begin
  insert into public.flight_types(id) values (v_payment);
  -- Disabled by default; direct API writes cannot bypass the switch.
  v_rejected := false;
  begin
    insert into public.bookings(aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration,start_time,end_time)
    values (v_private,gen_random_uuid(),'C172','VH-ABC','2026-09-09 10:00+10','2026-09-09 12:00+10');
  exception when others then v_rejected := sqlerrm like '%disabled%'; end;
  assert v_rejected, 'Disabled private option accepted new booking';

  perform public.save_private_aircraft_configuration(true,jsonb_build_array(jsonb_build_object('flightTypeId',v_payment,'chargeType','tach','dualRate',150,'flatSurcharge',10,'weekendSurcharge',20)));
  -- Configuration is administrator-only and atomic.
  perform set_config('test.is_admin','false',true);
  v_rejected := false;
  begin perform public.save_private_aircraft_configuration(false,'[]');
  exception when others then v_rejected := sqlerrm like '%Administrator%'; end;
  assert v_rejected, 'Non-admin changed private configuration';
  perform set_config('test.is_admin','true',true);
  v_rejected := false;
  begin
    perform public.save_private_aircraft_configuration(false,jsonb_build_array(jsonb_build_object('flightTypeId',v_payment,'chargeType','tach','dualRate',-1,'flatSurcharge',0,'weekendSurcharge',0)));
  exception when others then v_rejected := true; end;
  assert v_rejected, 'Negative rate accepted';
  assert (select private_booking_enabled from public.aircraft where id=v_private), 'Failed save changed enabled state';

  -- Different instructors can book the shared option simultaneously.
  insert into public.bookings(aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration,start_time,end_time)
  values (v_private,'30000000-0000-4000-8000-000000000001','Cessna 172',' vh-abc ','2026-09-09 10:00+10','2026-09-09 12:00+10') returning id into v_first;
  insert into public.bookings(aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration,start_time,end_time,is_guest_booking,guest_name)
  values (v_private,'30000000-0000-4000-8000-000000000002','Piper PA-28','VH-DEF','2026-09-09 10:00+10','2026-09-09 12:00+10',true,'Guest Pilot') returning id into v_second;
  assert not exists(select 1 from public.bookings where has_conflict), 'Private option created false aircraft conflict';
  assert (select private_aircraft_registration='VH-ABC' from public.bookings where id=v_first), 'Registration was not normalised';
  v_rejected := false;
  begin
    insert into public.bookings(aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration,start_time,end_time)
    values (v_private,'30000000-0000-4000-8000-000000000001','C172','VH-XYZ','2026-09-09 11:00+10','2026-09-09 12:00+10');
  exception when others then v_rejected := sqlerrm like '%conflicts%'; end;
  assert v_rejected, 'Instructor double-booking was accepted';
  v_rejected := false;
  begin
    insert into public.bookings(aircraft_id,private_aircraft_type,private_aircraft_registration) values(v_private,'C172','VH-XYZ');
  exception when others then v_rejected := sqlerrm like '%requires%'; end;
  assert v_rejected, 'Instructor was not required';
  v_rejected := false;
  begin
    insert into public.bookings(aircraft_id,instructor_id,private_aircraft_type,private_aircraft_registration) values(v_private,gen_random_uuid(),' ','VH-XYZ');
  exception when others then v_rejected := sqlerrm like '%requires%'; end;
  assert v_rejected, 'Aircraft type was not required';

  -- Existing bookings remain editable and loggable after disabling.
  perform public.save_private_aircraft_configuration(false,'[]');
  update public.bookings set notes='Still completable' where id=v_first;
  v_rejected := false;
  begin
    insert into public.flight_logs(booking_id,aircraft_id,instructor_id,start_time,end_time,flight_duration,dual_time,solo_time,flight_type_id,calculated_cost)
    values(v_first,v_private,'30000000-0000-4000-8000-000000000001','2026-09-09 10:00+10','2026-09-09 12:00+10',1.2,1.2,0,v_payment,1);
  exception when others then v_rejected := sqlerrm like '%rate has changed%'; end;
  assert v_rejected, 'Stale or tampered charge reached the payment workflow';
  insert into public.flight_logs(booking_id,aircraft_id,instructor_id,start_time,end_time,flight_duration,dual_time,solo_time,flight_type_id,calculated_cost)
  values(v_first,v_private,'30000000-0000-4000-8000-000000000001','2026-09-09 10:00+10','2026-09-09 12:00+10',1.2,1.2,0,v_payment,190)
  returning id,calculated_cost into v_log,v_cost;
  assert v_cost=190, 'Authoritative instruction charge must be 1.2 x 150 + 10';
  assert (select total_cost=190 and start_tach=0 and end_tach=1.2 and private_aircraft_registration='VH-ABC' from public.flight_logs where id=v_log), 'Log identity or total cost incorrect';
  insert into public.training_records(flight_log_id,registration,aircraft_type) values(v_log,'Private aircraft','single-engine');
  assert (select registration='VH-ABC' and aircraft_type='Cessna 172' from public.training_records where flight_log_id=v_log), 'Student report contains system option instead of actual aircraft';
  update public.flight_logs set private_aircraft_registration='vh-corrected',private_aircraft_type='Cessna 172S' where id=v_log;
  assert (select registration='VH-CORRECTED' and aircraft_type='Cessna 172S' from public.training_records where flight_log_id=v_log), 'Corrected aircraft did not reach student records';

  -- Later rate changes never reprice historical flying hours.
  update public.aircraft_rates set dual_rate=300 where aircraft_id=v_private;
  update public.flight_logs set calculated_cost=999 where id=v_log;
  assert (select calculated_cost=190 from public.flight_logs where id=v_log), 'Metadata edit repriced historical charge';
  update public.flight_logs set flight_duration=1.5,dual_time=1.5 where id=v_log;
  assert (select calculated_cost=235 from public.flight_logs where id=v_log), 'Duration correction did not use saved rate';
  v_rejected := false;
  begin update public.flight_logs set solo_time=0.1 where id=v_log;
  exception when others then v_rejected := sqlerrm like '%dual%'; end;
  assert v_rejected, 'Private instruction accepted solo hours';
  update public.flight_logs set stripe_checkout_session_id='cs_test_private' where id=v_log;
  v_rejected := false;
  begin update public.flight_logs set flight_duration=2,dual_time=2 where id=v_log;
  exception when others then v_rejected := sqlerrm like '%payment or invoice%'; end;
  assert v_rejected, 'Outstanding Stripe checkout amount was invalidated';
  update public.flight_logs set stripe_checkout_session_id=null,xero_invoice_id='test-invoice' where id=v_log;
  v_rejected := false;
  begin update public.flight_logs set flight_duration=2,dual_time=2 where id=v_log;
  exception when others then v_rejected := sqlerrm like '%payment or invoice%'; end;
  assert v_rejected, 'Existing Xero invoice amount was invalidated';

  -- Guests use the same charge path; provider-disabled logs carry no billing.
  insert into public.flight_logs(booking_id,aircraft_id,instructor_id,start_time,end_time,flight_duration,dual_time,solo_time,financial_capture_suppressed)
  values(v_second,v_private,'30000000-0000-4000-8000-000000000002','2026-09-09 10:00+10','2026-09-09 11:00+10',1,1,0,true);
  assert (select private_aircraft_registration='VH-DEF' and private_aircraft_type='Piper PA-28' from public.flight_logs where booking_id=v_second), 'Guest log lost aircraft identity';
  assert (select total_hours=0 from public.aircraft where id=v_private), 'Private logs incremented fleet hours';
  v_rejected := false;
  begin delete from public.aircraft where id=v_private;
  exception when others then v_rejected := sqlerrm like '%cannot be deleted%'; end;
  assert v_rejected, 'System option could be deleted';
end;
$$;
rollback;
\echo Private aircraft database assertions passed.
