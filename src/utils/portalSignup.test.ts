import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortalSignupMetadata, getPortalSignupSteps } from './portalSignup.ts';

test('portal-only signup creates an account without silently applying for membership', () => {
  const metadata = buildPortalSignupMetadata({
    intent: 'portal',
    name: '  Portal User  ',
    phone: ' 0400 000 000 ',
    privacyNoticeVersion: '2026-07-31',
  });

  assert.equal(metadata.name, 'Portal User');
  assert.equal(metadata.membership_application, false);
  assert.equal(metadata.portal_signup_intent, 'portal');
  assert.equal('membership_class' in metadata, false);
  assert.equal('residential_address' in metadata, false);
  assert.equal('membership_payment_method' in metadata, false);
});

test('membership signup retains the application, agreements and payment preference', () => {
  const metadata = buildPortalSignupMetadata({
    intent: 'membership',
    name: 'Member User',
    phone: '',
    privacyNoticeVersion: '2026-07-31',
    membership: {
      membershipClass: 'full',
      dateOfBirth: '1990-01-01',
      residentialAddress: '23 Example Road',
      serviceAddress: '23 Example Road',
      guardianName: '',
      guardianConsent: false,
      paymentMethod: 'becs',
      autoRenew: true,
      scholarshipEnabled: false,
      scholarshipAmount: 5,
      documentIds: ['11111111-1111-4111-8111-111111111111'],
    },
  });

  assert.equal(metadata.membership_application, true);
  assert.equal('membership_class' in metadata && metadata.membership_class, 'full');
  assert.equal('membership_payment_method' in metadata && metadata.membership_payment_method, 'becs');
  assert.equal('membership_auto_renew' in metadata && metadata.membership_auto_renew, true);
  assert.deepEqual(
    'membership_document_ids' in metadata ? metadata.membership_document_ids : [],
    ['11111111-1111-4111-8111-111111111111'],
  );
});

test('account-only signup is shorter than account plus membership', () => {
  assert.deepEqual(getPortalSignupSteps('portal'), ['Start', 'Your details', 'Privacy']);
  assert.deepEqual(getPortalSignupSteps('membership'), ['Start', 'Your details', 'Agreements', 'Payment']);
});
