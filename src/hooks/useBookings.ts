import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Booking, FlightLog } from '../types';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export const useBookings = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  const fetchBookings = async () => {
    try {
      setLoading(true);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 5000)
      );

      const bookingsPromise = supabase
        .from('bookings')
        .select('*')
        .is('deleted_at', null)
        .order('start_time', { ascending: false });

      const { data: bookingsData, error: bookingsError } = await Promise.race([
        bookingsPromise,
        timeoutPromise
      ]) as any;

      if (bookingsError) {
        console.error('Bookings error:', bookingsError);
        setBookings([]);
        setError(null);
        setLoading(false);
        return;
      }

      const { data: flightLogsData, error: flightLogsError } = await supabase
        .from('flight_logs')
        .select('*');

      if (flightLogsError) {
        console.error('Flight logs error:', flightLogsError);
      }

      const flightLogsMap = new Map(flightLogsData?.map(fl => [fl.booking_id, {
        id: fl.id,
        bookingId: fl.booking_id,
        landings: fl.landings,
        duration: fl.duration,
        tachStart: parseFloat(fl.tach_start),
        tachEnd: parseFloat(fl.tach_end),
        engineStart: parseFloat(fl.engine_start),
        engineEnd: parseFloat(fl.engine_end),
        totalCost: parseFloat(fl.total_cost),
        notes: fl.notes
      } as FlightLog]) || []);

      const combinedBookings: Booking[] = (bookingsData || []).map(b => ({
        id: b.id,
        studentId: b.student_id,
        instructorId: b.instructor_id,
        aircraftId: b.aircraft_id,
        startTime: new Date(b.start_time),
        endTime: new Date(b.end_time),
        paymentType: b.payment_type,
        notes: b.notes,
        status: b.status,
        hasConflict: b.has_conflict || false,
        flightLog: flightLogsMap.get(b.id),
        flight_logged: b.flight_logged || false,
        flightTypeId: b.flight_type_id || undefined,
      }));

      setBookings(combinedBookings);
      setError(null);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch bookings');
      setBookings([]);
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
      booking.status === 'confirmed' && !booking.has_conflict
    );
    const waitlisted = data.filter((booking: any) =>
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
      const { error: promoteError } = await supabase
        .from('bookings')
        .update({ has_conflict: false })
        .in('id', promoteIds);

      if (promoteError) {
        console.error('Error promoting waitlisted bookings:', promoteError);
      }
    }
  };

  const addBooking = async (bookingData: Omit<Booking, 'id' | 'flightLog'>) => {
    try {
      console.log('Creating booking with data:', bookingData);

      // Validate required fields
      if (!bookingData.studentId || bookingData.studentId.trim() === '') {
        throw new Error('Student is required');
      }
      if (!bookingData.aircraftId || bookingData.aircraftId.trim() === '') {
        throw new Error('Aircraft is required');
      }

      // Validate against booking rules
      const { data: ruleValidation, error: ruleError } = await supabase
        .rpc('validate_booking_rules', {
          p_start_time: bookingData.startTime.toISOString(),
          p_end_time: bookingData.endTime.toISOString(),
          p_instructor_id: bookingData.instructorId || null
        });

      if (ruleError) {
        console.error('Error validating booking rules:', ruleError);
      }

      // Students always need approval; admins/instructors book directly
      let needsApproval = user?.role === 'student' || user?.role === 'pilot';

      if (ruleValidation && Array.isArray(ruleValidation) && ruleValidation.length > 0) {
        const errors = ruleValidation.filter((err: any) => !err.needs_approval);
        const approvalRequired = ruleValidation.some((err: any) => err.needs_approval);

        if (errors.length > 0) {
          const errorMessages = errors.map((err: any) => err.message);
          throw new Error(errorMessages.join('. '));
        }

        if (approvalRequired) needsApproval = true;
      }

      const conflicts = findConfirmedConflicts(bookingData);
      const isWaitlisted = conflicts.length > 0;

      const bookingStatus = needsApproval ? 'pending_approval' : bookingData.status;

      const insertData = {
        student_id: bookingData.studentId,
        instructor_id: bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null,
        aircraft_id: bookingData.aircraftId,
        start_time: bookingData.startTime.toISOString(),
        end_time: bookingData.endTime.toISOString(),
        payment_type: bookingData.paymentType,
        notes: bookingData.notes || null,
        status: bookingStatus,
        has_conflict: isWaitlisted,
        flight_type_id: bookingData.flightTypeId || null,
      };

      console.log('Insert data:', insertData);

      const { data, error } = await supabase
        .from('bookings')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          full: error
        });
        const errorMsg = error.message || error.details || 'Unknown database error';
        toast.error(`Failed to create booking: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      console.log('Booking created:', data);

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

      await fetchBookings();

      if (isWaitlisted) {
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
      if (!err?.message?.includes('Failed to create booking')) {
        toast.error(`Failed to create booking: ${errorMessage}`);
      }
      throw err;
    }
  };

  const updateBooking = async (id: string, bookingData: Partial<Omit<Booking, 'id' | 'flightLog'>>, silent = false) => {
    try {
      const updateData: any = {};
      if (bookingData.studentId !== undefined) {
        if (!bookingData.studentId || bookingData.studentId.trim() === '') {
          throw new Error('Student is required');
        }
        updateData.student_id = bookingData.studentId;
      }
      if (bookingData.instructorId !== undefined) {
        updateData.instructor_id = bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null;
      }
      if (bookingData.aircraftId !== undefined) {
        if (!bookingData.aircraftId || bookingData.aircraftId.trim() === '') {
          throw new Error('Aircraft is required');
        }
        updateData.aircraft_id = bookingData.aircraftId;
      }
      if (bookingData.startTime !== undefined) updateData.start_time = bookingData.startTime.toISOString();
      if (bookingData.endTime !== undefined) updateData.end_time = bookingData.endTime.toISOString();
      if (bookingData.paymentType !== undefined) updateData.payment_type = bookingData.paymentType;
      if (bookingData.notes !== undefined) updateData.notes = bookingData.notes || null;
      if (bookingData.status !== undefined) updateData.status = bookingData.status;
      if (bookingData.flightTypeId !== undefined) updateData.flight_type_id = bookingData.flightTypeId || null;

      const currentBooking = bookings.find(b => b.id === id);
      const candidateBooking = currentBooking
        ? { ...currentBooking, ...bookingData }
        : null;
      const conflicts = candidateBooking ? findConfirmedConflicts(candidateBooking, id) : [];
      const isWaitlisted = conflicts.length > 0;

      if (
        bookingData.aircraftId !== undefined ||
        bookingData.instructorId !== undefined ||
        bookingData.startTime !== undefined ||
        bookingData.endTime !== undefined
      ) {
        updateData.has_conflict = isWaitlisted;
      }

      const { error } = await supabase
        .from('bookings')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      if (!isWaitlisted) {
        await promoteAvailableWaitlistedBookings();
      }

      await fetchBookings();
      if (isWaitlisted) {
        toast('This booking overlaps an existing booking, so it has been placed on the waiting list.');
      } else if (!silent) {
        toast.success('Booking updated successfully');
      }
    } catch (err) {
      console.error('Error updating booking:', err);
      toast.error('Failed to update booking');
      throw err;
    }
  };

  const deleteBooking = async (id: string) => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;

      await promoteAvailableWaitlistedBookings();
      await fetchBookings();
      toast.success('Booking deleted successfully');
    } catch (err) {
      console.error('Error deleting booking:', err);
      toast.error('Failed to delete booking');
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

      await fetchBookings();
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

      const { error } = await supabase
        .from('bookings')
        .update({
          status: 'confirmed',
          approved_by: userData.user.id,
          approved_at: new Date().toISOString()
        })
        .eq('id', bookingId);

      if (error) throw error;

      // Remove any pending booking_approval notifications for this booking
      await supabase
        .from('notifications')
        .delete()
        .eq('booking_id', bookingId)
        .eq('type', 'booking_approval');

      await fetchBookings();
      toast.success('Booking approved successfully');
    } catch (err) {
      console.error('Error approving booking:', err);
      toast.error('Failed to approve booking');
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

      await fetchBookings();
      toast.success('Booking rejected');
    } catch (err) {
      console.error('Error rejecting booking:', err);
      toast.error('Failed to reject booking');
      throw err;
    }
  };

  useEffect(() => {
    fetchBookings();

    // Debounce rapid back-to-back realtime events (e.g. insert + update on same row)
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => {
        fetchBookings();
        refetchTimer = null;
      }, 300);
    };

    const bookingsSubscription = supabase
      .channel('bookings_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          // Apply optimistic update immediately so the colour changes right away,
          // then schedule a full refetch to reconcile.
          if (payload.eventType === 'UPDATE' && payload.new) {
            const updated = payload.new as any;
            setBookings(prev =>
              prev.map(b =>
                b.id === updated.id
                  ? {
                      ...b,
                      status: updated.status ?? b.status,
                      hasConflict: updated.has_conflict ?? b.hasConflict,
                      flight_logged: updated.flight_logged ?? b.flight_logged,
                      startTime: updated.start_time ? new Date(updated.start_time) : b.startTime,
                      endTime: updated.end_time ? new Date(updated.end_time) : b.endTime,
                    }
                  : b
              )
            );
          } else if (payload.eventType === 'INSERT' && payload.new) {
            // New booking from another user — schedule refetch to get full joined data
            scheduleRefetch();
            return;
          } else if (payload.eventType === 'DELETE' && payload.old) {
            const deleted = payload.old as any;
            setBookings(prev => prev.filter(b => b.id !== deleted.id));
          }
          scheduleRefetch();
        }
      )
      .subscribe();

    const flightLogsSubscription = supabase
      .channel('flight_logs_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'flight_logs' },
        (payload) => {
          // When a flight log is inserted, immediately mark the linked booking as logged
          const newLog = payload.new as any;
          if (newLog?.booking_id) {
            setBookings(prev =>
              prev.map(b =>
                b.id === newLog.booking_id
                  ? { ...b, flight_logged: true }
                  : b
              )
            );
          }
          scheduleRefetch();
        }
      )
      .subscribe();

    return () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      bookingsSubscription.unsubscribe();
      flightLogsSubscription.unsubscribe();
    };
  }, []);

  return {
    bookings,
    loading,
    error,
    addBooking,
    updateBooking,
    deleteBooking,
    addFlightLog,
    approveBooking,
    rejectBooking,
    refetch: fetchBookings
  };
};
