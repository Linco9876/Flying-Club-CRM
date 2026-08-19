-- Make Full and Junior membership age eligibility symmetrical.
-- Minors cannot apply for, request, or be assigned Full membership through normal
-- portal workflows. The existing Junior under-18 rule remains in force.

create or replace function private.enforce_junior_membership_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_code text;
  v_date_of_birth date;
begin
  select membership_class.code into v_class_code
  from public.membership_classes membership_class
  where membership_class.id = new.membership_class_id;

  if v_class_code not in ('junior', 'full') then return new; end if;

  select member.date_of_birth into v_date_of_birth
  from public.users member
  where member.id = new.user_id;

  if v_class_code = 'junior' then
    if v_date_of_birth is null then
      raise exception 'A date of birth is required for Junior membership';
    end if;
    if v_date_of_birth <= (current_date - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18';
    end if;
  elsif v_date_of_birth is not null
     and v_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'Full membership is not available while the member is under 18';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_membership_application_age_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_code text;
begin
  select membership_class.code into v_class_code
  from public.membership_classes membership_class
  where membership_class.id = new.membership_class_id;

  if v_class_code = 'junior' then
    if new.date_of_birth is null then
      raise exception 'A date of birth is required for Junior membership';
    end if;
    if new.date_of_birth <= (current_date - interval '18 years')::date then
      raise exception 'Junior membership is only available to applicants under 18';
    end if;
  elsif v_class_code = 'full' then
    if new.date_of_birth is null then
      raise exception 'A date of birth is required to confirm Full membership eligibility';
    end if;
    if new.date_of_birth > (current_date - interval '18 years')::date then
      raise exception 'Full membership is not available to applicants under 18';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_membership_application_age_eligibility
  on public.membership_applications;
create trigger enforce_membership_application_age_eligibility
before insert or update of membership_class_id, date_of_birth
on public.membership_applications
for each row execute function private.enforce_membership_application_age_eligibility();

create or replace function private.enforce_membership_change_age_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class_code text;
  v_date_of_birth date;
begin
  select membership_class.code into v_class_code
  from public.membership_classes membership_class
  where membership_class.id = new.to_membership_class_id;

  if v_class_code not in ('junior', 'full') then return new; end if;

  select member.date_of_birth into v_date_of_birth
  from public.users member
  where member.id = new.user_id;

  if v_class_code = 'junior' then
    if v_date_of_birth is null then
      raise exception 'A date of birth is required for Junior membership';
    end if;
    if v_date_of_birth <= (new.effective_on - interval '18 years')::date then
      raise exception 'Junior membership is only available while the member is under 18 on the change date';
    end if;
  else
    if v_date_of_birth is null then
      raise exception 'A date of birth is required to confirm Full membership eligibility';
    end if;
    if v_date_of_birth > (current_date - interval '18 years')::date then
      raise exception 'Full membership is not available while the member is under 18';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_membership_change_age_eligibility
  on public.membership_change_requests;
create trigger enforce_membership_change_age_eligibility
before insert or update of user_id, to_membership_class_id, effective_on
on public.membership_change_requests
for each row execute function private.enforce_membership_change_age_eligibility();

comment on function private.enforce_junior_membership_eligibility() is
  'Prevents known minors from holding Full membership and preserves strict Junior eligibility.';
comment on function private.enforce_membership_application_age_eligibility() is
  'Rejects Full applications from minors and Junior applications from adults.';
comment on function private.enforce_membership_change_age_eligibility() is
  'Rejects membership-change requests that would expose a minor to Full membership.';
