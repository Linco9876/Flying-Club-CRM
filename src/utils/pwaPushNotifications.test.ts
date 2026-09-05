import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { shouldShowPwaNotificationPrompt } from './pwaNotificationPrompt.ts';

const read = (relativePath: string) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260810150000_add_pwa_web_push_notifications.sql');
const dutyBreakMigration = read('supabase/migrations/20260814113000_add_duty_break_push_reminders.sql');
const edgeFunction = read('supabase/functions/push-notifications/index.ts');
const portalWorker = read('public/sw.js');
const dutyWorker = read('apps/duty-clock/public/duty-clock-sw.js');
const portalBootstrap = read('src/main.tsx');
const dutyBootstrap = read('apps/duty-clock/public/duty-clock-bootstrap.js');
const appSource = read('src/App.tsx');
const promptSource = read('src/components/Layout/PwaNotificationPermissionPrompt.tsx');
const notificationHook = read('src/hooks/useNotifications.ts');
const monochromeBadgeSource = read('apps/duty-clock/assets/monochrome-icon-source.svg');
const portalBadge = readFileSync(new URL('../../public/notification-badge.png', import.meta.url));
const dutyBadge = readFileSync(new URL('../../apps/duty-clock/public/notification-badge.png', import.meta.url));

test('push subscriptions and delivery outbox remain service-only and idempotent', () => {
  assert.match(migration, /create table if not exists public\.push_subscriptions/i);
  assert.match(migration, /unique\(notification_id, subscription_id\)/i);
  assert.match(migration, /alter table public\.push_subscriptions enable row level security/i);
  assert.match(migration, /revoke all on public\.push_subscriptions from public, anon, authenticated/i);
  assert.match(migration, /for update of delivery skip locked/i);
});

test('the migration installs delivery prerequisites and a retry schedule', () => {
  assert.match(migration, /create extension if not exists pg_net/i);
  assert.match(migration, /create extension if not exists pg_cron/i);
  assert.match(migration, /enqueue_notification_push_deliveries_trigger/i);
  assert.match(migration, /process-notification-push-deliveries/i);
  assert.match(migration, /select private\.assert_function_permission_manifest\(\)/i);
});

test('duty break pushes are server timed, scoped to the Duty Clock and idempotent', () => {
  assert.match(dutyBreakMigration, /unique \(duty_period_id, reminder_kind\)/i);
  assert.match(dutyBreakMigration, /v_warning_at := v_due_at - interval '30 minutes'/i);
  assert.match(dutyBreakMigration, /session\.ended_at is null/i);
  assert.match(dutyBreakMigration, /duty_break\.break_end - duty_break\.break_start/i);
  assert.match(dutyBreakMigration, /subscription\.app_scope = 'duty_clock'/i);
  assert.match(dutyBreakMigration, /'target_app_scope', 'duty_clock'/i);
  assert.match(dutyBreakMigration, /dispatch-duty-break-notifications/i);
});

test('the push endpoint requires either an authenticated user or its worker secret', () => {
  assert.match(edgeFunction, /workerAuthorised\(req, workerSecret\)/);
  assert.match(edgeFunction, /const user = await requireUser/);
  assert.match(edgeFunction, /\.eq\("user_id", user\.id\)\.eq\("endpoint", endpoint\)/);
  assert.match(edgeFunction, /shouldRevokePushSubscription/);
});

test('both installed apps display and route clicked push notifications', () => {
  for (const worker of [portalWorker, dutyWorker]) {
    assert.match(worker, /addEventListener\('push'/);
    assert.match(worker, /showNotification/);
    assert.match(worker, /addEventListener\('notificationclick'/);
    assert.match(worker, /pushNotificationId/);
    assert.match(worker, /payload\.icon/);
    assert.match(worker, /icon: notificationIcon/);
    assert.match(worker, /badge:[^\n]*notification-badge\.png/);
  }
});

test('the portal worker reconciles and clears stale taskbar notifications', () => {
  assert.match(portalWorker, /SYNC_NOTIFICATION_BADGE/);
  assert.match(portalWorker, /getNotifications\(\)/);
  assert.match(portalWorker, /notification\.close\(\)/);
  assert.match(portalWorker, /setAppBadge\(0\)/);
});

test('badge reconciliation waits for an authoritative notification fetch', () => {
  assert.match(notificationHook, /if \(loading\) return;[\s\S]*syncAppNotificationBadge\(unreadCount\)/);
  assert.match(notificationHook, /\[loading, unreadCount\]/);
});

test('Android notification badges are transparent 96px aircraft silhouettes', () => {
  assert.doesNotMatch(monochromeBadgeSource, /<rect/i, 'the badge source must not contain a square background');
  assert.match(monochromeBadgeSource, /<path[^>]+fill="#FFFFFF"/i);
  for (const badge of [portalBadge, dutyBadge]) {
    assert.equal(badge.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(badge.readUInt32BE(16), 96);
    assert.equal(badge.readUInt32BE(20), 96);
    assert.equal(badge[25], 6, 'PNG must use RGBA colour so the background stays transparent');
  }
});

test('the push worker includes the configured company logo in every delivery', () => {
  assert.match(edgeFunction, /from\("organisation_settings"\)/);
  assert.match(edgeFunction, /select\("logo_url"\)/);
  assert.match(edgeFunction, /icon: notificationIcon/);
});

test('both installed apps explicitly refresh their service worker on launch', () => {
  for (const bootstrap of [portalBootstrap, dutyBootstrap]) {
    assert.match(bootstrap, /updateViaCache:\s*['"]none['"]/);
    assert.match(bootstrap, /registration\.update\(\)/);
  }
});

test('the install welcome prompt appears only for an authenticated installed PWA awaiting a choice', () => {
  const base = {
    authenticated: true,
    installed: true,
    pushState: 'prompt' as const,
    previouslyPrompted: false,
  };
  assert.equal(shouldShowPwaNotificationPrompt(base), true);
  assert.equal(shouldShowPwaNotificationPrompt({ ...base, authenticated: false }), false);
  assert.equal(shouldShowPwaNotificationPrompt({ ...base, installed: false }), false);
  assert.equal(shouldShowPwaNotificationPrompt({ ...base, pushState: 'enabled' }), false);
  assert.equal(shouldShowPwaNotificationPrompt({ ...base, pushState: 'blocked' }), false);
  assert.equal(shouldShowPwaNotificationPrompt({ ...base, previouslyPrompted: true }), false);
});

test('the prompt stores its one-time marker and requires a user click before requesting permission', () => {
  assert.match(appSource, /<PwaNotificationPermissionPrompt authenticated=\{Boolean\(user\?\.id\)\}/);
  assert.match(promptSource, /rememberPwaNotificationPrompt\(\)/);
  assert.match(promptSource, /onClick=\{\(\) => void enable\(\)\}/);
  assert.match(promptSource, /await phoneNotifications\.enable\(\)/);
  assert.match(promptSource, /This welcome prompt appears once for this installed app/);
  assert.match(promptSource, /changed in Settings/);
});
