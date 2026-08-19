import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Booking } from '../types';
import {
  authorisationCoversBooking,
  canOfferManualBookingSupervision,
  type SeniorInstructorAuthorisation,
} from './manualBookingSupervision.ts';

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: 'booking-1',
  instructorId: 'trainee-1',
  studentId: 'student-1',
  aircraftId: 'aircraft-1',
  startTime: new Date('2026-09-10T00:00:00.000Z'),
  endTime: new Date('2026-09-10T01:30:00.000Z'),
  paymentType: 'account',
  status: 'pending_supervision',
  bookingKind: 'flight',
  location: 'Bendigo',
  supervisionRequired: true,
  supervisionStatus: 'pending',
  ...overrides,
});

const authorisation = (
  overrides: Partial<SeniorInstructorAuthorisation> = {},
): SeniorInstructorAuthorisation => ({
  instructor_id: 'senior-1',
  is_active: true,
  locations: ['Bendigo'],
  activity_types: ['flight'],
  remote_supervision_allowed: false,
  effective_from: '2026-01-01',
  effective_to: null,
  qualification_expires_on: '2027-01-01',
  ...overrides,
});

test('an authorised senior can accept an uncovered future booking', () => {
  assert.equal(canOfferManualBookingSupervision(
    booking(),
    'senior-1',
    [authorisation()],
    new Date('2026-09-01T00:00:00.000Z'),
  ), true);
});

test('the trainee, expired authorisations and already covered bookings are not offered the action', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(canOfferManualBookingSupervision(
    booking(),
    'trainee-1',
    [authorisation({ instructor_id: 'trainee-1' })],
    now,
  ), false);
  assert.equal(canOfferManualBookingSupervision(
    booking(),
    'senior-1',
    [authorisation({ qualification_expires_on: '2026-09-09' })],
    now,
  ), false);
  assert.equal(canOfferManualBookingSupervision(
    booking({ supervisionStatus: 'assigned', supervisingInstructorId: 'senior-2' }),
    'senior-1',
    [authorisation()],
    now,
  ), false);
});

test('authorisation activity and location scope are enforced without case sensitivity', () => {
  assert.equal(authorisationCoversBooking(
    authorisation({ locations: ['BENDIGO'], activity_types: ['FLIGHT'] }),
    booking({ location: 'Bendigo' }),
  ), true);
  assert.equal(authorisationCoversBooking(
    authorisation({ locations: ['Shepparton'] }),
    booking({ location: 'Bendigo' }),
  ), false);
  assert.equal(authorisationCoversBooking(
    authorisation({ activity_types: ['ground'] }),
    booking(),
  ), false);
});

test('past, cancelled and logged bookings cannot receive a new promise', () => {
  const eligible = [authorisation()];
  assert.equal(canOfferManualBookingSupervision(
    booking(),
    'senior-1',
    eligible,
    new Date('2026-09-11T00:00:00.000Z'),
  ), false);
  assert.equal(canOfferManualBookingSupervision(
    booking({ status: 'cancelled' }),
    'senior-1',
    eligible,
    new Date('2026-09-01T00:00:00.000Z'),
  ), false);
  assert.equal(canOfferManualBookingSupervision(
    booking({ flight_logged: true }),
    'senior-1',
    eligible,
    new Date('2026-09-01T00:00:00.000Z'),
  ), false);
  assert.equal(canOfferManualBookingSupervision(
    booking({ bookingKind: 'ground', ground_session_logged: true }),
    'senior-1',
    [authorisation({ activity_types: ['ground'] })],
    new Date('2026-09-01T00:00:00.000Z'),
  ), false);
});

test('database and booking actions preserve the safety contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20260818110000_add_manual_booking_supervision_commitments.sql',
    'utf8',
  );
  const menu = readFileSync('src/components/Bookings/BookingActionMenu.tsx', 'utf8');
  const hook = readFileSync('src/hooks/useManualBookingSupervision.ts', 'utf8');

  assert.match(migration, /create table if not exists public\.booking_supervision_commitments/i);
  assert.match(migration, /for update;/i, 'acceptance must lock the booking');
  assert.match(migration, /manual_supervisor_available_for_slot/i);
  assert.match(migration, /assess_instructor_duty_booking/i);
  assert.match(migration, /v_count < v_maximum/i);
  assert.match(migration, /manual_supervision_accepted/i);
  assert.match(migration, /rosterAvailabilityOverridden', true/i);
  assert.match(migration, /invalidate_manual_supervision_after_booking_change/i);
  assert.match(migration, /invalidate_manual_supervision_after_requirement_change/i);
  assert.match(menu, /I will supervise this booking/);
  assert.match(menu, /will be present and responsible/);
  assert.match(hook, /accept_booking_supervision/);
  assert.match(hook, /supervision-accepted/);
});
