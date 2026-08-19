import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { User } from '../types';
import {
  PORTAL_FEEDBACK_MAX_COMMENT_LENGTH,
  canAccessPortalFeedback,
  estimateDataUrlBytes,
  validatePortalFeedbackComment,
} from './portalFeedback.ts';

const feedbackComponent = readFileSync(
  new URL('../components/Layout/PortalFeedbackButton.tsx', import.meta.url),
  'utf8',
);
const productionHeaders = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');

const user = (role: User['role'], roles?: User['roles']): User => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'member@example.com',
  name: 'Test Member',
  role,
  roles,
  isActive: true,
});

test('feedback is visible only to active administrators and instructors', () => {
  assert.equal(canAccessPortalFeedback(user('admin')), true);
  assert.equal(canAccessPortalFeedback(user('instructor')), true);
  assert.equal(canAccessPortalFeedback(user('senior_instructor')), true);
  assert.equal(canAccessPortalFeedback(user('cfi')), true);
  assert.equal(canAccessPortalFeedback(user('pilot')), false);
  assert.equal(canAccessPortalFeedback(user('student')), false);
  assert.equal(canAccessPortalFeedback({ ...user('admin'), isActive: false }), false);
});

test('additive instructor roles grant feedback access', () => {
  assert.equal(canAccessPortalFeedback(user('pilot', ['pilot', 'instructor'])), true);
});

test('feedback comment validation rejects vague or oversized reports', () => {
  assert.match(validatePortalFeedbackComment('no') || '', /at least 5/i);
  assert.equal(validatePortalFeedbackComment('Calendar button overlaps the aircraft name.'), null);
  assert.match(validatePortalFeedbackComment('x'.repeat(PORTAL_FEEDBACK_MAX_COMMENT_LENGTH + 1)) || '', /under 4,000/i);
});

test('base64 data URL byte estimates account for padding', () => {
  assert.equal(estimateDataUrlBytes('data:image/png;base64,YQ=='), 1);
  assert.equal(estimateDataUrlBytes('data:image/png;base64,YWI='), 2);
  assert.equal(estimateDataUrlBytes('data:image/png;base64,YWJj'), 3);
  assert.equal(estimateDataUrlBytes('not-a-data-url'), 0);
});

test('production policy permits same-origin screen capture', () => {
  assert.match(productionHeaders, /display-capture=\(self\)/);
  assert.doesNotMatch(productionHeaders, /display-capture=\(\)/);
});

test('feedback capture offers a screenshot fallback without misleading permission copy', () => {
  assert.match(feedbackComponent, /Upload a screenshot/);
  assert.match(feedbackComponent, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.doesNotMatch(feedbackComponent, /Choose Allow/);
});
