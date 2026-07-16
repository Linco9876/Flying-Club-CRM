create index if not exists bookings_cancellation_reason_id_idx
  on public.bookings (cancellation_reason_id);

drop policy if exists "Admins can manage cancellation reasons"
  on public.booking_cancellation_reasons;

drop policy if exists "Admins can insert cancellation reasons"
  on public.booking_cancellation_reasons;
create policy "Admins can insert cancellation reasons"
  on public.booking_cancellation_reasons
  for insert
  to authenticated
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update cancellation reasons"
  on public.booking_cancellation_reasons;
create policy "Admins can update cancellation reasons"
  on public.booking_cancellation_reasons
  for update
  to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete cancellation reasons"
  on public.booking_cancellation_reasons;
create policy "Admins can delete cancellation reasons"
  on public.booking_cancellation_reasons
  for delete
  to authenticated
  using (public.current_user_is_admin());
