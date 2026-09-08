import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDefaultDowntimeRecurrence,
  buildRecurringDowntimeOccurrences,
  canManageCalendarDowntime,
  doesTemporaryDowntimeOverlapBooking,
  getDowntimeRecurrenceValidationError,
  getCalendarUnavailabilityBackground,
  getTemporaryDowntimeValidationError,
} from './calendarDowntime.ts';

const validDraft = {
  startDate: '2026-08-18',
  endDate: '2026-08-18',
  startTime: '10:00',
  endTime: '11:30',
  reason: 'Appointment',
};

test('only the downtime owner or an admin can manage a temporary off period', () => {
  assert.equal(canManageCalendarDowntime('instructor-1', 'instructor-1', false), true);
  assert.equal(canManageCalendarDowntime('instructor-1', 'admin-1', true), true);
  assert.equal(canManageCalendarDowntime('instructor-1', 'instructor-2', false), false);
  assert.equal(canManageCalendarDowntime(null, 'admin-1', true), false);
});

test('temporary off periods use orange diagonal hatching while rostered unavailability stays grey', () => {
  assert.match(getCalendarUnavailabilityBackground('absence'), /249, 115, 22/);
  assert.match(getCalendarUnavailabilityBackground('absence'), /repeating-linear-gradient/);
  assert.equal(getCalendarUnavailabilityBackground('schedule'), 'rgba(156, 163, 175, 0.35)');
});

test('downtime edits require valid dates, paired times and a reason', () => {
  assert.equal(getTemporaryDowntimeValidationError(validDraft), null);
  assert.equal(getTemporaryDowntimeValidationError({ ...validDraft, endDate: '2026-08-17' }), 'The end date cannot be before the start date');
  assert.equal(getTemporaryDowntimeValidationError({ ...validDraft, endTime: undefined }), 'Choose both a start and end time, or make the downtime all day');
  assert.equal(getTemporaryDowntimeValidationError({ ...validDraft, endTime: '09:30' }), 'The end time must be after the start time');
  assert.equal(getTemporaryDowntimeValidationError({ ...validDraft, reason: ' ' }), 'Enter a short reason for the downtime');
  assert.equal(getTemporaryDowntimeValidationError({ ...validDraft, startTime: undefined, endTime: undefined }), null);
});

test('supervision impact only includes bookings that overlap the selected downtime dates', () => {
  const downtime = {
    startDate: '2026-09-21',
    endDate: '2026-09-21',
  };

  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-09-13T10:30:00+10:00',
    endTime: '2026-09-13T12:00:00+10:00',
  }), false);
  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-09-27T07:30:00+10:00',
    endTime: '2026-09-27T09:00:00+10:00',
  }), false);
  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-09-21T08:30:00+10:00',
    endTime: '2026-09-21T17:00:00+10:00',
  }), true);
});

test('timed downtime only affects overlapping times in the Sydney calendar day', () => {
  const downtime = {
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    startTime: '12:00',
    endTime: '14:00',
  };

  // Sydney is UTC+11 on this date. These values also prove the comparison is
  // based on the club timezone rather than the browser or test runner timezone.
  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-10-05T00:30:00.000Z',
    endTime: '2026-10-05T02:00:00.000Z',
  }), true);
  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-10-04T22:00:00.000Z',
    endTime: '2026-10-05T00:00:00.000Z',
  }), false);
  assert.equal(doesTemporaryDowntimeOverlapBooking(downtime, {
    startTime: '2026-10-05T03:00:00.000Z',
    endTime: '2026-10-05T04:00:00.000Z',
  }), false);
});

test('a booking ending at midnight does not affect downtime on the following day', () => {
  assert.equal(doesTemporaryDowntimeOverlapBooking({
    startDate: '2026-09-21',
    endDate: '2026-09-21',
  }, {
    startTime: '2026-09-20T20:00:00+10:00',
    endTime: '2026-09-21T00:00:00+10:00',
  }), false);
});

test('the absence mutation warning passes the selected periods into impact checking', () => {
  const source = readFileSync(new URL('../hooks/useInstructorAvailability.ts', import.meta.url), 'utf8');
  assert.match(source, /confirmSupervisionImpact\(absence\.userId, 'This absence', \[absence\]\)/);
  assert.match(source, /doesTemporaryDowntimeOverlapBooking\(period/);
});

test('calendar exposes click-to-edit, save and permanent delete actions for temporary downtime', () => {
  const source = readFileSync(new URL('../components/Calendar/Calendar.tsx', import.meta.url), 'utf8');
  assert.match(source, /Edit temporary off period/);
  assert.match(source, /Save changes/);
  assert.match(source, /Delete permanently/);
  assert.match(source, /openInstructorDowntimeEditor/);
});

test('recurring downtime preserves the original and multi-day duration', () => {
  const occurrences = buildRecurringDowntimeOccurrences(
    { startDate: '2026-08-20', endDate: '2026-08-22' },
    {
      ...buildDefaultDowntimeRecurrence(),
      enabled: true,
      frequency: 'daily',
      interval: 2,
      count: 3,
    },
  );

  assert.deepEqual(occurrences, [
    { startDate: '2026-08-20', endDate: '2026-08-22' },
    { startDate: '2026-08-22', endDate: '2026-08-24' },
    { startDate: '2026-08-24', endDate: '2026-08-26' },
  ]);
});

test('weekly recurring downtime supports multiple selected weekdays', () => {
  const occurrences = buildRecurringDowntimeOccurrences(
    { startDate: '2026-08-20', endDate: '2026-08-20' },
    {
      ...buildDefaultDowntimeRecurrence(),
      enabled: true,
      frequency: 'weekly',
      weekdays: [1, 4],
      count: 4,
    },
  );

  assert.deepEqual(occurrences.map(item => item.startDate), [
    '2026-08-20',
    '2026-08-24',
    '2026-08-27',
    '2026-08-31',
  ]);
});

test('recurring downtime validates its end controls and is exposed in the editor', () => {
  const base = { ...buildDefaultDowntimeRecurrence(), enabled: true };
  assert.equal(
    getDowntimeRecurrenceValidationError({ ...base, frequency: 'weekly', weekdays: [] }, '2026-08-20'),
    'Choose at least one weekday',
  );
  assert.equal(
    getDowntimeRecurrenceValidationError({ ...base, weekdays: [4], endMode: 'on', untilDate: '2026-08-20' }, '2026-08-20'),
    'Choose an end date after the first downtime period',
  );

  const source = readFileSync(new URL('../components/Calendar/Calendar.tsx', import.meta.url), 'utf8');
  assert.match(source, /Recurring downtime/);
  assert.match(source, /Save & create series/);
  assert.match(source, /updateAbsenceWithCopies/);
});
