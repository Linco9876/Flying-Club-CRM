alter table public.membership_documents
  add column if not exists storage_path text,
  add column if not exists uploaded_file_name text,
  add column if not exists file_size_bytes bigint,
  add column if not exists mime_type text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

comment on table public.membership_documents is
  'Versioned organisation documents. Current rows with acknowledgement_required are presented and acknowledged during membership signup.';
comment on column public.membership_documents.acknowledgement_required is
  'When true, the current version must be read and acknowledged during membership signup.';
comment on column public.membership_documents.storage_path is
  'Private organisation-documents bucket path. Historical files are retained for acknowledgement evidence.';

with ranked as (
  select id, row_number() over (partition by code order by effective_date desc, created_at desc, id desc) as position
  from public.membership_documents
  where is_current
)
update public.membership_documents document
set is_current = false, updated_at = now()
from ranked
where document.id = ranked.id and ranked.position > 1;

create unique index if not exists membership_documents_one_current_per_code
  on public.membership_documents(code)
  where is_current;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organisation-documents',
  'organisation-documents',
  false,
  15728640,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read current membership documents" on public.membership_documents;
create policy "Public can read current membership documents"
on public.membership_documents for select to anon
using (is_current and acknowledgement_required);

drop policy if exists "Public can read current membership document files" on storage.objects;
create policy "Public can read current membership document files"
on storage.objects for select to anon
using (
  bucket_id = 'organisation-documents'
  and exists (
    select 1
    from public.membership_documents document
    where document.storage_path = name
      and document.is_current
      and document.acknowledgement_required
  )
);

drop policy if exists "Portal users can read organisation document files" on storage.objects;
create policy "Portal users can read organisation document files"
on storage.objects for select to authenticated
using (
  bucket_id = 'organisation-documents'
  and exists (
    select 1
    from public.membership_documents document
    where document.storage_path = name
  )
);

drop policy if exists "Admins upload organisation document files" on storage.objects;
create policy "Admins upload organisation document files"
on storage.objects for insert to authenticated
with check (bucket_id = 'organisation-documents' and public.current_user_is_admin());

drop policy if exists "Admins update organisation document files" on storage.objects;
create policy "Admins update organisation document files"
on storage.objects for update to authenticated
using (bucket_id = 'organisation-documents' and public.current_user_is_admin())
with check (bucket_id = 'organisation-documents' and public.current_user_is_admin());

drop policy if exists "Admins delete unreferenced organisation document files" on storage.objects;
create policy "Admins delete unreferenced organisation document files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'organisation-documents'
  and public.current_user_is_admin()
  and not exists (
    select 1 from public.membership_documents document where document.storage_path = name
  )
);

create or replace function public.publish_organisation_document_version(
  p_replaces_document_id uuid,
  p_code text,
  p_title text,
  p_version text,
  p_effective_date date,
  p_storage_path text,
  p_uploaded_file_name text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_acknowledgement_required boolean,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_code text := lower(trim(coalesce(p_code, '')));
  v_document_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  if v_code !~ '^[a-z0-9][a-z0-9_-]{1,79}$' then
    raise exception 'Document code must use letters, numbers, hyphens or underscores';
  end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'Document title is required'; end if;
  if nullif(trim(coalesce(p_version, '')), '') is null then raise exception 'Document version is required'; end if;
  if p_effective_date is null then raise exception 'Effective date is required'; end if;
  if nullif(trim(coalesce(p_storage_path, '')), '') is null then raise exception 'Upload a document file'; end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 15728640 then
    raise exception 'Document file must be no larger than 15 MB';
  end if;
  if p_mime_type not in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) then
    raise exception 'Document must be a PDF or Word file';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'organisation-documents' and name = trim(p_storage_path)
  ) then
    raise exception 'The uploaded document file could not be found';
  end if;

  if p_replaces_document_id is not null then
    select code into v_code
    from public.membership_documents
    where id = p_replaces_document_id and is_current
    for update;
    if v_code is null then raise exception 'The document being updated is no longer current'; end if;
  elsif exists (
    select 1 from public.membership_documents where code = v_code and is_current
  ) then
    raise exception 'A current document with that code already exists';
  end if;

  update public.membership_documents
  set is_current = false, updated_at = now(), updated_by = auth.uid()
  where code = v_code and is_current;

  insert into public.membership_documents (
    code,
    title,
    version,
    effective_date,
    document_url,
    storage_path,
    uploaded_file_name,
    file_size_bytes,
    mime_type,
    acknowledgement_required,
    is_current,
    notes,
    updated_at,
    updated_by
  ) values (
    v_code,
    trim(p_title),
    trim(p_version),
    p_effective_date,
    null,
    trim(p_storage_path),
    nullif(trim(coalesce(p_uploaded_file_name, '')), ''),
    p_file_size_bytes,
    p_mime_type,
    coalesce(p_acknowledgement_required, false),
    true,
    nullif(trim(coalesce(p_notes, '')), ''),
    now(),
    auth.uid()
  )
  returning id into v_document_id;

  return v_document_id;
