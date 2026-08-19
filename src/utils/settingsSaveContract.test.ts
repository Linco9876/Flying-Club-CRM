import assert from 'node:assert/strict';
import test from 'node:test';
import { requireSettingsHandler, settingsHandlerName } from './settingsSaveContract.ts';

test('settings handler names remain stable for hyphenated sections', () => {
  assert.equal(settingsHandlerName('booking-rules', 'save'), '__bookingrulesSettingsSave');
  assert.equal(settingsHandlerName('account-notifications', 'cancel'), '__accountnotificationsSettingsCancel');
});

test('missing settings handlers fail instead of pretending changes were saved', () => {
  assert.throws(
    () => requireSettingsHandler({}, 'organisation', 'save'),
    /not ready to save/,
  );
});

test('registered sync and async handlers are returned', async () => {
  let called = false;
  const handler = requireSettingsHandler({
    __calendarSettingsSave: async () => { called = true; },
  }, 'calendar', 'save');
  await handler();
  assert.equal(called, true);
});
