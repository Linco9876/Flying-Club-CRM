import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface BookingConflict {
  id: string;
  bookingId: string;
  conflictType: 'instructor_unavailable' | 'aircraft_grounded' | 'double_booking' | 'aircraft_maintenance';
  conflictDetails: any;
  isResolved: boolean;
  notifiedAt?: Date;
  resolvedAt?: Date;
  createdAt: Date;
}

export const useBookingConflicts = () => {
  const [conflicts, setConflicts] = useState<BookingConflict[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConflicts = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('booking_conflicts')
        .select('*')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      const mappedData: BookingConflict[] = (data || []).map(conflict => ({
        id: conflict.id,
        bookingId: conflict.booking_id,
        conflictType: conflict.conflict_type,
        conflictDetails: conflict.conflict_details,
        isResolved: conflict.is_resolved,
        notifiedAt: conflict.notified_at ? new Date(conflict.notified_at) : undefined,
        resolvedAt: conflict.resolved_at ? new Date(conflict.resolved_at) : undefined,
        createdAt: new Date(conflict.created_at)
      }));

      setConflicts(mappedData);
    } catch (err) {
      console.error('Error fetching conflicts:', err);
    } finally {
      setLoading(false);
    }
  };

  const resolveConflict = async (conflictId: string) => {
    try {
      const { error: updateError } = await supabase
        .from('booking_conflicts')
        .update({
          is_resolved: true,
          resolved_at: new Date().toISOString()
        })
        .eq('id', conflictId);

      if (updateError) throw updateError;

      await fetchConflicts();
      toast.success('Conflict resolved');
    } catch (err) {
      console.error('Error resolving conflict:', err);
      toast.error('Failed to resolve conflict');
      throw err;
    }
  };

  const markAsNotified = async (conflictId: string) => {
    try {
      const { error: updateError } = await supabase
        .from('booking_conflicts')
        .update({
          notified_at: new Date().toISOString()
        })
        .eq('id', conflictId);

      if (updateError) throw updateError;
    } catch (err) {
      console.error('Error marking conflict as notified:', err);
    }
  };

  const getConflictsForBooking = (bookingId: string): BookingConflict[] => {
    return conflicts.filter(c => c.bookingId === bookingId);
  };

  useEffect(() => {
    fetchConflicts();

    const subscription = supabase
      .channel('booking_conflicts_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'booking_conflicts'
        },
        () => {
          fetchConflicts();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return {
    conflicts,
    loading,
    resolveConflict,
    markAsNotified,
    getConflictsForBooking,
    refetch: fetchConflicts
  };
};
