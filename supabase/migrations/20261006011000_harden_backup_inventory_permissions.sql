insert into private.function_permission_manifest(signature,function_name,classification,allowed_roles,security_definer,fixed_search_path,rationale,reviewed_at)
values('public.storage_backup_inventory()','storage_backup_inventory','service_worker',array['service_role'],true,true,
'Read-only Storage metadata inventory for private independent file backups. Not accessible to browser roles.',date '2026-10-06')
on conflict(signature) do update set rationale=excluded.rationale,reviewed_at=excluded.reviewed_at;

alter function public.duty_geo_distance_metres(double precision,double precision,double precision,double precision)
set search_path=pg_catalog;
notify pgrst,'reload schema';
