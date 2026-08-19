import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSafetyOccurrenceDateTime,
  normaliseSafetyOccurrenceTimestamp,
} from './safetyReportDateTime.ts';

test('converts a winter Bendigo occurrence entered in local time to the correct UTC instant', () => {
  assert.equal(
    normaliseSafetyOccurrenceTimestamp('2026-08-07T16:00', 'Australia/Melbourne'),
    '2026-08-07T06:00:00.000Z',
  );
});

test('observes daylight saving when converting summer occurrence times', () => {
  assert.equal(
    normaliseSafetyOccurrenceTimestamp('2026-01-07T16:00', 'Australia/Melbourne'),
    '2026-01-07T05:00:00.000Z',
  );
});

test('retains valid timestamps that already include an explicit timezone', () => {
  assert.equal(
    normaliseSafetyOccurrenceTimestamp('2026-08-07T06:00:00Z', 'Australia/Melbourne'),
    '2026-08-07T06:00:00.000Z',
  );
});

test('formats stored timestamps in the configured club timezone', () => {
  const formatted = formatSafetyOccurrenceDateTime(
    '2026-08-07T06:00:00.000Z',
    'Australia/Melbourne',
  );
  assert.match(formatted, /07\/08\/2026/);
  assert.match(formatted, /16:00:00/);
  assert.match(formatted, /AEST|GMT\+10/);
});

test('rejects invalid and daylight-saving gap times instead of silently shifting them', () => {
  assert.throws(
    () => normaliseSafetyOccurrenceTimestamp('not-a-time', 'Australia/Melbourne'),
    /valid occurrence date and time/i,
  );
  assert.throws(
    () => normaliseSafetyOccurrenceTimestamp('2026-10-04T02:30', 'Australia/Melbourne'),
    /daylight-saving clock change/i,
  );
});
