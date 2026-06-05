-- Refreshable demo data for Bendigo Flying Club CRM.
-- Rows created by this script are marked with [DEMO] so they can be safely removed
-- and reseeded without touching normal operational records.

begin;

with demo_training_records as (
  select id from public.training_records
  where comments ilike '[DEMO]%' or briefing_comments ilike '[DEMO]%'
),
demo_bookings as (
  select id from public.bookings where notes ilike '[DEMO]%'
),
demo_logs as (
  select id from public.flight_logs
  where notes ilike '[DEMO]%'
     or comments ilike '[DEMO]%'
     or booking_id in (select id from demo_bookings)
),
demo_milestones as (
  select id from public.maintenance_milestones
  where title ilike '[DEMO]%' or notes ilike '[DEMO]%'
)
delete from public.account_transactions
where description ilike '[DEMO]%'
   or flight_log_id in (select id from demo_logs);

with demo_training_records as (
  select id from public.training_records
  where comments ilike '[DEMO]%' or briefing_comments ilike '[DEMO]%'
)
delete from public.training_sequence_results
where training_record_id in (select id from demo_training_records);

delete from public.training_records
where comments ilike '[DEMO]%' or briefing_comments ilike '[DEMO]%';

delete from public.student_exam_results
where notes ilike '[DEMO]%' or exam_id ilike 'demo-%';

with demo_bookings as (
  select id from public.bookings where notes ilike '[DEMO]%'
)
delete from public.flight_logs
where notes ilike '[DEMO]%'
   or comments ilike '[DEMO]%'
   or booking_id in (select id from demo_bookings);

delete from public.bookings where notes ilike '[DEMO]%';

with demo_milestones as (
  select id from public.maintenance_milestones
  where title ilike '[DEMO]%' or notes ilike '[DEMO]%'
)
delete from public.maintenance_completions
where notes ilike '[DEMO]%' or milestone_id in (select id from demo_milestones);

delete from public.maintenance_milestones
where title ilike '[DEMO]%' or notes ilike '[DEMO]%';

delete from public.defects where description ilike '[DEMO]%';
delete from public.safety_reports where title ilike '[DEMO]%';
delete from public.instructor_absences where reason ilike '[DEMO]%';

with anchors as (
  select
    (select id from public.users where email = 'lincoln@bbkm.com.au' limit 1) as admin_id,
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    coalesce(
      (select id from public.users where email = 'cot000055@live.com' limit 1),
      (select id from public.users where role = 'pilot' order by created_at desc limit 1)
    ) as pilot_id,
    (select id from public.aircraft where registration = '24-4851' limit 1) as aircraft_4851,
    (select id from public.aircraft where registration = '24-4852' limit 1) as aircraft_4852,
    (select id from public.aircraft where registration = '24-5167' limit 1) as aircraft_5167,
    (select id from public.aircraft where registration = '24-5420' limit 1) as aircraft_5420,
    (select id from public.flight_types where name = 'PAYG' limit 1) as payg_id,
    (select id from public.flight_types where name = 'Pre-Paid' limit 1) as prepaid_id,
    (select id from public.flight_types where name = 'BFC Ops' limit 1) as ops_id,
    (select id from public.payment_methods where name = 'Bank Transfer' limit 1) as bank_transfer_id,
    (select id from public.payment_methods where name = 'Pilot Account' limit 1) as pilot_account_id,
    (select id from public.training_courses where title = 'RAAus Ab-Initio RPC' limit 1) as course_id
),
seed_students as (
  insert into public.students (
    id, raaus_id, casa_id, medical_type, medical_expiry, licence_expiry,
    date_of_birth, prepaid_balance, emergency_contact_name, emergency_contact_phone,
    emergency_contact_relationship, occupation, alternate_phone
  )
  select student_id, 'RAAUS-DEMO-12045', 'ARN-DEMO-774211', 'Basic Class 2',
    current_date + 170, current_date + 310, date '2001-08-14', 425.50,
    'Alex Demo', '0400 111 222', 'Parent', 'Apprentice aircraft engineer', '03 5440 1000'
  from anchors
  union all
  select pilot_id, 'RAAUS-DEMO-55612', 'ARN-DEMO-882010', 'RAMPC',
    current_date + 22, current_date + 510, date '1988-04-07', 1180.00,
    'Morgan Demo', '0400 333 444', 'Partner', 'Club member', '03 5440 2000'
  from anchors
  on conflict (id) do update set
    raaus_id = excluded.raaus_id,
    casa_id = excluded.casa_id,
    medical_type = excluded.medical_type,
    medical_expiry = excluded.medical_expiry,
    licence_expiry = excluded.licence_expiry,
    prepaid_balance = excluded.prepaid_balance,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    emergency_contact_relationship = excluded.emergency_contact_relationship,
    occupation = excluded.occupation,
    alternate_phone = excluded.alternate_phone,
    updated_at = now()
  returning id
)
select count(*) from seed_students;

