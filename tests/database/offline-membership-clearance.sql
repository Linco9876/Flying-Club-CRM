-- Run in a new disposable database. No provider requests or actual member changes.
\set ON_ERROR_STOP on
begin;
create schema private;
create function private.assert_function_permission_manifest() returns void language plpgsql as $$ begin return; end $$;
create table club_memberships(id uuid, user_id uuid, legal_status text, membership_class_id uuid);
create table membership_classes(id uuid, code text, name text, can_self_book_aircraft boolean);
create table membership_settings(id boolean, rollout_mode text);
create table membership_financial_periods(id uuid, membership_id uuid, financial_year_start date, financial_year_end date, fee_disposition text, due_date date, grace_expires_at timestamptz, xero_last_synced_at timestamptz);
create table xero_connection_settings(id boolean, tenant_id text, disconnected_at timestamptz, connection_mode text);
create function current_user_has_staff_role() returns boolean language sql as $$ select true $$;
\ir ../../supabase/migrations/20260909210000_clear_approved_members_while_xero_disconnected.sql
insert into membership_settings values(true,'enforced');
do $$
declare u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); result jsonb;
begin
  insert into membership_classes values(c,'flying','Flying',true);
  result:=assess_member_booking_eligibility(u,now());
  assert not (result->>'eligible')::boolean, 'Missing membership must fail';
  insert into club_memberships values(m,u,'current',c);
  result:=assess_member_booking_eligibility(u,now());
  assert (result->>'eligible')::boolean, 'Approved member without fee period must clear offline';
  insert into membership_financial_periods(id,membership_id,financial_year_start,financial_year_end,fee_disposition) values(gen_random_uuid(),m,current_date-1,current_date+1,'invoice_required');
  result:=assess_member_booking_eligibility(u,now());
  assert (result->>'eligible')::boolean and not (result->>'requiresStaffOverride')::boolean;
  assert result->>'feeDisposition'='invoice_required', 'Do not fabricate a payment';
  insert into xero_connection_settings values(true,'tenant',now(),'disconnected');
  assert (assess_member_booking_eligibility(u,now())->>'eligible')::boolean;
  update xero_connection_settings set disconnected_at=null, connection_mode='inventory_only';
  assert not (assess_member_booking_eligibility(u,now())->>'eligible')::boolean, 'Connected read-only Xero must retain fee checks';
  update membership_financial_periods set fee_disposition='paid';
  assert (assess_member_booking_eligibility(u,now())->>'eligible')::boolean;
  update xero_connection_settings set connection_mode='disconnected';
  update club_memberships set legal_status='suspended';
  assert not (assess_member_booking_eligibility(u,now())->>'eligible')::boolean, 'Suspended member must fail offline';
  update club_memberships set legal_status='current';
  update membership_classes set can_self_book_aircraft=false;
  assert not (assess_member_booking_eligibility(u,now())->>'eligible')::boolean, 'Class restrictions must remain';
  assert (assess_member_booking_eligibility(u,now(),true)->>'eligible')::boolean;
  raise notice 'Offline clearance, reconnect, unpaid preservation, suspension and class checks passed';
end $$;
rollback;
