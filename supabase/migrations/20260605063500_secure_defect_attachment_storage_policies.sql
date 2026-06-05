-- Private defect attachments with authenticated read/upload and staff-only mutation.

insert into storage.buckets (id, name, public)
values ('defect-attachments', 'defect-attachments', false)
on conflict (id) do update set public = false;

drop policy if exists "Authenticated users can upload defect attachments" on storage.objects;
drop policy if exists "Authenticated users can read defect attachments" on storage.objects;
drop policy if exists "Staff can update defect attachments" on storage.objects;
drop policy if exists "Staff can delete defect attachments" on storage.objects;

create policy "Authenticated users can upload defect attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'defect-attachments'
  and auth.uid() is not null
);

create policy "Authenticated users can read defect attachments"
on storage.objects
for select
to authenticated
using (bucket_id = 'defect-attachments');

create policy "Staff can update defect attachments"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'defect-attachments'
  and public.current_user_has_staff_role()
)
with check (
  bucket_id = 'defect-attachments'
  and public.current_user_has_staff_role()
);

create policy "Staff can delete defect attachments"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'defect-attachments'
  and public.current_user_has_staff_role()
);
