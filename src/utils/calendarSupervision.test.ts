import assert from 'node:assert/strict';
import test from 'node:test';
import type { Booking } from '../types';
import { layoutSupervisionMarkers, supervisionToCalendarEvent } from './calendarSupervision.ts';

test('simultaneous supervision markers receive separate narrow lanes', () => {
  const layouts = layoutSupervisionMarkers([
    { item: 'Tim first', start: new Date('2026-09-07T01:00:00Z'), end: new Date('2026-09-07T03:00:00Z') },
    { item: 'Matt', start: new Date('2026-09-07T01:30:00Z'), end: new Date('2026-09-07T04:00:00Z') },
    { item: 'Tim next', start: new Date('2026-09-07T03:00:00Z'), end: new Date('2026-09-07T05:00:00Z') },
  ]);

  assert.deepEqual(layouts.map(layout => [layout.item, layout.lane]), [
    ['Tim first', 0],
    ['Matt', 1],
    ['Tim next', 0],
  ]);
});

test('supervision calendar entry contains only the supervision commitment window', () => {
  const booking = {
    id: 'booking-1',
    startTime: new Date('2026-09-07T01:30:00Z'),
    endTime: new Date('2026-09-07T03:30:00Z'),
    instructorName: 'Matthew Lawrence',
    supervisingInstructorName: 'Lincoln Cottingham',
    supervisionStatus: 'assigned',
    location: 'Bendigo',
    paymentType: 'account',
    status: 'confirmed',
  } as Booking;

  const event = supervisionToCalendarEvent(booking, {
    aircraftLabel: '24-4852 Tecnam P92',
    coverageStart: new Date('2026-09-07T01:00:00Z'),
    coverageEnd: new Date('2026-09-07T04:00:00Z'),
    portalUrl: 'https://portal.bendigoflyingclub.com.au/calendar',
  });

  assert.equal(event.uid, 'supervision-booking-1@portal.bendigoflyingclub.com.au');
  assert.equal(event.title, 'BFC Supervision – Matthew Lawrence – 24-4852 Tecnam P92');
  assert.equal(event.start.toISOString(), '2026-09-07T01:00:00.000Z');
  assert.equal(event.end.toISOString(), '2026-09-07T04:00:00.000Z');
  assert.equal(event.status, 'TENTATIVE');
  assert.match(event.description, /Acknowledgement: Required/);
  assert.doesNotMatch(event.description, /student|hirer|booking actions/i);
});
