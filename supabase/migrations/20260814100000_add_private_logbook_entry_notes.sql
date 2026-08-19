create table if not exists public.logbook_entry_notes (
  id uuid primary key default gen_random_uuid(),
  flight_log_id uuid not null references public.flight_logs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint logbook_entry_notes_user_flight_unique unique (user_id, flight_log_id),
  constraint logbook_entry_notes_length_check check (char_length(note) <= 2000)
);

comment on table public.logbook_entry_notes is
  'Private notes a signed-in user saves against a flight visible in their logbook view.';
comment on column public.logbook_entry_notes.user_id is
  'The note owner. Notes are never shared with another portal user.';

create index if not exists logbook_entry_notes_flight_log_idx
  on public.logbook_entry_notes(flight_log_id);

alter table public.logbook_entry_notes enable row level security;

drop policy if exists "Users can read own logbook notes" on public.logbook_entry_notes;
create policy "Users can read own logbook notes"
  on public.logbook_entry_notes
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can create own logbook notes" on public.logbook_entry_notes;
create policy "Users can create own logbook notes"
  on public.logbook_entry_notes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.flight_logs flight
      where flight.id = flight_log_id
    )
  );

drop policy if exists "Users can update own logbook notes" on public.logbook_entry_notes;
create policy "Users can update own logbook notes"
  on public.logbook_entry_notes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own logbook notes" on public.logbook_entry_notes;
create policy "Users can delete own logbook notes"
  on public.logbook_entry_notes
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on table public.logbook_entry_notes to authenticated;
grant all on table public.logbook_entry_notes to service_role;
