import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatBillingDescription } from './billingDescription.ts';

const checkoutSession =
  'cs_test_a1bDqcdTsb9YnEzyciSgOCzi8OdOoqpDDU4WEfXgJkamCJDu4U1LRu9E5P';

test('shortens Stripe top-up descriptions without exposing the session ID', () => {
  const display = formatBillingDescription(
    `Stripe pilot account top-up (${checkoutSession})`,
  );

  assert.equal(display, 'Pilot account top-up');
  assert.equal(display.includes(checkoutSession), false);
});

test('keeps useful flight details while removing Stripe references', () => {
  assert.equal(
    formatBillingDescription(
      `Stripe card payment (${checkoutSession}) - VH-BFC flight on 29/07/2026`,
    ),
    'Card payment · VH-BFC flight on 29/07/2026',
  );
  assert.equal(
    formatBillingDescription(
      'Stripe saved card payment (pi_3ExampleReference) - VH-BIU flight on 28/07/2026',
    ),
    'Saved card payment · VH-BIU flight on 28/07/2026',
  );
});

test('handles a bare Stripe reference and leaves ordinary descriptions intact', () => {
  assert.equal(formatBillingDescription(checkoutSession), 'Stripe card payment');
  assert.equal(
    formatBillingDescription('Membership payment received'),
    'Membership payment received',
  );
  assert.equal(formatBillingDescription('', 'Top-up'), 'Top-up');
});

test('all portal transaction-history views use the concise description formatter', () => {
  const views = [
    '../components/Billing/BillingDashboard.tsx',
    '../components/Billing/TransactionsTab.tsx',
    '../components/Billing/AccountHistoryModal.tsx',
    '../components/Students/StudentProfilePage.tsx',
  ];

  for (const view of views) {
    const source = readFileSync(new URL(view, import.meta.url), 'utf8');
    assert.match(source, /formatBillingDescription/);
  }
});
