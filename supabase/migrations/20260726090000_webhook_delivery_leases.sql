create or replace function public.claim_integration_webhook_deliveries(
  p_limit integer default 25,
  p_lease_timeout_seconds integer default 300
) returns table (
  id uuid,
  endpoint_id uuid,
  event_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_timeout_seconds, 300), 30), 3600));
begin
  update public.integration_webhook_deliveries delivery
  set status = 'abandoned',
      last_error = 'Delivery lease expired after the maximum number of attempts',
      updated_at = now()
  where delivery.status = 'delivering'
    and delivery.updated_at <= now() - v_lease
    and delivery.attempt_count >= 8;

  return query
  with candidates as (
    select delivery.id
    from public.integration_webhook_deliveries delivery
    where delivery.attempt_count < 8
      and (
        (
          delivery.status in ('pending', 'failed')
          and delivery.next_attempt_at <= now()
        )
        or (
          delivery.status = 'delivering'
          and delivery.updated_at <= now() - v_lease
        )
      )
    order by delivery.next_attempt_at, delivery.created_at
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.integration_webhook_deliveries delivery
    set status = 'delivering',
        attempt_count = delivery.attempt_count + 1,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.id, delivery.endpoint_id, delivery.event_id, delivery.attempt_count
  )
  select claimed.id, claimed.endpoint_id, claimed.event_id, claimed.attempt_count
  from claimed;
end;
$$;

revoke all on function public.claim_integration_webhook_deliveries(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_integration_webhook_deliveries(integer, integer) to service_role;

create index if not exists integration_webhook_deliveries_lease_idx
  on public.integration_webhook_deliveries(updated_at)
  where status = 'delivering';

comment on function public.claim_integration_webhook_deliveries(integer, integer) is
  'Atomically leases due webhook deliveries and reclaims interrupted deliveries after the lease expires.';
