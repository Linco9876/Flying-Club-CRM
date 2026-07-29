import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { membershipSettingHelp } from './membershipSettingHelp.ts';

test('every membership setting has detailed help content', () => {
  const entries = Object.entries(membershipSettingHelp);

  assert.equal(entries.length, 33);
  for (const [key, help] of entries) {
    assert.ok(help.title.length >= 4, `${key} needs a useful title`);
    assert.ok(help.description.length >= 80, `${key} needs a detailed explanation`);
    assert.match(help.description, /\.$/, `${key} should be a complete sentence`);
  }
});

test('every help entry is wired to a membership settings control', () => {
  const dashboardSource = readFileSync(
    new URL('../components/Membership/MembershipDashboard.tsx', import.meta.url),
    'utf8',
  );

  for (const key of Object.keys(membershipSettingHelp)) {
    assert.match(
      dashboardSource,
      new RegExp(`setting="${key}"`),
      `${key} is not connected to a help icon`,
    );
  }
});
