create or replace function public.delete_training_record_draft(p_record_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in to delete a draft training record.';
  end if;

  delete from public.training_records
  where id = p_record_id
    and status = 'draft'
    and (
      instructor_id = (select auth.uid())
      or public.current_user_is_admin()
    )
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'Draft training record not found or you do not have permission to delete it.';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.delete_training_record_draft(uuid) from public;
revoke all on function public.delete_training_record_draft(uuid) from anon;
grant execute on function public.delete_training_record_draft(uuid) to authenticated;
grant execute on function public.delete_training_record_draft(uuid) to service_role;

comment on function public.delete_training_record_draft(uuid) is
  'Deletes only draft training records owned by the current instructor, or any draft when called by an admin. The training_records audit trigger records the deletion.';
