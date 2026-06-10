-- A trial flight voucher can only hold one active calendar booking at a time.
-- Cancelled/soft-deleted bookings remain as history and do not block rebooking.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_trial_voucher_one_active
  ON public.bookings(trial_flight_voucher_id)
  WHERE trial_flight_voucher_id IS NOT NULL
    AND deleted_at IS NULL
    AND COALESCE(status, '') <> 'cancelled';
