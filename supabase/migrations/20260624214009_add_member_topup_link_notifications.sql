CREATE TABLE IF NOT EXISTS public.member_topup_link_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  checkout_session_id text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  trigger_reason text NOT NULL DEFAULT 'manual',
  email_to text,
  email_sent boolean NOT NULL DEFAULT false,
  email_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_topup_link_notifications_user_created
  ON public.member_topup_link_notifications(user_id, created_at DESC);

ALTER TABLE public.member_topup_link_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can manage top-up link notifications" ON public.member_topup_link_notifications;
CREATE POLICY "Staff can manage top-up link notifications"
  ON public.member_topup_link_notifications
  FOR ALL
  USING (public.current_user_has_staff_role())
  WITH CHECK (public.current_user_has_staff_role());

DROP POLICY IF EXISTS "Members can read own top-up link notifications" ON public.member_topup_link_notifications;
CREATE POLICY "Members can read own top-up link notifications"
  ON public.member_topup_link_notifications
  FOR SELECT
  USING (auth.uid() = user_id);
