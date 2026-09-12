\set ON_ERROR_STOP on
begin;
select set_config('test.user_id','00000000-0000-0000-0000-000000000001',false);
insert into users(id,email,name,role) values
 ('00000000-0000-0000-0000-000000000001','examiner@example.test','Examiner','instructor'),
 ('00000000-0000-0000-0000-000000000002','student@example.test','Candidate','student');
insert into students(id,raaus_id,licence_expiry) values('00000000-0000-0000-0000-000000000002','012345','2027-09-01');
insert into aircraft(id,registration,make,model,type) values('00000000-0000-0000-0000-000000000003','24-TEST','Tecnam','P92','single_engine');
insert into training_courses(id,title,course_purpose,status,review_configuration) values
 ('00000000-0000-0000-0000-000000000004','RPC test','flight_test','published','{"review_type":"raaus_rpc_flight_test","required_evidence":[],"checklist":[{"key":"one","required":true},{"key":"two","required":true}]}'),
 ('00000000-0000-0000-0000-000000000005','RAAus Ab-Initio','training','published','{}');
insert into training_lessons(id,course_id,name,is_flight_test,flight_review_template_id) values
 ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','Flight Test',true,'00000000-0000-0000-0000-000000000004');
insert into student_course_enrolments(student_id,course_id) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005');
insert into flight_logs(id,booking_id,student_id,instructor_id,aircraft_id,start_time,end_time,dual_time,solo_time,comments) select
 ('00000000-0000-0000-0000-0000000000'||n)::uuid,gen_random_uuid(),'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',
 ts,ts+interval '1 hour',1,0,'Observed test flight' from (values ('10','2026-08-01 00:00:00+00'::timestamptz),('11','2026-08-31 00:00:00+00'),('12','2026-09-01 00:00:00+00'),('13','2026-07-31 00:00:00+00')) logs(n,ts);
insert into flight_review_records(id,template_course_id,template_snapshot,candidate_id,reviewer_user_id,review_type,authority,assessment_details)
 select '00000000-0000-0000-0000-000000000020',id,jsonb_build_object('review_configuration',review_configuration),
 '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','raaus_rpc_flight_test','raaus',
 '{"detailsConfirmed":true,"applicantMembershipNumber":"012345","applicantMembershipExpiry":"2027-09-01","totalFlightHours":20,"dualFlightHours":15,"commandFlightHours":5,"raausFlightHours":20,"endorsementsSought":["Flight Radio"]}'
 from training_courses where id='00000000-0000-0000-0000-000000000004';
insert into flight_review_record_items(review_record_id,template_item_key,section,code,title,result,notes) values
 ('00000000-0000-0000-0000-000000000020','one','Competencies','one','Radio','satisfactory','Original competency evidence'),
 ('00000000-0000-0000-0000-000000000020','two','Competencies','two','Forced landing','further_training','Original unsuccessful evidence');
do $$begin
 begin update flight_review_records set status='further_training_required',reviewer_summary='Landing needs work',reviewer_sign_name='Examiner',reviewer_sign_at=now() where id='00000000-0000-0000-0000-000000000020'; raise exception 'TEST failed: unlinked submission accepted';
 exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
