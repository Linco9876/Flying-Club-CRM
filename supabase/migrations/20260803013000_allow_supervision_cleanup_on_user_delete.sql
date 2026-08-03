-- Preserve mandatory supervision rows during normal edits, but allow the
-- foreign-key cascade that removes them as part of deleting the instructor.
-- PostgreSQL reports the cascade trigger as nested, while a direct row delete
-- remains at trigger depth one.

create or replace function public.protect_role_mandated_supervision_requirement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;

    if old.role_mandated
      and public.instructor_requires_role_supervision(old.instructor_id)
    then
      raise exception 'Supervision is required while this account has the Instructor role without Senior Instructor or CFI authority';
    end if;

    return old;
  end if;

  if old.role_mandated
    and public.instructor_requires_role_supervision(old.instructor_id)
    and (
      not new.role_mandated
      or not new.supervision_required
      or not ('flight' = any(new.activity_types))
      or cardinality(new.locations) <> 0
      or new.effective_from > current_date
      or new.effective_to is not null
    )
  then
    raise exception 'The role-based instructor supervision requirement must remain active for flights at all locations';
  end if;

  return new;
end;
$$;

-- Maintenance audit history must survive account deletion, but its nullable
-- actor reference must not turn that history into an undeletable account.
alter table public.maintenance_audit_log
  drop constraint if exists maintenance_audit_log_performed_by_fkey;

alter table public.maintenance_audit_log
  add constraint maintenance_audit_log_performed_by_fkey
  foreign key (performed_by)
  references public.users(id)
  on delete set null;
