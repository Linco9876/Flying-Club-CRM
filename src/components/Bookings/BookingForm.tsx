import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Loader2, X, Clock, Plane, User, CreditCard, Repeat2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useStudents } from '../../hooks/useStudents';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import { useBookingFieldSettings } from '../../hooks/useBookingFieldSettings';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useBookingRulesSettings, useOrganisationSettings, usePortalUxSettings } from '../../hooks/useSettings';
import { Booking } from '../../types';
import { SafetyConcern, buildSafetyComplianceSummary } from '../../utils/safetyCompliance';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface BookingFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bookingData: any) => void | Promise<void>;
  booking?: Booking | null;
  isEdit?: boolean;
  isKioskMode?: boolean;
  prefilledData?: {
    bookingKind?: 'flight' | 'ground';
    date?: string;
    startTime?: string;
    endTime?: string;
    endDate?: string;
    studentId?: string;
    aircraftId?: string;
    instructorId?: string;
    paymentType?: string;
    flightTypeId?: string;
    notes?: string;
    copiedFromBookingId?: string;
    isGuestBooking?: boolean;
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
    trialFlightVoucherId?: string;
  };
}

interface GuestVoucherOption {
  id: string;
  code: string;
  status: string;
  bookedBookingId?: string | null;
  redeemedByUserId?: string | null;
  displayName: string;
  displayEmail: string;
  displayPhone?: string;
  productName: string;
  eligibleAircraftIds: string[];
}

interface PublicInstructorOption {
  id: string;
  name: string;
  email: string;
}

