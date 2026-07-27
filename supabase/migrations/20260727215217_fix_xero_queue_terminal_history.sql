-- Permit complete queue history while still preventing concurrent duplicate work.

drop index if exists public.idx_xero_sync_queue_unique_open_status;
drop index if exists public.xero_sync_queue_one_open_membership_item;

with ranked_open_items as (
  select
    id,
    row_number() over (
      partition by entity_type, entity_id, action
      order by
        case when status = 'processing' then 0 else 1 end,
        created_at desc,
        id
    ) as open_rank
  from public.xero_sync_queue
  where status in ('pending', 'processing')
)
update public.xero_sync_queue queue
set
  status = 'cancelled',
  last_error = coalesce(
    queue.last_error,
    'Superseded while enforcing one open queue item per entity and action.'
  ),
  processed_at = coalesce(queue.processed_at, now()),
  updated_at = now()
from ranked_open_items ranked
where queue.id = ranked.id
  and ranked.open_rank > 1;

create unique index if not exists xero_sync_queue_one_open_item
  on public.xero_sync_queue (entity_type, entity_id, action)
  where status in ('pending', 'processing');

comment on index public.xero_sync_queue_one_open_item is
  'Prevents concurrent duplicate work while retaining all synced, failed and reviewed queue history.';
