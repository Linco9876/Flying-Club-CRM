ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_system_key_unique
  ON public.payment_methods(system_key)
  WHERE system_key IS NOT NULL;

INSERT INTO public.payment_methods (
  name,
  description,
  active,
  allow_account_topup,
  display_order,
  is_system,
  system_key,
  updated_at
)
VALUES (
  'Stripe Card Payment',
  'Card payment through the connected Stripe account. Enable this only if flight charges should be paid by card when flights are logged.',
  false,
  false,
  90,
  true,
  'stripe_card',
  now()
)
ON CONFLICT (system_key) WHERE system_key IS NOT NULL
DO UPDATE SET
  name = 'Stripe Card Payment',
  description = excluded.description,
  allow_account_topup = false,
  is_system = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.protect_system_payment_methods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stripe_connected boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system IS TRUE THEN
      RAISE EXCEPTION 'System payment methods cannot be deleted. Deactivate them instead.'
        USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.system_key = 'stripe_card' THEN
    NEW.name := 'Stripe Card Payment';
    NEW.description := coalesce(
      nullif(trim(NEW.description), ''),
      'Card payment through the connected Stripe account. Enable this only if flight charges should be paid by card when flights are logged.'
    );
    NEW.allow_account_topup := false;
    NEW.is_system := true;

    IF NEW.active IS TRUE THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.stripe_connect_settings
        WHERE id IS TRUE
          AND stripe_user_id IS NOT NULL
          AND trim(stripe_user_id) <> ''
      )
      INTO v_stripe_connected;

      IF v_stripe_connected IS NOT TRUE THEN
        RAISE EXCEPTION 'Connect Stripe before activating Stripe Card Payment for flight charges.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF OLD.is_system IS TRUE THEN
    NEW.is_system := true;
    NEW.system_key := OLD.system_key;
    IF OLD.system_key = 'stripe_card' THEN
      NEW.name := 'Stripe Card Payment';
      NEW.allow_account_topup := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_payment_methods_update ON public.payment_methods;
CREATE TRIGGER trg_protect_system_payment_methods_update
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW
EXECUTE FUNCTION public.protect_system_payment_methods();

DROP TRIGGER IF EXISTS trg_protect_system_payment_methods_delete ON public.payment_methods;
CREATE TRIGGER trg_protect_system_payment_methods_delete
BEFORE DELETE ON public.payment_methods
FOR EACH ROW
EXECUTE FUNCTION public.protect_system_payment_methods();

REVOKE ALL ON FUNCTION public.protect_system_payment_methods() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_system_payment_methods() FROM anon;
REVOKE ALL ON FUNCTION public.protect_system_payment_methods() FROM authenticated;
