import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Booking, FlightLog } from '../types';
import toast from 'react-hot-toast';

export const useBookings = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBookings = async () => {
    try {
      setLoading(true);
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('bookings')
        .select('*')
        .order('start_time', { ascending: false });

      if (bookingsError) throw bookingsError;

      const { data: flightLogsData, error: flightLogsError } = await supabase
        .from('flight_logs')
        .select('*');

      if (flightLogsError) throw flightLogsError;

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
        flightLog: flightLogsMap.get(b.id)
      }));

      setBookings(combinedBookings);
      setError(null);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch bookings');
      toast.error('Failed to load bookings');
    } finally {
      setLoading(false);
    }
  };

  const addBooking = async (bookingData: Omit<Booking, 'id' | 'flightLog'>) => {
    try {
      console.log('Creating booking with data:', bookingData);

      const insertData = {
        student_id: bookingData.studentId || null,
        instructor_id: bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null,
        aircraft_id: bookingData.aircraftId || null,
        start_time: bookingData.startTime.toISOString(),
        end_time: bookingData.endTime.toISOString(),
        payment_type: bookingData.paymentType,
        notes: bookingData.notes || null,
        status: bookingData.status
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

      await fetchBookings();
      toast.success('Booking created successfully');
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
      if (bookingData.studentId !== undefined) updateData.student_id = bookingData.studentId || null;
      if (bookingData.instructorId !== undefined) updateData.instructor_id = bookingData.instructorId && bookingData.instructorId.trim() !== '' ? bookingData.instructorId : null;
      if (bookingData.aircraftId !== undefined) updateData.aircraft_id = bookingData.aircraftId || null;
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
    refetch: fetchBookings
  };
};
