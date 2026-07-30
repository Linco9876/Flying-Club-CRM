-- The queue retains terminal history and now enforces one open item with the
-- partial xero_sync_queue_one_open_item index. Trigger functions created
-- before that change still targeted the removed four-column uniqueness rule,
-- causing unrelated writes (including Auth invitations) to fail.

do $migration$
declare
  function_row record;
  function_definition text;
  repaired_count integer := 0;
begin
  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_class on index_class.oid = index_row.indexrelid
    join pg_class table_class on table_class.oid = index_row.indrelid
    join pg_namespace schema_row on schema_row.oid = table_class.relnamespace
    where schema_row.nspname = 'public'
      and table_class.relname = 'xero_sync_queue'
      and index_class.relname = 'xero_sync_queue_one_open_item'
      and index_row.indisunique
      and pg_get_expr(index_row.indpred, index_row.indrelid)
        = '(status = ANY (ARRAY[''pending''::text, ''processing''::text]))'
  ) then
    raise exception
      'Expected partial unique index public.xero_sync_queue_one_open_item is missing or incompatible';
  end if;

  for function_row in
    select procedure_row.oid
    from pg_proc procedure_row
    join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
    where schema_row.nspname = 'public'
      and procedure_row.prosrc ilike
        '%ON CONFLICT (entity_type, entity_id, action, status)%'
  loop
    function_definition := pg_get_functiondef(function_row.oid);
    function_definition := replace(
      function_definition,
      'ON CONFLICT (entity_type, entity_id, action, status)',
      'ON CONFLICT (entity_type, entity_id, action)
    WHERE status IN (''pending'', ''processing'')'
    );

    execute function_definition;
    repaired_count := repaired_count + 1;
  end loop;

  if repaired_count = 0 then
    raise notice 'No legacy Xero queue conflict targets required repair';
  end if;

  if exists (
    select 1
    from pg_proc procedure_row
    join pg_namespace schema_row on schema_row.oid = procedure_row.pronamespace
    where schema_row.nspname = 'public'
      and procedure_row.prosrc ilike
        '%ON CONFLICT (entity_type, entity_id, action, status)%'
  ) then
    raise exception 'One or more legacy Xero queue conflict targets remain';
  end if;
end;
$migration$;