exception
  when unique_violation then
    raise exception 'That version already exists for this document';
end;
$$;

create or replace function public.set_organisation_document_acknowledgement(
  p_document_id uuid,
  p_acknowledgement_required boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  update public.membership_documents
  set acknowledgement_required = coalesce(p_acknowledgement_required, false),
      updated_at = now(),
      updated_by = auth.uid()
  where id = p_document_id and is_current;
  if not found then raise exception 'Current document was not found'; end if;
end;
$$;

create or replace function public.archive_organisation_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Administrator permission is required';
  end if;
  update public.membership_documents
  set is_current = false, updated_at = now(), updated_by = auth.uid()
  where id = p_document_id and is_current;
  if not found then raise exception 'Current document was not found'; end if;
end;
$$;

create or replace function public.assert_current_membership_documents_acknowledged(
  p_document_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_ids uuid[] := coalesce(p_document_ids, '{}'::uuid[]);
begin
  if exists (
    select 1
    from public.membership_documents document
    where document.is_current
      and document.acknowledgement_required
      and not (document.id = any(v_document_ids))
  ) then
    raise exception 'Read and acknowledge every current membership document before continuing';
  end if;
  if exists (
    select 1
    from unnest(v_document_ids) acknowledged_id
    where not exists (
      select 1
      from public.membership_documents document
      where document.id = acknowledged_id
        and document.is_current
        and document.acknowledgement_required
    )
  ) then
    raise exception 'The membership documents changed. Review the current versions before continuing';
  end if;
end;
$$;

drop function if exists public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text
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
  p_privacy_notice_version text default null,
  p_acknowledged_document_ids uuid[] default '{}'::uuid[],
  p_applicant_name text default null,
  p_phone text default null,
  p_update_profile boolean default false
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
  if p_update_profile and nullif(trim(coalesce(p_applicant_name, '')), '') is null then
    raise exception 'Full name is required';
  end if;
  perform public.assert_current_membership_documents_acknowledged(p_acknowledged_document_ids);
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

  update public.users
  set name = case
        when p_update_profile then trim(p_applicant_name)
        else name
      end,
      phone = case
        when p_update_profile then nullif(trim(coalesce(p_phone, '')), '')
        else phone
      end,
      mobile_phone = case
        when p_update_profile then nullif(trim(coalesce(p_phone, '')), '')
        else mobile_phone
      end,
      address = trim(p_residential_address),
      date_of_birth = p_date_of_birth,
      updated_at = now()
  where id = v_user_id;

  for v_doc in
    select *
    from public.membership_documents
    where id = any(coalesce(p_acknowledged_document_ids, '{}'::uuid[]))
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
    jsonb_build_object(
      'source', 'membership_portal',
      'privacy_notice_version', trim(p_privacy_notice_version),
      'membership_document_ids', to_jsonb(coalesce(p_acknowledged_document_ids, '{}'::uuid[])),
      'profile_updated', p_update_profile
    )
  );
  return v_application_id;
end;
$$;

create or replace function public.create_membership_application_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_meta jsonb;
  v_class_id uuid;
  v_application_id uuid;
  v_days integer;
  v_doc record;
  v_document_ids uuid[];
begin
  if coalesce(new.portal_access_scope, 'full') <> 'full' then return new; end if;
  select raw_user_meta_data into v_meta from auth.users where id = new.id;
  if coalesce((v_meta->>'membership_application')::boolean, false) is not true then return new; end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into v_document_ids
  from jsonb_array_elements_text(coalesce(v_meta->'membership_document_ids', '[]'::jsonb));
  perform public.assert_current_membership_documents_acknowledged(v_document_ids);

  select id into v_class_id from public.membership_classes
  where code = coalesce(nullif(v_meta->>'membership_class', ''), 'full')
    and code <> 'life' and is_active;
  if v_class_id is null then
    raise exception 'Select Full, Junior or Affiliate membership. Life membership is assigned by an administrator.';
  end if;
  if coalesce(nullif(v_meta->>'membership_class', ''), 'full') = 'junior'
     and (nullif(v_meta->>'date_of_birth', '') is null
       or nullif(v_meta->>'date_of_birth', '')::date <= (current_date - interval '18 years')::date) then
    raise exception 'Junior membership requires a date of birth showing that the applicant is under 18';
  end if;

  select automatic_commencement_days into v_days from public.membership_settings where id = true;
  insert into public.membership_applications(
    user_id, membership_class_id, residential_address, service_address, date_of_birth,
    supports_club_purposes, agrees_to_constitution, agrees_to_member_guarantee,
    agrees_to_code_of_conduct, agrees_to_members_manual, guardian_name, guardian_consent,
    automatic_commencement_at
  ) values (
    new.id, v_class_id, trim(coalesce(v_meta->>'residential_address', '')),
    trim(coalesce(nullif(v_meta->>'service_address', ''), v_meta->>'residential_address', '')),
    nullif(v_meta->>'date_of_birth', '')::date,
    coalesce((v_meta->>'supports_club_purposes')::boolean, false),
    coalesce((v_meta->>'agrees_to_constitution')::boolean, false),
    coalesce((v_meta->>'agrees_to_member_guarantee')::boolean, false),
    coalesce((v_meta->>'agrees_to_code_of_conduct')::boolean, false),
    coalesce((v_meta->>'agrees_to_members_manual')::boolean, false),
    nullif(trim(coalesce(v_meta->>'guardian_name', '')), ''),
    coalesce((v_meta->>'guardian_consent')::boolean, false),
    now() + coalesce(v_days, 30) * interval '1 day'
  ) returning id into v_application_id;

  update public.users set
    address = trim(coalesce(v_meta->>'residential_address', address)),
    date_of_birth = coalesce(nullif(v_meta->>'date_of_birth', '')::date, date_of_birth),
    updated_at = now()
  where id = new.id;

  for v_doc in
    select * from public.membership_documents where id = any(v_document_ids)
  loop
    insert into public.membership_application_acknowledgements(application_id, document_id, acknowledgement_text)
    values (v_application_id, v_doc.id, format('Applicant acknowledged %s version %s during portal signup.', v_doc.title, v_doc.version));
  end loop;

  insert into public.membership_status_events(application_id, user_id, event_type, details)
  values (
    v_application_id,
    new.id,
    'application_submitted',
    jsonb_build_object('source', 'portal_signup', 'membership_document_ids', to_jsonb(v_document_ids))
  );
  return new;
end;
$$;

revoke all on function public.publish_organisation_document_version(
  uuid, text, text, text, date, text, text, bigint, text, boolean, text
) from public, anon;
grant execute on function public.publish_organisation_document_version(
  uuid, text, text, text, date, text, text, bigint, text, boolean, text
) to authenticated, service_role;

revoke all on function public.set_organisation_document_acknowledgement(uuid, boolean) from public, anon;
grant execute on function public.set_organisation_document_acknowledgement(uuid, boolean) to authenticated, service_role;
revoke all on function public.archive_organisation_document(uuid) from public, anon;
grant execute on function public.archive_organisation_document(uuid) to authenticated, service_role;
revoke all on function public.assert_current_membership_documents_acknowledged(uuid[]) from public, anon;
grant execute on function public.assert_current_membership_documents_acknowledged(uuid[]) to authenticated, service_role;
revoke all on function public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, uuid[], text, text, boolean
) from public, anon;
grant execute on function public.submit_membership_application(
  text, text, text, date, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, uuid[], text, text, boolean
) to authenticated, service_role;

grant select on public.membership_documents to anon;
