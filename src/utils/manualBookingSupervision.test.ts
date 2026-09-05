import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Booking } from '../types';
import {
  authorisationCoversBooking,
  canAcknowledgeBookingSupervision,
  canOfferCfiSupervisorAllocation,
  canOfferManualBookingSupervision,
  getAuthorisedSupervisorsForBooking,
  getSupervisionCoverageWindow,
  type InstructorSupervisionRequirement,
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

test('a CFI can allocate or reassign an authorised supervisor on a future booking', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(canOfferCfiSupervisorAllocation(booking(), true, now), true);
  assert.equal(canOfferCfiSupervisorAllocation(booking(), false, now), false);
  assert.equal(canOfferCfiSupervisorAllocation(
    booking({ supervisionStatus: 'assigned', supervisingInstructorId: 'senior-1' }),
    true,
    now,
  ), true);
  assert.equal(canOfferCfiSupervisorAllocation(
    booking({ supervisionStatus: 'acknowledged', supervisingInstructorId: 'senior-1' }),
    true,
    now,
  ), true);
  assert.equal(canOfferCfiSupervisorAllocation(
    booking({ flight_logged: true }),
    true,
    now,
  ), false);
});

test('the CFI selector contains only active authorisations that cover the booking', () => {
  assert.deepEqual(getAuthorisedSupervisorsForBooking(
    booking(),
    [
      authorisation({ instructor_id: 'senior-2' }),
      authorisation({ instructor_id: 'senior-1' }),
      authorisation({ instructor_id: 'senior-3', locations: ['Shepparton'] }),
      authorisation({ instructor_id: 'trainee-1' }),
    ],
    [
      { id: 'senior-1', name: 'Zara Senior' },
      { id: 'senior-2', name: 'Alex Senior' },
      { id: 'senior-3', name: 'Wrong Location' },
      { id: 'trainee-1', name: 'Booking Instructor' },
    ],
  ), [
    { id: 'senior-2', name: 'Alex Senior' },
    { id: 'senior-1', name: 'Zara Senior' },
  ]);
});

test('the existing supervisor is omitted from the reassignment selector', () => {
  assert.deepEqual(getAuthorisedSupervisorsForBooking(
    booking({ supervisionStatus: 'assigned', supervisingInstructorId: 'senior-1' }),
    [authorisation(), authorisation({ instructor_id: 'senior-2' })],
    [
      { id: 'senior-1', name: 'Current Supervisor' },
      { id: 'senior-2', name: 'Replacement Supervisor' },
    ],
  ), [{ id: 'senior-2', name: 'Replacement Supervisor' }]);
});

test('only the allocated supervisor can acknowledge a new assignment', () => {
  const assigned = booking({ supervisionStatus: 'assigned', supervisingInstructorId: 'senior-1' });
  assert.equal(canAcknowledgeBookingSupervision(assigned, 'senior-1'), true);
  assert.equal(canAcknowledgeBookingSupervision(assigned, 'senior-2'), false);
  assert.equal(canAcknowledgeBookingSupervision(
    booking({ supervisionStatus: 'acknowledged', supervisingInstructorId: 'senior-1' }),
    'senior-1',
  ), false);
});

test('calendar supervision blocks include the configured briefing and debriefing window', () => {
  const requirement: InstructorSupervisionRequirement = {
    instructor_id: 'trainee-1',
    supervision_required: true,
    activity_types: ['flight'],
    locations: ['Bendigo'],
    preflight_minutes: 20,
    postflight_minutes: 15,
    effective_from: '2026-01-01',
    effective_to: null,
  };
  const window = getSupervisionCoverageWindow(booking(), [requirement]);
  assert.equal(window.startTime.toISOString(), '2026-09-09T23:40:00.000Z');
  assert.equal(window.endTime.toISOString(), '2026-09-10T01:45:00.000Z');
});

test('database and booking actions preserve the safety contract', () => {
  const migration = readFileSync(
    'supabase/migrations/20260818110000_add_manual_booking_supervision_commitments.sql',
    'utf8',
  );
  const menu = readFileSync('src/components/Bookings/BookingActionMenu.tsx', 'utf8');
  const hook = readFileSync('src/hooks/useManualBookingSupervision.ts', 'utf8');
  const cfiMigration = readFileSync(
    'supabase/migrations/20260826100000_add_cfi_supervisor_allocation.sql',
    'utf8',
  );
  const allocationModal = readFileSync(
    'src/components/Bookings/SupervisorAssignmentModal.tsx',
    'utf8',
  );
  const reassignmentMigration = readFileSync(
    'supabase/migrations/20260903090000_support_calendar_supervision_reassignment.sql',
    'utf8',
  );
  const requirementRefreshMigration = readFileSync(
    'supabase/migrations/20260905153000_preserve_manual_supervision_on_requirement_refresh.sql',
    'utf8',
  );
  const calendar = readFileSync('src/components/Calendar/Calendar.tsx', 'utf8');
  const browserCalendar = readFileSync('src/utils/calendar.ts', 'utf8');
  const calendarFeed = readFileSync('supabase/functions/calendar-feed/index.ts', 'utf8');

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
  assert.match(cfiMigration, /create or replace function public\.assign_booking_supervisor/i);
  assert.match(cfiMigration, /current_user_is_cfi\(\)/i);
  assert.match(cfiMigration, /for update;/i, 'CFI allocation must lock the booking');
  assert.match(cfiMigration, /manual_supervisor_available_for_slot/i);
  assert.match(cfiMigration, /rosterAvailabilityOverridden', true/i);
  assert.match(cfiMigration, /supervisorAcknowledgementRequired', true/i);
  assert.match(cfiMigration, /cfi_supervisor_allocated/i);
  assert.match(menu, /CFI supervisor allocation/);
  assert.match(menu, /Assign supervisor/);
  assert.match(menu, /data-mobile-supervision-actions/);
  assert.match(menu, /Assign a supervisor/);
  assert.match(allocationModal, /asked to acknowledge the assignment/i);
  assert.match(hook, /assign_booking_supervisor/);
  assert.match(hook, /supervision-assigned/);
  assert.match(hook, /current_user_is_cfi/);
  assert.match(reassignmentMigration, /cfi_supervisor_reassigned/i);
  assert.match(reassignmentMigration, /supervision_status not in \('pending', 'assigned', 'acknowledged'\)/i);
  assert.match(requirementRefreshMigration, /old\.supervision_required is not distinct from new\.supervision_required/i);
  assert.match(requirementRefreshMigration, /old\.role_mandated is not distinct from new\.role_mandated/i);
  assert.match(requirementRefreshMigration, /update of supervision_required,[\s\S]*role_mandated or delete/i);
  assert.match(requirementRefreshMigration, /manual_supervisor_available_for_slot/i);
  assert.match(requirementRefreshMigration, /lastRequirementRevalidatedAt/i);
  assert.match(requirementRefreshMigration, /recoveredFromNoOpRequirementInvalidation/i);
  assert.match(requirementRefreshMigration, /end_reason = 'Instructor supervision requirement changed'/i);
  assert.match(calendar, /<span>Supervision<\/span>/i);
  assert.match(calendar, /Supervision confirmed/i);
  assert.match(calendar, /data-supervision-block/i);
  assert.match(browserCalendar, /!showSupervision && booking\.status === 'pending_supervision'/i);
  assert.match(browserCalendar, /showSupervision && booking\.supervisingInstructorName/i);
  assert.match(calendarFeed, /!showSupervision && booking\.status === "pending_supervision"/i);
  assert.match(calendarFeed, /showSupervision && supervisor\?\.name/i);
});
