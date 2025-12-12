import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Booking, FlightLog, BookingConflict } from '../types';
import toast from 'react-hot-toast';

export const useBookings = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    try {
      setLoading(true);

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), 5000)
      );

      const bookingsPromise = supabase
        .from('bookings')
        .select('*')
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
        flightLog: flightLogsMap.get(b.id)
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

      let needsApproval = false;
      if (ruleValidation && Array.isArray(ruleValidation) && ruleValidation.length > 0) {
        const errors = ruleValidation.filter((err: any) => !err.needs_approval);
        const approvalRequired = ruleValidation.some((err: any) => err.needs_approval);

        if (errors.length > 0) {
          const errorMessages = errors.map((err: any) => err.message);
          throw new Error(errorMessages.join('. '));
        }

        needsApproval = approvalRequired;
      }

      // Check for conflicts before creating booking
      const { data: conflicts, error: conflictError } = await supabase
        .rpc('check_booking_conflicts', {
          p_booking_id: null,
          p_aircraft_id: bookingData.aircraftId,
          p_instructor_id: bookingData.instructorId || null,
          p_start_time: bookingData.startTime.toISOString(),
          p_end_time: bookingData.endTime.toISOString()
        });

      if (conflictError) {
        console.error('Error checking conflicts:', conflictError);
      }

      if (conflicts && conflicts.length > 0) {
        const conflictMessages = conflicts.map((c: BookingConflict) =>
          `${c.conflictType === 'aircraft' ? 'Aircraft' : 'Instructor'} is already booked during this time`
        );
        throw new Error(conflictMessages.join('. '));
      }

      const bookingStatus = needsApproval ? 'pending_approval' : bookingData.status;

      const insertData = {
        student_id: bookingData.studentId,
        instructor_id: bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null,
        aircraft_id: bookingData.aircraftId,
        start_time: bookingData.startTime.toISOString(),
        end_time: bookingData.endTime.toISOString(),
        payment_type: bookingData.paymentType,
        notes: bookingData.notes || null,
        status: bookingStatus
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
          .rpc('notify_instructors_for_approval', {
            booking_id: data[0].id
          });

        if (notifyError) {
          console.error('Error sending approval notifications:', notifyError);
        }
      }

      await fetchBookings();

      if (needsApproval) {
        toast.success('Booking created and sent for instructor approval');
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

  const updateBooking = async (id: string, bookingData: Partial<Omit<Booking, 'id' | 'flightLog'>>) => {
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

      const { error } = await supabase
        .from('bookings')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchBookings();
      toast.success('Booking updated successfully');
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
        .delete()
        .eq('id', id);

      if (error) throw error;

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
