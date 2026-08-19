import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOGBOOK_FILTERS,
  filterAndSortLogbookEntries,
  hasActiveLogbookFilters,
} from './logbookFilters.ts';

const entries = [
  {
    id: 'older-dual',
    start_time: '2026-06-01T09:00:00+10:00',
    flight_duration: 1.2,
    dual_time: 1.2,
    solo_time: 0,
    comments: 'Circuit training',
    pilotInCommand: 'Lincoln Instructor',
    otherPilotOrCrew: 'Alex Student',
    aircraft: { id: 'tecnam', registration: '24-8511', make: 'Tecnam', model: 'P2008' },
  },
  {
    id: 'newer-solo',
    start_time: '2026-07-10T14:00:00+10:00',
    flight_duration: 2.4,
    dual_time: 0,
    solo_time: 2.4,
    comments: 'Navigation exercise',
    pilotInCommand: 'Alex Student',
    otherPilotOrCrew: '',
    aircraft: { id: 'archer', registration: 'VH-BIU', make: 'Piper', model: 'PA-28' },
  },
  {
    id: 'short-solo',
    start_time: '2026-07-05T11:00:00+10:00',
    flight_duration: 0.8,
    dual_time: 0,
    solo_time: 0.8,
    comments: 'Local flight',
    pilotInCommand: 'Alex Student',
    otherPilotOrCrew: '',
    aircraft: { id: 'tecnam', registration: '24-8511', make: 'Tecnam', model: 'P2008' },
  },
];

test('logbook filters combine search, aircraft, flight mode and date range', () => {
  const result = filterAndSortLogbookEntries(entries, {
    ...DEFAULT_LOGBOOK_FILTERS,
    search: 'tecnam',
    aircraftKey: 'tecnam',
    flightMode: 'solo',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31',
  });

  assert.deepEqual(result.map(entry => entry.id), ['short-solo']);
});

test('logbook search includes pilots, crew, comments and registration', () => {
  for (const search of ['Lincoln', 'Alex Student', 'circuit', '24-8511']) {
    const result = filterAndSortLogbookEntries(entries, {
      ...DEFAULT_LOGBOOK_FILTERS,
      search,
    });
    assert.ok(result.some(entry => entry.id === 'older-dual'), search);
  }
});

test('flight mode uses the hours allocated for the viewed logbook', () => {
  const instructorView = [{
    ...entries[0],
    hoursDual: 0,
    hoursPic: 1.2,
  }];

  assert.equal(filterAndSortLogbookEntries(instructorView, {
    ...DEFAULT_LOGBOOK_FILTERS,
    flightMode: 'dual',
  }).length, 0);
  assert.equal(filterAndSortLogbookEntries(instructorView, {
    ...DEFAULT_LOGBOOK_FILTERS,
    flightMode: 'solo',
  }).length, 1);
});

test('search includes lesson, booking description and personal notes', () => {
  const contextualEntry = [{
    ...entries[0],
    lessonName: 'Stalls and recovery',
    bookingDescription: 'Area training flight',
    personalNote: 'Revise pre-stall checks',
  }];

  for (const search of ['stalls', 'area training', 'pre-stall']) {
    assert.equal(filterAndSortLogbookEntries(contextualEntry, {
      ...DEFAULT_LOGBOOK_FILTERS,
      search,
    }).length, 1);
  }
});

test('logbook sorting supports date, duration and aircraft ordering', () => {
  assert.deepEqual(
    filterAndSortLogbookEntries(entries, DEFAULT_LOGBOOK_FILTERS).map(entry => entry.id),
    ['newer-solo', 'short-solo', 'older-dual'],
  );
  assert.deepEqual(
    filterAndSortLogbookEntries(entries, {
      ...DEFAULT_LOGBOOK_FILTERS,
      sortBy: 'duration_asc',
    }).map(entry => entry.id),
    ['short-solo', 'older-dual', 'newer-solo'],
  );
  assert.deepEqual(
    filterAndSortLogbookEntries(entries, {
      ...DEFAULT_LOGBOOK_FILTERS,
      sortBy: 'aircraft_asc',
    }).map(entry => entry.id),
    ['older-dual', 'short-solo', 'newer-solo'],
  );
});

test('sort selection alone does not count as an active filter', () => {
  assert.equal(hasActiveLogbookFilters({
    ...DEFAULT_LOGBOOK_FILTERS,
    sortBy: 'duration_desc',
  }), false);
  assert.equal(hasActiveLogbookFilters({
    ...DEFAULT_LOGBOOK_FILTERS,
    flightMode: 'dual',
  }), true);
});
