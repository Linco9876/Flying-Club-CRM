import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';
import type { Booking } from '../types';
import {
  canOfferManualBookingSupervision,
  type SeniorInstructorAuthorisation,
} from '../utils/manualBookingSupervision';
import { requestBookingCalendarRefresh } from '../utils/bookingCalendarRefresh';

interface AcceptedSupervisionResult {
  bookingId: string;
  supervisingInstructorId: string;
  supervisingInstructorName: string;
  supervisionStatus: 'acknowledged';
  bookingStatus: Booking['status'];
}

const AUTHORISATION_FIELDS = [
  'instructor_id',
  'is_active',
  'locations',
  'activity_types',
  'remote_supervision_allowed',
  'effective_from',
  'effective_to',
  'qualification_expires_on',
].join(',');

export const useManualBookingSupervision = () => {
  const { user } = useAuth();
  const [authorisations, setAuthorisations] = useState<SeniorInstructorAuthorisation[]>([]);
  const [authorisationsLoading, setAuthorisationsLoading] = useState(true);
  const [acceptingBookingId, setAcceptingBookingId] = useState<string | null>(null);
  const acceptingBookingIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadAuthorisations = async () => {
      if (!user?.id) {
        if (mounted) {
          setAuthorisations([]);
          setAuthorisationsLoading(false);
        }
        return;
      }

      setAuthorisationsLoading(true);
      const { data, error } = await supabase
        .from('senior_instructor_authorisations')
        .select(AUTHORISATION_FIELDS)
        .eq('instructor_id', user.id)
        .eq('is_active', true);

      if (!mounted) return;
      if (error) {
        console.error('Unable to load supervision authorisation:', error);
        setAuthorisations([]);
      } else {
        setAuthorisations((data || []) as unknown as SeniorInstructorAuthorisation[]);
      }
      setAuthorisationsLoading(false);
    };

    void loadAuthorisations();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const canAcceptBooking = useCallback((booking: Booking) =>
    canOfferManualBookingSupervision(booking, user?.id, authorisations),
  [authorisations, user?.id]);

  const acceptBooking = useCallback(async (booking: Booking) => {
    if (!user?.id) throw new Error('Sign in again before accepting supervision.');
    if (acceptingBookingIdRef.current) {
      throw new Error('Another supervision request is still being processed.');
    }

    acceptingBookingIdRef.current = booking.id;
    setAcceptingBookingId(booking.id);
    try {
      const { data, error } = await supabase.rpc('accept_booking_supervision', {
        p_booking_id: booking.id,
      });
      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(
          error,
          'The supervision commitment could not be saved. Refresh the calendar and try again.',
        ));
      }

      requestBookingCalendarRefresh({
        bookingId: booking.id,
        reason: 'supervision-accepted',
      });
      return data as AcceptedSupervisionResult;
    } finally {
      acceptingBookingIdRef.current = null;
      setAcceptingBookingId(null);
    }
  }, [user?.id]);

  return {
    acceptBooking,
    acceptingBookingId,
    authorisationsLoading,
    canAcceptBooking,
  };
};