with anchors as (
  select
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    coalesce((select id from public.users where email = 'cot000055@live.com' limit 1), (select id from public.users where role = 'pilot' order by created_at desc limit 1)) as pilot_id,
    (select id from public.aircraft where registration = '24-4851' limit 1) as aircraft_4851,
    (select id from public.aircraft where registration = '24-4852' limit 1) as aircraft_4852,
    (select id from public.aircraft where registration = '24-5167' limit 1) as aircraft_5167,
    (select id from public.aircraft where registration = '24-5420' limit 1) as aircraft_5420,
    (select id from public.flight_types where name = 'PAYG' limit 1) as payg_id,
    (select id from public.flight_types where name = 'Pre-Paid' limit 1) as prepaid_id,
    (select id from public.flight_types where name = 'BFC Ops' limit 1) as ops_id
),
booking_rows as (
  select b.*
  from anchors
  cross join lateral (
    values
      (anchors.student_id, anchors.instructor_id, anchors.aircraft_4851, (current_date - 6 + time '08:30') at time zone 'Australia/Sydney', (current_date - 6 + time '10:00') at time zone 'Australia/Sydney', 'Pre-Paid', '[DEMO] Completed lesson - straight and level consolidation', 'completed', true, anchors.prepaid_id, false),
      (anchors.pilot_id, null::uuid, anchors.aircraft_5420, (current_date - 4 + time '15:00') at time zone 'Australia/Sydney', (current_date - 4 + time '16:10') at time zone 'Australia/Sydney', 'Pilot Account', '[DEMO] Completed private hire - local scenic flight', 'completed', true, anchors.payg_id, false),
      (anchors.student_id, anchors.instructor_id, anchors.aircraft_4851, (current_date + time '08:30') at time zone 'Australia/Sydney', (current_date + time '10:00') at time zone 'Australia/Sydney', 'Pre-Paid', '[DEMO] Effects of controls lesson. Review lookout, balance, and coordination.', 'confirmed', false, anchors.prepaid_id, false),
      (anchors.pilot_id, null::uuid, anchors.aircraft_4852, (current_date + time '10:15') at time zone 'Australia/Sydney', (current_date + time '11:45') at time zone 'Australia/Sydney', 'Pilot Account', '[DEMO] Solo hire to training area. Passenger briefing required.', 'confirmed', false, anchors.payg_id, false),
      (anchors.student_id, anchors.instructor_id, anchors.aircraft_4852, (current_date + time '10:30') at time zone 'Australia/Sydney', (current_date + time '11:30') at time zone 'Australia/Sydney', 'Pre-Paid', '[DEMO] Waitlist conflict example - circuit consolidation if aircraft becomes free.', 'confirmed', false, anchors.prepaid_id, true),
      (anchors.instructor_id, null::uuid, anchors.aircraft_5167, (current_date + time '13:00') at time zone 'Australia/Sydney', (current_date + time '14:15') at time zone 'Australia/Sydney', 'BFC Ops', '[DEMO] Club ops flight - post-maintenance check profile.', 'confirmed', false, anchors.ops_id, false),
      (anchors.student_id, anchors.instructor_id, anchors.aircraft_5420, (current_date + 1 + time '09:00') at time zone 'Australia/Sydney', (current_date + 1 + time '10:30') at time zone 'Australia/Sydney', 'Pre-Paid', '[DEMO] Medium turns and climbing turns. Include local radio practice.', 'confirmed', false, anchors.prepaid_id, false),
      (anchors.pilot_id, anchors.instructor_id, anchors.aircraft_4851, (current_date + 2 + time '14:00') at time zone 'Australia/Sydney', (current_date + 2 + time '15:00') at time zone 'Australia/Sydney', 'PAYG', '[DEMO] Currency check before passenger flight.', 'pending_approval', false, anchors.payg_id, false)
  ) as b(student_id, instructor_id, aircraft_id, start_time, end_time, payment_type, notes, status, flight_logged, flight_type_id, has_conflict)
),
inserted_bookings as (
  insert into public.bookings (
    student_id, instructor_id, aircraft_id, start_time, end_time, payment_type, notes,
    status, flight_logged, flight_type_id, has_conflict, approved_by, approved_at
  )
  select student_id, instructor_id, aircraft_id, start_time, end_time, payment_type, notes,
    status, flight_logged, flight_type_id, has_conflict,
    case when status in ('confirmed', 'completed') then instructor_id else null end,
    case when status in ('confirmed', 'completed') then now() - interval '2 hours' else null end
  from booking_rows
  returning *
)
insert into public.flight_logs (
  booking_id, aircraft_id, student_id, instructor_id, start_time, end_time,
  duration, tach_start, tach_end, start_tach, end_tach, flight_duration,
  dual_time, solo_time, takeoffs, landings, total_cost, calculated_cost,
  payment_type, payment_status, training_record_status, notes, comments,
  observations, fuel_added, oil_added, passengers, created_by, flight_type_id,
  hobbs_start, hobbs_end, fuel_start, fuel_end, oil_start, oil_end, fuel_type, aircraft_condition
)
select id, aircraft_id, student_id, instructor_id, start_time, end_time,
  case when notes like '%straight and level%' then 1.5 else 1.2 end,
  case when notes like '%straight and level%' then 9.1 else 42.3 end,
  case when notes like '%straight and level%' then 10.6 else 43.5 end,
  case when notes like '%straight and level%' then 9.1 else 42.3 end,
  case when notes like '%straight and level%' then 10.6 else 43.5 end,
  case when notes like '%straight and level%' then 1.5 else 1.2 end,
  case when instructor_id is not null then case when notes like '%straight and level%' then 1.5 else 0.0 end else 0 end,
  case when instructor_id is null then 1.2 else 0 end,
  case when instructor_id is null then 1 else 4 end,
  case when instructor_id is null then 1 else 4 end,
  case when instructor_id is null then 301.50 else 412.50 end,
  case when instructor_id is null then 301.50 else 412.50 end,
  payment_type,
  'paid',
  case when instructor_id is not null then 'recorded' else 'dismissed' end,
  '[DEMO] Flight log created for presentation data.',
  case when instructor_id is not null then '[DEMO] Good lookout scan and radio calls. Continue building stable attitude picture.' else '[DEMO] Smooth private hire, no aircraft issues reported.' end,
  'Normal operation. Oil and fuel checked serviceable.',
  case when instructor_id is null then 20 else 15 end,
  0,
  case when instructor_id is null then 1 else 0 end,
  coalesce(instructor_id, student_id),
  flight_type_id,
  case when notes like '%straight and level%' then 100.1 else 208.2 end,
  case when notes like '%straight and level%' then 101.6 else 209.4 end,
  78, 52, 6.5, 6.4, 'Avgas', 'Serviceable'