const BookingForm: React.FC<BookingFormProps> = ({ isOpen, onClose, onSubmit, booking, isEdit, isKioskMode = false, prefilledData }) => {
  const { user } = useAuth();
  const { aircraft, loading: aircraftLoading } = useAircraft({ participateInPageLoad: false });
  const { users, getInstructors, loading: usersLoading } = useUsers();
  const { students, loading: studentsLoading } = useStudents({ participateInPageLoad: false });
  const { flightLogs, loading: flightLogsLoading } = useFlightLogs(undefined, { participateInPageLoad: false });
  const { settings: safetySettings } = useSafetySettings({ participateInPageLoad: false });
  const { settings, isFieldRequired, isFieldVisible } = useBookingFieldSettings();
  const { flightTypes, paymentMethods } = useBillingSettings();
  const { settings: portalSettings } = usePortalUxSettings();
  const { settings: bookingRules } = useBookingRulesSettings();
  const { settings: organisationSettings } = useOrganisationSettings();
  const isCopiedBooking = Boolean(prefilledData?.copiedFromBookingId && !isEdit);
  const buildInitialFormData = React.useCallback(() => {
    const today = format(new Date(), 'yyyy-MM-dd');

    if (booking) {
      return {
        bookingKind: booking.bookingKind || 'flight',
        studentId: booking.studentId || '',
        date: format(new Date(booking.startTime), 'yyyy-MM-dd'),
        endDate: format(new Date(booking.endTime), 'yyyy-MM-dd'),
        startTime: normalizeToQuarterHour(format(new Date(booking.startTime), 'HH:mm')) || '09:00',
        endTime: normalizeToQuarterHour(format(new Date(booking.endTime), 'HH:mm')) || '11:00',
        aircraftId: booking.aircraftId || '',
        instructorId: booking.instructorId || '',
        paymentType: booking.paymentType || '',
        flightTypeId: booking.flightTypeId || '',
        notes: booking.notes || '',
        isGuestBooking: booking.isGuestBooking || false,
        guestName: booking.guestName || '',
        guestEmail: booking.guestEmail || '',
        guestPhone: booking.guestPhone || '',
        trialFlightVoucherId: booking.trialFlightVoucherId || '',
      };
    }

    return {
      bookingKind: prefilledData?.bookingKind || 'flight',
      studentId: prefilledData?.studentId || (isKioskMode ? '' : user?.id) || '',
      date: prefilledData?.date || today,
      endDate: prefilledData?.endDate || prefilledData?.date || today,
      startTime: normalizeToQuarterHour(prefilledData?.startTime) || '09:00',
      endTime: normalizeToQuarterHour(prefilledData?.endTime) || '11:00',
      aircraftId: prefilledData?.aircraftId || '',
      instructorId: prefilledData?.instructorId || '',
      paymentType: prefilledData?.paymentType || '',
      flightTypeId: prefilledData?.flightTypeId || '',
      notes: prefilledData?.notes || '',
      isGuestBooking: prefilledData?.isGuestBooking || false,
      guestName: prefilledData?.guestName || '',
      guestEmail: prefilledData?.guestEmail || '',
      guestPhone: prefilledData?.guestPhone || '',
      trialFlightVoucherId: prefilledData?.trialFlightVoucherId || '',
    };
  }, [
    booking?.id,
    booking?.studentId,
    booking?.aircraftId,
    booking?.instructorId,
    booking?.paymentType,
    booking?.flightTypeId,
    booking?.notes,
    booking?.isGuestBooking,
    booking?.guestName,
    booking?.guestEmail,
    booking?.guestPhone,
    booking?.trialFlightVoucherId,
    booking?.startTime,
    booking?.endTime,
    prefilledData?.date,
    prefilledData?.endDate,
    prefilledData?.startTime,
    prefilledData?.endTime,
    prefilledData?.studentId,
    prefilledData?.aircraftId,
    prefilledData?.instructorId,
    prefilledData?.paymentType,
    prefilledData?.flightTypeId,
    prefilledData?.notes,
    prefilledData?.isGuestBooking,
    prefilledData?.guestName,
    prefilledData?.guestEmail,
    prefilledData?.guestPhone,
    prefilledData?.trialFlightVoucherId,
    isKioskMode,
    user?.id,
  ]);

  const [formData, setFormData] = useState(buildInitialFormData);
  const [guestVoucherOptions, setGuestVoucherOptions] = useState<GuestVoucherOption[]>([]);
  const [guestVoucherSearch, setGuestVoucherSearch] = useState('');
  const [pilotSearch, setPilotSearch] = useState('');
  const [showPilotDropdown, setShowPilotDropdown] = useState(false);
  const [loadingGuestVouchers, setLoadingGuestVouchers] = useState(false);
  const [publicInstructors, setPublicInstructors] = useState<PublicInstructorOption[]>([]);
  type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly';
  type RecurrenceEndMode = 'never' | 'on' | 'after';
  const buildDefaultRecurrence = (): {
    enabled: boolean;
    frequency: RecurrenceFrequency;
    interval: number;
    weekdays: number[];
    endMode: RecurrenceEndMode;
    untilDate: string;
    count: number;
  } => ({
    enabled: false,
    frequency: 'weekly',
    interval: 1,
    weekdays: [],
    endMode: 'after',
    untilDate: '',
    count: 2,
  });
  const [recurrence, setRecurrence] = useState<{
    enabled: boolean;
    frequency: RecurrenceFrequency;
    interval: number;
    weekdays: number[];
    endMode: RecurrenceEndMode;
    untilDate: string;
    count: number;
  }>(buildDefaultRecurrence);
  const [showRecurrenceModal, setShowRecurrenceModal] = useState(false);
  const [pendingSafetySubmit, setPendingSafetySubmit] = useState<typeof formData | null>(null);
  const [safetyWarningState, setSafetyWarningState] = useState<{
    concerns: SafetyConcern[];
    blocking: boolean;
    pilotName: string;
    picHours: number;
  } | null>(null);
  const [pendingEndorsementSubmit, setPendingEndorsementSubmit] = useState<typeof formData | null>(null);
  const [endorsementWarningState, setEndorsementWarningState] = useState<{
    aircraftName: string;
    pilotName: string;
    endorsementType: string;
    needsStaffLicence: boolean;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const roleBasedInstructors = getInstructors().map((instructor) => ({
    id: instructor.id,
    name: instructor.name,
    email: instructor.email,
  }));
  const userRole = user?.role || 'student';
  const isAdminUser = Boolean(user?.role === 'admin' || user?.roles?.includes('admin'));
  const canCreateGuestBooking = isAdminUser;
  const isGroundSessionBooking = formData.bookingKind === 'ground';
  const displayUserRoles = user?.roles && user.roles.length > 0 ? user.roles : [userRole];
  const isStudentOnlyUser = displayUserRoles.includes('student') && !displayUserRoles.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
  const isLimitedCalendarUser = displayUserRoles.some(role => role === 'student' || role === 'pilot')
    && !displayUserRoles.some(role => ['admin', 'instructor', 'senior_instructor'].includes(role));
  const isLoading = aircraftLoading || usersLoading || studentsLoading || flightLogsLoading;
  const showModalLoader = isLoading || isSubmitting;
  const selectedGuestVoucher = guestVoucherOptions.find(option => option.id === formData.trialFlightVoucherId);
  const selectedPilot = users.find(item => item.id === formData.studentId);
  const getPilotSearchLabel = (member: { name?: string; email?: string; id: string }) =>
    `${member.name || 'Unnamed member'}${member.email ? ` - ${member.email}` : ''}`;
  const guestEligibleAircraftIds = selectedGuestVoucher?.eligibleAircraftIds ?? [];
  const isPrepaidLikeFlightType = (name?: string | null) => {
    const normalised = (name || '').toLowerCase().replace(/[-_]/g, ' ');
    return normalised.includes('pilot account') || normalised.includes('prepaid') || normalised.includes('pre paid');
  };
  const getPilotAccountPaymentType = React.useCallback(() => {
    const method = paymentMethods.find((paymentMethod) => {
      if (!paymentMethod.active) return false;
      return isPrepaidLikeFlightType(paymentMethod.name);
    });
    return method?.name || 'Pilot Account';
  }, [paymentMethods]);
  const derivePaymentTypeForFlightType = React.useCallback((flightTypeId?: string) => {
    if (!flightTypeId) return '';
    const selectedFlightType = flightTypes.find(ft => ft.id === flightTypeId);
    if (!selectedFlightType) return '';
    return isPrepaidLikeFlightType(selectedFlightType.name)
      ? getPilotAccountPaymentType()
      : selectedFlightType.name;
  }, [flightTypes, getPilotAccountPaymentType]);
  const shouldShowInstructorField = isFieldVisible('instructor', userRole) || isStudentOnlyUser || Boolean(formData.trialFlightVoucherId);
  const instructors = useMemo(() => {
    const merged = new Map<string, PublicInstructorOption>();
    roleBasedInstructors.forEach((instructor) => merged.set(instructor.id, instructor));
    publicInstructors.forEach((instructor) => {
      if (!merged.has(instructor.id)) merged.set(instructor.id, instructor);
    });
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [publicInstructors, roleBasedInstructors]);

  const availableAircraft = aircraft.filter((item) => {
    if (item.status !== 'serviceable' || item.isArchived) return false;
    if (!formData.isGuestBooking || guestEligibleAircraftIds.length === 0) return true;
    return guestEligibleAircraftIds.includes(item.id);
  });
  const availableFlightTypes = flightTypes.filter((flightType) =>
    flightType.active && (!formData.isGuestBooking || !isPrepaidLikeFlightType(flightType.name))
  );
  const filteredGuestVoucherOptions = guestVoucherOptions.filter((option) => {
    const query = guestVoucherSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      option.code,
      option.displayName,
      option.displayEmail,
      option.productName,
    ].some(value => value.toLowerCase().includes(query));
  }).slice(0, 8);
  const filteredPilotOptions = users.filter((member) => {
    const query = pilotSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      member.name || '',
      member.email || '',
      member.phone || '',
      member.mobilePhone || '',
      member.homePhone || '',
      member.workPhone || '',
    ].some(value => String(value).toLowerCase().startsWith(query));
  }).slice(0, 10);

  React.useEffect(() => {
    if (!isOpen || !isLimitedCalendarUser) {
      setPublicInstructors([]);
      return;
    }

    let cancelled = false;

    const loadPublicInstructors = async () => {
      try {
        let directory: PublicInstructorOption[] = [];
        const { data, error } = await supabase.rpc('list_calendar_instructors');
        if (error) throw error;
        directory = Array.isArray(data)
          ? data.map((row: any) => ({
              id: row.id,
              name: row.name || row.email || 'Instructor',
              email: row.email || '',
            }))
          : [];

        if (directory.length === 0) {
          const [{ data: fallbackUsers }, { data: fallbackRoles }] = await Promise.all([
            supabase.from('users').select('id, name, email'),
            supabase.from('user_roles').select('user_id, role').in('role', ['instructor', 'senior_instructor']),
          ]);
          const instructorIds = new Set((fallbackRoles || []).map((row: any) => row.user_id));
          directory = (fallbackUsers || [])
            .filter((row: any) => instructorIds.has(row.id))
            .map((row: any) => ({
              id: row.id,
              name: row.name || row.email || 'Instructor',
              email: row.email || '',
            }));
        }

        if (cancelled) return;
        setPublicInstructors(directory);
      } catch (error) {
        console.error('Failed to load public instructors for booking form:', error);
        if (!cancelled) {
          setPublicInstructors([]);
        }
      }
    };

    void loadPublicInstructors();
    return () => {
      cancelled = true;
    };
  }, [isLimitedCalendarUser, isOpen]);

  // Rebuild the whole form every time it opens so stale values cannot leak between bookings.
  React.useEffect(() => {
    if (!isOpen) return;
    const initialData = buildInitialFormData();
    const initialPilot = users.find(item => item.id === initialData.studentId);
    setFormData(initialData);
    setPendingSafetySubmit(null);
    setSafetyWarningState(null);
    setPendingEndorsementSubmit(null);
    setEndorsementWarningState(null);
    setGuestVoucherSearch('');
    setPilotSearch(initialData.isGuestBooking || !initialPilot ? '' : getPilotSearchLabel(initialPilot));
    setShowPilotDropdown(false);
    setRecurrence(buildDefaultRecurrence());
    setIsSubmitting(false);
  }, [buildInitialFormData, isOpen, users]);

  React.useEffect(() => {
    if (!isOpen || !canCreateGuestBooking || !formData.isGuestBooking) {
      setGuestVoucherOptions([]);
      setLoadingGuestVouchers(false);
      return;
    }

    let cancelled = false;
    const loadGuestVouchers = async () => {
      setLoadingGuestVouchers(true);
      const { data, error } = await supabase
        .from('trial_flight_vouchers')
        .select(`
          id,
          code,
          status,
          recipient_name,
          recipient_email,
          purchaser_name,
          purchaser_email,
          purchaser_phone,
          redeemed_by_user_id,
          booked_booking_id,
          trial_flight_voucher_products(name, aircraft_ids)
        `)
        .in('status', ['issued', 'redeemed', 'booked'])
        .order('created_at', { ascending: false })
        .limit(100);

      if (cancelled) return;
      if (error) {
        console.error('Failed to load guest voucher options:', error);
        setGuestVoucherOptions([]);
        setLoadingGuestVouchers(false);
        return;
      }

      const options = (data || [])
        .filter((voucher: any) => {
          if (voucher.booked_booking_id === booking?.id) return true;
          if (voucher.booked_booking_id) return false;
          return voucher.status === 'issued' || voucher.status === 'redeemed';
        })
        .map((voucher: any) => ({
          id: voucher.id,
          code: voucher.code || '',
          status: voucher.status || '',
          bookedBookingId: voucher.booked_booking_id || null,
          redeemedByUserId: voucher.redeemed_by_user_id || null,
          displayName: voucher.recipient_name || voucher.purchaser_name || 'Voucher holder',
          displayEmail: voucher.recipient_email || voucher.purchaser_email || '',
          displayPhone: voucher.purchaser_phone || '',
          productName: voucher.trial_flight_voucher_products?.name || 'Trial flight voucher',
          eligibleAircraftIds: voucher.trial_flight_voucher_products?.aircraft_ids || [],
        }));

      setGuestVoucherOptions(options);
      setLoadingGuestVouchers(false);
    };

    void loadGuestVouchers();
    return () => {
      cancelled = true;
    };
  }, [booking?.id, canCreateGuestBooking, formData.isGuestBooking, isOpen]);

  React.useEffect(() => {
    if (!formData.isGuestBooking || guestEligibleAircraftIds.length === 0 || !formData.aircraftId) return;
    if (!guestEligibleAircraftIds.includes(formData.aircraftId)) {
      setFormData(prev => ({ ...prev, aircraftId: '' }));
    }
  }, [formData.aircraftId, formData.isGuestBooking, guestEligibleAircraftIds]);

  React.useEffect(() => {
    if (!formData.isGuestBooking) return;
    if (recurrence.enabled) {
      setRecurrence(prev => ({ ...prev, enabled: false }));
    }

    const selectedFlightType = flightTypes.find(ft => ft.id === formData.flightTypeId);
    if (isPrepaidLikeFlightType(formData.paymentType) || isPrepaidLikeFlightType(selectedFlightType?.name)) {
      setFormData(prev => ({
        ...prev,
        paymentType: '',
        flightTypeId: '',
      }));
    }
  }, [flightTypes, formData.flightTypeId, formData.isGuestBooking, formData.paymentType, recurrence.enabled]);

  React.useEffect(() => {
    if (!isGroundSessionBooking) return;
    if (!formData.isGuestBooking && !formData.trialFlightVoucherId && !formData.aircraftId) return;

    setFormData(prev => ({
      ...prev,
      isGuestBooking: false,
      guestName: '',
      guestEmail: '',
      guestPhone: '',
      trialFlightVoucherId: '',
      aircraftId: '',
      paymentType: '',
      flightTypeId: '',
    }));
  }, [formData.aircraftId, formData.isGuestBooking, formData.trialFlightVoucherId, isGroundSessionBooking]);

  React.useEffect(() => {
    if (!formData.flightTypeId || formData.trialFlightVoucherId) return;
    const selectedFlightType = flightTypes.find(ft => ft.id === formData.flightTypeId);
    if (!isPrepaidLikeFlightType(selectedFlightType?.name)) return;

    const forcedPaymentType = getPilotAccountPaymentType();
    if (formData.paymentType === forcedPaymentType) return;
    setFormData(prev => ({ ...prev, paymentType: forcedPaymentType }));
  }, [flightTypes, formData.flightTypeId, formData.paymentType, formData.trialFlightVoucherId, getPilotAccountPaymentType]);

  const validateFormData = () => {
    const userRole = user?.role || 'student';
    const effectiveGroundSession = formData.bookingKind === 'ground' || (!formData.aircraftId && !formData.trialFlightVoucherId);

    if (formData.isGuestBooking) {
      if (effectiveGroundSession) {
        toast.error('Ground sessions are for members only');
        return;
      }
      if (!canCreateGuestBooking) {
        toast.error('Only admins can create guest or casual bookings');
        return;
      }
      if (!formData.guestName.trim()) {
        toast.error('Guest name is required');
        return;
      }
      if (!formData.guestEmail.trim()) {
        toast.error('Guest email is required');
        return;
      }
      if (!formData.trialFlightVoucherId && !formData.guestPhone.trim()) {
        toast.error('Guest phone number is required');
        return;
      }
    } else if (isFieldRequired('pilot', userRole) && !formData.studentId) {
      toast.error('Pilot is required');
      return;
    }
    if (formData.isGuestBooking && formData.trialFlightVoucherId) {
      const selectedVoucher = guestVoucherOptions.find(option => option.id === formData.trialFlightVoucherId);
      if (!selectedVoucher) {
        toast.error('Select a valid unused voucher');
        return;
      }
      if (selectedVoucher.eligibleAircraftIds.length === 0) {
        toast.error('This voucher product needs aircraft configured before it can be linked');
        return;
      }
      if (selectedVoucher.eligibleAircraftIds.length > 0 && !selectedVoucher.eligibleAircraftIds.includes(formData.aircraftId)) {
        toast.error('This voucher is only valid for its configured aircraft type');
        return;
      }
      if (!formData.instructorId) {
        toast.error('Voucher flights need an instructor assigned');
        return;
      }
    }
    // A blank aircraft is treated as an instructor-only ground session.
    if (isFieldRequired('startDate', userRole) && !formData.date) {
      toast.error('Start date is required');
      return;
    }
    if (isFieldRequired('startTime', userRole) && !formData.startTime) {
      toast.error('Start time is required');
      return;
    }
    if (isFieldRequired('endDate', userRole) && !formData.endDate) {
      toast.error('End date is required');
      return;
    }
    if (isFieldRequired('endTime', userRole) && !formData.endTime) {
      toast.error('End time is required');
      return;
    }
    if (!effectiveGroundSession && isFieldRequired('paymentType', userRole) && !formData.trialFlightVoucherId && !formData.paymentType) {
      toast.error('Payment type is required');
      return;
    }
    const userRoles = user?.roles && user.roles.length > 0 ? user.roles : [userRole];
    const isStudentOnlyUser = userRoles.includes('student') && !userRoles.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
    if ((isStudentOnlyUser || effectiveGroundSession) && !formData.instructorId) {
      toast.error(effectiveGroundSession ? 'Instructor is required for ground sessions.' : 'Students need an instructor assigned. Pilots can book aircraft solo.');
      return;
    }

    const selectedAircraft = aircraft.find(a => a.id === formData.aircraftId);
    if (!effectiveGroundSession) {
      if (selectedAircraft?.isArchived) {
        toast.error('This aircraft is archived and cannot be booked');
        return;
      }
      if (selectedAircraft && selectedAircraft.status !== 'serviceable') {
        toast.error('Selected aircraft is not serviceable');
        return;
      }
    }

    const startDateTime = new Date(`${formData.date}T${formData.startTime}`);
    const endDateTime = new Date(`${formData.endDate}T${formData.endTime}`);

    if (endDateTime <= startDateTime) {
      toast.error('End time must be after start time');
      return;
    }

    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (60 * 60 * 1000);
    if (bookingRules?.enforce_max_duration && durationHours > bookingRules.max_booking_duration_hours) {
      toast.error(`Bookings cannot be longer than ${bookingRules.max_booking_duration_hours} hours`);
      return;
    }

    if (
      !isEdit &&
      (user?.role === 'student' || user?.role === 'pilot') &&
      startDateTime.getTime() > Date.now() + portalSettings.max_advance_booking_days * 24 * 60 * 60 * 1000
    ) {
      toast.error(`Bookings can only be made up to ${portalSettings.max_advance_booking_days} days in advance`);
      return;
    }

    return { startDateTime, endDateTime };
  };

  const submitBookingData = async (data: typeof formData & { status?: Booking['status'] }) => {
    if (isSubmitting || isLoading) return;
    setIsSubmitting(true);
    try {
      const effectiveBookingKind = data.bookingKind === 'ground' || (!data.aircraftId && !data.trialFlightVoucherId) ? 'ground' : 'flight';
      const normalisedBookingData = effectiveBookingKind === 'ground'
        ? {
            ...data,
            bookingKind: 'ground' as const,
            aircraftId: '',
            paymentType: '',
            flightTypeId: '',
            trialFlightVoucherId: '',
          }
        : data.trialFlightVoucherId
        ? { ...data, flightTypeId: '', paymentType: 'Gift Voucher' }
        : {
            ...data,
            paymentType: derivePaymentTypeForFlightType(data.flightTypeId) || data.paymentType,
          };
      await onSubmit({
        ...normalisedBookingData,
        recurrence: !isEdit && !normalisedBookingData.isGuestBooking && recurrence.enabled ? recurrence : undefined,
      });
      onClose();
    } catch (error) {
      setIsSubmitting(false);
      throw error;
    }
  };

  const getEndorsementWarning = (data: typeof formData) => {
    if (data.instructorId || data.bookingKind === 'ground') return null;

    const selectedAircraft = aircraft.find(a => a.id === data.aircraftId);
    const requiredAnyEndorsements = (selectedAircraft?.requiredEndorsementTypes?.length
      ? selectedAircraft.requiredEndorsementTypes
      : selectedAircraft?.requiredEndorsementType
        ? [selectedAircraft.requiredEndorsementType]
        : []
    )
      .map(type => type.trim())
      .filter(Boolean);
    const requiredAllEndorsements = (selectedAircraft?.requiredAllEndorsementTypes || [])
      .map(type => type.trim())
      .filter(Boolean);
    const requiredAnyLicences = (selectedAircraft?.requiredLicenceTypes || []).map(type => type.trim()).filter(Boolean);
    const requiredAllLicences = (selectedAircraft?.requiredAllLicenceTypes || []).map(type => type.trim()).filter(Boolean);
    if (!selectedAircraft || (requiredAnyEndorsements.length === 0 && requiredAllEndorsements.length === 0 && requiredAnyLicences.length === 0 && requiredAllLicences.length === 0)) return null;

    if (data.isGuestBooking) return null;

    const selectedPerson = students.find((student) => student.id === data.studentId);
    const now = new Date();
    const activeEndorsements = new Set(
      (selectedPerson?.endorsements || [])
        .filter((endorsement) => endorsement.isActive && (!endorsement.expiryDate || new Date(endorsement.expiryDate) >= now))
        .map((endorsement) => endorsement.type.trim().toLowerCase())
    );
    const activeLicences = new Set((selectedPerson?.licences || [])
      .filter(licence => licence.isActive && (!licence.expiryDate || new Date(licence.expiryDate) >= now))
      .map(licence => licence.type.trim().toLowerCase()));

    const meetsAllRequired = requiredAllEndorsements.every(type => activeEndorsements.has(type.toLowerCase()));
    const meetsAnyRequired = requiredAnyEndorsements.length === 0 || requiredAnyEndorsements.some(type => activeEndorsements.has(type.toLowerCase()));
    const meetsAllLicences = requiredAllLicences.every(type => activeLicences.has(type.toLowerCase()));
    const meetsAnyLicence = requiredAnyLicences.length === 0 || requiredAnyLicences.some(type => activeLicences.has(type.toLowerCase()));

    if (meetsAllRequired && meetsAnyRequired && meetsAllLicences && meetsAnyLicence) return null;

    const requirementParts = [
      requiredAllEndorsements.length > 0 ? `all of: ${requiredAllEndorsements.join(', ')}` : null,
      requiredAnyEndorsements.length > 0 ? `one of: ${requiredAnyEndorsements.join(', ')}` : null,
      requiredAllLicences.length > 0 ? `all licences: ${requiredAllLicences.join(', ')}` : null,
      requiredAnyLicences.length > 0 ? `one licence: ${requiredAnyLicences.join(', ')}` : null,
    ].filter(Boolean);

    return {
      aircraftName: `${selectedAircraft.registration} ${selectedAircraft.make} ${selectedAircraft.model}`.trim(),
      pilotName: selectedPerson?.name || users.find(u => u.id === data.studentId)?.name || 'This pilot',
      endorsementType: requirementParts.join(' and '),
      needsStaffLicence: !meetsAllLicences || !meetsAnyLicence,
    };
  };

  const openRecurrenceModal = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    const selectedDate = formData.date ? new Date(`${formData.date}T12:00:00`) : new Date();
    const selectedWeekday = selectedDate.getDay();
    setRecurrence(prev => ({
      ...buildDefaultRecurrence(),
      ...prev,
      weekdays: Array.isArray(prev.weekdays) && prev.weekdays.length > 0 ? prev.weekdays : [selectedWeekday],
      untilDate: prev.untilDate || formData.endDate || formData.date || format(selectedDate, 'yyyy-MM-dd'),
    }));
    setShowRecurrenceModal(true);
  };

  const recurrenceSummary = recurrence.enabled
    ? recurrence.endMode === 'on'
      ? `Repeats until ${recurrence.untilDate || 'selected date'}`
      : recurrence.endMode === 'never'
      ? 'Repeats, capped at 52 bookings'
      : `Repeats ${recurrence.count} times`
    : 'Make this a recurring booking';

  const runSafetyCheckOrSubmit = (data: typeof formData & { status?: Booking['status'] }) => {
    const selectedPerson = students.find((student) => student.id === data.studentId);
    if (selectedPerson) {
      const compliance = buildSafetyComplianceSummary(selectedPerson, safetySettings, flightLogs, {
        hasInstructor: Boolean(data.instructorId)
      });
      const concerns = compliance.concerns;

      if (concerns.length > 0) {
        setSafetyWarningState({
          concerns,
          blocking: compliance.blockingConcerns.length > 0,
          pilotName: selectedPerson.name,
          picHours: compliance.picHours
        });
        setPendingSafetySubmit(data);
        return;
      }
    }

    void submitBookingData(data);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateFormData();
    if (!validation) return;

    const endorsementWarning = getEndorsementWarning(formData);
    if (endorsementWarning) {
      setEndorsementWarningState(endorsementWarning);
      return;
    }

    runSafetyCheckOrSubmit(formData);
  };

  const parseHour = (time: string | undefined, fallback: number, roundUp = false) => {
    if (!time) return fallback;
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return roundUp && minute > 0 ? hour + 1 : hour;
  };
  const bookingDayStartHour = parseHour(organisationSettings?.booking_day_start, 6);
  const bookingDayEndHour = parseHour(organisationSettings?.booking_day_end, 22, true);
  const timeOptions = React.useMemo(
    () => generateTimeOptions(bookingDayStartHour, bookingDayEndHour),
    [bookingDayStartHour, bookingDayEndHour]
  );

  const handleConfirmSafetyWarning = () => {
    if (!pendingSafetySubmit || safetyWarningState?.blocking) return;
    void submitBookingData(pendingSafetySubmit);
    setPendingSafetySubmit(null);
    setSafetyWarningState(null);
  };

  const handleCloseSafetyWarning = () => {
    setSafetyWarningState(null);
    setPendingSafetySubmit(null);
  };

  const handleOpenEndorsementSettings = () => {
    const endorsementQuery = endorsementWarningState?.endorsementType
      ? `&endorsement=${encodeURIComponent(endorsementWarningState.endorsementType)}`
      : '';
    setEndorsementWarningState(null);
    onClose();
    window.location.assign(`/settings?tab=account-info&accountTab=info&focus=endorsements${endorsementQuery}`);
  };

  const handleCloseEndorsementWarning = () => {
    setEndorsementWarningState(null);
  };

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="relative bg-white rounded-xl shadow-2xl max-w-xs w-full max-h-[90vh] overflow-hidden flex flex-col">
        {showModalLoader && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/88 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-blue-100 bg-white px-5 py-4 text-center shadow-lg">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {isSubmitting ? (isEdit ? 'Updating booking...' : 'Creating booking...') : 'Loading booking details...'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {isSubmitting
                    ? 'Please wait while we save the booking.'
                    : 'Preparing members, aircraft and safety checks for this booking.'}
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Booking' : isCopiedBooking ? 'Copy Booking' : 'New Booking'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 rounded-md transition-colors"
          >
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1">
          <div className="p-4 space-y-3">
          {!isLoading && isFieldVisible('pilot', userRole) && (user?.role === 'admin' || user?.role === 'instructor' || user?.role === 'senior_instructor') && (
            <div>
              {canCreateGuestBooking && (
                <>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      isGuestBooking: false,
                      guestName: '',
                      guestEmail: '',
                      guestPhone: '',
                      trialFlightVoucherId: '',
                      paymentType: '',
                      flightTypeId: '',
                    }))}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      !formData.isGuestBooking
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    disabled={isGroundSessionBooking}
                  >
                    Member booking
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      isGuestBooking: true,
                      studentId: '',
                      paymentType: '',
                      flightTypeId: '',
                    }))}
                    className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                      formData.isGuestBooking
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                    disabled={isGroundSessionBooking}
                  >
                    Guest / casual
                  </button>
                </div>
                </>
              )}

              <label className="block text-xs font-medium text-gray-600 mb-1">
                <User className="h-3.5 w-3.5 inline mr-1" />
                {formData.isGuestBooking ? 'Guest booking contact' : 'Pilot'} {isFieldRequired('pilot', userRole) && !formData.isGuestBooking && <span className="text-red-500">*</span>}
              </label>
              {formData.isGuestBooking ? (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">
                      Link unused gift voucher <span className="text-gray-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={guestVoucherSearch}
                      onChange={(event) => {
                        setGuestVoucherSearch(event.target.value);
                        setFormData(prev => ({
                          ...prev,
                          trialFlightVoucherId: '',
                          paymentType: '',
                          flightTypeId: '',
                        }));
                      }}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={loadingGuestVouchers}
                      placeholder={loadingGuestVouchers ? 'Loading unused vouchers...' : 'Search voucher code, name or email'}
                    />
                    {formData.trialFlightVoucherId && selectedGuestVoucher && (
                      <div className="mt-1 rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs text-blue-700">
                        {selectedGuestVoucher.code} - {selectedGuestVoucher.displayName} - {selectedGuestVoucher.productName}
                      </div>
                    )}
                    {!formData.trialFlightVoucherId && guestVoucherSearch.trim() && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-sm">
                        {filteredGuestVoucherOptions.length > 0 ? (
                          filteredGuestVoucherOptions.map(option => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setGuestVoucherSearch(`${option.code} - ${option.displayName}`);
                                setFormData(prev => ({
                                  ...prev,
                                  trialFlightVoucherId: option.id,
                                  guestName: option.displayName || prev.guestName,
                                  guestEmail: option.displayEmail || prev.guestEmail,
                                  guestPhone: prev.guestPhone || option.displayPhone || '',
                                  paymentType: 'Gift Voucher',
                                  flightTypeId: '',
                                  aircraftId: option.eligibleAircraftIds.length === 1 ? option.eligibleAircraftIds[0] : prev.aircraftId,
                                }));
                              }}
                              className="block w-full px-2.5 py-2 text-left text-xs hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                            >
                              <span className="block font-semibold text-gray-900">{option.code} - {option.displayName}</span>
                              <span className="block truncate text-gray-500">{option.productName}{option.displayEmail ? ` - ${option.displayEmail}` : ''}</span>
                            </button>
                          ))
                        ) : (
                          <p className="px-2.5 py-2 text-xs text-gray-500">No unused vouchers found.</p>
                        )}
                      </div>
                    )}
                    {formData.trialFlightVoucherId && (
                      <p className="mt-1 text-xs text-blue-600">
                        Aircraft choices are limited to the voucher setup.
                      </p>
                    )}
                  </div>
                  <input
                    type="text"
                    value={formData.guestName}
                    onChange={(e) => setFormData(prev => ({ ...prev, guestName: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Guest name"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="email"
                      value={formData.guestEmail}
                      onChange={(e) => setFormData(prev => ({ ...prev, guestEmail: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Guest email"
                    />
                    <input
                      type="tel"
                      value={formData.guestPhone}
                      onChange={(e) => setFormData(prev => ({ ...prev, guestPhone: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Guest phone"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    This guest stays attached to this booking only. They do not get a normal portal account unless you convert them later.
                  </p>
                </div>
              ) : (
                <div className="relative space-y-1">
                  <input
                    type="text"
                    value={pilotSearch}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setPilotSearch(nextValue);
                      setShowPilotDropdown(true);
                      setFormData(prev => ({ ...prev, studentId: '' }));
                    }}
                    onFocus={() => {
                      setShowPilotDropdown(true);
                    }}
                    onBlur={() => {
                      window.setTimeout(() => {
                        setShowPilotDropdown(false);
                        if (formData.studentId && selectedPilot) {
                          setPilotSearch(getPilotSearchLabel(selectedPilot));
                        }
                      }, 120);
                    }}
                    className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required={isFieldRequired('pilot', userRole)}
                    placeholder="Type a name, email or phone"
                  />
                  {showPilotDropdown && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-44 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {filteredPilotOptions.length > 0 ? (
                        filteredPilotOptions.map(member => (
                          <button
                            key={member.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setPilotSearch(getPilotSearchLabel(member));
                              setShowPilotDropdown(false);
                              setFormData(prev => ({ ...prev, studentId: member.id }));
                            }}
                            className="block w-full px-2.5 py-2 text-left text-xs hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
                          >
                            <span className="block font-semibold text-gray-900">{member.name || 'Unnamed member'}</span>
                            <span className="block truncate text-gray-500">{member.email || member.phone || member.mobilePhone || 'No contact saved'}</span>
                          </button>
                        ))
                      ) : (
                        <p className="px-2.5 py-2 text-xs text-gray-500">No matching members.</p>
                      )}
                    </div>
                  )}
                  {pilotSearch && !formData.studentId && (
                    <p className="text-xs text-amber-700">
                      Select a member from the suggestions so the booking links to their profile.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {!isLoading && isFieldVisible('startDate', userRole) && (
          <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Start Date {isFieldRequired('startDate', userRole) && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldRequired('startDate', userRole)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Clock className="h-3.5 w-3.5 inline mr-1" />
                  Start Time {isFieldRequired('startTime', userRole) && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={formData.startTime}
                  onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                  className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldRequired('startTime', userRole)}
                >
                  <option value="">Select time</option>
                  {timeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {!isLoading && isFieldVisible('endDate', userRole) && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                End Date {isFieldRequired('endDate', userRole) && <span className="text-red-500">*</span>}
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('endDate', userRole)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                End Time {isFieldRequired('endTime', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.endTime}
                onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('endTime', userRole)}
              >
                <option value="">Select time</option>
                {timeOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
          )}

          {!isLoading && isFieldVisible('aircraft', userRole) && !isGroundSessionBooking && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <Plane className="h-3.5 w-3.5 inline mr-1" />
                Aircraft <span className="text-gray-400">(optional for ground sessions)</span>
              </label>
              <select
                value={formData.aircraftId}
                onChange={(e) => setFormData(prev => ({ ...prev, aircraftId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">No aircraft - ground session</option>
                {availableAircraft.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.registration} — {a.make} {a.model}
                  </option>
                ))}
              </select>
            </div>

            {shouldShowInstructorField && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Instructor {(isFieldRequired('instructor', userRole) || isStudentOnlyUser || Boolean(formData.trialFlightVoucherId)) ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}
              </label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('instructor', userRole) || isStudentOnlyUser || Boolean(formData.trialFlightVoucherId)}
              >
                <option value="">{(isStudentOnlyUser || formData.trialFlightVoucherId) ? 'Select instructor' : 'Solo flight'}</option>
                {instructors.map(instructor => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </option>
                ))}
              </select>
            </div>
            )}
          </div>
          )}

          {!isLoading && isGroundSessionBooking && shouldShowInstructorField && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Instructor <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select instructor</option>
                {instructors.map(instructor => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Ground sessions are scheduled against the instructor only. Booking type, payment method and description are chosen when the session is logged.
              </p>
            </div>
          )}

          {!isLoading && isFieldVisible('paymentType', userRole) && !formData.trialFlightVoucherId && !isGroundSessionBooking && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <CreditCard className="h-3.5 w-3.5 inline mr-1" />
              Flight Type {isFieldRequired('paymentType', userRole) && <span className="text-red-500">*</span>}
            </label>
            <select
              value={formData.flightTypeId}
              onChange={(e) => {
                const selectedFlightTypeId = e.target.value;
                setFormData(prev => ({
                  ...prev,
                  flightTypeId: selectedFlightTypeId,
                  paymentType: derivePaymentTypeForFlightType(selectedFlightTypeId),
                }));
              }}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={isFieldRequired('paymentType', userRole)}
            >
              <option value="">Select flight type</option>
              {availableFlightTypes.map(ft => (
                <option key={ft.id} value={ft.id}>{ft.name}</option>
              ))}
            </select>
          </div>
          )}

          {!isLoading && isFieldVisible('notes', userRole) && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notes {isFieldRequired('notes', userRole) && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => {
                setFormData(prev => ({ ...prev, notes: e.target.value }));
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden"
              rows={2}
              placeholder="Lesson details, special requirements, etc."
              required={isFieldRequired('notes', userRole)}
            />
          </div>
          )}

          </div>

          <div className="flex justify-end space-x-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-md transition-colors font-medium"
            >
              Cancel
            </button>
            {!isLoading && !isEdit && !formData.isGuestBooking && (
              <button
                type="button"
                onClick={openRecurrenceModal}
                title="Create repeated bookings using this booking as the template"
                aria-label="Recurring booking options"
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition-colors ${
                  recurrence.enabled
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Repeat2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? (isEdit ? 'Updating...' : recurrence.enabled ? 'Creating series...' : 'Creating...')
                : (isEdit ? 'Update Booking' : recurrence.enabled ? 'Create Series' : 'Create Booking')}
            </button>
          </div>
        </form>

        {showRecurrenceModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-950">Recurring booking</h3>
                  <p className="text-xs text-gray-500">{recurrenceSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRecurrenceModal(false)}
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 px-5 py-4">
                <section>
                  <h4 className="mb-2 text-sm font-bold text-gray-900">Repeats every</h4>
                  <div className="grid grid-cols-[110px_1fr] gap-3">
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={recurrence.interval}
                      onChange={(event) => setRecurrence(prev => ({
                        ...prev,
                        interval: Math.max(1, Math.min(12, Number(event.target.value) || 1)),
                      }))}
                      className="rounded-lg border border-gray-300 px-3 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={recurrence.frequency}
                      onChange={(event) => setRecurrence(prev => ({ ...prev, frequency: event.target.value as RecurrenceFrequency }))}
                      className="rounded-lg border border-gray-300 px-3 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="daily">day</option>
                      <option value="weekly">week</option>
                      <option value="monthly">month</option>
                    </select>
                  </div>
                </section>

                {recurrence.frequency === 'weekly' && (
                  <section>
                    <h4 className="mb-2 text-sm font-bold text-gray-900">Repeats on</h4>
                    <div className="flex flex-wrap gap-2">
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => {
                        const selected = recurrence.weekdays.includes(index);
                        return (
                          <button
                            key={`${label}-${index}`}
                            type="button"
                            onClick={() => setRecurrence(prev => {
                              const next = selected
                                ? prev.weekdays.filter(day => day !== index)
                                : [...prev.weekdays, index].sort((a, b) => a - b);
                              return { ...prev, weekdays: next.length > 0 ? next : [index] };
                            })}
                            className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-bold ${
                              selected
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section>
                  <h4 className="mb-2 text-sm font-bold text-gray-900">Ends</h4>
                  <div className="space-y-3">
                    {[
                      { value: 'never', label: 'Never' },
                      { value: 'on', label: 'On' },
                      { value: 'after', label: 'After' },
                    ].map(option => (
                      <label key={option.value} className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                        <input
                          type="radio"
                          name="recurrence-end-mode"
                          checked={recurrence.endMode === option.value}
                          onChange={() => setRecurrence(prev => ({ ...prev, endMode: option.value as RecurrenceEndMode }))}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="min-w-14 text-sm font-semibold text-gray-800">{option.label}</span>
                        {option.value === 'on' && (
                          <input
                            type="date"
                            value={recurrence.untilDate}
                            onChange={(event) => setRecurrence(prev => ({ ...prev, untilDate: event.target.value }))}
                            className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                          />
                        )}
                        {option.value === 'after' && (
                          <span className="flex flex-1 items-center gap-2">
                            <input
                              type="number"
                              min={2}
                              max={52}
                              value={recurrence.count}
                              onChange={(event) => setRecurrence(prev => ({
                                ...prev,
                                count: Math.max(2, Math.min(52, Number(event.target.value) || 2)),
                              }))}
                              className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                            />
                            <span className="text-sm text-gray-600">occurrences</span>
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setRecurrence(prev => ({ ...prev, enabled: false }));
                    setShowRecurrenceModal(false);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  No repeat
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecurrence(prev => ({ ...prev, enabled: true }));
                    setShowRecurrenceModal(false);
                  }}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    {safetyWarningState && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
          <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
            <div className="rounded-full bg-amber-100 p-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                {safetyWarningState.blocking ? 'Booking requires an instructor' : 'Safety acknowledgement required'}
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {safetyWarningState.pilotName} has safety or currency items that need attention before this booking.
              </p>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            <ul className="space-y-2">
              {safetyWarningState.concerns.map((concern) => (
                <li key={`${concern.type}-${concern.label}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-sm font-semibold text-amber-950">{concern.label}</p>
                  <p className="text-sm text-amber-900">{concern.message}</p>
                </li>
              ))}
            </ul>
            {safetyWarningState.concerns.some((concern) => concern.type === 'recency') && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                <p>{safetySettings.recencyWarningMessage}</p>
                <p className="mt-2 text-xs font-semibold text-blue-800">
                  Recorded solo/PIC hours in this system: {safetyWarningState.picHours.toFixed(1)}
                </p>
              </div>
            )}
            {safetyWarningState.blocking && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                BFR is lapsed. This person cannot book an aircraft without an instructor. Add an instructor to continue.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
            <button
              type="button"
              onClick={handleCloseSafetyWarning}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go back
            </button>
            {!safetyWarningState.blocking && (
              <button
                type="button"
                onClick={handleConfirmSafetyWarning}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                I acknowledge and continue
              </button>
            )}
          </div>
        </div>
      </div>
    )}
    {endorsementWarningState && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
          <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
            <div className="rounded-full bg-amber-100 p-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                Qualification needed before solo hire
              </h3>
              <p className="mt-1 text-sm text-gray-600">
                {endorsementWarningState.aircraftName} requires {endorsementWarningState.endorsementType} for solo hire.
              </p>
            </div>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm text-gray-700">
            <p>
              {endorsementWarningState.pilotName} does not appear to have the required licence or endorsement recorded in this CRM.
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
              Go back and choose a different aircraft or add an instructor. Existing licences must be verified and added by an instructor or administrator; endorsements can be submitted with supporting proof.
            </div>
            <p className="text-xs text-gray-500">
              {endorsementWarningState.needsStaffLicence ? 'Contact staff to have your licence verified and added.' : 'Endorsements can be added from Settings > Update My Info.'}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
            <button
              type="button"
              onClick={handleCloseEndorsementWarning}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Go back
            </button>
            {!endorsementWarningState.needsStaffLicence && <button
              type="button"
              onClick={handleOpenEndorsementSettings}
              className="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Add endorsement in settings
            </button>
            }
          </div>
        </div>
      </div>
    )}
    </>
  );
};

// Helper function for date formatting
function format(date: Date | number, formatStr: string): string {
  const d = new Date(date);

  if (formatStr === 'yyyy-MM-dd') {
    // Use local date parts to avoid UTC date-shift in non-UTC timezones
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (formatStr === 'HH:mm') {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  if (formatStr === 'EEEE, MMMM d, yyyy') {
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  if (formatStr === 'EEE') {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
  if (formatStr === 'd') {
    return d.getDate().toString();
  }
  if (formatStr === 'MMM d') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (formatStr === 'MMM d, yyyy') {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  
  return d.toLocaleDateString();
}

function normalizeToQuarterHour(time?: string): string {
  if (!time) return '';

  const [hourPart = '', minutePart = ''] = time.split(':');
  const hour = parseInt(hourPart, 10);
  const minute = parseInt(minutePart, 10);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return '';
  }

  const clampedHour = Math.min(Math.max(hour, 0), 23);
  const normalizedMinute = Math.floor(minute / 15) * 15;

  return `${clampedHour.toString().padStart(2, '0')}:${normalizedMinute
    .toString()
    .padStart(2, '0')}`;
}

function generateTimeOptions(startHour: number, endHour: number): string[] {
  const options: string[] = [];
  const normalizedStart = Math.max(0, Math.min(23, startHour));
  const normalizedEnd = Math.max(normalizedStart, Math.min(23, endHour));

  for (let hour = normalizedStart; hour < normalizedEnd; hour++) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const minute = quarter * 15;
      const time = `${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')}`;
      options.push(time);
    }
  }
  options.push(`${normalizedEnd.toString().padStart(2, '0')}:00`);

  return options;
}

export default BookingForm;
