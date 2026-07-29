const STRIPE_REFERENCE_SOURCE =
  String.raw`(?:cs_(?:test|live)_[A-Za-z0-9_]+|pi_[A-Za-z0-9_]+|ch_[A-Za-z0-9_]+|py_[A-Za-z0-9_]+|seti_[A-Za-z0-9_]+|pm_[A-Za-z0-9_]+)`;

const parenthesisedStripeReference = new RegExp(
  String.raw`\s*\(${STRIPE_REFERENCE_SOURCE}\)`,
  'gi',
);
const stripeReference = new RegExp(STRIPE_REFERENCE_SOURCE, 'gi');
const containsStripeReference = new RegExp(STRIPE_REFERENCE_SOURCE, 'i');

/**
 * Keeps payment-provider references in the stored transaction while presenting
 * a short, useful description to members and staff.
 */
export const formatBillingDescription = (
  description: string | null | undefined,
  fallback = 'Account transaction',
) => {
  const raw = String(description || '').trim();
  if (!raw) return fallback;

  const hadStripeReference = containsStripeReference.test(raw);
  let display = raw
    .replace(parenthesisedStripeReference, '')
    .replace(stripeReference, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*-\s*$/, '');

  display = display
    .replace(/^Stripe pilot account top-up$/i, 'Pilot account top-up')
    .replace(/^Stripe saved card payment\s*-\s*/i, 'Saved card payment · ')
    .replace(/^Stripe card payment\s*-\s*/i, 'Card payment · ')
    .replace(/^Stripe invoice payment\s*-\s*/i, 'Invoice payment · ')
    .replace(/^Stripe saved card payment$/i, 'Saved card payment')
    .replace(/^Stripe card payment$/i, 'Card payment')
    .replace(/^Stripe invoice payment$/i, 'Invoice payment')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return display || (hadStripeReference ? 'Stripe card payment' : fallback);
};
