-- Central admin-only audit trail for sensitive CRM edits and deletes.

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('UPDATE', 'DELETE')),
  area text not null,
  table_name text not null,
  record_id text not null,
  record_label text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_log_occurred_at_idx on public.admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_actor_id_idx on public.admin_audit_log (actor_id);
create index if not exists admin_audit_log_area_idx on public.admin_audit_log (area);
create index if not exists admin_audit_log_table_record_idx on public.admin_audit_log (table_name, record_id);

alter table public.admin_audit_log enable row level security;

grant select on public.admin_audit_log to authenticated;

drop policy if exists "Admins can read admin audit log" on public.admin_audit_log;
create policy "Admins can read admin audit log"
on public.admin_audit_log
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles
    where user_roles.user_id = auth.uid()
      and user_roles.role = 'admin'
  )
);

create or replace function public.audit_record_label(table_name text, row_data jsonb)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  case table_name
    when 'bookings' then
      return concat_ws(' ',
        'Booking',
        row_data->>'start_time',
        row_data->>'student_id',
        row_data->>'aircraft_id'
      );
    when 'flight_logs' then
      return concat_ws(' ',
        'Flight log',
        row_data->>'start_time',
        row_data->>'student_id',
        row_data->>'aircraft_id'
      );
    when 'account_transactions' then
      return concat_ws(' ',
        row_data->>'type',
        row_data->>'amount',
        row_data->>'description'
      );
    when 'invoices' then
      return concat_ws(' ', 'Invoice', row_data->>'invoice_number', row_data->>'student_id');
    when 'invoice_items' then
      return concat_ws(' ', 'Invoice item', row_data->>'description');
    when 'training_records' then
      return concat_ws(' ', 'Training record', row_data->>'date', row_data->>'student_id');
    when 'training_sequence_results' then
      return concat_ws(' ', row_data->>'sequence_code', row_data->>'sequence_title');
    when 'users' then
      return concat_ws(' ', row_data->>'name', row_data->>'email');
    when 'students' then
      return concat_ws(' ', 'Student profile', row_data->>'id');
    when 'user_roles' then
      return concat_ws(' ', 'Role', row_data->>'role', row_data->>'user_id');
    else
      return concat_ws(' ', table_name, row_data->>'id');
  end case;
end;
$$;

revoke execute on function public.audit_record_label(text, jsonb) from public, anon, authenticated;

create or replace function public.audit_changed_fields(old_row jsonb, new_row jsonb)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(key order by key), '{}')
  from (
    select key
    from jsonb_object_keys(old_row || new_row) as keys(key)
    where coalesce(old_row -> key, 'null'::jsonb) is distinct from coalesce(new_row -> key, 'null'::jsonb)
  ) changed;
$$;

revoke execute on function public.audit_changed_fields(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.admin_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_payload jsonb;
  new_payload jsonb;
  changed text[];
  audit_area text;
  row_id text;
begin
  if tg_op not in ('UPDATE', 'DELETE') then
    return coalesce(new, old);
  end if;

  old_payload := to_jsonb(old);
  new_payload := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  changed := case when tg_op = 'UPDATE' then public.audit_changed_fields(old_payload, new_payload) else '{}'::text[] end;

  if tg_op = 'UPDATE' and coalesce(array_length(changed, 1), 0) = 0 then
    return new;
  end if;

  audit_area := tg_argv[0];
  row_id := coalesce(old_payload->>'id', new_payload->>'id');

  insert into public.admin_audit_log (
    actor_id,
    action,
    area,
    table_name,
    record_id,
    record_label,
    old_data,
    new_data,
    changed_fields,
    metadata
  )
  values (
    auth.uid(),
    tg_op,
    audit_area,
    tg_table_name,
    row_id,
    public.audit_record_label(tg_table_name, coalesce(new_payload, old_payload)),
    old_payload,
    new_payload,
    changed,
    jsonb_build_object(
      'schema', tg_table_schema,
      'trigger', tg_name,
      'captured_by', 'admin_audit_trigger'
    )
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.admin_audit_trigger() from public, anon, authenticated;

drop trigger if exists audit_bookings_edits_deletes on public.bookings;
create trigger audit_bookings_edits_deletes
after update or delete on public.bookings
for each row execute function public.admin_audit_trigger('Bookings');

drop trigger if exists audit_flight_logs_edits_deletes on public.flight_logs;
create trigger audit_flight_logs_edits_deletes
after update or delete on public.flight_logs
for each row execute function public.admin_audit_trigger('Flight Logs');

drop trigger if exists audit_account_transactions_edits_deletes on public.account_transactions;
create trigger audit_account_transactions_edits_deletes
after update or delete on public.account_transactions
for each row execute function public.admin_audit_trigger('Billing');

drop trigger if exists audit_invoices_edits_deletes on public.invoices;
create trigger audit_invoices_edits_deletes
after update or delete on public.invoices
for each row execute function public.admin_audit_trigger('Billing');

drop trigger if exists audit_invoice_items_edits_deletes on public.invoice_items;
create trigger audit_invoice_items_edits_deletes
after update or delete on public.invoice_items
for each row execute function public.admin_audit_trigger('Billing');

drop trigger if exists audit_training_records_edits_deletes on public.training_records;
create trigger audit_training_records_edits_deletes
after update or delete on public.training_records
for each row execute function public.admin_audit_trigger('Training Records');

drop trigger if exists audit_training_sequence_results_edits_deletes on public.training_sequence_results;
create trigger audit_training_sequence_results_edits_deletes
after update or delete on public.training_sequence_results
for each row execute function public.admin_audit_trigger('Training Records');

drop trigger if exists audit_users_edits_deletes on public.users;
create trigger audit_users_edits_deletes
after update or delete on public.users
for each row execute function public.admin_audit_trigger('Member Profiles');

drop trigger if exists audit_students_edits_deletes on public.students;
create trigger audit_students_edits_deletes
after update or delete on public.students
for each row execute function public.admin_audit_trigger('Member Profiles');

drop trigger if exists audit_user_roles_edits_deletes on public.user_roles;
create trigger audit_user_roles_edits_deletes
after update or delete on public.user_roles
for each row execute function public.admin_audit_trigger('Member Profiles');
