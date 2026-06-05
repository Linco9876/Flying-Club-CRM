do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'training_records'
  ) then
    alter publication supabase_realtime add table public.training_records;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'training_sequence_results'
  ) then
    alter publication supabase_realtime add table public.training_sequence_results;
  end if;
end $$;