from inserted_bookings
where flight_logged = true;

with anchors as (
  select
    (select id from public.users where email = 'lincoln@bbkm.com.au' limit 1) as admin_id,
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    coalesce((select id from public.users where email = 'cot000055@live.com' limit 1), (select id from public.users where role = 'pilot' order by created_at desc limit 1)) as pilot_id,
    (select id from public.payment_methods where name = 'Bank Transfer' limit 1) as bank_transfer_id,
    (select id from public.payment_methods where name = 'Pilot Account' limit 1) as pilot_account_id
),
demo_logs as (
  select id, student_id, calculated_cost, row_number() over (order by start_time) as rn
  from public.flight_logs
  where notes ilike '[DEMO]%'
)
insert into public.account_transactions (
  user_id, type, amount, description, flight_log_id, payment_method_id,
  created_by, created_at, balance_after, verified_status
)
select demo_logs.student_id, 'flight_charge', -calculated_cost, '[DEMO] Flight charge from logged dual lesson', id, pilot_account_id, instructor_id, now() - interval '5 days', 12.00, 'verified'
from demo_logs, anchors
where rn = 1
union all
select pilot_id, 'flight_charge', -calculated_cost, '[DEMO] Flight charge from private hire', id, pilot_account_id, admin_id, now() - interval '3 days', 878.50, 'verified'
from demo_logs, anchors
where rn = 2
union all
select student_id, 'topup', 600.00, '[DEMO] Bank transfer top-up awaiting admin approval', null, bank_transfer_id, student_id, now() - interval '1 day', 612.00, 'pending'
from anchors
union all
select pilot_id, 'topup', 1200.00, '[DEMO] Verified account top-up for aircraft hire', null, bank_transfer_id, admin_id, now() - interval '8 days', 1180.00, 'verified'
from anchors;

