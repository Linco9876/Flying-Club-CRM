import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativeUrl: string) => readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');

test('next-slot search stops after early chronological matches and has conflict indexes', () => {
  const migration = readSource('../../supabase/migrations/20260819160000_optimize_calendar_availability_search.sql');

  assert.match(migration, /for v_local_start in/i);
  assert.match(migration, /v_match_count >= v_match_limit/i);
  assert.doesNotMatch(migration, /cross join local_slots/i);
  assert.match(migration, /bookings_active_aircraft_time_idx/i);
  assert.match(migration, /bookings_active_instructor_time_idx/i);
});

test('next-slot search distinguishes an operational failure from no availability', () => {
  const source = readSource('../components/Calendar/NextAvailableSlotModal.tsx');

  assert.match(source, /const \[searchError, setSearchError\]/);
  assert.match(source, /errorCode === '57014'/);
  assert.match(source, /searched && !searchError && slots\.length === 0/);
  assert.match(source, /event\.key === 'Escape'/);
});

test('calendar overlays and view controls expose complete keyboard semantics', () => {
  const calendar = readSource('../components/Calendar/Calendar.tsx');
  const bookingForm = readSource('../components/Bookings/BookingForm.tsx');
  const resources = readSource('../components/Calendar/ResourceManagerPanel.tsx');
  const month = readSource('../components/Calendar/MonthView.tsx');

  assert.match(calendar, /aria-pressed=\{viewMode === mode\}/);
  assert.match(calendar, /aria-label="Choose calendar date"/);
  assert.match(calendar, /filteredListBookings\.length === 1 \? 'matches' : 'match'/);
  assert.match(calendar, /viewMode === 'list'\s*\? parseCalendarDateParam\(listStartDate\)/);
  assert.match(calendar, /refetch: refetchAvailability/);
  assert.match(calendar, /Promise\.all\(\[\s*onRefresh\?\.\(\),\s*refetchAvailability\(\)/);
  assert.match(calendar, /onDayClick=\{\(date\) => \{\s*setCurrentDate\(date\);\s*handleViewModeChange\('day', date\)/);
  assert.match(calendar, /if \(focusDate\) next\.set\('date', format\(focusDate, 'yyyy-MM-dd'\)\)/);
  assert.match(bookingForm, /aria-label="Close booking form"/);
  assert.match(bookingForm, /aria-labelledby="recurring-booking-title"/);
  assert.match(resources, /aria-label="Close resource manager"/);
  assert.match(resources, /aria-controls=\{panelId\}/);
  assert.match(month, /role="button"/);
  assert.match(month, /event\.key !== 'Enter' && event\.key !== ' '/);
});
