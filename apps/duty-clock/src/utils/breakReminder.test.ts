import assert from 'node:assert/strict';
import test from 'node:test';
import { getDutyBreakReminderState } from './breakReminder.ts';

const base = {
  dutyStart: '2026-08-14T08:00:00+10:00',
  policyEnabled: true,
  requiredAfterMinutes: 300,
  minimumBreakMinutes: 30,
  recordedBreaks: [],
};

test('break reminder warns exactly 30 minutes before the configured due time', () => {
  const result = getDutyBreakReminderState({ ...base, now: '2026-08-14T12:30:00+10:00' });
  assert.equal(result.state, 'warning');
  assert.equal(result.minutesUntilDue, 30);
  assert.equal(result.dueAt?.toISOString(), '2026-08-14T03:00:00.000Z');
});

test('break reminder becomes due at the configured threshold', () => {
  const result = getDutyBreakReminderState({ ...base, now: '2026-08-14T13:00:00+10:00' });
  assert.equal(result.state, 'due');
});

test('a completed qualifying break suppresses reminders', () => {
  const result = getDutyBreakReminderState({
    ...base,
    now: '2026-08-14T13:30:00+10:00',
    recordedBreaks: [{ start: '2026-08-14T10:00:00+10:00', end: '2026-08-14T10:30:00+10:00' }],
  });
  assert.equal(result.state, 'satisfied');
});

test('an active break suppresses reminders while the user is taking it', () => {
  const result = getDutyBreakReminderState({
    ...base,
    now: '2026-08-14T13:30:00+10:00',
    activeBreakStart: '2026-08-14T13:20:00+10:00',
  });
  assert.equal(result.state, 'in_progress');
});