end$$;
insert into training_deficiencies(student_id,course_id,stage,status) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','pre_test','open');
update flight_review_records set flight_log_id='00000000-0000-0000-0000-000000000010',status='further_training_required',reviewer_summary='Landing needs work',reviewer_sign_name='Examiner',reviewer_sign_at=now() where id='00000000-0000-0000-0000-000000000020';
do $$declare rid uuid; count_before integer; original_hash text; begin
 assert (select count(*) from training_records where flight_review_record_id='00000000-0000-0000-0000-000000000020' and flight_review_result='fail')=1,'Unsuccessful attempt must appear in enrolled course';
 assert (select review_date='2026-08-01' and flight_minutes=60 and registration='24-TEST' from flight_review_records where id='00000000-0000-0000-0000-000000000020'),'Flight details must come from the log';
 select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) into original_hash from flight_review_record_items i where review_record_id='00000000-0000-0000-0000-000000000020';
 begin delete from flight_review_records where id='00000000-0000-0000-0000-000000000020'; raise exception 'TEST failed: original assessment deleted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 rid:=start_rpc_retest('00000000-0000-0000-0000-000000000020');
 assert start_rpc_retest('00000000-0000-0000-0000-000000000020')=rid,'Double click must return the same open retest';
 assert (select count(*) from flight_review_record_items where review_record_id=rid and result='satisfactory' and carried_from_item_id is not null)=1,'Only satisfactory work is carried';
 assert (select count(*) from flight_review_record_items where review_record_id=rid and template_item_key='two' and result='not_assessed')=1,'Unsuccessful component needs assessment';
 begin update flight_review_records set flight_log_id='00000000-0000-0000-0000-000000000010' where id=rid; raise exception 'TEST failed: same flight accepted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 begin update flight_review_records set flight_log_id='00000000-0000-0000-0000-000000000012' where id=rid; raise exception 'TEST failed: day 31 accepted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 begin update flight_review_records set flight_log_id='00000000-0000-0000-0000-000000000013' where id=rid; raise exception 'TEST failed: earlier flight accepted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 update flight_review_records set flight_log_id='00000000-0000-0000-0000-000000000011' where id=rid;
 -- The editor loads refreshed totals for the new attempt rather than reusing the first test's hours.
 update flight_review_records set assessment_details=assessment_details||(rpc_review_context(rid)->'defaults') where id=rid;
 assert (select assessment_details->>'dualFlightHours'='3.0' from flight_review_records where id=rid),'Prefill must include completed flight log totals through the attached test';
 begin update flight_review_records set retest_of_id=null,retest_root_id=null where id=rid; raise exception 'TEST failed: retest chain removed'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 begin update flight_review_record_items set notes='Overwritten' where review_record_id='00000000-0000-0000-0000-000000000020'; raise exception 'TEST failed: original evidence changed'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 begin update flight_review_records set status='completed',reviewer_sign_name='Examiner',reviewer_sign_at=now(),assessment_details=assessment_details||'{"detailsConfirmed":true}' where id=rid; raise exception 'TEST failed: incomplete retest passed'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 update flight_review_record_items set result='satisfactory',notes='Competent on the new flight' where review_record_id=rid and template_item_key='two';
 begin update flight_review_records set status='completed',reviewer_sign_name='Examiner',reviewer_sign_at=now(),assessment_details=assessment_details||'{"detailsConfirmed":true}' where id=rid; raise exception 'TEST failed: unresolved deficiency allowed pass'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 update training_deficiencies set status='fixed';
 update flight_review_records set status='completed',reviewer_sign_name='Examiner',reviewer_sign_at=now(),assessment_details=assessment_details||'{"detailsConfirmed":true}' where id=rid;
 assert (select count(*) from training_records where flight_review_record_id=rid and flight_review_result='pass')=1,'Successful retest must appear once in the course';
 assert (select md5(jsonb_agg(to_jsonb(i) order by i.id)::text) from flight_review_record_items i where review_record_id='00000000-0000-0000-0000-000000000020')=original_hash,'Original checklist and notes must remain byte-for-byte intact';
 perform private.sync_rpc_course_record(rid);
 assert (select count(*) from training_records where flight_review_record_id=rid)=1,'Repeated synchronisation must not duplicate a course record';
 perform set_config('test.staff','false',true);
 begin perform start_rpc_retest('00000000-0000-0000-0000-000000000020'); raise exception 'TEST failed: nonstaff retest accepted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
 perform set_config('test.staff','true',true); perform set_config('test.aal','aal1',true);
 begin perform start_rpc_retest('00000000-0000-0000-0000-000000000020'); raise exception 'TEST failed: low assurance retest accepted'; exception when others then if sqlerrm like 'TEST%' then raise; end if; end;
end$$;
rollback;
\echo RPC review workflow assertions passed
