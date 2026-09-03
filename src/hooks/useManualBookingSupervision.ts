import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';
import type { Booking, UserRole } from '../types';
import {
  canOfferCfiSupervisorAllocation,
  canOfferManualBookingSupervision,
  canAcknowledgeBookingSupervision,
  getSupervisionCoverageWindow,
  getAuthorisedSupervisorsForBooking,
  type InstructorSupervisionRequirement,
  type ManualSupervisorOption,
  type SeniorInstructorAuthorisation,
} from '../utils/manualBookingSupervision';
import { requestBookingCalendarRefresh } from '../utils/bookingCalendarRefresh';
import { hasRole } from '../utils/rbac';

interface AcceptedSupervisionResult {
  bookingId: string;
  supervisingInstructorId: string;
  supervisingInstructorName: string;
  supervisionStatus: 'acknowledged';
  bookingStatus: Booking['status'];
}

interface AssignedSupervisionResult {
  bookingId: string;
  supervisingInstructorId: string;
  supervisingInstructorName: string;
  supervisionStatus: 'assigned';
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

const REQUIREMENT_FIELDS = [
  'instructor_id',
  'supervision_required',
  'activity_types',
  'locations',
  'preflight_minutes',
  'postflight_minutes',
  'effective_from',
  'effective_to',
].join(',');

const STAFF_ROLES: UserRole[] = ['admin', 'cfi', 'senior_instructor', 'instructor'];

export const useManualBookingSupervision = () => {
  const { user } = useAuth();
  const [authorisations, setAuthorisations] = useState<SeniorInstructorAuthorisation[]>([]);
  const [authorisationsLoading, setAuthorisationsLoading] = useState(true);
  const [authorisedPeople, setAuthorisedPeople] = useState<ManualSupervisorOption[]>([]);
  const [requirements, setRequirements] = useState<InstructorSupervisionRequirement[]>([]);
  const [acceptingBookingId, setAcceptingBookingId] = useState<string | null>(null);
  const [assigningBookingId, setAssigningBookingId] = useState<string | null>(null);
  const [acknowledgingBookingId, setAcknowledgingBookingId] = useState<string | null>(null);
  const acceptingBookingIdRef = useRef<string | null>(null);
  const assigningBookingIdRef = useRef<string | null>(null);
  const [serverCfiAuthority, setServerCfiAuthority] = useState(false);
  const [cfiAuthorityLoading, setCfiAuthorityLoading] = useState(true);
  const isCfi = hasRole(user, 'cfi') || serverCfiAuthority;
  const isStaff = STAFF_ROLES.some(role => hasRole(user, role));

  useEffect(() => {
    let mounted = true;

    const confirmCfiAuthority = async () => {
      if (!user?.id) {
        if (mounted) {
          setServerCfiAuthority(false);
          setCfiAuthorityLoading(false);
        }
        return;
      }

      setCfiAuthorityLoading(true);
      const { data, error } = await supabase.rpc('current_user_is_cfi');
      if (!mounted) return;

      if (error) {
        console.error('Unable to confirm CFI / DCFI authority:', error);
        setServerCfiAuthority(false);
      } else {
        setServerCfiAuthority(data === true);
      }
      setCfiAuthorityLoading(false);
    };

    void confirmCfiAuthority();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;

    const loadAuthorisations = async () => {
      if (!user?.id || !isStaff) {
        if (mounted) {
          setAuthorisations([]);
          setAuthorisedPeople([]);
          setRequirements([]);
          setAuthorisationsLoading(false);
        }
        return;
      }

      setAuthorisationsLoading(true);
      const { data: requirementData, error: requirementError } = await supabase
        .from('instructor_supervision_requirements')
        .select(REQUIREMENT_FIELDS)
        .eq('supervision_required', true);
      if (!mounted) return;
      if (requirementError) {
        console.error('Unable to load supervision requirements:', requirementError);
        setRequirements([]);
      } else {
        setRequirements((requirementData || []) as unknown as InstructorSupervisionRequirement[]);
      }

      let authorisationQuery = supabase
        .from('senior_instructor_authorisations')
        .select(AUTHORISATION_FIELDS)
        .eq('is_active', true);
      if (!isCfi) authorisationQuery = authorisationQuery.eq('instructor_id', user.id);

      const { data, error } = await authorisationQuery;

      if (!mounted) return;
      if (error) {
        console.error('Unable to load supervision authorisation:', error);
        setAuthorisations([]);
        setAuthorisedPeople([]);
      } else {
        const rows = (data || []) as unknown as SeniorInstructorAuthorisation[];
        setAuthorisations(rows);

        const authorisedIds = Array.from(new Set(rows.map(row => row.instructor_id)));
        if (authorisedIds.length === 0) {
          setAuthorisedPeople([]);
        } else {
          const { data: peopleData, error: peopleError } = await supabase
            .from('users')
            .select('id,name,is_active')
            .in('id', authorisedIds);
          if (!mounted) return;
          if (peopleError) {
            console.error('Unable to load authorised supervisors:', peopleError);
            setAuthorisedPeople([]);
          } else {
            setAuthorisedPeople((peopleData || [])
              .filter(person => person.is_active !== false)
              .map(person => ({ id: person.id, name: person.name || 'Senior instructor' })));
          }
        }
      }
      setAuthorisationsLoading(false);
    };

    void loadAuthorisations();
    return () => {
      mounted = false;
    };
  }, [isCfi, isStaff, user?.id]);

  const canAcceptBooking = useCallback((booking: Booking) =>
    canOfferManualBookingSupervision(booking, user?.id, authorisations),
  [authorisations, user?.id]);

  const canAssignBooking = useCallback((booking: Booking) =>
    canOfferCfiSupervisorAllocation(booking, isCfi),
  [isCfi]);

  const getAssignableSupervisors = useCallback((booking: Booking) =>
    getAuthorisedSupervisorsForBooking(booking, authorisations, authorisedPeople),
  [authorisations, authorisedPeople]);

  const getCoverageWindow = useCallback((booking: Booking) =>
    getSupervisionCoverageWindow(booking, requirements),
  [requirements]);

  const canAcknowledgeBooking = useCallback((booking: Booking) =>
    canAcknowledgeBookingSupervision(booking, user?.id),
  [user?.id]);

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

  const assignBooking = useCallback(async (booking: Booking, supervisorId: string) => {
    if (!user?.id || !isCfi) throw new Error('CFI / DCFI authority is required to allocate a supervisor.');
    if (assigningBookingIdRef.current) {
      throw new Error('Another supervisor allocation is still being processed.');
    }

    assigningBookingIdRef.current = booking.id;
    setAssigningBookingId(booking.id);
    try {
      const { data, error } = await supabase.rpc('assign_booking_supervisor', {
        p_booking_id: booking.id,
        p_supervisor_id: supervisorId,
      });
      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(
          error,
          'The supervisor could not be allocated. Refresh the calendar and try again.',
        ));
      }

      requestBookingCalendarRefresh({
        bookingId: booking.id,
        reason: 'supervision-assigned',
      });
      return data as AssignedSupervisionResult;
    } finally {
      assigningBookingIdRef.current = null;
      setAssigningBookingId(null);
    }
  }, [isCfi, user?.id]);

  const acknowledgeBooking = useCallback(async (booking: Booking) => {
    if (!user?.id || !canAcknowledgeBookingSupervision(booking, user.id)) {
      throw new Error('Only the allocated supervisor can acknowledge this assignment.');
    }
    if (acknowledgingBookingId) {
      throw new Error('Another supervision acknowledgement is still being processed.');
    }

    setAcknowledgingBookingId(booking.id);
    try {
      const { error } = await supabase.rpc('acknowledge_booking_supervision', {
        p_booking_id: booking.id,
      });
      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(
          error,
          'The supervision acknowledgement could not be saved. Refresh the calendar and try again.',
        ));
      }
      requestBookingCalendarRefresh({
        bookingId: booking.id,
        reason: 'supervision-acknowledged',
      });
    } finally {
      setAcknowledgingBookingId(null);
    }
  }, [acknowledgingBookingId, user?.id]);

  return {
    acceptBooking,
    assignBooking,
    acknowledgeBooking,
    acceptingBookingId,
    assigningBookingId,
    acknowledgingBookingId,
    authorisationsLoading,
    cfiAuthorityLoading,
    canAcceptBooking,
    canAssignBooking,
    canAcknowledgeBooking,
    getCoverageWindow,
    getAssignableSupervisors,
  };
};
