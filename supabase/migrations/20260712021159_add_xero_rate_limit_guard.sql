CREATE TABLE IF NOT EXISTS public.xero_rate_limit_state (
  id boolean PRIMARY KEY DEFAULT true,
  paused_until timestamptz,
  minute_window_started_at timestamptz NOT NULL DEFAULT now(),
  minute_calls integer NOT NULL DEFAULT 0,
  daily_window_started_on date NOT NULL DEFAULT CURRENT_DATE,
  daily_calls integer NOT NULL DEFAULT 0,
  next_available_at timestamptz NOT NULL DEFAULT now(),
  last_retry_after_seconds integer,
  last_rate_limited_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT xero_rate_limit_state_singleton CHECK (id IS TRUE)
);

INSERT INTO public.xero_rate_limit_state (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.xero_rate_limit_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view Xero rate limit state" ON public.xero_rate_limit_state;
CREATE POLICY "Admins can view Xero rate limit state"
  ON public.xero_rate_limit_state
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = 'admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.claim_xero_api_slot(
  max_calls_per_minute integer DEFAULT 45,
  max_calls_per_day integer DEFAULT 4500,
  spacing_ms integer DEFAULT 1200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  state_row public.xero_rate_limit_state%ROWTYPE;
  now_at timestamptz := clock_timestamp();
  wait_until timestamptz;
  wait_ms integer;
BEGIN
  INSERT INTO public.xero_rate_limit_state (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  SELECT *
  INTO state_row
  FROM public.xero_rate_limit_state
  WHERE id IS TRUE
  FOR UPDATE;

  IF state_row.minute_window_started_at <= now_at - interval '60 seconds' THEN
    state_row.minute_window_started_at := now_at;
    state_row.minute_calls := 0;
  END IF;

  IF state_row.daily_window_started_on < CURRENT_DATE THEN
    state_row.daily_window_started_on := CURRENT_DATE;
    state_row.daily_calls := 0;
  END IF;

  IF state_row.paused_until IS NOT NULL AND state_row.paused_until > now_at THEN
    wait_until := state_row.paused_until;
  ELSIF state_row.daily_calls >= GREATEST(max_calls_per_day, 1) THEN
    wait_until := (CURRENT_DATE + 1)::timestamptz;
  ELSIF state_row.minute_calls >= GREATEST(max_calls_per_minute, 1) THEN
    wait_until := state_row.minute_window_started_at + interval '60 seconds';
  ELSIF state_row.next_available_at > now_at THEN
    wait_until := state_row.next_available_at;
  ELSE
    UPDATE public.xero_rate_limit_state
    SET minute_window_started_at = state_row.minute_window_started_at,
        minute_calls = state_row.minute_calls + 1,
        daily_window_started_on = state_row.daily_window_started_on,
        daily_calls = state_row.daily_calls + 1,
        next_available_at = now_at + make_interval(secs => GREATEST(spacing_ms, 0)::double precision / 1000.0),
        updated_at = now_at
    WHERE id IS TRUE;

    RETURN jsonb_build_object(
      'granted', true,
      'waitMs', 0,
      'minuteCalls', state_row.minute_calls + 1,
      'dailyCalls', state_row.daily_calls + 1
    );
  END IF;

  wait_ms := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (wait_until - now_at)) * 1000)::integer);

  UPDATE public.xero_rate_limit_state
  SET minute_window_started_at = state_row.minute_window_started_at,
      minute_calls = state_row.minute_calls,
      daily_window_started_on = state_row.daily_window_started_on,
      daily_calls = state_row.daily_calls,
      updated_at = now_at
  WHERE id IS TRUE;

  RETURN jsonb_build_object(
    'granted', false,
    'waitMs', wait_ms,
    'waitUntil', wait_until,
    'minuteCalls', state_row.minute_calls,
    'dailyCalls', state_row.daily_calls
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.note_xero_rate_limit(
  retry_after_seconds integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pause_seconds integer := GREATEST(COALESCE(retry_after_seconds, 300), 30);
BEGIN
  INSERT INTO public.xero_rate_limit_state (id)
  VALUES (true)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.xero_rate_limit_state
  SET paused_until = clock_timestamp() + make_interval(secs => pause_seconds),
      last_retry_after_seconds = pause_seconds,
      last_rate_limited_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id IS TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_xero_api_slot(integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.note_xero_rate_limit(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_xero_api_slot(integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.note_xero_rate_limit(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
