import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Booking, FlightLog, GroundSessionLog } from '../types';
import { useAuth } from '../context/AuthContext';
import { useBookingRulesSettings, useCalendarSettings, usePortalUxSettings } from './useSettings';
import toast from 'react-hot-toast';

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

const OPTIONAL_BOOKING_COLUMNS = new Set(['booking_kind', 'has_conflict', 'ground_session_logged']);

export interface BookingCancellationInput {
  reasonId?: string;
  notes?: string;
}

export const useBookings = (enabled = true) => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const { settings: bookingRules } = useBookingRulesSettings();
  const { settings: calendarSettings } = useCalendarSettings();
  const localCreatedBookingIdsRef = useRef<Set<string>>(new Set());
  const localDeletedBookingIdsRef = useRef<Set<string>>(new Set());
  const missingOptionalBookingColumnsRef = useRef<Set<string>>(new Set());

  const isStudentOrPilot = user?.role === 'student' || user?.role === 'pilot';
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isStudentOnlyUser = userRoles.includes('student') && !userRoles.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
  const isStaffUser = userRoles.some(role => ['admin', 'senior_instructor', 'instructor'].includes(role));
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
        'cancellation_reason_id',
        'cancellation_reason_name',
        'cancellation_notes',
        'cancellation_fee_type',
        'cancellation_fee_amount',
        'cancelled_at',
        'cancelled_by',
        'waitlist_reason',
        'waitlisted_by_defect_id',
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
    cancellationReasonId: row.cancellation_reason_id || undefined,
    cancellationReasonName: row.cancellation_reason_name || undefined,
    cancellationNotes: row.cancellation_notes || undefined,
    cancellationFeeType: row.cancellation_fee_type || undefined,
    cancellationFeeAmount: Number(row.cancellation_fee_amount || 0),
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : undefined,
    cancelledBy: row.cancelled_by || undefined,
    waitlistReason: row.waitlist_reason || undefined,
    waitlistedByDefectId: row.waitlisted_by_defect_id || undefined,
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

  const parseLocalTime = (time: string | undefined, fallback: string) => {
    const [hour, minute] = (time || fallback).slice(0, 5).split(':').map(Number);
    return {
      hour: Number.isFinite(hour) ? hour : Number(fallback.slice(0, 2)),
      minute: Number.isFinite(minute) ? minute : Number(fallback.slice(3, 5)),
    };
  };

  const minutesSinceMidnight = (date: Date) => date.getHours() * 60 + date.getMinutes();

  const sameLocalDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const startOfLocalDay = (date: Date) => {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    return value;
  };

  const addLocalDays = (date: Date, days: number) => {
    const value = new Date(date);
    value.setDate(value.getDate() + days);
    return value;
  };

  const hoursBetween = (start: Date, end: Date) =>
    Math.max(0, (end.getTime() - start.getTime()) / (60 * 60 * 1000));

  const getCasaAppendix6FdpLimitHours = (startTime: Date) => {
    const startMinutes = minutesSinceMidnight(startTime);
    if (startMinutes >= 5 * 60 && startMinutes < 6 * 60) return 9;
    if (startMinutes >= 6 * 60 && startMinutes < 8 * 60) return 10;
    if (startMinutes >= 8 * 60 && startMinutes < 11 * 60) return 11;
    if (startMinutes >= 11 * 60 && startMinutes < 14 * 60) return 10;
    if (startMinutes >= 14 * 60 && startMinutes < 23 * 60) return 9;
    return 8;
  };

  const getLatestCasaAppendix6Finish = (startTime: Date) => {
    const latest = startOfLocalDay(startTime);
    latest.setDate(latest.getDate() + 1);
    latest.setHours(1, 0, 0, 0);
    return latest;
  };

  const formatLocalTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const getInstructorFatigueWarnings = (
    bookingData: Pick<Booking, 'instructorId' | 'startTime' | 'endTime'>,
    excludingBookingId?: string
  ) => {
    if (!bookingRules?.fatigue_rules_enabled || !bookingData.instructorId) {
      return { blockingWarnings: [], advisoryWarnings: [] };
    }

    const candidate = {
      id: '__candidate__',
      instructorId: bookingData.instructorId,
      startTime: new Date(bookingData.startTime),
      endTime: new Date(bookingData.endTime),
      status: 'confirmed' as Booking['status'],
      hasConflict: false,
    };
    const instructorBookings = bookings
      .filter(existing =>
        existing.id !== excludingBookingId &&
        existing.instructorId === bookingData.instructorId &&
        !existing.deletedAt &&
        existing.status !== 'cancelled' &&
        existing.status !== 'no-show' &&
        !existing.hasConflict
      )
      .map(existing => ({
        id: existing.id,
        instructorId: existing.instructorId,
        startTime: new Date(existing.startTime),
        endTime: new Date(existing.endTime),
        status: existing.status,
        hasConflict: existing.hasConflict,
      }));
    const consideredBookings = [...instructorBookings, candidate];
    const blockingWarnings: string[] = [];
    const advisoryWarnings: string[] = [];
    const lateTime = parseLocalTime(bookingRules.fatigue_late_finish_time, '22:00');
    const earlyTime = parseLocalTime(bookingRules.fatigue_early_start_time, '07:00');
    const lateFinishMinutes = lateTime.hour * 60 + lateTime.minute;
    const earlyStartMinutes = earlyTime.hour * 60 + earlyTime.minute;
    const minRestMs = Math.max(0, Number(bookingRules.fatigue_min_rest_hours || 0)) * 60 * 60 * 1000;

    const sameDayBookings = consideredBookings.filter(existing =>
      sameLocalDay(existing.startTime, candidate.startTime) ||
      sameLocalDay(existing.endTime, candidate.startTime)
    );
    if (sameDayBookings.length > 0) {
      const firstStart = new Date(Math.min(...sameDayBookings.map(existing => existing.startTime.getTime())));
      const lastEnd = new Date(Math.max(...sameDayBookings.map(existing => existing.endTime.getTime())));
      const dutySpanHours = hoursBetween(firstStart, lastEnd);
      const bookedHours = sameDayBookings.reduce((total, existing) =>
        total + hoursBetween(existing.startTime, existing.endTime), 0
      );
      const casaFdpLimitHours = getCasaAppendix6FdpLimitHours(firstStart);
      const localDutyLimitHours = Math.max(0, Number(bookingRules.fatigue_max_duty_hours_per_day || casaFdpLimitHours));
      const effectiveDutyLimitHours = Math.min(localDutyLimitHours || casaFdpLimitHours, casaFdpLimitHours);
      const latestAllowedFinish = new Date(firstStart.getTime() + effectiveDutyLimitHours * 60 * 60 * 1000);

      if (dutySpanHours > effectiveDutyLimitHours) {
        blockingWarnings.push(`Instructor duty day would run ${formatLocalTime(firstStart)} - ${formatLocalTime(lastEnd)} (${dutySpanHours.toFixed(1)} hours). A duty starting at ${formatLocalTime(firstStart)} must finish by ${formatLocalTime(latestAllowedFinish)} under the active duty limit.`);
      }
      if (bookedHours > Number(bookingRules.fatigue_max_flight_hours_per_day || 0)) {
        advisoryWarnings.push(`Instructor booked flight/supervision time would be ${bookedHours.toFixed(1)} hours, above the ${bookingRules.fatigue_max_flight_hours_per_day} hour daily review threshold.`);
      }

      const latestFinish = getLatestCasaAppendix6Finish(firstStart);
      if (lastEnd > latestFinish) {
        blockingWarnings.push(`Instructor duty would finish after 01:00 local time following the duty start, outside the CASA Appendix 6 planning window.`);
      }
    }

    const sortedBookings = [...consideredBookings].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const candidateIndex = sortedBookings.findIndex(existing => existing.id === candidate.id);
    const neighbours = [
      candidateIndex > 0 ? sortedBookings[candidateIndex - 1] : null,
      candidateIndex >= 0 && candidateIndex < sortedBookings.length - 1 ? sortedBookings[candidateIndex + 1] : null,
    ].filter(Boolean) as typeof sortedBookings;

    neighbours.forEach((neighbour) => {
      if (sameLocalDay(neighbour.startTime, candidate.startTime) || sameLocalDay(neighbour.endTime, candidate.startTime)) {
        return;
      }
      const restMs = neighbour.startTime > candidate.endTime
        ? neighbour.startTime.getTime() - candidate.endTime.getTime()
        : candidate.startTime.getTime() - neighbour.endTime.getTime();
      if (restMs >= 0 && restMs < minRestMs) {
        blockingWarnings.push(`Instructor would have only ${(restMs / (60 * 60 * 1000)).toFixed(1)} hours rest between duties; minimum is ${bookingRules.fatigue_min_rest_hours} hours.`);
      }
    });

    const candidateIsLate = minutesSinceMidnight(candidate.endTime) >= lateFinishMinutes;
    const candidateIsEarly = minutesSinceMidnight(candidate.startTime) < earlyStartMinutes;
    const hasEarlyNearLate = consideredBookings.some(existing => {
      if (existing.id === candidate.id) return false;
      const dayGap = Math.abs(new Date(existing.startTime.getFullYear(), existing.startTime.getMonth(), existing.startTime.getDate()).getTime() -
        new Date(candidate.startTime.getFullYear(), candidate.startTime.getMonth(), candidate.startTime.getDate()).getTime()) / (24 * 60 * 60 * 1000);
      if (dayGap > 1) return false;
      return candidateIsLate && minutesSinceMidnight(existing.startTime) < earlyStartMinutes;
    });
    const hasLateNearEarly = consideredBookings.some(existing => {
      if (existing.id === candidate.id) return false;
      const dayGap = Math.abs(new Date(existing.startTime.getFullYear(), existing.startTime.getMonth(), existing.startTime.getDate()).getTime() -
        new Date(candidate.startTime.getFullYear(), candidate.startTime.getMonth(), candidate.startTime.getDate()).getTime()) / (24 * 60 * 60 * 1000);
      if (dayGap > 1) return false;
      return candidateIsEarly && minutesSinceMidnight(existing.endTime) >= lateFinishMinutes;
    });
    if (hasEarlyNearLate || hasLateNearEarly) {
      blockingWarnings.push(`Instructor has an early/late combination inside the fatigue window (${bookingRules.fatigue_early_start_time} early start / ${bookingRules.fatigue_late_finish_time} late finish).`);
    }

    const windowStart = new Date(candidate.startTime);
    windowStart.setDate(windowStart.getDate() - 6);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(candidate.startTime);
    windowEnd.setHours(23, 59, 59, 999);
    const lateFinishes = consideredBookings.filter(existing =>
      existing.startTime >= windowStart &&
      existing.startTime <= windowEnd &&
      minutesSinceMidnight(existing.endTime) >= lateFinishMinutes
    ).length;
    if (lateFinishes > Number(bookingRules.fatigue_max_late_finishes_7_days || 0)) {
      advisoryWarnings.push(`Instructor would have ${lateFinishes} late finishes in 7 days; limit is ${bookingRules.fatigue_max_late_finishes_7_days}.`);
    }

    const rollingHours = (days: number) => {
      const start = addLocalDays(startOfLocalDay(candidate.startTime), -(days - 1));
      const end = new Date(candidate.endTime);
      return consideredBookings.reduce((total, existing) => {
        if (existing.endTime <= start || existing.startTime > end) return total;
        const overlapStart = existing.startTime < start ? start : existing.startTime;
        const overlapEnd = existing.endTime > end ? end : existing.endTime;
        return total + hoursBetween(overlapStart, overlapEnd);
      }, 0);
    };

    const rolling7DutyHours = rollingHours(7);
    if (rolling7DutyHours > 60) {
      advisoryWarnings.push(`Instructor CRM-booked duty would be ${rolling7DutyHours.toFixed(1)} hours in 7 days; CASA Appendix 6 cumulative duty limit is 60 hours.`);
    }

    const rolling14DutyHours = rollingHours(14);
    if (rolling14DutyHours > 100) {
      advisoryWarnings.push(`Instructor CRM-booked duty would be ${rolling14DutyHours.toFixed(1)} hours in 14 days; CASA Appendix 6 cumulative duty limit is 100 hours.`);
    }

    const rolling28FlightHours = rollingHours(28);
    if (rolling28FlightHours > 100) {
      advisoryWarnings.push(`Instructor CRM-booked flight/supervision time would be ${rolling28FlightHours.toFixed(1)} hours in 28 days; CASA cumulative flight-time limit is 100 hours.`);
    }

    const rolling365FlightHours = rollingHours(365);
    if (rolling365FlightHours > 1000) {
      advisoryWarnings.push(`Instructor CRM-booked flight/supervision time would be ${rolling365FlightHours.toFixed(1)} hours in 365 days; CASA cumulative flight-time limit is 1000 hours.`);
    }

    const sevenDayStart = addLocalDays(startOfLocalDay(candidate.startTime), -6);
    const sevenDayEnd = new Date(candidate.endTime);
    const dutiesInSevenDays = consideredBookings
      .filter(existing => existing.endTime > sevenDayStart && existing.startTime <= sevenDayEnd)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    let has36HourGap = dutiesInSevenDays.length === 0;
    let previousEnd = sevenDayStart;
    for (const duty of dutiesInSevenDays) {
      if (hoursBetween(previousEnd, duty.startTime) >= 36) has36HourGap = true;
      if (duty.endTime > previousEnd) previousEnd = duty.endTime;
    }
    if (hoursBetween(previousEnd, sevenDayEnd) >= 36) has36HourGap = true;
    if (!has36HourGap) {
      advisoryWarnings.push('Instructor has no 36-hour off-duty gap in the rolling 7-day CRM roster window.');
    }

    const twentyEightDayStart = addLocalDays(startOfLocalDay(candidate.startTime), -27);
    let offDutyDays = 0;
    for (let day = new Date(twentyEightDayStart); day <= startOfLocalDay(candidate.startTime); day = addLocalDays(day, 1)) {
      const nextDay = addLocalDays(day, 1);
      const hasDuty = consideredBookings.some(existing => existing.startTime < nextDay && existing.endTime > day);
      if (!hasDuty) offDutyDays += 1;
    }
    if (offDutyDays < 6) {
      advisoryWarnings.push(`Instructor has only ${offDutyDays} CRM-rostered off-duty days in the rolling 28-day window; CASA Appendix 6 requires at least 6.`);
    }

    return {
      blockingWarnings: Array.from(new Set(blockingWarnings)),
      advisoryWarnings: Array.from(new Set(advisoryWarnings)),
    };
  };

  const assertFatigueRules = (
    bookingData: Pick<Booking, 'instructorId' | 'startTime' | 'endTime'>,
    excludingBookingId?: string
  ) => {
    const { blockingWarnings, advisoryWarnings } = getInstructorFatigueWarnings(bookingData, excludingBookingId);
    const warnings = [...blockingWarnings, ...advisoryWarnings];
    if (warnings.length === 0) return;

    if (bookingRules?.fatigue_block_on_breach !== false && blockingWarnings.length > 0) {
      throw new Error(blockingWarnings.join(' '));
    }
    toast(warnings.join(' '));
  };

  const fetchBookings = async () => {
    if (!enabled) {
      setBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);

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
        setError(null);
        setLoading(false);
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

      setBookings(combinedBookings);
      setError(null);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch bookings');
    } finally {
      setLoading(false);
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
    existing.status === 'confirmed' &&
    timeRangesOverlap(bookingData.startTime, bookingData.endTime, existing.startTime, existing.endTime) &&
    (
      existing.aircraftId === bookingData.aircraftId ||
      Boolean(bookingData.instructorId && existing.instructorId === bookingData.instructorId)
    )
  );

  const promoteAvailableWaitlistedBookings = async () => {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .is('deleted_at', null)
      .order('start_time', { ascending: true })
      .order('created_at', { ascending: true });

    if (error || !data) {
      if (error) console.error('Error checking waitlisted bookings:', error);
      return;
    }

      const activeConfirmed = data.filter((booking: any) =>
      !booking.deleted_at &&
      booking.status === 'confirmed' && !booking.has_conflict
    );
    const waitlisted = data.filter((booking: any) =>
      !booking.deleted_at &&
      booking.status === 'confirmed' && booking.has_conflict
    );
    const promoteIds: string[] = [];

    for (const candidate of waitlisted) {
      const hasConflict = activeConfirmed.some((existing: any) =>
        timeRangesOverlap(candidate.start_time, candidate.end_time, existing.start_time, existing.end_time) &&
        (
          existing.aircraft_id === candidate.aircraft_id ||
          Boolean(candidate.instructor_id && existing.instructor_id === candidate.instructor_id)
        )
      );

      if (!hasConflict) {
        promoteIds.push(candidate.id);
        activeConfirmed.push({ ...candidate, has_conflict: false });
      }
    }

    if (promoteIds.length > 0) {
      if (missingOptionalBookingColumnsRef.current.has('has_conflict')) {
        return;
      }
      const { error: promoteError } = await supabase
        .from('bookings')
        .update({ has_conflict: false })
        .in('id', promoteIds);

      if (promoteError) {
        console.error('Error promoting waitlisted bookings:', promoteError);
      }
    }
  };

  const addBooking = async (bookingData: Omit<Booking, 'id' | 'flightLog'>, options: { silent?: boolean } = {}) => {
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
        if (!resolvedGuestEmail) throw new Error('Guest email is required');
        if (!bookingData.trialFlightVoucherId && !resolvedGuestPhone) throw new Error('Guest phone number is required');
      }

      if (isStudentOnlyUser && !bookingData.instructorId) {
        throw new Error('Students need an instructor assigned before booking an aircraft solo. Pilots can book solo.');
      }

      await assertInstructorAvailable(bookingData);
      assertFatigueRules(bookingData);

      const conflicts = findConfirmedConflicts(bookingData);
      const isWaitlisted = conflicts.length > 0;
      if (isWaitlisted && calendarSettings?.conflict_rules === 'block') {
        throw new Error('This booking conflicts with an existing confirmed booking');
      }

      if (isWaitlisted && calendarSettings?.conflict_rules === 'approval') needsApproval = true;

      const bookingStatus = needsApproval ? 'pending_approval' : bookingData.status;

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
      };

      console.log('Insert data:', insertData);

      const runInsert = async (payload: typeof insertData) => supabase
        .from('bookings')
        .insert(payload)
        .select(getBookingSelectFields());

      let { data, error } = await runBookingMutationWithOptionalColumnRetry(insertData, runInsert);

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
      const createdBooking = data?.[0];
      if (createdBooking?.id) {
        localCreatedBookingIdsRef.current.add(createdBooking.id);
        setBookings(prev => [mapBookingRow(createdBooking, undefined, undefined), ...prev]);
      }

      // Send approval notifications if needed
      if (needsApproval && data && data.length > 0) {
        const { error: notifyError } = await supabase
          .rpc('notify_instructor_booking_request', {
            booking_id: data[0].id
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

      if (effectiveKind === 'ground') {
        updateData.aircraft_id = null;
        if (!(bookingData.instructorId || currentBooking?.instructorId)) {
          throw new Error('Instructor is required for ground sessions');
        }
      }

      if (bookingData.isGuestBooking) {
        if (!resolvedGuestName) throw new Error('Guest name is required');
        if (!resolvedGuestEmail) throw new Error('Guest email is required');
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
        assertFatigueRules(candidateBooking, id);
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

      if (!isWaitlisted) {
        void promoteAvailableWaitlistedBookings().catch((promoteError) => {
          console.error('Error promoting waitlisted bookings after booking update:', promoteError);
        });
      }
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

      void promoteAvailableWaitlistedBookings().catch((promoteError) => {
        console.error('Error promoting waitlisted bookings after booking deletion:', promoteError);
      });
      localDeletedBookingIdsRef.current.add(id);
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
      assertFatigueRules(candidateBooking, id);

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
          total_cost: flightLogData.totalCost,
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
        existing.status === 'confirmed' &&
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
      toast.success('Booking rejected');
    } catch (err) {
      console.error('Error rejecting booking:', err);
      toast.error('Failed to reject booking');
      throw err;
    }
  };

  useEffect(() => {
    if (!enabled) {
      setBookings([]);
      setLoading(false);
      setError(null);
      return;
    }

    fetchBookings();

    const channelId = `bookings_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const bookingsSubscription = supabase
      .channel(`${channelId}_bookings`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          // Apply row-level realtime changes without forcing a full calendar refetch.
          if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as any;
            if (updated?.deleted_at) {
              if (updated?.id && localDeletedBookingIdsRef.current.has(updated.id)) {
                localDeletedBookingIdsRef.current.delete(updated.id);
                return;
              }
              setBookings(prev =>
                prev.some(b => b.id === updated.id)
                  ? prev.map(b => b.id === updated.id ? mapBookingRow(updated, updated.flight_logged ? b.flightLog : undefined) : b)
                  : [mapBookingRow(updated), ...prev]
              );
              return;
            }
            setBookings(prev =>
              prev.some(b => b.id === updated.id)
                ? prev.map(b => b.id === updated.id ? mapBookingRow(updated, updated.flight_logged ? b.flightLog : undefined) : b)
                : [mapBookingRow(updated), ...prev]
            );
          } else if (payload.eventType === 'INSERT' && payload.new) {
            // New booking from another user.
            const inserted = payload.new as any;
            if (inserted?.id && localCreatedBookingIdsRef.current.has(inserted.id)) {
              localCreatedBookingIdsRef.current.delete(inserted.id);
              return;
            }
            setBookings(prev =>
              prev.some(b => b.id === inserted.id) ? prev : [mapBookingRow(inserted), ...prev]
            );
            return;
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deleted = payload.old as any;
            setBookings(prev => prev.filter(b => b.id !== deleted.id));
          }
        }
      )
      .subscribe();

    const flightLogsSubscription = supabase
      .channel(`${channelId}_flight_logs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flight_logs' },
        (payload) => {
          const row = (payload.new || payload.old) as any;
          if (!row?.booking_id) return;

          if (payload.eventType === 'DELETE') {
            setBookings(prev =>
              prev.map(b =>
                b.id === row.booking_id
                  ? { ...b, flight_logged: false, flightLog: undefined }
                  : b
              )
            );
            return;
          }

          setBookings(prev =>
            prev.map(b =>
              b.id === row.booking_id
                ? {
                    ...b,
                    flight_logged: true,
                    flightLog: {
                      id: row.id,
                      bookingId: row.booking_id,
                      landings: row.landings,
                      duration: parseFloat(row.duration ?? row.flight_duration ?? 0),
                      tachStart: parseFloat(row.tach_start ?? 0),
                      tachEnd: parseFloat(row.tach_end ?? 0),
                      engineStart: parseFloat(row.engine_start ?? 0),
                      engineEnd: parseFloat(row.engine_end ?? 0),
                      totalCost: parseFloat(row.total_cost ?? row.calculated_cost ?? 0),
                      notes: row.notes,
                    },
                  }
                : b
            )
          );
        }
      )
      .subscribe();

    return () => {
      bookingsSubscription.unsubscribe();
      flightLogsSubscription.unsubscribe();
    };
  }, [enabled]);

  return {
    bookings,
    loading,
    error,
    addBooking,
    updateBooking,
    deleteBooking,
    restoreBooking,
    addFlightLog,
    approveBooking,
    rejectBooking,
    refetch: fetchBookings
  };
};