with anchors as (
  select
    (select id from public.users where email = 'lincoln@bbkm.com.au' limit 1) as admin_id,
    (select id from public.aircraft where registration = '24-4851' limit 1) as aircraft_4851,
    (select id from public.aircraft where registration = '24-4852' limit 1) as aircraft_4852,
    (select id from public.aircraft where registration = '24-5167' limit 1) as aircraft_5167,
    (select id from public.aircraft where registration = '24-5420' limit 1) as aircraft_5420
),
inserted_milestones as (
  insert into public.maintenance_milestones (
    aircraft_id, title, due_condition, due_value, warning_threshold, notes, status,
    type, interval_hours, interval_months, last_completed_date, last_completed_tach,
    next_due_hours, next_due_date, description, is_one_time
  )
  select aircraft_4851, '[DEMO] 100 hourly inspection', 'hours', '110.0', '5', '[DEMO] Upcoming scheduled inspection with parts checklist ready.', 'due', 'hours', 100, 0, current_date - 35, 10.0, 110.0, null, 'Regular 100 hourly maintenance milestone.', false from anchors
  union all select aircraft_4852, '[DEMO] Annual inspection', 'date', (current_date + 18)::text, '14', '[DEMO] Calendar-based annual inspection due soon.', 'upcoming', 'calendar', 0, 12, current_date - 350, null, null, current_date + 18, 'Annual inspection due before continued club operations.', false from anchors
  union all select aircraft_5167, '[DEMO] Radio placard replacement', 'date', (current_date + 3)::text, '7', '[DEMO] One-time maintenance item for the demo board.', 'due', 'calendar', 0, 0, null, null, null, current_date + 3, 'Replace faded radio placard.', true from anchors
  union all select aircraft_5420, '[DEMO] Completed prop balance check', 'hours', '485.1', '5', '[DEMO] Completed one-time milestone for history display.', 'completed', 'hours', 0, 0, current_date - 2, 485.1, null, null, 'One-time propeller balance check completed.', true from anchors
  returning *
)
insert into public.maintenance_completions (
  milestone_id, aircraft_id, completed_by, completed_at, notes, tach_hours,
  hobbs_hours, completed_date, completed_tach
)
select id, aircraft_id, (select admin_id from anchors), now() - interval '2 days',
  '[DEMO] Maintenance action completed and released to service.', 485.1, 491.4, current_date - 2, 485.1
from inserted_milestones
where status = 'completed';

with anchors as (
  select
    (select id from public.users where email = 'lincoln@bbkm.com.au' limit 1) as admin_id,
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.aircraft where registration = '24-4851' limit 1) as aircraft_4851,
    (select id from public.aircraft where registration = '24-5420' limit 1) as aircraft_5420
)
insert into public.defects (
  aircraft_id, reported_by, date_reported, description, status, mel_notes,
  severity, location, tach_hours, hobbs_hours, updated_by, fix_notes, grounded_aircraft
)
select aircraft_4851, 'Lincoln Cottingham', now() - interval '1 day', '[DEMO] Landing light intermittent during preflight check.', 'open', 'Can dispatch daylight VFR only until rectified.', 'Minor', 'Nose cowl', 108.4, 114.2, instructor_id, null, false from anchors
union all
select aircraft_5420, 'Maintenance Officer', now() - interval '7 days', '[DEMO] Brake pedal feel soft after taxi.', 'fixed', null, 'Major', 'Left main wheel', 484.6, 490.9, admin_id, 'Bled brake line and performed functional check.', false from anchors;

