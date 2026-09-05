import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Booking, DutyAssessment, FlightLog, GroundSessionLog } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBookingRulesSettings, useCalendarSettings, usePortalUxSettings } from './useSettings';
import toast from 'react-hot-toast';
import { useLatestEffect } from './useLatestEffect';
import { useFinancialProviders } from '../context/financialProviderState';
import { shouldCaptureFinancialDetails } from '../utils/financialProviderPresentation';
import {
  BOOKING_CALENDAR_REFRESH_EVENT,
  requestBookingCalendarRefresh,
} from '../utils/bookingCalendarRefresh';
import { normaliseGuestBookingPurpose } from '../utils/casualContacts';
import { buildRecurringBookingUpdatePlan } from '../utils/recurringBookingEdits';

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
};

const getMissingSchemaColumn = (error: unknown) => {
  const message = getErrorMessage(error);
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
};

const OPTIONAL_BOOKING_COLUMNS = new Set([
  'booking_kind', 'has_conflict', 'ground_session_logged', 'location', 'location_id',
  'duty_override_reason', 'duty_assessment', 'supervision_required',
  'supervision_status', 'supervising_instructor_id', 'membership_eligibility_status',
  'membership_warning_code', 'membership_override_reason', 'membership_overridden_by',
  'membership_overridden_at', 'membership_eligibility_snapshot', 'casual_contact_id',
  'booking_purpose', 'recurrence_series_id', 'recurrence_occurrence_index',
  'recurrence_occurrence_count', 'recurrence_notifications_finalised_at',
]);

interface AddBookingOptions {
  silent?: boolean;
  recurrence?: {
    seriesId: string;
    occurrenceIndex: number;
    occurrenceCount: number;
  };
}

export interface BookingCancellationInput {
  reasonId?: string;
  notes?: string;
}

