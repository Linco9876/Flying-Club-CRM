alter table public.membership_applications
  add column if not exists privacy_notice_version text,
  add column if not exists privacy_notice_accepted_at timestamptz;

comment on column public.membership_applications.privacy_notice_version is
  'Version of the portal privacy notice affirmatively acknowledged by the applicant.';
comment on column public.membership_applications.privacy_notice_accepted_at is
  'Time the applicant affirmatively acknowledged the portal privacy notice.';

create or replace function public.validate_membership_application_privacy()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_meta jsonb;
begin
  if new.date_of_birth is null then
    raise exception 'Date of birth is required for all membership applications';
  end if;

  if new.privacy_notice_accepted_at is null or nullif(trim(coalesce(new.privacy_notice_version, '')), '') is null then
    select raw_user_meta_data into v_meta from auth.users where id = new.user_id;
    if coalesce((v_meta ->> 'privacy_notice_accepted')::boolean, false) is not true then
      raise exception 'The portal privacy notice must be acknowledged';
    end if;
    new.privacy_notice_version := nullif(trim(v_meta ->> 'privacy_notice_version'), '');
    new.privacy_notice_accepted_at := coalesce(
      nullif(v_meta ->> 'privacy_notice_accepted_at', '')::timestamptz,
      now()
    );
  end if;

  if new.privacy_notice_version is null then
    raise exception 'Privacy notice version is required';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_membership_application_privacy() from public, anon, authenticated;
grant execute on function public.validate_membership_application_privacy() to service_role;

drop trigger if exists validate_membership_application_privacy on public.membership_applications;
create trigger validate_membership_application_privacy
before insert on public.membership_applications
for each row execute function public.validate_membership_application_privacy();

drop function if exists public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean
);

create function public.submit_membership_application(
  p_membership_class_code text,
  p_residential_address text,
  p_service_address text,
  p_date_of_birth date,
  p_guardian_name text default null,
  p_guardian_consent boolean default false,
  p_supports_club_purposes boolean default false,
  p_agrees_to_constitution boolean default false,
  p_agrees_to_member_guarantee boolean default false,
  p_agrees_to_code_of_conduct boolean default false,
  p_agrees_to_members_manual boolean default false,
  p_privacy_notice_accepted boolean default false,
  p_privacy_notice_version text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_class_id uuid;
  v_application_id uuid;
  v_days integer;
  v_doc record;
begin
  if v_user_id is null then raise exception 'Sign in before applying for membership'; end if;
  if nullif(trim(coalesce(p_residential_address, '')), '') is null then raise exception 'Residential address is required'; end if;
  if p_date_of_birth is null then raise exception 'Date of birth is required'; end if;
  if not p_privacy_notice_accepted or nullif(trim(coalesce(p_privacy_notice_version, '')), '') is null then
    raise exception 'The portal privacy notice must be acknowledged';
  end if;
  if not (p_supports_club_purposes and p_agrees_to_constitution and p_agrees_to_member_guarantee
          and p_agrees_to_code_of_conduct and p_agrees_to_members_manual) then
    raise exception 'All membership declarations must be accepted';
  end if;
  if p_date_of_birth > (current_date - interval '18 years')::date
     and (not p_guardian_consent or nullif(trim(coalesce(p_guardian_name, '')), '') is null) then
    raise exception 'Guardian consent is required for applicants under 18';
  end if;
  if p_membership_class_code = 'junior'
     and p_date_of_birth <= (current_date - interval '18 years')::date then
    raise exception 'Junior membership requires the applicant to be under 18';
  end if;
  if exists (select 1 from public.membership_applications where user_id = v_user_id and status = 'pending') then
    raise exception 'You already have a pending membership application';
  end if;
  if exists (select 1 from public.club_memberships where user_id = v_user_id and legal_status = 'current') then
    raise exception 'You already have a current BFC membership';
  end if;
  select id into v_class_id from public.membership_classes
  where code = p_membership_class_code and code <> 'life' and is_active;
  if v_class_id is null then raise exception 'Select Full, Junior or Affiliate membership'; end if;
  select automatic_commencement_days into v_days from public.membership_settings where id = true;

  insert into public.membership_applications(
    user_id, membership_class_id, residential_address, service_address, date_of_birth,
    supports_club_purposes, agrees_to_constitution, agrees_to_member_guarantee,
    agrees_to_code_of_conduct, agrees_to_members_manual, guardian_name, guardian_consent,
    automatic_commencement_at, privacy_notice_version, privacy_notice_accepted_at
  ) values (
    v_user_id, v_class_id, trim(p_residential_address),
    coalesce(nullif(trim(coalesce(p_service_address, '')), ''), trim(p_residential_address)), p_date_of_birth,
    p_supports_club_purposes, p_agrees_to_constitution, p_agrees_to_member_guarantee,
    p_agrees_to_code_of_conduct, p_agrees_to_members_manual,
    nullif(trim(coalesce(p_guardian_name, '')), ''), p_guardian_consent,
    now() + coalesce(v_days, 30) * interval '1 day', trim(p_privacy_notice_version), now()
  ) returning id into v_application_id;

  update public.users set address = trim(p_residential_address), date_of_birth = p_date_of_birth, updated_at = now()
  where id = v_user_id;
  for v_doc in select * from public.membership_documents where is_current and acknowledgement_required
  loop
    insert into public.membership_application_acknowledgements(application_id, document_id, acknowledgement_text)
    values (v_application_id, v_doc.id, format('Applicant acknowledged %s version %s in the BFC portal.', v_doc.title, v_doc.version));
  end loop;
  insert into public.membership_status_events(application_id, user_id, event_type, actor_id, details)
  values (
    v_application_id,
    v_user_id,
    'application_submitted',
    v_user_id,
    jsonb_build_object('source', 'membership_portal', 'privacy_notice_version', trim(p_privacy_notice_version))
  );
  return v_application_id;
end;
$$;

revoke all on function public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text
) from public, anon;
grant execute on function public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text
) to authenticated, service_role;
