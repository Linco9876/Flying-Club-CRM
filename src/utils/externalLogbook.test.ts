import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  calculateLifetimeLogbookTotals,
  getExternalLogbookEntryValidationError,
  getLogbookBaselineValidationError,
  isIncludedInLogbookBaseline,
  type LogbookBaseline,
} from './externalLogbook.ts';

const externalLogbookMigration = readFileSync(
  new URL('../../supabase/migrations/20260819100000_add_external_logbook_hours.sql', import.meta.url),
  'utf8',
).toLowerCase();

const deploymentRepairMigration = readFileSync(
  new URL('../../supabase/migrations/20260819104500_harden_single_guest_booking_relink.sql', import.meta.url),
  'utf8',
).toLowerCase();

const baseline: LogbookBaseline = {
  user_id: 'pilot-1',
  as_of_date: '2026-06-30',
  last_flight_date: '2026-06-20',
  total_hours: 80,
  pic_hours: 55,
  dual_hours: 20,
  takeoffs: 120,
  landings: 118,
};

test('a baseline is combined only with entries after its inclusive cutoff', () => {
  const totals = calculateLifetimeLogbookTotals(baseline, [
    { date: '2026-06-30', totalHours: 1, picHours: 1, dualHours: 0, takeoffs: 1, landings: 1 },
    { date: '2026-07-01', totalHours: 1.2, picHours: 0.4, dualHours: 0.8, takeoffs: 2, landings: 2 },
  ]);

  assert.deepEqual(totals, {
    totalHours: 81.2,
    picHours: 55.4,
    dualHours: 20.8,
    takeoffs: 122,
    landings: 120,
  });
  assert.equal(isIncludedInLogbookBaseline('2026-06-30T13:59:59Z', baseline), true);
  assert.equal(isIncludedInLogbookBaseline('2026-06-30T14:00:00Z', baseline), false);
  assert.equal(isIncludedInLogbookBaseline('2026-07-01', baseline), false);
});

test('portal timestamps use the configured club timezone at the baseline boundary', () => {
  assert.equal(
    isIncludedInLogbookBaseline('2026-06-30T23:00:00Z', baseline, 'Australia/Melbourne'),
    false,
  );
  assert.equal(
    isIncludedInLogbookBaseline('2026-06-30T23:00:00Z', baseline, 'America/Los_Angeles'),
    true,
  );
  assert.equal(isIncludedInLogbookBaseline('2026-06-30', baseline, 'Pacific/Auckland'), true);
});

test('all entries count when no baseline exists', () => {
  assert.deepEqual(calculateLifetimeLogbookTotals(null, [
    { date: '2026-01-01', totalHours: 1.1, picHours: 1.1, dualHours: 0, takeoffs: 1, landings: 1 },
  ]), {
    totalHours: 1.1,
    picHours: 1.1,
    dualHours: 0,
    takeoffs: 1,
    landings: 1,
  });
});

test('baseline validation prevents double-allocation and false future dates', () => {
  assert.match(getLogbookBaselineValidationError({
    asOfDate: '2999-01-01',
    totalHours: 10,
    picHours: 5,
    dualHours: 5,
  }) || '', /future/);
  assert.match(getLogbookBaselineValidationError({
    asOfDate: '2026-01-01',
    totalHours: 10,
    picHours: 8,
    dualHours: 4,
  }) || '', /cannot exceed/);
});

test('dual external entries identify the instructor or PIC', () => {
  assert.match(getExternalLogbookEntryValidationError({
    flightDate: '2026-01-01',
    aircraftRegistration: '24-0001',
    aircraftType: 'Tecnam P92',
    dualHours: 1,
    picHours: 0,
  }) || '', /instructor or pilot in command/);
  assert.equal(getExternalLogbookEntryValidationError({
    flightDate: '2026-01-01',
    aircraftRegistration: '24-0001',
    aircraftType: 'Tecnam P92',
    pilotInCommandName: 'Example Instructor',
    dualHours: 1,
    picHours: 0,
  }), null);
});

test('external logbook trigger permissions are manifested for fresh and deployed databases', () => {
  for (const migration of [externalLogbookMigration, deploymentRepairMigration]) {
    assert.match(migration, /'public\.touch_external_logbook_updated_at\(\)'/);
    assert.match(migration, /'trigger_internal'/);
    assert.match(migration, /array\[\]::text\[\]/);
    assert.match(
      migration,
      /revoke all on function public\.touch_external_logbook_updated_at\(\)[\s\S]*service_role/,
    );
    assert.match(migration, /select private\.assert_function_permission_manifest\(\)/);
  }
});
