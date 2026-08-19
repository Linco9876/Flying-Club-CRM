import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayAfter,
  isUnder18On,
  membershipClassRequiresFinancialStatus,
  membershipClassEligibility,
  nextMembershipRenewalDate,
} from './membershipChangeRules.ts';

test('fee-exempt memberships never require a financial-status declaration', () => {
  assert.equal(membershipClassRequiresFinancialStatus({ isFeeExempt: true }), false);
  assert.equal(membershipClassRequiresFinancialStatus({ code: 'life', isFeeExempt: false }), false);
  assert.equal(membershipClassRequiresFinancialStatus({ isFeeExempt: false }), true);
  assert.equal(membershipClassRequiresFinancialStatus(undefined), true);
});

test('Junior eligibility ends on the eighteenth birthday', () => {
  assert.equal(isUnder18On('2008-08-16', '2026-08-15'), true);
  assert.equal(isUnder18On('2008-08-16', '2026-08-16'), false);
  assert.equal(membershipClassEligibility('junior', '2008-08-16', '2026-08-16').eligible, false);
});

test('Junior membership requires a valid date of birth', () => {
  assert.equal(membershipClassEligibility('junior', null, '2026-08-16').eligible, false);
  assert.equal(membershipClassEligibility('junior', 'not-a-date', '2026-08-16').eligible, false);
  assert.equal(membershipClassEligibility('full', null, '2026-08-16').eligible, true);
});

test('Full membership is unavailable to members under 18', () => {
  assert.equal(membershipClassEligibility('full', '2012-03-20', '2026-08-16').eligible, false);
  assert.match(
    membershipClassEligibility('full', '2012-03-20', '2026-08-16').reason || '',
    /not available.*under 18/i,
  );
  assert.equal(membershipClassEligibility('affiliate', '2012-03-20', '2026-08-16').eligible, true);
  assert.equal(membershipClassEligibility('full', '2000-03-20', '2026-08-16').eligible, true);
});

test('scheduled Junior changes use eligibility on the effective date', () => {
  assert.equal(membershipClassEligibility('junior', '2009-01-01', '2026-12-31').eligible, true);
  assert.equal(membershipClassEligibility('junior', '2009-01-01', '2027-07-01').eligible, false);
});

test('renewal dates are date-only and cross year boundaries safely', () => {
  assert.equal(dayAfter('2027-06-30'), '2027-07-01');
  assert.equal(dayAfter('2028-02-29'), '2028-03-01');
  assert.equal(nextMembershipRenewalDate('2027-06-30'), '2027-07-01');
  assert.equal(nextMembershipRenewalDate(null, 7, 1, '2026-08-16'), '2027-07-01');
  assert.equal(nextMembershipRenewalDate(null, 7, 1, '2026-06-16'), '2026-07-01');
});
