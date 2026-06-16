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
      'Card payment through the connected Stripe account. Enable this only if flight charges or account top-ups should be paid by card.'
    );
    NEW.is_system := true;

    IF (NEW.active IS TRUE OR NEW.allow_account_topup IS TRUE) THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.stripe_connect_settings
        WHERE id IS TRUE
          AND stripe_user_id IS NOT NULL
          AND trim(stripe_user_id) <> ''
      )
      INTO v_stripe_connected;

      IF v_stripe_connected IS NOT TRUE THEN
        RAISE EXCEPTION 'Connect Stripe before enabling Stripe Card Payment.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF OLD.is_system IS TRUE THEN
    NEW.is_system := true;
    NEW.system_key := OLD.system_key;
    IF OLD.system_key = 'stripe_card' THEN
      NEW.name := 'Stripe Card Payment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
