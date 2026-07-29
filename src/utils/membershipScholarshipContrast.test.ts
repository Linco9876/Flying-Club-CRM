import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const luminance = (hex: string) => {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map(value => Number.parseInt(value, 16) / 255) || [];
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
};

const contrast = (foreground: string, background: string) => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

test('scholarship settings text meets WCAG AA contrast in both themes', () => {
  // Tailwind violet palette used by the scholarship settings card.
  assert.ok(contrast('#2e1065', '#f5f3ff') >= 4.5, 'light-theme heading contrast is too low');
  assert.ok(contrast('#5b21b6', '#f5f3ff') >= 4.5, 'light-theme supporting text contrast is too low');
  assert.ok(contrast('#ede9fe', '#2e1065') >= 4.5, 'dark-theme heading contrast is too low');
  assert.ok(contrast('#ddd6fe', '#2e1065') >= 4.5, 'dark-theme supporting text contrast is too low');
});

test('scholarship settings card declares explicit light and dark surfaces', () => {
  const dashboardSource = readFileSync(
    new URL('../components/Membership/MembershipDashboard.tsx', import.meta.url),
    'utf8',
  );
  const card = dashboardSource.match(/data-testid="membership-scholarship-settings"[^>]+/)?.[0] || '';

  assert.match(card, /bg-violet-50/);
  assert.match(card, /dark:bg-violet-950/);
  assert.match(card, /border-violet-300/);
  assert.match(card, /dark:border-violet-700/);
});