with anchors as (
  select
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    coalesce((select id from public.users where email = 'cot000055@live.com' limit 1), (select id from public.users where role = 'pilot' order by created_at desc limit 1)) as pilot_id,
    (select id from public.safety_report_categories where name = 'Hazard' limit 1) as hazard_category,
    (select id from public.safety_report_categories where name = 'Operational Occurrence' limit 1) as ops_category
)
insert into public.safety_reports (
  reporter_id, category_id, report_type, severity, title, description, location,
  immediate_actions, involved_user_ids, status, assigned_to, created_at
)
select student_id, hazard_category, 'hazard', 'medium', '[DEMO] Fuel bowser hose left across walkway',
  '[DEMO] Student identified a trip hazard near the refuelling area before the morning lesson.',
  'Fuel bay', 'Hose moved clear of walkway and reminder added to morning brief.', array[student_id], 'under_review', 'Safety Officer', now() - interval '16 hours' from anchors
union all
select instructor_id, ops_category, 'incident', 'low', '[DEMO] Unstable approach go-around decision',
  '[DEMO] Instructor initiated a go-around during circuit training and used it as a positive TEM example.',
  'Bendigo circuit', 'Debrief completed. No damage or injury.', array[student_id, instructor_id], 'closed', 'Chief Flying Instructor', now() - interval '5 days' from anchors
union all
select pilot_id, hazard_category, 'risk_assessment', 'high', '[DEMO] Forecast crosswind near club solo limit',
  '[DEMO] Pilot raised a pre-flight risk assessment for a passenger scenic booking with strengthening crosswind.',
  'Operations room', 'Booking held pending updated TAF and instructor review.', array[pilot_id], 'open', 'Duty Instructor', now() - interval '2 hours' from anchors;

with anchors as (
  select
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id
)
insert into public.instructor_absences (
  instructor_id, user_id, start_date, end_date, start_time, end_time, reason
)
select instructor_id, instructor_id, current_date + 1, current_date + 1, time '12:00', time '14:00', '[DEMO] Temporary off period - CFI meeting' from anchors
union all
select instructor_id, instructor_id, current_date + 3, current_date + 3, time '15:30', time '17:00', '[DEMO] Temporary off period - medical appointment' from anchors;

