import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('authenticated portal keeps an app-style mobile shell', () => {
  const header = source('src/components/Layout/Header.tsx');
  const sidebar = source('src/components/Layout/Sidebar.tsx');

  assert.match(header, /app-header-safe-area/);
  assert.match(header, /aria-label="Open profile"/);
  assert.match(header, /lg:flex/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
  assert.match(sidebar, /app-mobile-bottom-nav/);
  assert.match(sidebar, /app-mobile-drawer/);
  assert.match(sidebar, /app-drawer-bottom-safe-area/);
  assert.match(sidebar, /Sign out/);
});

test('mobile foundations preserve safe areas, touch sizing, sheets and readable forms', () => {
  const css = source('src/index.css');

  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /\.portal-app-shell button/);
  assert.match(css, /min-height: 2\.75rem/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /:has\(> \[class\*='max-w-'\]\)/);
  assert.match(css, /\.mobile-card-table/);
  assert.match(css, /overscroll-behavior-y: contain/);
});

test('high-use mobile panels use phone-native navigation patterns', () => {
  const notifications = source('src/components/Layout/NotificationBell.tsx');
  const bookingActions = source('src/components/Bookings/BookingActionMenu.tsx');
  const settings = source('src/components/Settings/SettingsDashboard.tsx');

  assert.match(notifications, /notification-mobile-panel/);
  assert.match(notifications, /h-\[min\(82dvh,44rem\)\]/);
  assert.match(bookingActions, /booking-action-menu/);
  assert.match(bookingActions, /booking-action-backdrop/);
  assert.match(settings, /mobile-settings-switcher/);
  assert.match(settings, /mobile-settings-save-bar/);
});

test('calendar filters stay compact and balanced on desktop', () => {
  const calendar = source('src/components/Calendar/Calendar.tsx');

  assert.match(calendar, /sm:w-48 xl:w-52/);
  assert.match(calendar, /aria-label="Calendar resource type"/);
  assert.match(calendar, /lg:hidden/);
  assert.match(calendar, /lg:flex/);
  assert.match(calendar, /ml-auto flex shrink-0 items-center gap-2 border-l/);
  assert.match(calendar, /Hide all-day unavailable/);
});

test('both installable apps relaunch existing windows and Duty Clock remains keyboard-safe', () => {
  const portalManifest = JSON.parse(source('public/manifest.webmanifest'));
  const dutyManifest = JSON.parse(source('apps/duty-clock/public/manifest.webmanifest'));
  const portalServiceWorker = source('public/sw.js');
  const portalHtml = source('index.html');
  const responseHeaders = source('public/_headers');
  const dutyLogin = source('apps/duty-clock/src/components/LoginScreen.tsx');
  const startDuty = source('apps/duty-clock/src/components/StartDutyModal.tsx');

  assert.equal(portalManifest.display, 'standalone');
  assert.equal(portalManifest.launch_handler.client_mode, 'navigate-existing');
  assert.equal(dutyManifest.display, 'standalone');
  assert.equal(dutyManifest.launch_handler.client_mode, 'navigate-existing');
  assert.match(portalServiceWorker, /bfc-portal-shell-v3-mobile-app/);
  assert.match(portalServiceWorker, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(portalHtml, /viewport-fit=cover/);
  assert.match(dutyLogin, /<ScrollView/);
  assert.match(dutyLogin, /keyboardShouldPersistTaps="handled"/);
  assert.match(dutyLogin, /<form/);
  assert.doesNotMatch(responseHeaders, /ambient-light-sensor/);
  assert.match(startDuty, /score: \{ width: 44, height: 44/);
});
