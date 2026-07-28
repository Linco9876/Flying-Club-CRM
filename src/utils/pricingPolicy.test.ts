import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PORTAL_PRICES_ARE_TAX_INCLUSIVE,
  TAX_INCLUSIVE_NOTICE,
  TAX_INCLUSIVE_SHORT_LABEL,
} from './pricingPolicy.ts';

test('portal pricing is explicitly tax inclusive', () => {
  assert.equal(PORTAL_PRICES_ARE_TAX_INCLUSIVE, true);
  assert.match(TAX_INCLUSIVE_SHORT_LABEL, /GST inclusive/i);
  assert.match(TAX_INCLUSIVE_NOTICE, /include GST/i);
  assert.match(TAX_INCLUSIVE_NOTICE, /never added on top/i);
});
