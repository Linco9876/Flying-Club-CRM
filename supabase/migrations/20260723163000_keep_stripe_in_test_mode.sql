-- Keep all payment paths fail-safe in Stripe Test Mode until an administrator
-- deliberately changes mode later from the MFA-protected integration settings.
alter table public.stripe_connect_settings
  alter column stripe_mode set default 'test';

insert into public.stripe_connect_settings (
  id,
  stripe_mode,
  allow_test_mode_xero_sync,
  mode_updated_at,
  updated_at
)
values (true, 'test', false, now(), now())
on conflict (id) do update
set stripe_mode = 'test',
    allow_test_mode_xero_sync = false,
    mode_updated_at = now(),
    updated_at = now();
