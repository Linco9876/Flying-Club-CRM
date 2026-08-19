import assert from 'node:assert/strict';
import test from 'node:test';
import { getCalendarStickyHeaderTransition } from './calendarStickyHeader.ts';

const visibleInput = {
  viewportWidth: 1440,
  stickyTop: 64,
  originalHeaderTop: 64,
  originalHeaderHeight: 72,
  calendarBottom: 1200,
  compactHeaderHeight: 48,
  shrinkDistance: 40,
  viewMode: 'day',
  isKioskMode: false,
};

test('starts at full height when the original heading reaches the portal header', () => {
  assert.deepEqual(getCalendarStickyHeaderTransition(visibleInput), {
    visible: true,
    progress: 0,
    height: 72,
  });
});

test('stays hidden while the original titles are still visible', () => {
  assert.equal(getCalendarStickyHeaderTransition({
    ...visibleInput,
    originalHeaderTop: 65,
  }).visible, false);
});

test('shrinks in proportion to the scroll distance', () => {
  assert.deepEqual(getCalendarStickyHeaderTransition({
    ...visibleInput,
    originalHeaderTop: 44,
  }), {
    visible: true,
    progress: 0.5,
    height: 60,
  });
});

test('settles at compact height after the shrink distance', () => {
  assert.deepEqual(getCalendarStickyHeaderTransition({
    ...visibleInput,
    originalHeaderTop: 0,
  }), {
    visible: true,
    progress: 1,
    height: 48,
  });
});

test('disappears after the user scrolls past the calendar body', () => {
  assert.equal(getCalendarStickyHeaderTransition({
    ...visibleInput,
    calendarBottom: 100,
  }).visible, false);
});

test('is limited to desktop day/week calendars outside kiosk mode', () => {
  assert.equal(getCalendarStickyHeaderTransition({ ...visibleInput, viewportWidth: 767 }).visible, false);
  assert.equal(getCalendarStickyHeaderTransition({ ...visibleInput, viewMode: 'month' }).visible, false);
  assert.equal(getCalendarStickyHeaderTransition({ ...visibleInput, isKioskMode: true }).visible, false);
  assert.equal(getCalendarStickyHeaderTransition({ ...visibleInput, viewMode: 'week' }).visible, true);
});
