import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingDefaultTimes } from './bookingDefaults.ts';

test('organisation slot length controls the default new-booking duration', () => {
  assert.deepEqual(bookingDefaultTimes({
    bookingDayStart: '06:00',
    bookingDayEnd: '22:00',
    slotLengthMinutes: 90,
  }), { startTime: '09:00', endTime: '10:30' });
});

test('default booking times stay inside configured operating hours', () => {
  assert.deepEqual(bookingDefaultTimes({
    bookingDayStart: '10:00',
    bookingDayEnd: '10:45',
    slotLengthMinutes: 60,
  }), { startTime: '10:00', endTime: '10:45' });
});
