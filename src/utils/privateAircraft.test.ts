import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIVATE_AIRCRAFT_ID, aircraftResourcesConflict, hasPrivateRegistrationOverlap, isPrivateAircraft, normaliseAircraftRegistration, privateAircraftValidationError, withPrivateAircraftDetails } from './privateAircraft.ts';
import { calculateFlightCost } from './billing.ts';

test('private option and ground sessions are not exclusive aircraft resources', () => {
  assert.equal(aircraftResourcesConflict(PRIVATE_AIRCRAFT_ID, PRIVATE_AIRCRAFT_ID), false);
  assert.equal(aircraftResourcesConflict(undefined, undefined), false);
  assert.equal(aircraftResourcesConflict('club-aircraft', 'club-aircraft'), true);
  assert.equal(aircraftResourcesConflict('club-aircraft', 'other-aircraft'), false);
  assert.equal(isPrivateAircraft(PRIVATE_AIRCRAFT_ID), true);
});

test('private booking requires instructor, type and registration for both members and guests', () => {
  const booking = { aircraftId: PRIVATE_AIRCRAFT_ID, instructorId: 'instructor', privateAircraftType: 'Cessna 172S', privateAircraftRegistration: 'VH-ABC' };
  assert.equal(privateAircraftValidationError(booking), null);
  for (const key of ['instructorId', 'privateAircraftType', 'privateAircraftRegistration']) {
    assert.ok(privateAircraftValidationError({ ...booking, [key]: '' }));
  }
  assert.equal(privateAircraftValidationError({ aircraftId: 'club-aircraft' }), null);
  assert.equal(normaliseAircraftRegistration('  vh-abc  '), 'VH-ABC');
  assert.equal(normaliseAircraftRegistration('24-1234'), '24-1234');
});

test('logbook presents the real private aircraft, preserving the source record', () => {
  const source = { id: 'flight', private_aircraft_registration: 'VH-ABC', private_aircraft_type: 'Cessna 172S', aircraft: { id: PRIVATE_AIRCRAFT_ID, registration: 'Private aircraft', make: '', model: 'Instruction only' } };
  const result = withPrivateAircraftDetails(source);
  assert.equal(result.aircraft.registration, 'VH-ABC');
  assert.equal(result.aircraft.model, 'Cessna 172S');
  assert.equal(result.aircraft.id, PRIVATE_AIRCRAFT_ID);
  assert.equal(source.aircraft.registration, 'Private aircraft');
  const club = { aircraft: { registration: 'VH-CLUB', make: 'Cessna', model: '172' } };
  assert.equal(withPrivateAircraftDetails(club), club);
});

test('instruction-only pricing uses flying hours and the existing billing calculation', () => {
  const rate = { chargeType: 'tach' as const, soloRate: 0, dualRate: 150, flatSurcharge: 10, weekendSurcharge: 20 };
  assert.equal(calculateFlightCost({ rate, durationHours: 1.2, dualHours: 1.2, soloHours: 0, isDual: true, startTime: new Date(2026, 8, 9) }), 190);
  assert.equal(calculateFlightCost({ rate, durationHours: 1.2, dualHours: 1.2, soloHours: 0, isDual: true, startTime: new Date(2026, 8, 12) }), 210);
  assert.equal(calculateFlightCost({ rate: { ...rate, chargeType: 'free' }, durationHours: 1.2, isDual: true }), 0);
  assert.equal(calculateFlightCost({ rate, durationHours: 1.2, isDual: true, startTime: '2026-09-06T15:30:00Z', timeZone: 'Australia/Sydney' }), 190, 'Monday in Bendigo must not attract Sunday pricing');
});

test('registration warning catches equivalent registrations and excludes self, cancelled and adjacent bookings', () => {
  const booking = { id: 'a', aircraftId: PRIVATE_AIRCRAFT_ID, privateAircraftRegistration: 'VH-ABC', startTime: new Date('2026-09-09T00:00Z'), endTime: new Date('2026-09-09T02:00Z') };
  assert.equal(hasPrivateRegistrationOverlap(booking, [{ ...booking, id: 'b', privateAircraftRegistration: ' vh abc ' }]), true);
  assert.equal(hasPrivateRegistrationOverlap(booking, [booking]), false);
  assert.equal(hasPrivateRegistrationOverlap(booking, [{ ...booking, id: 'b', status: 'cancelled' }]), false);
  assert.equal(hasPrivateRegistrationOverlap(booking, [{ ...booking, id: 'b', startTime: booking.endTime, endTime: new Date('2026-09-09T03:00Z') }]), false);
});
