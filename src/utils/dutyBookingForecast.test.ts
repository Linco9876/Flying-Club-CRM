import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260815160000_use_duty_clock_with_booking_fallback.sql', import.meta.url),
  'utf8',
);
const bookingHook = readFileSync(new URL('../hooks/useBookings.ts', import.meta.url), 'utf8');
const spanOnlyMigration = readFileSync(
  new URL('../../supabase/migrations/20260908120000_use_duty_span_for_booking_warnings.sql', import.meta.url),
  'utf8',
);

test('Duty Clock time is authoritative and booking fallback has realistic margins', () => {
  assert.match(migration, /v_candidate_is_today :=/);
  assert.match(migration, /coalesce\(d\.entry_source, 'manual'\) in \('manual', 'mobile'\)/);
  assert.match(migration, /min\(a\.start_time\) - interval '30 minutes'/);
  assert.match(migration, /max\(a\.end_time\) \+ interval '30 minutes'/);
  assert.match(migration, /'dutyTimeSource'/);
  assert.match(migration, /'booking-fallback-30-minutes'/);
  assert.doesNotMatch(migration, /coalesce\(d\.actual_end, d\.planned_end, p_end\)/);
  assert.match(migration, /'engineVersion', 'duty-v3'/);
});

test('the current active duty is not compared with itself for minimum rest', () => {
  assert.match(migration, /where w\.duty_date < v_candidate_date/);
  assert.match(migration, /and w\.ends_at <= v_forecast_start/);
  assert.doesNotMatch(migration, /least\(v_now, v_forecast_start\)/);
});

test('automatic booking estimates close after the final booking', () => {
  assert.match(migration, /v_close_end := v_window\.ends_at/);
  assert.match(migration, /Booking fallback ended 30 minutes after the final booking/);
  assert.match(migration, /'fallbackRule', 'first-booking-minus-30-to-last-booking-plus-30'/);
  assert.match(migration, /b\.supervising_instructor_id/);
  assert.doesNotMatch(migration, /booking_kind[^\n]+<> 'ground'/);
});

test('a genuine mobile clock-in replaces an active booking estimate', () => {
  assert.match(migration, /v_existing_source <> 'automatic_booking'/);
  assert.match(migration, /entry_source = 'mobile'/);
  assert.match(migration, /auto_started_for_booking_id = null/);
});

test('recorded flight limits use flight minutes rather than duty duration', () => {
  assert.match(migration, /sum\(d\.flight_minutes\)/);
  assert.match(migration, /'ROLLING_28_FLIGHT'/);
  assert.match(migration, /'ROLLING_365_FLIGHT'/);
  assert.match(migration, /d\.duty_date between v_candidate_date - 27 and v_candidate_date/);
  assert.match(migration, /d\.duty_date between v_candidate_date - 364 and v_candidate_date/);
});

test('booking warnings use first start to last finish without summing the activity inside', () => {
  assert.match(spanOnlyMigration, /private\.assess_instructor_duty_booking_span_base/i);
  assert.match(spanOnlyMigration, /warning_item\.item->>'code' <> 'MAX_DAILY_BOOKED_FLIGHT'/i);
  assert.match(spanOnlyMigration, /rule_code\.code <> 'MAX_DAILY_BOOKED_FLIGHT'/i);
  assert.match(spanOnlyMigration, /v_assessment - 'forecastBookedHours'/i);
  assert.match(spanOnlyMigration, /'planningModel', 'first-start-to-last-finish'/i);
  assert.match(spanOnlyMigration, /'engineVersion', 'duty-v4-span-only'/i);
  assert.match(spanOnlyMigration, /grant execute[\s\S]*to authenticated, service_role/i);
  assert.match(spanOnlyMigration, /select private\.assert_function_permission_manifest\(\)/i);
});

test('Appendix 6 start-time limits replace the unrelated 01:00 finish rule', () => {
  assert.match(migration, /casa_appendix_6_fdp_limit_hours\(v_forecast_start\)/);
  assert.doesNotMatch(migration, /'LATEST_FINISH'/);
  assert.doesNotMatch(migration, /finish(?:es)? after 01:00/i);
});

test('all booking mutations use the authoritative server assessment', () => {
  assert.equal((bookingHook.match(/await assessDutyBooking\(/g) || []).length, 3);
  assert.doesNotMatch(bookingHook, /getInstructorFatigueWarnings|assertFatigueRules|LATEST_FINISH/);
});