export const useBookings = (enabled = true) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const financialCaptureEnabled = shouldCaptureFinancialDetails(financialProviders);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const { settings: bookingRules } = useBookingRulesSettings();
  const { settings: calendarSettings } = useCalendarSettings();
  const bookingFetchSequenceRef = useRef(0);
  const missingOptionalBookingColumnsRef = useRef<Set<string>>(new Set());

  const isStudentOrPilot = user?.role === 'student' || user?.role === 'pilot';
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isStudentOnlyUser = userRoles.includes('student') && !userRoles.some(role => ['pilot', 'cfi', 'instructor', 'senior_instructor', 'admin'].includes(role));
  const isStaffUser = userRoles.some(role => ['admin', 'cfi', 'senior_instructor', 'instructor'].includes(role));
  const shouldUsePublicCalendarView = isStudentOrPilot && !isStaffUser;
  const getBookingSelectFields = () => shouldUsePublicCalendarView
    ? '*'
    : [
        'id',
        'student_id',
        'instructor_id',
        'aircraft_id',
        'start_time',
        'end_time',
        'payment_type',
        'notes',
        'status',
        'booking_kind',
        'has_conflict',
        'deleted_at',
        'flight_logged',
        'ground_session_logged',
        'flight_type_id',
        'trial_flight_voucher_id',
        'is_guest_booking',
        'guest_name',
        'guest_email',
        'guest_phone',
        'casual_contact_id',
        'booking_purpose',
        'cancellation_reason_id',
        'cancellation_reason_name',
        'cancellation_notes',
        'cancellation_fee_type',
        'cancellation_fee_amount',
        'cancelled_at',
        'cancelled_by',
        'waitlist_reason',
        'waitlisted_by_defect_id',
        'location',
        'location_id',
        'duty_override_reason',
        'duty_assessment',
        'supervision_required',
        'supervision_status',
        'supervising_instructor_id',
        'membership_eligibility_status',
        'membership_warning_code',
        'membership_override_reason',
        'membership_overridden_by',
        'membership_overridden_at',
        'membership_eligibility_snapshot',
        'recurrence_series_id',
        'recurrence_occurrence_index',
        'recurrence_occurrence_count',
        'recurrence_notifications_finalised_at',
      ].filter(field => !missingOptionalBookingColumnsRef.current.has(field)).join(',');
  const flightLogCalendarFields = [
    'id',
    'booking_id',
    'landings',
    'duration',
    'tach_start',
    'tach_end',
    'engine_start',
    'engine_end',
    'total_cost',
    'notes',
    'flight_duration',
    'start_tach',
    'end_tach',
    'calculated_cost',
  ].join(',');
  const mapBookingRow = (row: any, flightLog?: FlightLog, groundSessionLog?: GroundSessionLog): Booking => ({
    id: row.id,
    studentId: row.student_id,
    pilotId: row.student_id,
    instructorId: row.instructor_id,
    aircraftId: row.aircraft_id || undefined,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    paymentType: row.payment_type || '',
    notes: row.notes || undefined,
    status: row.deleted_at && row.status !== 'no-show' ? 'cancelled' : row.status,
    bookingKind: row.booking_kind || 'flight',
    hasConflict: row.has_conflict || false,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : undefined,
    flightLog,
    flight_logged: row.flight_logged || false,
    groundSessionLog,
    ground_session_logged: row.ground_session_logged || false,
    flightTypeId: row.flight_type_id || undefined,
    trialFlightVoucherId: row.trial_flight_voucher_id || undefined,
    hirerName: row.guest_name || row.hirer_name || undefined,
    instructorName: row.instructor_name || undefined,
    isGuestBooking: row.is_guest_booking || false,
    guestName: row.guest_name || undefined,
    guestEmail: row.guest_email || undefined,
    guestPhone: row.guest_phone || undefined,
    casualContactId: row.casual_contact_id || undefined,
    bookingPurpose: row.booking_purpose || (row.is_guest_booking
      ? (row.trial_flight_voucher_id ? 'trial_flight' : 'casual_flight')
      : 'standard'),
    cancellationReasonId: row.cancellation_reason_id || undefined,
    cancellationReasonName: row.cancellation_reason_name || undefined,
    cancellationNotes: row.cancellation_notes || undefined,
    cancellationFeeType: row.cancellation_fee_type || undefined,
    cancellationFeeAmount: Number(row.cancellation_fee_amount || 0),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    cancelledBy: row.cancelled_by || undefined,
    waitlistReason: row.waitlist_reason || undefined,
    waitlistedByDefectId: row.waitlisted_by_defect_id || undefined,
    location: row.location || 'Bendigo',
    locationId: row.location_id || undefined,
    dutyOverrideReason: row.duty_override_reason || undefined,
    dutyAssessment: row.duty_assessment || undefined,
    supervisionRequired: Boolean(row.supervision_required),
    supervisionStatus: row.supervision_status || 'not_required',
    supervisingInstructorId: row.supervising_instructor_id || undefined,
    membershipEligibilityStatus: row.membership_eligibility_status || undefined,
    membershipWarningCode: row.membership_warning_code || undefined,
    membershipOverrideReason: row.membership_override_reason || undefined,
    membershipOverriddenBy: row.membership_overridden_by || undefined,
    membershipOverriddenAt: row.membership_overridden_at ? new Date(row.membership_overridden_at) : undefined,
    membershipEligibilitySnapshot: row.membership_eligibility_snapshot || undefined,
    recurrenceSeriesId: row.recurrence_series_id || undefined,
    recurrenceOccurrenceIndex: row.recurrence_occurrence_index == null
      ? undefined
      : Number(row.recurrence_occurrence_index),
    recurrenceOccurrenceCount: row.recurrence_occurrence_count == null
      ? undefined
      : Number(row.recurrence_occurrence_count),
    recurrenceNotificationsFinalisedAt: row.recurrence_notifications_finalised_at
      ? new Date(row.recurrence_notifications_finalised_at)
      : undefined,
  });

  const retryWithoutMissingOptionalColumn = async <T,>(
    error: unknown,
    operation: () => Promise<T>
  ) => {
    const missingColumn = getMissingSchemaColumn(error);
    if (!missingColumn || !OPTIONAL_BOOKING_COLUMNS.has(missingColumn)) {
      throw error;
    }
    missingOptionalBookingColumnsRef.current.add(missingColumn);
    return operation();
  };

  const withoutKnownMissingOptionalColumns = <T extends Record<string, unknown>>(payload: T): T => {
    const next = { ...payload };
    missingOptionalBookingColumnsRef.current.forEach((column) => {
      delete next[column];
    });
    return next;
  };

  const runBookingMutationWithOptionalColumnRetry = async <
    TPayload extends Record<string, unknown>,
    TResult extends { error: unknown }
  >(
    payload: TPayload,
    operation: (payload: TPayload) => Promise<TResult>
  ): Promise<TResult> => {
    let currentPayload = withoutKnownMissingOptionalColumns(payload);

    for (let attempt = 0; attempt <= OPTIONAL_BOOKING_COLUMNS.size; attempt += 1) {
      const result = await operation(currentPayload);
      if (!result.error) return result;

      const missingColumn = getMissingSchemaColumn(result.error);
      if (!missingColumn || !OPTIONAL_BOOKING_COLUMNS.has(missingColumn)) {
        return result;
      }

      missingOptionalBookingColumnsRef.current.add(missingColumn);
      currentPayload = withoutKnownMissingOptionalColumns(currentPayload);
    }

    return operation(currentPayload);
  };

  const ensureGuestPlaceholderAccount = async () => {
    const { data, error } = await supabase.functions.invoke<{ userId?: string }>('ensure-guest-account', {
      body: {},
    });

    if (error) throw error;
    if (!data?.userId) throw new Error('Guest booking account could not be prepared.');
    return data.userId;
  };

  const resolveGuestVoucherHolder = async (
    voucherId: string,
    options: { allowUnredeemedGuest?: boolean } = {}
  ) => {
    const { data, error } = await supabase
      .from('trial_flight_vouchers')
      .select(`
        id,
        code,
        status,
        redeemed_by_user_id,
        recipient_name,
        recipient_email,
        purchaser_name,
        purchaser_email,
        purchaser_phone
      `)
      .eq('id', voucherId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Linked voucher could not be found.');
    if (!data.redeemed_by_user_id && !options.allowUnredeemedGuest) {
      throw new Error(`Voucher ${data.code || voucherId} has not been redeemed into a member account yet.`);
    }

    return {
      userId: data.redeemed_by_user_id as string | undefined,
      guestName: (data.recipient_name || data.purchaser_name || '').trim(),
      guestEmail: (data.recipient_email || data.purchaser_email || '').trim(),
      guestPhone: (data.purchaser_phone || '').trim(),
    };
  };

  const validateTimingRules = (
    startTime: Date,
    endTime: Date,
    options: { enforceMinNotice?: boolean } = { enforceMinNotice: true }
  ) => {
    const now = Date.now();
    const durationHours = (endTime.getTime() - startTime.getTime()) / (60 * 60 * 1000);
    const isPastBooking = startTime.getTime() < now;

    if (endTime <= startTime) throw new Error('End time must be after start time');
    if (
      bookingRules?.enforce_max_duration &&
      durationHours > bookingRules.max_booking_duration_hours
    ) {
      throw new Error(`Bookings cannot be longer than ${bookingRules.max_booking_duration_hours} hours`);
    }
    if (!isStudentOrPilot) return;
    if (
      !isPastBooking &&
      options.enforceMinNotice !== false &&
      bookingRules?.enforce_min_notice &&
      startTime.getTime() < now + bookingRules.min_booking_notice_hours * 60 * 60 * 1000
    ) {
      throw new Error(`Bookings must be made at least ${bookingRules.min_booking_notice_hours} hours in advance`);
    }
    if (
      bookingRules?.enforce_max_advance &&
      startTime.getTime() > now + bookingRules.max_booking_advance_days * 24 * 60 * 60 * 1000
    ) {
      throw new Error(`Bookings can only be made up to ${bookingRules.max_booking_advance_days} days in advance`);
    }
  };

  const assessDutyBooking = async (
    bookingData: Pick<Booking, 'instructorId' | 'startTime' | 'endTime' | 'dutyOverrideReason'>,
    excludingBookingId?: string
  ) => {
    if (bookingRules?.fatigue_rules_enabled === false || !bookingData.instructorId) {
      return { assessment: null as DutyAssessment | null, overrideReason: bookingData.dutyOverrideReason };
    }
    const { data, error: assessmentError } = await supabase.rpc('assess_instructor_duty_booking', {
      p_instructor_id: bookingData.instructorId,
      p_start: new Date(bookingData.startTime).toISOString(),
      p_end: new Date(bookingData.endTime).toISOString(),
      p_exclude_booking_id: excludingBookingId || null,
    });
    if (assessmentError) {
      console.error('Server duty assessment failed', assessmentError);
      throw new Error('The duty assessment could not be completed. The booking has not been saved.');
    }
    const assessment = data as DutyAssessment;
    if (assessment?.result !== 'warning') {
      return { assessment, overrideReason: undefined };
    }
    if (bookingData.dutyOverrideReason?.trim().length && bookingData.dutyOverrideReason.trim().length >= 10) {
      return { assessment, overrideReason: bookingData.dutyOverrideReason.trim() };
    }
    const warningText = (assessment.warnings || []).map(warning => `• ${warning.message}`).join('\n');
    const reason = window.prompt(`Duty-limit warning\n\n${warningText}\n\nYou may continue, but must provide a reason (at least 10 characters):`);
    if (!reason || reason.trim().length < 10) {
      throw new Error('Booking cancelled: a reason of at least 10 characters is required to continue after a duty warning.');
    }
    return { assessment, overrideReason: reason.trim() };
  };

  const fetchBookings = async ({ silent = false }: { silent?: boolean } = {}) => {
    const fetchSequence = ++bookingFetchSequenceRef.current;
    if (!enabled) {
      setBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      if (!silent) setLoading(true);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 15000)
      );

      const runBookingsQuery = async () => {
        const bookingsPromise = supabase
          .from(shouldUsePublicCalendarView ? 'calendar_booking_public' : 'bookings')
          .select(getBookingSelectFields())
          .order('start_time', { ascending: false });

        return Promise.race([
          bookingsPromise,
          timeoutPromise
        ]) as Promise<{ data: any[] | null; error: any }>;
      };

      let { data: bookingsData, error: bookingsError } = await runBookingsQuery();
      if (bookingsError) {
        try {
          ({ data: bookingsData, error: bookingsError } = await retryWithoutMissingOptionalColumn(
            bookingsError,
            runBookingsQuery
          ));
        } catch (retryError) {
          bookingsError = retryError;
        }
      }

      if (bookingsError) {
        console.error('Bookings error:', bookingsError);
        if (fetchSequence === bookingFetchSequenceRef.current) {
          setError(null);
          setLoading(false);
        }
        return;
      }

      const bookingIds = (bookingsData || [])
        .map((booking: any) => booking.id)
        .filter(Boolean);

      let flightLogsData: any[] = [];
      let flightLogsError: any = null;
      let groundSessionLogsData: any[] = [];
      let groundSessionLogsError: any = null;
      if (bookingIds.length > 0) {
        const chunkSize = 150;
        for (let index = 0; index < bookingIds.length; index += chunkSize) {
          const response = await supabase
            .from('flight_logs')
            .select(flightLogCalendarFields)
            .in('booking_id', bookingIds.slice(index, index + chunkSize));
          if (response.error) {
            flightLogsError = response.error;
            break;
          }
          flightLogsData = [...flightLogsData, ...(response.data || [])];

          const groundResponse = await supabase
            .from('ground_session_logs')
            .select('id, booking_id, student_id, instructor_id, start_time, end_time, duration_hours, flight_type_id, payment_type, description_option_id, description_text, notes, calculated_cost, payment_status, xero_invoice_id, xero_invoice_number, xero_invoice_status, xero_sync_status, xero_sync_error')
            .in('booking_id', bookingIds.slice(index, index + chunkSize));
          if (groundResponse.error) {
            groundSessionLogsError = groundResponse.error;
            break;
          }
          groundSessionLogsData = [...groundSessionLogsData, ...(groundResponse.data || [])];
        }
      }

      if (flightLogsError) {
        console.error('Flight logs error:', flightLogsError);
      }
      if (groundSessionLogsError) {
        console.error('Ground session logs error:', groundSessionLogsError);
      }

      const flightLogsMap = new Map(flightLogsData?.map(fl => [fl.booking_id, {
        id: fl.id,
        bookingId: fl.booking_id,
        landings: fl.landings,
        duration: parseFloat(fl.duration ?? fl.flight_duration ?? 0),
        tachStart: parseFloat(fl.tach_start ?? fl.start_tach ?? 0),
        tachEnd: parseFloat(fl.tach_end ?? fl.end_tach ?? 0),
        engineStart: parseFloat(fl.engine_start),
        engineEnd: parseFloat(fl.engine_end),
        totalCost: parseFloat(fl.total_cost ?? fl.calculated_cost ?? 0),
        notes: fl.notes
      } as FlightLog]) || []);

      const groundSessionLogsMap = new Map(groundSessionLogsData?.map(log => [log.booking_id, {
        id: log.id,
        bookingId: log.booking_id,
        studentId: log.student_id,
        instructorId: log.instructor_id,
        startTime: log.start_time,
        endTime: log.end_time,
        durationHours: Number(log.duration_hours || 0),
        flightTypeId: log.flight_type_id || undefined,
        paymentType: log.payment_type || '',
        descriptionOptionId: log.description_option_id || undefined,
        descriptionText: log.description_text || undefined,
        notes: log.notes || undefined,
        calculatedCost: Number(log.calculated_cost || 0),
        paymentStatus: log.payment_status || 'pending',
        xeroInvoiceId: log.xero_invoice_id || null,
        xeroInvoiceNumber: log.xero_invoice_number || null,
        xeroInvoiceStatus: log.xero_invoice_status || null,
        xeroSyncStatus: log.xero_sync_status || null,
        xeroSyncError: log.xero_sync_error || null,
      } as GroundSessionLog]) || []);

      const combinedBookings: Booking[] = (bookingsData || []).map(b =>
        mapBookingRow(b, flightLogsMap.get(b.id), groundSessionLogsMap.get(b.id))
      );

      if (fetchSequence === bookingFetchSequenceRef.current) {
        setBookings(combinedBookings);
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching bookings:', err);
      if (fetchSequence === bookingFetchSequenceRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch bookings');
      }
    } finally {
      if (fetchSequence === bookingFetchSequenceRef.current) setLoading(false);
    }
  };

  const timeRangesOverlap = (
    aStart: Date | string,
    aEnd: Date | string,
    bStart: Date | string,
    bEnd: Date | string
  ) => new Date(aStart) < new Date(bEnd) && new Date(aEnd) > new Date(bStart);

  const toLocalDateString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const addDays = (date: Date, days: number) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

  const getDatesBetween = (startTime: Date, endTime: Date) => {
    const dates: Date[] = [];
    let cursor = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    const end = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate());

    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }

    return dates;
  };

  const buildAbsenceDateTime = (date: Date, time: string | null | undefined, fallback: 'start' | 'end') => {
    const [hour, minute] = (time || (fallback === 'start' ? '00:00' : '23:59')).slice(0, 5).split(':').map(Number);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      Number.isFinite(hour) ? hour : fallback === 'start' ? 0 : 23,
      Number.isFinite(minute) ? minute : fallback === 'start' ? 0 : 59,
      fallback === 'end' ? 59 : 0
    );
  };

  const findInstructorAbsenceConflicts = async (
    instructorId: string | null | undefined,
    startTime: Date,
    endTime: Date
  ) => {
    if (!instructorId) return [];

    const bookingStartDate = toLocalDateString(startTime);
    const bookingEndDate = toLocalDateString(endTime);

    const { data, error } = await supabase
      .from('instructor_absences')
      .select('id,user_id,instructor_id,start_date,end_date,start_time,end_time,reason')
      .or(`user_id.eq.${instructorId},instructor_id.eq.${instructorId}`)
      .lte('start_date', bookingEndDate)
      .gte('end_date', bookingStartDate);

    if (error) {
      console.error('Error checking instructor absences:', error);
      throw new Error('Could not check instructor availability');
    }

    return (data || []).filter((absence: any) =>
      getDatesBetween(startTime, endTime).some((date) => {
        const dateString = toLocalDateString(date);
        if (dateString < absence.start_date || dateString > absence.end_date) return false;

        const absenceStart = buildAbsenceDateTime(date, absence.start_time, 'start');
        const absenceEnd = buildAbsenceDateTime(date, absence.end_time, 'end');
        return timeRangesOverlap(startTime, endTime, absenceStart, absenceEnd);
      })
    );
  };

  const assertInstructorAvailable = async (
    bookingData: Pick<Booking, 'instructorId' | 'startTime' | 'endTime'>
  ) => {
    const absences = await findInstructorAbsenceConflicts(
      bookingData.instructorId,
      new Date(bookingData.startTime),
      new Date(bookingData.endTime)
    );

    if (absences.length > 0) {
      const reason = absences[0]?.reason ? ` (${absences[0].reason})` : '';
      throw new Error(`Instructor is unavailable during that time${reason}`);
    }
  };

  const findConfirmedConflicts = (
    bookingData: Pick<Booking, 'aircraftId' | 'instructorId' | 'startTime' | 'endTime'>,
    excludingBookingId?: string
  ) => bookings.filter(existing =>
    existing.id !== excludingBookingId &&
    !existing.hasConflict &&
    (existing.status === 'confirmed' || existing.status === 'pending_supervision') &&
    timeRangesOverlap(bookingData.startTime, bookingData.endTime, existing.startTime, existing.endTime) &&
    (
      existing.aircraftId === bookingData.aircraftId ||
      Boolean(bookingData.instructorId && existing.instructorId === bookingData.instructorId)
    )
  );

  const addBooking = async (bookingData: Omit<Booking, 'id' | 'flightLog'>, options: AddBookingOptions = {}) => {
    try {
      console.log('Creating booking with data:', bookingData);

      let resolvedStudentId = bookingData.studentId;
      let resolvedGuestName = bookingData.guestName?.trim() || '';
      let resolvedGuestEmail = bookingData.guestEmail?.trim() || '';
      let resolvedGuestPhone = bookingData.guestPhone?.trim() || '';
      if (bookingData.isGuestBooking && bookingData.trialFlightVoucherId) {
        const voucherHolder = await resolveGuestVoucherHolder(bookingData.trialFlightVoucherId, {
          allowUnredeemedGuest: true,
        });
        resolvedStudentId = voucherHolder.userId || resolvedStudentId;
        resolvedGuestName = resolvedGuestName || voucherHolder.guestName;
        resolvedGuestEmail = resolvedGuestEmail || voucherHolder.guestEmail;
        resolvedGuestPhone = resolvedGuestPhone || voucherHolder.guestPhone;
      }

      if (bookingData.isGuestBooking && !resolvedStudentId) {
        resolvedStudentId = await ensureGuestPlaceholderAccount();
      }

      if ((user?.role === 'student' || user?.role === 'pilot') && !portalSettings.allow_self_booking) {
        throw new Error('Student self-booking is disabled. Please contact the club.');
      }

      if (
        isStudentOrPilot &&
        bookingData.startTime.getTime() > Date.now() + portalSettings.max_advance_booking_days * 24 * 60 * 60 * 1000
      ) {
        throw new Error(`Bookings can only be made up to ${portalSettings.max_advance_booking_days} days in advance`);
      }

      // Student-only users need approval; pilots can hire without instructor approval unless the organisation rule says otherwise.
      let needsApproval = isStudentOnlyUser ||
        Boolean(bookingRules?.require_instructor_approval && !bookingData.instructorId);

      validateTimingRules(bookingData.startTime, bookingData.endTime, {
        enforceMinNotice: Boolean(bookingData.instructorId),
      });
      if (!options.silent && bookingData.startTime.getTime() < Date.now()) {
        toast('Warning: this booking is being created in the past.');
      }

      // Validate required fields
      if (!resolvedStudentId || resolvedStudentId.trim() === '') {
        throw new Error('Student is required');
      }
      const effectiveKind = bookingData.bookingKind === 'ground' || !bookingData.aircraftId ? 'ground' : 'flight';
      if (effectiveKind !== 'ground' && (!bookingData.aircraftId || bookingData.aircraftId.trim() === '')) {
        throw new Error('Aircraft is required');
      }
      if (effectiveKind === 'ground' && (!bookingData.instructorId || bookingData.instructorId.trim() === '')) {
        throw new Error('Instructor is required for ground sessions');
      }
      if (bookingData.isGuestBooking) {
        if (!resolvedGuestName) throw new Error('Guest name is required');
        if (!bookingData.trialFlightVoucherId && !resolvedGuestPhone) throw new Error('Guest phone number is required');
      }

      if (isStudentOnlyUser && !bookingData.instructorId) {
        throw new Error('Students need an instructor assigned before booking an aircraft solo. Pilots can book solo.');
      }

      await assertInstructorAvailable(bookingData);
      const dutyResult = await assessDutyBooking(bookingData);

      const conflicts = findConfirmedConflicts(bookingData);
      const isWaitlisted = conflicts.length > 0;
      if (isWaitlisted && calendarSettings?.conflict_rules === 'block') {
        throw new Error('This booking conflicts with an existing confirmed booking');
      }

      if (isWaitlisted && calendarSettings?.conflict_rules === 'approval') needsApproval = true;

      const bookingStatus = needsApproval ? 'pending_approval' : bookingData.status;
      const bookingPurpose = bookingData.isGuestBooking
        ? normaliseGuestBookingPurpose(bookingData.bookingPurpose, Boolean(bookingData.trialFlightVoucherId))
        : bookingData.bookingPurpose || 'standard';

      const insertData = {
        student_id: resolvedStudentId,
        instructor_id: bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null,
        aircraft_id: effectiveKind === 'ground' ? null : bookingData.aircraftId,
        start_time: bookingData.startTime.toISOString(),
        end_time: bookingData.endTime.toISOString(),
        payment_type: bookingData.paymentType,
        notes: bookingData.notes || null,
        status: bookingStatus,
        booking_kind: effectiveKind,
        has_conflict: isWaitlisted,
        flight_type_id: bookingData.flightTypeId || null,
        trial_flight_voucher_id: bookingData.trialFlightVoucherId || null,
        is_guest_booking: bookingData.isGuestBooking || false,
        guest_name: bookingData.isGuestBooking ? resolvedGuestName || null : null,
        guest_email: bookingData.isGuestBooking ? resolvedGuestEmail || null : null,
        guest_phone: bookingData.isGuestBooking ? resolvedGuestPhone || null : null,
        casual_contact_id: bookingData.casualContactId || null,
        booking_purpose: bookingPurpose,
        location: bookingData.location?.trim() || 'Bendigo',
        location_id: bookingData.locationId || null,
        duty_override_reason: dutyResult.overrideReason || null,
        membership_override_reason: bookingData.membershipOverrideReason?.trim() || null,
        recurrence_series_id: options.recurrence?.seriesId || null,
        recurrence_occurrence_index: options.recurrence?.occurrenceIndex || null,
        recurrence_occurrence_count: options.recurrence?.occurrenceCount || null,
      };

      console.log('Insert data:', insertData);

      const runInsert = async (payload: typeof insertData) => supabase
        .from('bookings')
        .insert(payload)
        .select(getBookingSelectFields());

      const { data, error } = await runBookingMutationWithOptionalColumnRetry(insertData, runInsert);

      if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          full: error
        });
        const errorMsg = error.message || error.details || 'Unknown database error';
        const createError = new Error(errorMsg) as Error & { alreadyToasted?: boolean };
        createError.alreadyToasted = true;
        toast.error(`Failed to create booking: ${errorMsg}`);
        throw createError;
      }

      console.log('Booking created:', data);
      const createdRows = data as unknown as Array<Record<string, unknown>> | null;
      const createdBooking = createdRows?.[0];
      if (typeof createdBooking?.id === 'string') {
        setBookings(prev => [mapBookingRow(createdBooking, undefined, undefined), ...prev]);
        requestBookingCalendarRefresh({
          bookingId: createdBooking.id,
          reason: 'booking-created',
        });
      }

      // Send approval notifications if needed
      if (needsApproval && typeof createdBooking?.id === 'string') {
        const { error: notifyError } = await supabase
          .rpc('notify_instructor_booking_request', {
            booking_id: createdBooking.id
          });

        if (notifyError) {
          console.error('Error sending approval notifications:', notifyError);
        }
      }

      if (options.silent) {
        return;
      }

      if (createdBooking?.has_conflict) {
        toast('This booking overlaps an existing booking, so it has been placed on the waiting list.');
      } else if (needsApproval) {
        toast.success('Booking request submitted - awaiting approval');
      } else {
        toast.success('Booking created successfully');
      }
    } catch (err: any) {
      console.error('Error adding booking:', err);
      console.error('Error details:', {
        message: err?.message,
        details: err?.details,
        hint: err?.hint,
        code: err?.code
      });

      const errorMessage = err?.message || err?.details || 'Unknown error occurred';
      if (!err?.alreadyToasted) {
        toast.error(`Failed to create booking: ${errorMessage}`);
      }
      throw err;
    }
  };

  const finaliseRecurringBookingSeries = async (seriesId: string) => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error: finaliseError } = await supabase.rpc('finalise_recurring_booking_series', {
        p_series_id: seriesId,
      });
      if (!finaliseError) return;
      lastError = finaliseError;
      if (attempt < 2) {
        await new Promise(resolve => window.setTimeout(resolve, 200 * (attempt + 1)));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(getErrorMessage(lastError) || 'Recurring booking notifications could not be finalised');
  };

  const updateRecurringBookingSeries = async (
    id: string,
    bookingData: Partial<Omit<Booking, 'id' | 'flightLog'>>,
    silent = false,
  ) => {
    try {
      const currentBooking = bookings.find(booking => booking.id === id);
      if (!currentBooking) {
        throw new Error('The selected booking could not be found. Refresh the calendar and try again.');
      }
      if (!currentBooking.recurrenceSeriesId || !currentBooking.recurrenceOccurrenceIndex) {
        throw new Error('This booking is not linked to a recurring series.');
      }

      const newStartTime = bookingData.startTime
        ? new Date(bookingData.startTime)
        : new Date(currentBooking.startTime);
      const newEndTime = bookingData.endTime
        ? new Date(bookingData.endTime)
        : new Date(currentBooking.endTime);
      const updatePlan = buildRecurringBookingUpdatePlan(
        bookings,
        currentBooking,
        newStartTime,
        newEndTime,
      );

      let resolvedStudentId = bookingData.studentId ?? currentBooking.studentId;
      let resolvedGuestName = bookingData.guestName?.trim() ?? currentBooking.guestName?.trim();
      let resolvedGuestEmail = bookingData.guestEmail?.trim() ?? currentBooking.guestEmail?.trim();
      let resolvedGuestPhone = bookingData.guestPhone?.trim() ?? currentBooking.guestPhone?.trim();
      const trialFlightVoucherId = bookingData.trialFlightVoucherId ?? currentBooking.trialFlightVoucherId;
      const isGuestBooking = bookingData.isGuestBooking ?? currentBooking.isGuestBooking ?? false;

      if (isGuestBooking && trialFlightVoucherId) {
        const voucherHolder = await resolveGuestVoucherHolder(trialFlightVoucherId, {
          allowUnredeemedGuest: true,
        });
        resolvedStudentId = voucherHolder.userId || resolvedStudentId;
        resolvedGuestName = resolvedGuestName || voucherHolder.guestName;
        resolvedGuestEmail = resolvedGuestEmail || voucherHolder.guestEmail;
        resolvedGuestPhone = resolvedGuestPhone || voucherHolder.guestPhone;
      }
      if (isGuestBooking && !resolvedStudentId) {
        resolvedStudentId = await ensureGuestPlaceholderAccount();
      }
      if (!resolvedStudentId) throw new Error('Student is required');

      const instructorId = bookingData.instructorId !== undefined
        ? bookingData.instructorId?.trim() || undefined
        : currentBooking.instructorId;
      const requestedAircraftId = bookingData.aircraftId !== undefined
        ? bookingData.aircraftId?.trim() || undefined
        : currentBooking.aircraftId;
      const bookingKind = bookingData.bookingKind
        || (!requestedAircraftId ? 'ground' : currentBooking.bookingKind || 'flight');
      const aircraftId = bookingKind === 'ground' ? undefined : requestedAircraftId;

      if (bookingKind === 'flight' && !aircraftId) throw new Error('Aircraft is required');
      if (bookingKind === 'ground' && !instructorId) {
        throw new Error('Instructor is required for ground sessions');
      }
      if (isGuestBooking) {
        if (!resolvedGuestName) throw new Error('Guest name is required');
        if (!trialFlightVoucherId && !resolvedGuestPhone) throw new Error('Guest phone number is required');
      }

      for (const target of updatePlan) {
        validateTimingRules(target.startTime, target.endTime, {
          enforceMinNotice: Boolean(instructorId),
        });
        await assertInstructorAvailable({
          instructorId,
          startTime: target.startTime,
          endTime: target.endTime,
        });
      }

      const bookingPurpose = isGuestBooking
        ? normaliseGuestBookingPurpose(
          bookingData.bookingPurpose ?? currentBooking.bookingPurpose,
          Boolean(trialFlightVoucherId),
        )
        : bookingData.bookingPurpose ?? currentBooking.bookingPurpose ?? 'standard';

      const runSeriesUpdate = async (dutyOverrideReason?: string) => supabase.rpc(
        'update_recurring_booking_series_from_occurrence',
        {
          p_booking_id: id,
          p_new_start: newStartTime.toISOString(),
          p_new_end: newEndTime.toISOString(),
          p_student_id: resolvedStudentId,
          p_instructor_id: instructorId || null,
          p_aircraft_id: aircraftId || null,
          p_payment_type: bookingData.paymentType ?? currentBooking.paymentType ?? '',
          p_notes: bookingData.notes ?? currentBooking.notes ?? null,
          p_booking_kind: bookingKind,
          p_flight_type_id: bookingData.flightTypeId ?? currentBooking.flightTypeId ?? null,
          p_is_guest_booking: isGuestBooking,
          p_guest_name: resolvedGuestName || null,
          p_guest_email: resolvedGuestEmail || null,
          p_guest_phone: resolvedGuestPhone || null,
          p_trial_flight_voucher_id: trialFlightVoucherId || null,
          p_casual_contact_id: bookingData.casualContactId ?? currentBooking.casualContactId ?? null,
          p_booking_purpose: bookingPurpose,
          p_location: bookingData.location ?? currentBooking.location ?? 'Bendigo',
          p_location_id: bookingData.locationId ?? currentBooking.locationId ?? null,
          p_duty_override_reason: dutyOverrideReason || null,
          p_membership_override_reason: bookingData.membershipOverrideReason || null,
        },
      );

      let dutyOverrideReason = bookingData.dutyOverrideReason?.trim() || undefined;
      let response = await runSeriesUpdate(dutyOverrideReason);
      if (response.error) {
        const errorMessage = getErrorMessage(response.error);
        const dutyMarker = 'DUTY_OVERRIDE_REQUIRED|';
        const markerIndex = errorMessage.indexOf(dutyMarker);
        if (markerIndex >= 0 && !dutyOverrideReason) {
          let warningText = 'One or more future bookings would exceed a configured duty limit.';
          try {
            const assessment = JSON.parse(errorMessage.slice(markerIndex + dutyMarker.length)) as DutyAssessment;
            const messages = (assessment.warnings || []).map(warning => `• ${warning.message}`);
            if (messages.length > 0) warningText = messages.join('\n');
          } catch {
            // The database hint still supplies a useful fallback if a provider
            // wraps or truncates the structured assessment payload.
          }

          const reason = window.prompt(
            `Duty-limit warning for the recurring series\n\n${warningText}\n\n`
            + 'You may continue, but must provide one reason for the affected series (at least 10 characters):',
          );
          if (!reason || reason.trim().length < 10) {
            throw new Error('Series update cancelled: a reason of at least 10 characters is required after a duty warning.');
          }
          dutyOverrideReason = reason.trim();
          response = await runSeriesUpdate(dutyOverrideReason);
        }
      }
      if (response.error) throw response.error;

      const result = response.data as { updatedCount?: number } | null;
      const updatedCount = Number(result?.updatedCount || updatePlan.length);
      await fetchBookings({ silent: true });
      requestBookingCalendarRefresh({ bookingId: id, reason: 'recurring-bookings-updated' });
      if (!silent) {
        toast.success(`${updatedCount} recurring ${updatedCount === 1 ? 'booking' : 'bookings'} updated`);
      }
      return updatedCount;
    } catch (err) {
      console.error('Error updating recurring booking series:', err);
      if (!silent) {
        toast.error(getErrorMessage(err) || 'Failed to update recurring booking series');
      }
      throw err;
    }
  };

  const updateBooking = async (id: string, bookingData: Partial<Omit<Booking, 'id' | 'flightLog'>>, silent = false) => {
    try {
      const updateData: any = {};
      const currentBooking = bookings.find(b => b.id === id);
      let resolvedStudentId = bookingData.studentId;
      let resolvedGuestName = bookingData.guestName?.trim();
      let resolvedGuestEmail = bookingData.guestEmail?.trim();
      let resolvedGuestPhone = bookingData.guestPhone?.trim();
      if (bookingData.isGuestBooking && bookingData.trialFlightVoucherId) {
        const voucherHolder = await resolveGuestVoucherHolder(bookingData.trialFlightVoucherId, {
          allowUnredeemedGuest: true,
        });
        resolvedStudentId = voucherHolder.userId || resolvedStudentId;
        resolvedGuestName = resolvedGuestName || voucherHolder.guestName;
        resolvedGuestEmail = resolvedGuestEmail || voucherHolder.guestEmail;
        resolvedGuestPhone = resolvedGuestPhone || voucherHolder.guestPhone;
      }

      if (bookingData.isGuestBooking && !resolvedStudentId) {
        resolvedStudentId = await ensureGuestPlaceholderAccount();
      }

      if (resolvedStudentId !== undefined) {
        if (!resolvedStudentId || resolvedStudentId.trim() === '') {
          throw new Error('Student is required');
        }
        updateData.student_id = resolvedStudentId;
      }
      if (bookingData.instructorId !== undefined) {
        updateData.instructor_id = bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null;
      }
      const hasAircraftUpdate = bookingData.aircraftId !== undefined;
      const blankAircraftUpdate = hasAircraftUpdate && (!bookingData.aircraftId || bookingData.aircraftId.trim() === '');
      const effectiveKind = bookingData.bookingKind || (blankAircraftUpdate ? 'ground' : currentBooking?.bookingKind || 'flight');

      if (bookingData.aircraftId !== undefined) {
        if (effectiveKind !== 'ground' && (!bookingData.aircraftId || bookingData.aircraftId.trim() === '')) {
          throw new Error('Aircraft is required');
        }
        updateData.aircraft_id = effectiveKind === 'ground' ? null : bookingData.aircraftId || null;
      }
      if (bookingData.startTime !== undefined) updateData.start_time = bookingData.startTime.toISOString();
      if (bookingData.endTime !== undefined) updateData.end_time = bookingData.endTime.toISOString();
      if (bookingData.paymentType !== undefined) updateData.payment_type = bookingData.paymentType;
      if (bookingData.notes !== undefined) updateData.notes = bookingData.notes || null;
      if (bookingData.status !== undefined) updateData.status = bookingData.status;
      if ((bookingData.bookingKind !== undefined || effectiveKind === 'ground') && !missingOptionalBookingColumnsRef.current.has('booking_kind')) {
        updateData.booking_kind = effectiveKind;
      }
      if (bookingData.flightTypeId !== undefined) updateData.flight_type_id = bookingData.flightTypeId || null;
      if (bookingData.trialFlightVoucherId !== undefined) updateData.trial_flight_voucher_id = bookingData.trialFlightVoucherId || null;
      if (bookingData.isGuestBooking !== undefined) updateData.is_guest_booking = bookingData.isGuestBooking;
      if (bookingData.guestName !== undefined || bookingData.trialFlightVoucherId) updateData.guest_name = resolvedGuestName || null;
      if (bookingData.guestEmail !== undefined || bookingData.trialFlightVoucherId) updateData.guest_email = resolvedGuestEmail || null;
      if (bookingData.guestPhone !== undefined || bookingData.trialFlightVoucherId) updateData.guest_phone = resolvedGuestPhone || null;
      if (bookingData.casualContactId !== undefined) updateData.casual_contact_id = bookingData.casualContactId || null;
      if (bookingData.bookingPurpose !== undefined || bookingData.isGuestBooking !== undefined || bookingData.trialFlightVoucherId !== undefined) {
        const nextIsGuest = bookingData.isGuestBooking ?? currentBooking?.isGuestBooking ?? false;
        updateData.booking_purpose = nextIsGuest
          ? normaliseGuestBookingPurpose(
            bookingData.bookingPurpose ?? currentBooking?.bookingPurpose,
            Boolean(bookingData.trialFlightVoucherId ?? currentBooking?.trialFlightVoucherId),
          )
          : bookingData.bookingPurpose ?? currentBooking?.bookingPurpose ?? 'standard';
      }
      if (bookingData.location !== undefined) updateData.location = bookingData.location?.trim() || null;
      if (bookingData.locationId !== undefined) updateData.location_id = bookingData.locationId || null;

      if (effectiveKind === 'ground') {
        updateData.aircraft_id = null;
        if (!(bookingData.instructorId || currentBooking?.instructorId)) {
          throw new Error('Instructor is required for ground sessions');
        }
      }

      if (bookingData.isGuestBooking) {
        if (!resolvedGuestName) throw new Error('Guest name is required');
        if (!bookingData.trialFlightVoucherId && !resolvedGuestPhone) throw new Error('Guest phone number is required');
      }

      const candidateBooking = currentBooking
        ? { ...currentBooking, ...bookingData, ...(resolvedStudentId !== undefined ? { studentId: resolvedStudentId } : {}) }
        : null;
      const conflicts = candidateBooking ? findConfirmedConflicts(candidateBooking, id) : [];
      const isWaitlisted = conflicts.length > 0;
      if (candidateBooking && (
        bookingData.startTime !== undefined ||
        bookingData.endTime !== undefined
      )) {
        validateTimingRules(new Date(candidateBooking.startTime), new Date(candidateBooking.endTime), {
          enforceMinNotice: Boolean(candidateBooking.instructorId),
        });
      }
      if (candidateBooking && (
        bookingData.instructorId !== undefined ||
        bookingData.startTime !== undefined ||
        bookingData.endTime !== undefined
      )) {
        await assertInstructorAvailable(candidateBooking);
        const dutyResult = await assessDutyBooking(candidateBooking, id);
        updateData.duty_override_reason = dutyResult.overrideReason || null;
      }
      if (bookingData.membershipOverrideReason !== undefined) {
        updateData.membership_override_reason = bookingData.membershipOverrideReason?.trim() || null;
      }
      if (isWaitlisted && calendarSettings?.conflict_rules === 'block') {
        throw new Error('This booking conflicts with an existing confirmed booking');
      }

      if (
        bookingData.aircraftId !== undefined ||
        bookingData.instructorId !== undefined ||
        bookingData.startTime !== undefined ||
        bookingData.endTime !== undefined
      ) {
        if (!missingOptionalBookingColumnsRef.current.has('has_conflict')) {
          updateData.has_conflict = isWaitlisted;
        }
      }

      const previousBookings = bookings;
      setBookings(prev => prev.map(existing =>
        existing.id === id
          ? {
              ...existing,
              ...bookingData,
              hasConflict: updateData.has_conflict ?? existing.hasConflict,
            }
          : existing
      ));

      const runUpdate = async (payload: any) => supabase
        .from('bookings')
        .update(payload)
        .eq('id', id);

      const { error } = await runBookingMutationWithOptionalColumnRetry(updateData, runUpdate);

      if (error) {
        setBookings(previousBookings);
        throw error;
      }

      requestBookingCalendarRefresh({ bookingId: id, reason: 'booking-updated' });

      if (isWaitlisted) {
        toast('This booking overlaps an existing booking, so it has been placed on the waiting list.');
      }
    } catch (err) {
      console.error('Error updating booking:', err);
      if (!silent) {
        toast.error(err instanceof Error ? err.message : 'Failed to update booking');
      }
      throw err;
    }
  };

  const deleteBooking = async (id: string, cancellation: BookingCancellationInput = {}) => {
    try {
      const booking = bookings.find(existing => existing.id === id);
      if (booking && (booking.flight_logged || booking.flightLog || booking.ground_session_logged || booking.groundSessionLog)) {
        throw new Error('Delete the linked flight or ground session log before deleting this booking.');
      }
      if (
        isStudentOrPilot &&
        booking?.studentId === user.id &&
        !portalSettings.allow_booking_cancellation
      ) {
        throw new Error('Student booking cancellation is disabled. Please contact the club.');
      }
      const isInsideNoticePeriod = Boolean(
        booking &&
        bookingRules?.enforce_cancellation_notice &&
        new Date(booking.startTime).getTime() < Date.now() + bookingRules.cancellation_notice_hours * 60 * 60 * 1000
      );
      if (isInsideNoticePeriod && !cancellation.reasonId) {
        throw new Error(`Select a cancellation reason because this booking is within ${bookingRules?.cancellation_notice_hours || 0} hours of departure`);
      }

      let reason: any = null;
      if (cancellation.reasonId) {
        const { data: reasonData, error: reasonError } = await supabase
          .from('booking_cancellation_reasons')
          .select('id,name,fee_type,fee_amount,is_active')
          .eq('id', cancellation.reasonId)
          .maybeSingle();
        if (reasonError) throw reasonError;
        if (!reasonData) throw new Error('The selected cancellation reason is no longer available');
        reason = reasonData;
      }

      const cancelledAt = new Date();
      const cancellationFeeType = isInsideNoticePeriod ? reason?.fee_type || 'none' : 'none';
      const cancellationFeeAmount = isInsideNoticePeriod ? Number(reason?.fee_amount || 0) : 0;
      const cancelledStatus = cancellationFeeType === 'no_show' ? 'no-show' : 'cancelled';

      const { data, error } = await supabase
        .from('bookings')
        .update({
          deleted_at: cancelledAt.toISOString(),
          status: cancelledStatus,
          cancellation_reason_id: reason?.id || null,
          cancellation_reason_name: reason?.name || null,
          cancellation_notes: cancellation.notes?.trim() || null,
          cancellation_fee_type: cancellationFeeType,
          cancellation_fee_amount: cancellationFeeAmount,
          cancelled_at: cancelledAt.toISOString(),
          cancelled_by: user?.id || null,
          has_conflict: false,
          waitlist_reason: null,
          waitlisted_by_defect_id: null,
        })
        .eq('id', id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error('Booking could not be deleted. It may already be cancelled or you may not have permission to change it.');
      }

      setBookings(prev => prev.map(existing =>
        existing.id === id
          ? {
              ...existing,
              status: cancelledStatus,
              deletedAt: cancelledAt,
              cancelledAt,
              cancelledBy: user?.id,
              cancellationReasonId: reason?.id,
              cancellationReasonName: reason?.name,
              cancellationNotes: cancellation.notes?.trim() || undefined,
              cancellationFeeType,
              cancellationFeeAmount,
              hasConflict: false,
              waitlistReason: undefined,
              waitlistedByDefectId: undefined,
            }
          : existing
      ));
      requestBookingCalendarRefresh({ bookingId: id, reason: 'booking-deleted' });
      toast.success('Booking deleted successfully');
    } catch (err) {
      console.error('Error deleting booking:', err);
      const message = err instanceof Error && err.message
        ? err.message
        : 'Failed to delete booking';
      toast.error(message);
      throw err;
    }
  };

  const restoreBooking = async (id: string) => {
    try {
      const booking = bookings.find(existing => existing.id === id);
      if (!booking) {
        throw new Error('Booking could not be found');
      }

      const candidateBooking = {
        ...booking,
        status: 'confirmed' as const,
        deletedAt: undefined,
      };

      await assertInstructorAvailable(candidateBooking);
      const dutyResult = await assessDutyBooking(candidateBooking, id);

      const conflicts = findConfirmedConflicts(candidateBooking, id);
      const isWaitlisted = conflicts.length > 0;
      if (isWaitlisted && calendarSettings?.conflict_rules === 'block') {
        throw new Error('This booking conflicts with an existing confirmed booking');
      }

      const restorePayload: Record<string, unknown> = {
        deleted_at: null,
        status: isWaitlisted ? 'confirmed' : (booking.status === 'cancelled' ? 'confirmed' : booking.status),
      };
      if (!missingOptionalBookingColumnsRef.current.has('has_conflict')) {
        restorePayload.has_conflict = isWaitlisted;
      }
      if (!missingOptionalBookingColumnsRef.current.has('duty_override_reason')) {
        restorePayload.duty_override_reason = dutyResult.overrideReason || null;
      }

      const { data, error } = await supabase
        .from('bookings')
        .update(restorePayload)
        .eq('id', id)
        .select(getBookingSelectFields())
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        throw new Error('Booking could not be reinstated. It may no longer exist or you may not have permission.');
      }

      const restored = mapBookingRow(data, undefined, undefined);
      setBookings(prev => prev.map(existing => existing.id === id ? restored : existing));
      requestBookingCalendarRefresh({ bookingId: id, reason: 'booking-restored' });
      toast.success(isWaitlisted ? 'Booking reinstated on the waiting list' : 'Booking reinstated');
    } catch (err) {
      console.error('Error reinstating booking:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to reinstate booking');
      throw err;
    }
  };

  const addFlightLog = async (flightLogData: Omit<FlightLog, 'id'>) => {
    try {
      const { error } = await supabase
        .from('flight_logs')
        .insert({
          booking_id: flightLogData.bookingId,
          landings: flightLogData.landings,
          duration: flightLogData.duration,
          tach_start: flightLogData.tachStart,
          tach_end: flightLogData.tachEnd,
          engine_start: flightLogData.engineStart,
          engine_end: flightLogData.engineEnd,
          total_cost: financialCaptureEnabled ? flightLogData.totalCost : null,
          calculated_cost: financialCaptureEnabled ? flightLogData.totalCost : null,
          payment_status: financialCaptureEnabled
            ? flightLogData.totalCost > 0 ? 'pending' : 'free'
            : null,
          xero_sync_status: financialCaptureEnabled ? 'not_synced' : null,
          financial_capture_suppressed: !financialCaptureEnabled,
          notes: flightLogData.notes
        });

      if (error) throw error;

      setBookings(prev => prev.map(existing =>
        existing.id === flightLogData.bookingId
          ? {
              ...existing,
              flight_logged: true,
              flightLog: {
                id: crypto.randomUUID(),
                bookingId: flightLogData.bookingId,
                landings: flightLogData.landings,
                duration: flightLogData.duration,
                tachStart: flightLogData.tachStart,
                tachEnd: flightLogData.tachEnd,
                engineStart: flightLogData.engineStart,
                engineEnd: flightLogData.engineEnd,
                totalCost: flightLogData.totalCost,
                notes: flightLogData.notes,
              },
            }
          : existing
      ));
      requestBookingCalendarRefresh({
        bookingId: flightLogData.bookingId,
        reason: 'flight-log-created',
      });
      toast.success('Flight log added successfully');
    } catch (err) {
      console.error('Error adding flight log:', err);
      toast.error('Failed to add flight log');
      throw err;
    }
  };

  const approveBooking = async (bookingId: string) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error('User not authenticated');
      }

      const { data: activeBookings, error: activeBookingsError } = await supabase
        .from('bookings')
        .select('*')
        .is('deleted_at', null);

      if (activeBookingsError) throw activeBookingsError;

      const bookingToApprove = activeBookings?.find((booking: any) => booking.id === bookingId);
      if (!bookingToApprove) {
        throw new Error('Booking could not be found');
      }

      await assertInstructorAvailable({
        instructorId: bookingToApprove.instructor_id || undefined,
        startTime: new Date(bookingToApprove.start_time),
        endTime: new Date(bookingToApprove.end_time),
      });

      const conflicts = (activeBookings || []).filter((existing: any) =>
        existing.id !== bookingId &&
        !existing.has_conflict &&
        (existing.status === 'confirmed' || existing.status === 'pending_supervision') &&
        timeRangesOverlap(
          bookingToApprove.start_time,
          bookingToApprove.end_time,
          existing.start_time,
          existing.end_time
        ) &&
        (
          existing.aircraft_id === bookingToApprove.aircraft_id ||
          Boolean(bookingToApprove.instructor_id && existing.instructor_id === bookingToApprove.instructor_id)
        )
      );

      const isWaitlisted = conflicts.length > 0;
      if (isWaitlisted && calendarSettings?.conflict_rules === 'block') {
        throw new Error('This booking conflicts with an existing confirmed booking');
      }

      const approvePayload: Record<string, unknown> = {
        status: 'confirmed',
        approved_by: userData.user.id,
        approved_at: new Date().toISOString()
      };
      if (!missingOptionalBookingColumnsRef.current.has('has_conflict')) {
        approvePayload.has_conflict = isWaitlisted;
      }

      const { error } = await supabase
        .from('bookings')
        .update(approvePayload)
        .eq('id', bookingId);

      if (error) throw error;

      // Remove any pending booking_approval notifications for this booking
      await supabase
        .from('notifications')
        .delete()
        .eq('booking_id', bookingId)
        .eq('type', 'booking_approval');

      setBookings(prev => prev.map(existing =>
        existing.id === bookingId
          ? {
              ...existing,
              status: 'confirmed',
              hasConflict: isWaitlisted,
            }
          : existing
      ));
      requestBookingCalendarRefresh({ bookingId, reason: 'booking-approved' });
      if (isWaitlisted) {
        toast('Booking approved and placed on the waiting list because it overlaps an existing booking.');
      } else {
        toast.success('Booking approved successfully');
      }
    } catch (err) {
      console.error('Error approving booking:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to approve booking');
      throw err;
    }
  };

  const rejectBooking = async (bookingId: string, reason?: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({
          status: 'cancelled',
          notes: reason ? `Rejected: ${reason}` : 'Rejected by instructor'
        })
        .eq('id', bookingId);

      if (error) throw error;

      // Remove any pending booking_approval notifications for this booking
      await supabase
        .from('notifications')
        .delete()
        .eq('booking_id', bookingId)
        .eq('type', 'booking_approval');

      setBookings(prev => prev.map(existing =>
        existing.id === bookingId
          ? {
              ...existing,
              status: 'cancelled',
              notes: reason ? `Rejected: ${reason}` : 'Rejected by instructor',
            }
          : existing
      ));
      requestBookingCalendarRefresh({ bookingId, reason: 'booking-rejected' });
      toast.success('Booking rejected');
    } catch (err) {
      console.error('Error rejecting booking:', err);
      toast.error('Failed to reject booking');
      throw err;
    }
  };

  useLatestEffect(() => {
    if (!enabled) {
      setBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    void fetchBookings();

    const channelId = `bookings_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleBookingsRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void fetchBookings({ silent: true });
      }, 120);
    };
    const handleRequestedRefresh = () => scheduleBookingsRefresh();

    window.addEventListener(BOOKING_CALENDAR_REFRESH_EVENT, handleRequestedRefresh);

    const bookingsSubscription = supabase
      .channel(`${channelId}_bookings`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        scheduleBookingsRefresh
      )
      .subscribe();

    const flightLogsSubscription = supabase
      .channel(`${channelId}_flight_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flight_logs' },
        scheduleBookingsRefresh
      )
      .subscribe();

    const groundSessionLogsSubscription = supabase
      .channel(`${channelId}_ground_session_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ground_session_logs' },
        scheduleBookingsRefresh
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener(BOOKING_CALENDAR_REFRESH_EVENT, handleRequestedRefresh);
      bookingsSubscription.unsubscribe();
      flightLogsSubscription.unsubscribe();
      groundSessionLogsSubscription.unsubscribe();
    };
  }, [enabled]);

  return {
    bookings,
    loading,
    error,
    addBooking,
    finaliseRecurringBookingSeries,
    updateRecurringBookingSeries,
    updateBooking,
    deleteBooking,
    restoreBooking,
    addFlightLog,
    approveBooking,
    rejectBooking,
    refetch: fetchBookings
  };
};
