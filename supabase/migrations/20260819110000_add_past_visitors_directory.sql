-- Staff directory for every genuine casual visitor, including visitors whose
-- history has already been promoted to a portal profile. The client pages
-- through this RPC until every row has been loaded into the Members popup.

create or replace function public.list_past_visitors(
  p_query text default '',
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  email text,
  phone text,
  status text,
  promoted_to_user_id uuid,
  booking_count bigint,
  guest_booking_count bigint,
  first_booking_at timestamptz,
  last_booking_at timestamptz,
  promoted_user_name text,
  promoted_user_email text,
  promoted_user_is_active boolean,
  promoted_user_access_scope text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    contact.id,
    contact.name,
    contact.email,
    contact.phone,
    contact.status,
    contact.promoted_to_user_id,
    coalesce(visit.booking_count, 0)::bigint,
    coalesce(visit.guest_booking_count, 0)::bigint,
    visit.first_booking_at,
    greatest(contact.last_booking_at, visit.last_booking_at) as last_booking_at,
    portal_user.name as promoted_user_name,
    portal_user.email as promoted_user_email,
    portal_user.is_active as promoted_user_is_active,
    portal_user.portal_access_scope as promoted_user_access_scope
  from public.casual_contacts contact
  left join lateral (
    select
      count(*)::bigint as booking_count,
      count(*) filter (where coalesce(booking.is_guest_booking, false))::bigint as guest_booking_count,
      min(booking.start_time) as first_booking_at,
      max(booking.start_time) as last_booking_at
    from public.bookings booking
    where booking.casual_contact_id = contact.id
  ) visit on true
  left join public.users portal_user on portal_user.id = contact.promoted_to_user_id
  where public.current_user_has_staff_role()
    and contact.status <> 'merged'
    and coalesce(visit.booking_count, 0) > 0
    and (
      btrim(coalesce(p_query, '')) = ''
      or contact.name ilike '%' || btrim(p_query) || '%'
      or contact.email ilike '%' || btrim(p_query) || '%'
      or coalesce(contact.phone, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(portal_user.name, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(portal_user.email, '') ilike '%' || btrim(p_query) || '%'
    )
  order by
    greatest(contact.last_booking_at, visit.last_booking_at) desc nulls last,
    contact.name,
    contact.id
  limit least(greatest(coalesce(p_limit, 200), 1), 250)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on function public.list_past_visitors(text, integer, integer)
  from public, anon;
grant execute on function public.list_past_visitors(text, integer, integer)
  to authenticated, service_role;

insert into private.function_permission_manifest(
  signature,
  function_name,
  classification,
  allowed_roles,
  security_definer,
  fixed_search_path,
  rationale,
  reviewed_at
) values (
  'public.list_past_visitors(p_query text, p_limit integer, p_offset integer)',
  'list_past_visitors',
  'authenticated_self_service',
  array['authenticated', 'service_role']::text[],
  true,
  true,
  'Staff-only paginated directory of casual visitors and their portal-profile state. The RPC checks the caller role before returning contact details.',
  date '2026-08-19'
)
on conflict (signature) do update set
  function_name = excluded.function_name,
  classification = excluded.classification,
  allowed_roles = excluded.allowed_roles,
  security_definer = excluded.security_definer,
  fixed_search_path = excluded.fixed_search_path,
  rationale = excluded.rationale,
  reviewed_at = excluded.reviewed_at;

select private.assert_function_permission_manifest();

comment on function public.list_past_visitors(text, integer, integer) is
  'Returns every non-merged casual visitor with visit totals and any promoted portal profile to authorised staff.';
