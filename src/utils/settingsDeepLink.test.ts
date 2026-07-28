import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSettingsDeepLink } from './settingsDeepLink.ts';

test('opens the requested settings section and named field group', () => {
  assert.deepEqual(
    parseSettingsDeepLink(
      '?tab=account-info&accountTab=info&focus=aviation-credentials',
      '#account-aviation-credentials',
    ),
    {
      sectionId: 'account-info',
      focus: 'aviation-credentials',
      focusElementId: 'account-aviation-credentials',
      focusLabel: 'Aviation Credentials',
    },
  );
});

test('derives Update My Info from a valid focus when tab is omitted', () => {
  assert.deepEqual(
    parseSettingsDeepLink('?focus=contact-details'),
    {
      sectionId: 'account-info',
      focus: 'contact-details',
      focusElementId: 'account-contact-details',
      focusLabel: 'Contact Details',
    },
  );
});

test('uses the hash target as a fallback for older links', () => {
  assert.deepEqual(
    parseSettingsDeepLink('', '#account-emergency-contact'),
    {
      sectionId: 'account-info',
      focus: 'emergency-contact',
      focusElementId: 'account-emergency-contact',
      focusLabel: 'Emergency Contact',
    },
  );
});

test('ignores unknown focus values without inventing a destination', () => {
  assert.deepEqual(
    parseSettingsDeepLink('?tab=account-security&focus=unknown'),
    {
      sectionId: 'account-security',
      focus: null,
      focusElementId: null,
      focusLabel: null,
    },
  );
});