with anchors as (
  select
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    (select id from public.aircraft where registration = '24-4851' limit 1) as aircraft_id,
    (select id from public.training_courses where title = 'RAAus Ab-Initio RPC' limit 1) as course_id,
    (select id from public.training_lessons where name = 'Effects of controls' limit 1) as effects_lesson_id,
    (select id from public.training_lessons where name = 'Straight and level' limit 1) as straight_lesson_id,
    (select id from public.training_lessons where name = 'Medium turns, climbing turns and descending turns' limit 1) as turns_lesson_id,
    (select id from public.training_lessons where name = 'Pilot Certificate Flight Test' limit 1) as flight_test_lesson_id
),
logged_dual as (
  select id from public.flight_logs
  where notes ilike '[DEMO]%' and instructor_id is not null
  order by start_time
  limit 1
),
inserted_training as (
  insert into public.training_records (
    student_id, instructor_id, date, aircraft_id, aircraft_type, registration,
    dual_time_min, solo_time_min, comments, formal_briefing, lesson_codes,
    next_lesson, status, student_ack, student_ack_name, instructor_sign_timestamp,
    student_ack_timestamp, course_id, lesson_id, briefing_comments, criteria_grades,
    flight_log_id, student_comments, audit_log, is_flight_review, flight_review_type,
    flight_review_result, flight_review_notes, pilot_role_granted
  )
  select student_id, instructor_id, current_date - 6, aircraft_id, 'Tecnam P92', '24-4851',
    90, 0,
    '[DEMO] Student maintained improved attitude control and recovered promptly from minor heading drift.',
    true,
    array['Effects of controls', 'Straight and level'],
    'Straight and level',
    'submitted',
    true,
    'Test Student',
    now() - interval '6 days' + interval '2 hours',
    now() - interval '5 days',
    course_id,
    effects_lesson_id,
    '[DEMO] Normal pre-flight brief. Discussed handover/takeover and positive exchange of controls.',
    jsonb_build_object('effects-of-controls', 'S', 'straight-level', '-', 'airmanship-hf', 'S', 'flt-prep-ground-ops', 'S'),
    (select id from logged_dual),
    'I understood the exercise and want more practice trimming accurately.',
    jsonb_build_array(
      jsonb_build_object('action', 'record_submitted', 'actorName', 'Lincoln Cottingham', 'timestamp', (now() - interval '6 days' + interval '2 hours')::text),
      jsonb_build_object('action', 'student_acknowledged_record', 'actorName', 'Test Student', 'timestamp', (now() - interval '5 days')::text)
    ),
    false, null, null, null, false
  from anchors
  union all
  select student_id, instructor_id, current_date - 2, aircraft_id, 'Tecnam P92', '24-4851',
    75, 0,
    '[DEMO] Good entry and recovery from medium turns. Continue working on balanced rudder in climbing turns.',
    true,
    array['Medium turns', 'Climbing turns'],
    'Slow flight and basic stalls',
    'submitted',
    false,
    null,
    now() - interval '2 days',
    null,
    course_id,
    turns_lesson_id,
    '[DEMO] Emphasised TEM and maintaining area awareness while practising turns.',
    jsonb_build_object('basic-turning', 'S', 'climbing', 'S', 'descending', 'S', 'airmanship-hf', 'S'),
    null,
    '',
    jsonb_build_array(jsonb_build_object('action', 'record_submitted', 'actorName', 'Lincoln Cottingham', 'timestamp', (now() - interval '2 days')::text)),
    false, null, null, null, false
  from anchors
  union all
  select student_id, instructor_id, current_date - 1, aircraft_id, 'Tecnam P92', '24-4851',
    0, 0,
    '[DEMO] Pilot Certificate Flight Test completed to standard. Student demonstrated safe command decision making.',
    true,
    array['Flight Test'],
    'Post-certificate consolidation',
    'submitted',
    true,
    'Test Student',
    now() - interval '1 day',
    now() - interval '18 hours',
    course_id,
    flight_test_lesson_id,
    '[DEMO] Flight review/test record for showing pilot qualification workflow.',
    jsonb_build_object('flight-test', 'C', 'practice-flight-test', 'C', 'forced-landings', 'C', 'airmanship-hf', 'C'),
    null,
    'Acknowledged test result.',
    jsonb_build_array(
      jsonb_build_object('action', 'record_submitted', 'actorName', 'Lincoln Cottingham', 'timestamp', (now() - interval '1 day')::text),
      jsonb_build_object('action', 'student_acknowledged_record', 'actorName', 'Test Student', 'timestamp', (now() - interval '18 hours')::text)
    ),
    true, 'Pilot Certificate Flight Test', 'pass', '[DEMO] Pass - RPC standard met.', true
  from anchors
  returning id
)
select count(*) from inserted_training;

with anchors as (
  select
    (select id from public.users where email = 'cot000055@gmail.com' limit 1) as instructor_id,
    (select id from public.users where email = 'lincolnsaviation@gmail.com' limit 1) as student_id,
    (select id from public.training_courses where title = 'RAAus Ab-Initio RPC' limit 1) as course_id
)
insert into public.student_exam_results (
  student_id, course_id, exam_id, exam_name, score, pass_mark, result,
  exam_date, notes, instructor_id, file_name, file_type, file_size, storage_path
)
select student_id, course_id, 'demo-presolo', 'Presolo Exam', 86, 80, 'pass',
  current_date - 3, '[DEMO] Strong result. Revisit local emergency procedure wording before solo sign-off.', instructor_id,
  null, null, 0, null
from anchors
union all
select student_id, course_id, 'demo-radio', 'Radio Exam', 74, 80, 'fail',
  current_date - 1, '[DEMO] Good phraseology foundations, needs another practice run on CTAF conflict calls.', instructor_id,
  null, null, 0, null
from anchors;

commit;
