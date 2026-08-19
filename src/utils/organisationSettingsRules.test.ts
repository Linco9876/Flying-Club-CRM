import assert from 'node:assert/strict';
import test from 'node:test';
import { getOrganisationSettingsValidationError } from './organisationSettingsRules.ts';

const valid = {
  clubName: 'Bendigo Flying Club',
  contactEmail: 'office@example.com',
  website: 'https://example.com',
  studentPortalUrl: 'https://portal.example.com',
  bookingDayStart: '06:00',
  bookingDayEnd: '22:00',
  defaultSlotLength: 30,
};

test('accepts a complete organisation configuration', () => {
  assert.equal(getOrganisationSettingsValidationError(valid), null);
});

test('rejects invalid contact and URL values ignored by the external save button', () => {
  assert.match(getOrganisationSettingsValidationError({ ...valid, contactEmail: 'broken' }) || '', /valid contact email/);
  assert.match(getOrganisationSettingsValidationError({ ...valid, website: 'javascript:alert(1)' }) || '', /Website URL/);
});

test('rejects operating hours with no usable booking day', () => {
  assert.match(getOrganisationSettingsValidationError({ ...valid, bookingDayStart: '22:00', bookingDayEnd: '06:00' }) || '', /later/);
});
