/*
  Persist the global student portal and user experience configuration.
*/

CREATE TABLE IF NOT EXISTS public.portal_ux_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'auto')),
  date_format text NOT NULL DEFAULT 'dd/MM/yyyy',
  time_format text NOT NULL DEFAULT '24h' CHECK (time_format IN ('24h', '12h')),
  flight_time_decimals integer NOT NULL DEFAULT 1 CHECK (flight_time_decimals IN (1, 2)),
  currency_decimals integer NOT NULL DEFAULT 2 CHECK (currency_decimals IN (0, 2)),
  show_invoices_in_portal boolean NOT NULL DEFAULT true,
  show_study_tasks_in_portal boolean NOT NULL DEFAULT true,
  show_progress_tracking boolean NOT NULL DEFAULT true,
  allow_self_booking boolean NOT NULL DEFAULT true,
  allow_booking_cancellation boolean NOT NULL DEFAULT true,
  max_advance_booking_days integer NOT NULL DEFAULT 30 CHECK (max_advance_booking_days BETWEEN 1 AND 365),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.portal_ux_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read portal UX settings" ON public.portal_ux_settings;
CREATE POLICY "Authenticated users can read portal UX settings"
  ON public.portal_ux_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can update portal UX settings" ON public.portal_ux_settings;
CREATE POLICY "Admins can update portal UX settings"
  ON public.portal_ux_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admins can insert portal UX settings" ON public.portal_ux_settings;
CREATE POLICY "Admins can insert portal UX settings"
  ON public.portal_ux_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'));

INSERT INTO public.portal_ux_settings (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM public.portal_ux_settings);
