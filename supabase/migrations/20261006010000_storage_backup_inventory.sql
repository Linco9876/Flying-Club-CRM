-- Read-only inventory for the private backup worker. No client access.
create or replace function public.storage_backup_inventory()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog
as $$
begin
  if (select count(*) from storage.objects) > 10000 then
    raise exception 'Backup inventory capacity exceeded; operator action required';
  end if;
  return jsonb_build_object(
    'buckets', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from storage.buckets b),
    'files', (select coalesce(jsonb_agg(jsonb_build_object(
      'bucket',o.bucket_id,'path',o.name,'id',o.id,'updated_at',o.updated_at,'metadata',o.metadata
    ) order by o.bucket_id,o.name), '[]'::jsonb) from storage.objects o)
  );
end;
$$;
revoke all on function public.storage_backup_inventory() from public,anon,authenticated;
grant execute on function public.storage_backup_inventory() to service_role;
insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at)
values('public.storage_backup_inventory()','storage_backup_inventory','service_worker',array['service_role'],true,true,
'Read-only Storage metadata inventory for private independent file backups. Not accessible to browser roles.',date '2026-10-06')
on conflict(signature) do update set rationale=excluded.rationale,reviewed_at=excluded.reviewed_at;

select private.assert_function_permission_manifest();
