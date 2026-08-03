import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  GraduationCap,
  Contact,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plane,
  Settings,
  ShieldCheck,
  User as UserIcon,
  Vote,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useStudentCourseEnrolments } from '../../hooks/useStudentCourseEnrolments';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { usePageLoadState } from '../../context/PageLoadContext';
import { useOwnMembershipSummary } from '../../hooks/useOwnMembershipSummary';
import { supabase } from '../../lib/supabase';
import {
  getDatedReadinessStatus,
  getMembershipIdentityLabel,
  getOverallReadiness,
  getProfileReadinessDestination,
  isSelfDeclaredMedical,
  requiresFlightReview,
  shouldShowMembershipAmountDue,
  type ProfileReadinessLevel,
  usesRaausCredentials,
} from '../../utils/profileReadiness';
import type { BrowserCalendarEvent } from '../../utils/calendar';
import { AddToCalendarModal } from '../Bookings/AddToCalendarModal';

interface ProfileStudentDetails {
  raausId?: string;
  casaId?: string;
  medicalType?: string;
  medicalExpiry?: Date;
  licenceExpiry?: Date;
  lastFlightReview?: Date;
  licences: Array<{
    type?: string;
    issuingAuthority?: string;
  }>;
  instructorCurrency?: {
    nextSpCheckDue?: Date;
    nextRenewalDue?: Date;
  };
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

interface ProfileAction {
  id: string;
  title: string;
  detail: string;
  to: string;
  level: 'warning' | 'action';
}

const formatCurrency = (amount: number, decimals: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

const formatHoursFromMinutes = (minutes: number) => (minutes / 60).toFixed(1);

const formatStoredDate = (value: string | null, pattern: string) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, pattern);
};

const levelStyles: Record<ProfileReadinessLevel, {
  panel: string;
  icon: string;
  badge: string;
  dot: string;
}> = {
  ready: {
    panel: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-100',
    dot: 'bg-emerald-500',
  },
  warning: {
    panel: 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100',
    dot: 'bg-amber-500',
  },
  action: {
    panel: 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20',
    icon: 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-200',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-100',
    dot: 'bg-red-500',
  },
};

const humaniseStatus = (value?: string | null) =>
  (value || 'not recorded')
    .replaceAll('_', ' ')
    .replace(/^./, character => character.toUpperCase());

export const ProfileDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const isInstructor = roles.includes('instructor') || roles.includes('senior_instructor');
  const isStudentOnly = roles.includes('student') && !roles.some(role =>
    ['pilot', 'instructor', 'senior_instructor'].includes(role)
  );
  const isFlyingMember = roles.some(role => ['student', 'pilot', 'instructor', 'senior_instructor'].includes(role));
  const operationalRole = isInstructor
    ? 'instructor'
    : roles.includes('pilot')
      ? 'pilot'
      : roles.includes('student')
        ? 'student'
        : user?.role;

  const { stats, loading } = useDashboardStats(user?.id, operationalRole, 'user');
  const { settings: portalSettings } = usePortalUxSettings();
  const { trainingRecords, loading: trainingRecordsLoading } = useTrainingRecords(user?.id);
  const { modules: trainingCourses, loading: trainingCoursesLoading } = useTrainingModules();
  const { enrolments: courseEnrolments, loading: courseEnrolmentsLoading } = useStudentCourseEnrolments(user?.id);
  const { summary: membership, loading: membershipLoading } = useOwnMembershipSummary(user?.id);
  const [studentDetails, setStudentDetails] = useState<ProfileStudentDetails | null>(null);
  const [studentDetailsLoading, setStudentDetailsLoading] = useState(true);
  const [showCalendarModal, setShowCalendarModal] = useState(false);

  const timePattern = portalSettings.time_format === '12h' ? 'h:mm a' : 'HH:mm';
  const datePattern = portalSettings.date_format || 'dd/MM/yyyy';
  const studentTrainingRecords = useMemo(
    () => trainingRecords.filter(record => record.studentId === user?.id),
    [trainingRecords, user?.id]
  );
  const activeCourseEnrolments = useMemo(
    () => courseEnrolments.filter(enrolment => enrolment.status === 'active'),
    [courseEnrolments]
  );

  const courseProgressSummaries = useMemo(() => activeCourseEnrolments
    .map(enrolment => {
      const course = trainingCourses.find(item => item.id === enrolment.courseId);
      if (!course) return null;

      const courseRecords = studentTrainingRecords.filter(record => record.courseId === course.id);
      const completedLessonIds = new Set(courseRecords.map(record => record.lessonId).filter(Boolean));
      const totalLessons = course.lessons.length;
      const percent = totalLessons > 0
        ? Math.min(100, Math.round((completedLessonIds.size / totalLessons) * 100))
        : 0;
      const latestRecord = [...courseRecords].sort((a, b) =>
        (b.bookingStartTime || b.date).getTime() - (a.bookingStartTime || a.date).getTime()
      )[0];
      const competentSequences = courseRecords.reduce(
        (sum, record) => sum + (record.sequences || []).filter(sequence => sequence.competence === 'C').length,
        0
      );

      return {
        course,
        completedLessons: completedLessonIds.size,
        totalLessons,
        percent,
        latestRecord,
        competentSequences,
        recentRecords: [...courseRecords]
          .sort((a, b) => (b.bookingStartTime || b.date).getTime() - (a.bookingStartTime || a.date).getTime())
          .slice(0, 3),
        isComplete: totalLessons > 0 && completedLessonIds.size >= totalLessons,
      };
    })
    .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))
    .filter(summary => !summary.isComplete), [activeCourseEnrolments, studentTrainingRecords, trainingCourses]);

  const currentCourseSummary = useMemo(() => [...courseProgressSummaries].sort((a, b) =>
    b.percent - a.percent ||
    b.completedLessons - a.completedLessons ||
    a.course.title.localeCompare(b.course.title)
  )[0] ?? null, [courseProgressSummaries]);

  const nextLessonLabel = useMemo(() => {
    if (!currentCourseSummary) return null;
    if (currentCourseSummary.latestRecord?.nextLesson?.trim()) {
      return currentCourseSummary.latestRecord.nextLesson.trim();
    }
    const currentIndex = currentCourseSummary.course.lessons.findIndex(
      lesson => lesson.id === currentCourseSummary.latestRecord?.lessonId
    );
    const nextLesson = currentIndex >= 0
      ? currentCourseSummary.course.lessons[currentIndex + 1]
      : currentCourseSummary.course.lessons[0];
    return nextLesson?.name || nextLesson?.sequenceTitle || null;
  }, [currentCourseSummary]);

  const totalDualMinutes = studentTrainingRecords.reduce(
    (sum, record) => sum + Number(record.dualTimeMin || 0),
    0
  );
  const totalSoloMinutes = studentTrainingRecords.reduce(
    (sum, record) => sum + Number(record.soloTimeMin || 0),
    0
  );
  const totalFlightMinutes = totalDualMinutes + totalSoloMinutes;
  const lastFlightDate = useMemo(() => [...studentTrainingRecords]
    .map(record => record.bookingStartTime || record.date)
    .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0], [studentTrainingRecords]);

  useEffect(() => {
    let mounted = true;
    const fetchStudentDetails = async () => {
      if (!user?.id) {
        setStudentDetailsLoading(false);
        return;
      }

      setStudentDetailsLoading(true);
      const studentQuery = supabase
        .from('students')
        .select('raaus_id, casa_id, medical_type, medical_expiry, licence_expiry, last_flight_review, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship')
        .eq('id', user.id)
        .maybeSingle();
      const licencesQuery = supabase
        .from('licences')
        .select('type, issuing_authority')
        .eq('student_id', user.id)
        .eq('is_active', true);
      const instructorCurrencyQuery = isInstructor
        ? supabase
            .from('instructor_compliance_records')
            .select('check_date, next_sp_check_due, next_renewal_due')
            .eq('candidate_instructor_id', user.id)
            .is('voided_at', null)
            .neq('status', 'voided')
            .order('check_date', { ascending: false })
        : Promise.resolve({ data: [], error: null });
      const [
        { data, error },
        { data: licenceRows, error: licencesError },
        { data: currencyRows, error: instructorCurrencyError },
      ] = await Promise.all([studentQuery, licencesQuery, instructorCurrencyQuery]);

      if (!mounted) return;
      if (error) {
        console.error('Failed to load profile student details:', error);
        setStudentDetails(null);
      } else {
        if (licencesError) console.error('Failed to load profile licences:', licencesError);
        if (instructorCurrencyError) console.error('Failed to load instructor currency:', instructorCurrencyError);
        const latestCurrency = currencyRows?.[0];
        const latestRenewal = currencyRows?.find(record => record.next_renewal_due);
        setStudentDetails(data ? {
          raausId: data.raaus_id,
          casaId: data.casa_id,
          medicalType: data.medical_type,
          medicalExpiry: data.medical_expiry ? new Date(data.medical_expiry) : undefined,
          licenceExpiry: data.licence_expiry ? new Date(data.licence_expiry) : undefined,
          lastFlightReview: data.last_flight_review ? new Date(data.last_flight_review) : undefined,
          licences: (licenceRows || []).map(licence => ({
            type: licence.type,
            issuingAuthority: licence.issuing_authority || undefined,
          })),
          instructorCurrency: isInstructor ? {
            nextSpCheckDue: latestCurrency?.next_sp_check_due
              ? new Date(latestCurrency.next_sp_check_due)
              : undefined,
            nextRenewalDue: latestRenewal?.next_renewal_due
              ? new Date(latestRenewal.next_renewal_due)
              : undefined,
          } : undefined,
          emergencyContact: data.emergency_contact_name ? {
            name: data.emergency_contact_name,
            phone: data.emergency_contact_phone || '',
            relationship: data.emergency_contact_relationship || '',
          } : user.emergencyContact,
        } : {
          licences: (licenceRows || []).map(licence => ({
            type: licence.type,
            issuingAuthority: licence.issuing_authority || undefined,
          })),
          instructorCurrency: isInstructor ? {
            nextSpCheckDue: latestCurrency?.next_sp_check_due
              ? new Date(latestCurrency.next_sp_check_due)
              : undefined,
            nextRenewalDue: latestRenewal?.next_renewal_due
              ? new Date(latestRenewal.next_renewal_due)
              : undefined,
          } : undefined,
          emergencyContact: user.emergencyContact,
        });
      }
      setStudentDetailsLoading(false);
    };

    void fetchStudentDetails();
    return () => {
      mounted = false;
    };
  }, [isInstructor, user?.emergencyContact, user?.id]);

  const pageLoading = loading ||
    trainingRecordsLoading ||
    trainingCoursesLoading ||
    courseEnrolmentsLoading ||
    studentDetailsLoading ||
    membershipLoading;

  usePageLoadState(
    pageLoading,
    'Loading your profile',
    'Checking your next booking, membership, readiness and recent flying...'
  );

  const missingProfileFields = useMemo(() => {
    if (!user) return [];
    const missing: string[] = [];
    if (!(user.mobilePhone || user.phone || user.homePhone)) missing.push('phone');
    if (!user.dateOfBirth) missing.push('date of birth');
    if (!user.address?.trim()) missing.push('address');
    if (!studentDetails?.emergencyContact?.name?.trim()) missing.push('emergency contact');
    return missing;
  }, [studentDetails?.emergencyContact?.name, user]);

  const raausStatus = useMemo(
    () => getDatedReadinessStatus(studentDetails?.licenceExpiry),
    [studentDetails?.licenceExpiry]
  );
  const usesRaaus = useMemo(() => usesRaausCredentials({
    raausId: studentDetails?.raausId,
    licences: studentDetails?.licences || [],
  }), [studentDetails?.licences, studentDetails?.raausId]);
  const hasSelfDeclaredMedical = isSelfDeclaredMedical(studentDetails?.medicalType);
  const hasRecordedMedical = Boolean(studentDetails?.medicalType || studentDetails?.medicalExpiry);
  const medicalStatus = useMemo(() => hasSelfDeclaredMedical
    ? { level: 'ready' as const, label: 'Self-declared', daysRemaining: null }
    : getDatedReadinessStatus(studentDetails?.medicalExpiry),
  [hasSelfDeclaredMedical, studentDetails?.medicalExpiry]);
  const needsFlightReview = requiresFlightReview(roles);
  const flightReviewDue = useMemo(() => studentDetails?.lastFlightReview
    ? new Date(
        studentDetails.lastFlightReview.getFullYear() + 2,
        studentDetails.lastFlightReview.getMonth(),
        studentDetails.lastFlightReview.getDate()
      )
    : undefined, [studentDetails?.lastFlightReview]);
  const flightReviewStatus = useMemo(
    () => getDatedReadinessStatus(flightReviewDue),
    [flightReviewDue]
  );
  const instructorSpStatus = useMemo(
    () => getDatedReadinessStatus(studentDetails?.instructorCurrency?.nextSpCheckDue, new Date(), 30),
    [studentDetails?.instructorCurrency?.nextSpCheckDue]
  );
  const instructorRenewalStatus = useMemo(
    () => getDatedReadinessStatus(studentDetails?.instructorCurrency?.nextRenewalDue, new Date(), 60),
    [studentDetails?.instructorCurrency?.nextRenewalDue]
  );
  const instructorCurrencyLevel: ProfileReadinessLevel = [instructorSpStatus.level, instructorRenewalStatus.level].includes('action')
    ? 'action'
    : [instructorSpStatus.level, instructorRenewalStatus.level].includes('warning')
      ? 'warning'
      : 'ready';
  const instructorCurrencyLabel = instructorCurrencyLevel === 'ready'
    ? 'Current'
    : instructorCurrencyLevel === 'action'
      ? 'Not current'
      : !studentDetails?.instructorCurrency?.nextSpCheckDue && !studentDetails?.instructorCurrency?.nextRenewalDue
        ? 'Not recorded'
        : !studentDetails?.instructorCurrency?.nextSpCheckDue || !studentDetails?.instructorCurrency?.nextRenewalDue
          ? 'Incomplete'
          : 'Due soon';

  const membershipNeedsXeroSetup = membership.xeroAvailable
    && !membership.xeroLinked
    && !membership.stripeAvailable;
  const membershipFinanceActive = membership.financeEnabled && !membershipNeedsXeroSetup;
  const membershipLevel: ProfileReadinessLevel = membership.legalStatus === 'current'
    ? !membership.financeEnabled
      ? 'ready'
      : membershipNeedsXeroSetup
        ? 'warning'
        : membership.financiallyCleared ? 'ready' : 'action'
    : membership.applicationStatus === 'pending' ? 'warning' : 'action';
  const profileLevel: ProfileReadinessLevel = missingProfileFields.length > 0 ? 'warning' : 'ready';
  const membershipBillingProblem = membershipFinanceActive && (
    ['failed', 'needs_review'].includes(membership.billingSyncStatus || '') ||
    membership.lastCollectionStatus === 'failed'
  );
  const membershipBillingPending = membershipFinanceActive &&
    ['queued', 'processing'].includes(membership.billingSyncStatus || '');
  const billingLevel: ProfileReadinessLevel = membershipBillingProblem
    ? 'action'
    : membershipNeedsXeroSetup
      ? 'warning'
      : membershipFinanceActive
      ? membershipBillingPending ? 'warning' : 'ready'
      : 'ready';

  const readinessItems = useMemo(() => [
    {
      id: 'club-membership',
      label: 'BFC membership',
      value: membership.legalStatus === 'current'
        ? !membership.financeEnabled
          ? 'Current'
          : membershipNeedsXeroSetup
            ? 'Current'
            : membership.financiallyCleared ? 'Active' : 'Payment required'
        : membership.applicationStatus === 'pending' ? 'Pending approval' : humaniseStatus(membership.legalStatus),
      level: membershipLevel,
      to: getProfileReadinessDestination('membership'),
    },
    ...(isFlyingMember ? [
      ...(usesRaaus ? [{
        id: 'raaus',
        label: 'RAAus membership',
        value: raausStatus.label,
        level: raausStatus.level,
        to: getProfileReadinessDestination('raaus'),
      }] : []),
      ...(hasRecordedMedical ? [{
        id: 'medical',
        label: 'Medical',
        value: medicalStatus.label,
        level: medicalStatus.level,
        to: getProfileReadinessDestination('medical'),
      }] : []),
      ...(needsFlightReview ? [{
        id: 'flight-review',
        label: 'Flight review',
        value: flightReviewStatus.label,
        level: flightReviewStatus.level,
        to: getProfileReadinessDestination('flight-review'),
      }] : []),
    ] : []),
    ...(membership.financeEnabled ? [{
      id: 'billing',
      label: 'Billing setup',
      value: membershipBillingProblem
        ? 'Payment needs attention'
        : membershipBillingPending
          ? 'Billing in progress'
          : membershipNeedsXeroSetup ? 'Admin setup needed' : 'Ready',
      level: billingLevel,
      to: membershipBillingProblem || membershipBillingPending
        ? getProfileReadinessDestination('membership')
        : getProfileReadinessDestination('billing'),
    }] : []),
    {
      id: 'profile',
      label: 'Profile details',
      value: missingProfileFields.length === 0 ? 'Complete' : `${missingProfileFields.length} missing`,
      level: profileLevel,
      to: getProfileReadinessDestination('profile', missingProfileFields),
    },
  ], [
    billingLevel,
    flightReviewStatus.label,
    flightReviewStatus.level,
    hasRecordedMedical,
    isFlyingMember,
    medicalStatus.label,
    medicalStatus.level,
    membership.applicationStatus,
    membership.financiallyCleared,
    membership.financeEnabled,
    membership.legalStatus,
    membershipBillingPending,
    membershipBillingProblem,
    membershipNeedsXeroSetup,
    membershipLevel,
    missingProfileFields,
    profileLevel,
    raausStatus.label,
    raausStatus.level,
    needsFlightReview,
    usesRaaus,
  ]);

  const overallReadiness = useMemo(
    () => getOverallReadiness(readinessItems.map(item => item.level)),
    [readinessItems]
  );

  const actionItems = useMemo(() => {
    const actions: ProfileAction[] = [];
    if (missingProfileFields.length > 0) {
      actions.push({
        id: 'complete-profile',
        title: 'Complete your profile',
        detail: `Add ${missingProfileFields.join(', ')}.`,
        to: getProfileReadinessDestination('profile', missingProfileFields),
        level: 'warning',
      });
    }
    if (membership.legalStatus !== 'current') {
      actions.push({
        id: 'membership-status',
        title: membership.applicationStatus === 'pending'
          ? 'Membership application pending'
          : 'Set up your BFC membership',
        detail: membership.applicationStatus === 'pending' && membership.automaticCommencementAt
          ? `Scheduled commencement ${formatStoredDate(membership.automaticCommencementAt, datePattern)} if not approved earlier.`
          : 'Open Membership to review or begin the process.',
        to: getProfileReadinessDestination('membership'),
        level: membership.applicationStatus === 'pending' ? 'warning' : 'action',
      });
    } else if (membershipFinanceActive && !membership.financiallyCleared) {
      actions.push({
        id: 'membership-payment',
        title: 'Membership payment required',
        detail: membership.graceExpiresAt
          ? `Legal membership continues until ${formatStoredDate(membership.graceExpiresAt, datePattern)}, but aircraft self-booking is unavailable.`
          : 'Pay or have the fee waived before using aircraft self-booking.',
        to: getProfileReadinessDestination('membership'),
        level: 'action',
      });
    }
    if (isFlyingMember && usesRaaus && raausStatus.level !== 'ready') {
      actions.push({
        id: 'raaus-status',
        title: raausStatus.level === 'action' ? 'RAAus membership has expired' : 'Check your RAAus membership',
        detail: studentDetails?.licenceExpiry
          ? `Recorded date: ${format(studentDetails.licenceExpiry, datePattern)}.`
          : 'No RAAus membership expiry is recorded.',
        to: getProfileReadinessDestination('raaus'),
        level: raausStatus.level === 'action' ? 'action' : 'warning',
      });
    }
    if (isFlyingMember && hasRecordedMedical && medicalStatus.level !== 'ready') {
      actions.push({
        id: 'medical-status',
        title: medicalStatus.level === 'action' ? 'Medical has expired' : 'Check your medical',
        detail: studentDetails?.medicalExpiry
          ? `Recorded date: ${format(studentDetails.medicalExpiry, datePattern)}.`
          : 'No medical expiry is recorded.',
        to: getProfileReadinessDestination('medical'),
        level: medicalStatus.level === 'action' ? 'action' : 'warning',
      });
    }
    if (isFlyingMember && needsFlightReview && flightReviewStatus.level !== 'ready') {
      actions.push({
        id: 'flight-review-status',
        title: flightReviewStatus.level === 'action' ? 'Flight review has expired' : 'Flight review due soon',
        detail: flightReviewDue
          ? `Recorded due date: ${format(flightReviewDue, datePattern)}.`
          : 'No completed flight review is recorded.',
        to: getProfileReadinessDestination('flight-review'),
        level: flightReviewStatus.level === 'action' ? 'action' : 'warning',
      });
    }
    if (membershipNeedsXeroSetup) {
      actions.push({
        id: 'xero-link',
        title: 'Billing account needs administrator setup',
        detail: 'No balance will be shown until your account is linked to a Xero contact.',
        to: getProfileReadinessDestination('billing'),
        level: 'warning',
      });
    }
    return actions;
  }, [
    datePattern,
    flightReviewDue,
    flightReviewStatus.level,
    hasRecordedMedical,
    isFlyingMember,
    medicalStatus.level,
    membership.applicationStatus,
    membership.automaticCommencementAt,
    membership.financiallyCleared,
    membershipFinanceActive,
    membership.graceExpiresAt,
    membership.legalStatus,
    membershipNeedsXeroSetup,
    missingProfileFields,
    raausStatus.level,
    studentDetails?.licenceExpiry,
    studentDetails?.medicalExpiry,
    needsFlightReview,
    usesRaaus,
  ]);

  const calendarEvent = useMemo<BrowserCalendarEvent | null>(() => {
    if (!stats.nextBooking) return null;
    const booking = stats.nextBooking;
    const status = booking.status === 'cancelled' || booking.status === 'no-show'
      ? 'CANCELLED'
      : booking.status.startsWith('pending_') ? 'TENTATIVE' : 'CONFIRMED';
    return {
      uid: `booking-${booking.id}@portal.bendigoflyingclub.com.au`,
      title: `BFC booking – ${booking.aircraftRegistration}`,
      description: [
        `Status: ${humaniseStatus(booking.status)}`,
        booking.instructorName ? `Instructor: ${booking.instructorName}` : '',
        booking.supervisorName ? `Supervising senior instructor: ${booking.supervisorName}` : '',
        'The BFC portal is the source of truth for this booking.',
      ].filter(Boolean).join('\n'),
      location: booking.location || 'Bendigo Flying Club',
      start: booking.startTime,
      end: booking.endTime,
      status,
    };
  }, [stats.nextBooking]);

  if (pageLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const readinessStyle = levelStyles[overallReadiness.level];
  const roleLabel = isInstructor
    ? roles.includes('senior_instructor') ? 'Senior instructor' : 'Instructor'
    : roles.includes('pilot') ? 'Pilot'
      : roles.includes('student') ? 'Student'
        : humaniseStatus(user?.role);
  const todayOtherBookings = stats.recentBookingsToday.filter(
    booking => booking.id !== stats.nextBooking?.id
  );

  return (
    <div className="min-h-full bg-transparent p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-5 text-white shadow-lg sm:p-6">
          {user?.coverPhoto && (
            <img src={user.coverPhoto} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-900/85 to-blue-950/70" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-blue-700 shadow-md sm:h-24 sm:w-24">
                {user?.avatar ? (
                  <img src={user.avatar} alt={`${user.name} profile`} className="h-full w-full object-cover object-top" />
                ) : (
                  <UserIcon className="h-10 w-10 text-white" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-bold sm:text-3xl">{user?.name}</h1>
                  <span className="rounded-full border border-blue-300/25 bg-blue-300/10 px-2.5 py-1 text-xs font-semibold text-blue-100">
                    {roleLabel}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-300">{user?.email}</p>
                <p className="mt-2 text-sm font-medium text-blue-100">
                  {getMembershipIdentityLabel({
                    legalStatus: membership.legalStatus,
                    membershipClassName: membership.membershipClassName,
                    hasVotingRights: membership.hasVotingRights,
                  })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-white/70"
              >
                <Calendar className="h-4 w-4" />
                Booking calendar
              </button>
              <button
                type="button"
                onClick={() => navigate('/settings?tab=account-info')}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/70"
              >
                <Pencil className="h-4 w-4" />
                Edit profile
              </button>
            </div>
          </div>
          <div className="relative mt-5 grid gap-2 sm:grid-cols-2 lg:max-w-xl">
            <button
              type="button"
              onClick={() => navigate('/my-logbook')}
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left backdrop-blur-sm hover:bg-black/30"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-slate-300">Logged flying</span>
              <span className="mt-1 block text-xl font-bold">{stats.myFlightHours.toFixed(portalSettings.flight_time_decimals)} hours</span>
            </button>
            {stats.myCreditVisible ? (
              <button
                type="button"
                onClick={() => navigate('/billing')}
                className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left backdrop-blur-sm hover:bg-black/30"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-slate-300">Xero account position</span>
                <span className="mt-1 block text-xl font-bold">{formatCurrency(stats.myPrepaidBalance, portalSettings.currency_decimals)}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/billing')}
                className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left backdrop-blur-sm hover:bg-black/30"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-slate-300">Billing</span>
                <span className="mt-1 block text-sm font-semibold">Account setup required</span>
              </button>
            )}
          </div>
        </section>

        {actionItems.length > 0 && (
        <section className={`rounded-2xl border p-5 shadow-sm ${readinessStyle.panel}`} aria-labelledby="readiness-title">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${readinessStyle.icon}`}>
                {overallReadiness.level === 'ready'
                  ? <CheckCircle2 className="h-5 w-5" />
                  : <AlertTriangle className="h-5 w-5" />}
              </span>
              <div>
                <h2 id="readiness-title" className="text-lg font-bold text-slate-950 dark:text-white">{overallReadiness.title}</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{overallReadiness.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/calendar')}
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
            >
              Check booking eligibility
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {readinessItems.map(item => (
              <Link
                key={item.id}
                to={item.to}
                className="rounded-xl border border-white/70 bg-white/75 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-slate-950/35"
              >
                <span className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <span className={`h-2 w-2 rounded-full ${levelStyles[item.level].dot}`} />
                  {item.label}
                </span>
                <span className="mt-1.5 block text-sm font-bold text-slate-900 dark:text-white">{item.value}</span>
              </Link>
            ))}
          </div>
          <div className="mt-5 overflow-hidden rounded-xl border border-white/80 bg-white/80 shadow-sm dark:border-white/10 dark:bg-slate-950/35" aria-label="Actions to complete">
            <p className="border-b border-slate-200/80 px-4 py-3 text-sm font-bold text-slate-900 dark:border-slate-700 dark:text-white">
              What to do next
            </p>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {actionItems.map(action => (
                <Link
                  key={action.id}
                  to={action.to}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white dark:hover:bg-slate-800/60"
                >
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    action.level === 'action'
                      ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  }`}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white">{action.title}</span>
                    <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{action.detail}</span>
                  </span>
                  <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
                </Link>
              ))}
            </div>
          </div>
        </section>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.75fr)]">
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-labelledby="next-booking-title">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <Plane className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 id="next-booking-title" className="font-bold text-slate-950 dark:text-white">Next booking</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your next scheduled club activity.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/calendar')}
                  className="text-sm font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-300"
                >
                  Calendar
                </button>
              </div>
              {stats.nextBooking ? (
                <div>
                  <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-2xl font-bold text-slate-950 dark:text-white">
                          {format(stats.nextBooking.startTime, datePattern)}
                        </p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          stats.nextBooking.status.startsWith('pending_')
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                        }`}>
                          {humaniseStatus(stats.nextBooking.status)}
                        </span>
                      </div>
                      <p className="mt-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
                        {format(stats.nextBooking.startTime, timePattern)}–{format(stats.nextBooking.endTime, timePattern)}
                        {' · '}{stats.nextBooking.aircraftRegistration}
                      </p>
                      <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                        {stats.nextBooking.location && (
                          <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" />{stats.nextBooking.location}</p>
                        )}
                        {stats.nextBooking.instructorName && (
                          <p>Instructor/student: <span className="font-semibold">{stats.nextBooking.instructorName}</span></p>
                        )}
                        {stats.nextBooking.supervisorName && (
                          <p className="text-xs">Supervising senior instructor: {stats.nextBooking.supervisorName}</p>
                        )}
                        {isStudentOnly && nextLessonLabel && (
                          <p className="font-semibold text-blue-700 dark:text-blue-300">Next lesson: {nextLessonLabel}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:flex-col">
                      <button
                        type="button"
                        onClick={() => navigate(`/calendar?date=${format(stats.nextBooking!.startTime, 'yyyy-MM-dd')}`)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        View booking
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      {calendarEvent && (
                        <button
                          type="button"
                          onClick={() => setShowCalendarModal(true)}
                          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800"
                        >
                          <CalendarPlus className="h-4 w-4" />
                          Add to calendar
                        </button>
                      )}
                    </div>
                  </div>
                  {todayOtherBookings.length > 0 && (
                    <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/40">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Also today</p>
                      <div className="mt-2 space-y-2">
                        {todayOtherBookings.slice(0, 3).map(booking => (
                          <div key={booking.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                              {format(booking.startTime, timePattern)}–{format(booking.endTime, timePattern)}
                            </span>
                            <span className="truncate text-slate-500 dark:text-slate-400">{booking.aircraftRegistration}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center">
                  <Calendar className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
                  <p className="mt-3 font-semibold text-slate-800 dark:text-slate-100">No upcoming booking</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Open the calendar when you are ready to plan your next flight.</p>
                  <button
                    type="button"
                    onClick={() => navigate('/calendar')}
                    className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Open booking calendar
                  </button>
                </div>
              )}
            </section>

            {isStudentOnly && currentCourseSummary && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-violet-100 p-2 text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      <GraduationCap className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="font-bold text-slate-950 dark:text-white">Training progress</h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{currentCourseSummary.course.title}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/pilot-file')}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 dark:text-blue-300"
                  >
                    Pilot file <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {currentCourseSummary.completedLessons}/{currentCourseSummary.totalLessons || '-'} lessons
                  </span>
                  <span className="font-bold text-violet-700 dark:text-violet-300">{currentCourseSummary.percent}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-violet-600" style={{ width: `${currentCourseSummary.percent}%` }} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/30">
                    <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">Next lesson</p>
                    <p className="mt-1 font-bold text-violet-950 dark:text-violet-100">{nextLessonLabel || 'Ask your instructor'}</p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/30">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Competent sequences</p>
                    <p className="mt-1 text-xl font-bold text-emerald-950 dark:text-emerald-100">{currentCourseSummary.competentSequences}</p>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-sky-100 p-2 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-bold text-slate-950 dark:text-white">Recent flying</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Your recorded experience at a glance.</p>
                  </div>
                </div>
                <button type="button" onClick={() => navigate('/my-logbook')} className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                  Logbook
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ['Total', formatHoursFromMinutes(totalFlightMinutes)],
                  ['Dual', formatHoursFromMinutes(totalDualMinutes)],
                  ['Solo', formatHoursFromMinutes(totalSoloMinutes)],
                  ['Records', String(studentTrainingRecords.length)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Last flight: <span className="font-semibold text-slate-800 dark:text-slate-100">{lastFlightDate ? format(lastFlightDate, datePattern) : 'No flight recorded'}</span>
              </p>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <Contact className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-bold text-slate-950 dark:text-white">BFC membership</h2>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {membership.membershipClassName || (membership.legalStatus === 'current' ? 'Current membership' : 'Not established')}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${levelStyles[membershipLevel].badge}`}>
                  {membership.legalStatus === 'current'
                    ? !membership.financeEnabled || membershipNeedsXeroSetup
                      ? 'Current'
                      : membership.financiallyCleared ? 'Active' : 'Payment due'
                    : humaniseStatus(membership.applicationStatus || membership.legalStatus)}
                </span>
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                {membershipFinanceActive ? <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Financial year ends</dt>
                    <dd className="text-right font-semibold text-slate-900 dark:text-white">{formatStoredDate(membership.financialYearEnd, datePattern)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Financial status</dt>
                    <dd className="text-right font-semibold text-slate-900 dark:text-white">{humaniseStatus(membership.feeDisposition)}</dd>
                  </div>
                  {shouldShowMembershipAmountDue(membership) && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500 dark:text-slate-400">Amount due</dt>
                      <dd className="text-right font-semibold text-amber-700 dark:text-amber-300">{formatCurrency(membership.amountDue, portalSettings.currency_decimals)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500 dark:text-slate-400">Renewal</dt>
                    <dd className="text-right font-semibold text-slate-900 dark:text-white">
                      {membership.autoRenew ? 'Automatic' : membership.paymentMethod ? 'Manual' : 'Not selected'}
                    </dd>
                  </div>
                </> : membershipNeedsXeroSetup ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
                    Financial information is hidden until an administrator links this account to Xero.
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200">
                    Financial features are disabled because Stripe and Xero are disconnected.
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Vote className="h-3.5 w-3.5" />Voting</dt>
                  <dd className="text-right font-semibold text-slate-900 dark:text-white">
                    {membership.hasVotingRights === null ? 'Not available' : membership.hasVotingRights ? 'Eligible' : 'Not eligible'}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => navigate('/membership')}
                className="mt-5 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800"
              >
                Manage membership
                <ChevronRight className="h-4 w-4" />
              </button>
            </section>

            <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
                <span className="flex items-center gap-3">
                  <span className="rounded-xl bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    <UserIcon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-bold text-slate-950 dark:text-white">Personal details</span>
                    <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">Contact and emergency information</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" />
              </summary>
              <div className="space-y-3 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-800">
                <p className="flex gap-2 text-slate-600 dark:text-slate-300"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span className="break-all">{user?.email || 'Not recorded'}</span></p>
                <p className="flex gap-2 text-slate-600 dark:text-slate-300"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{user?.mobilePhone || user?.phone || user?.homePhone || 'Not recorded'}</p>
                {user?.address && <p className="rounded-xl bg-slate-50 p-3 text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">{user.address}</p>}
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Emergency contact</p>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{studentDetails?.emergencyContact?.name || 'Not recorded'}</p>
                  {studentDetails?.emergencyContact?.phone && <p className="text-slate-600 dark:text-slate-300">{studentDetails.emergencyContact.phone}</p>}
                </div>
                <button type="button" onClick={() => navigate(getProfileReadinessDestination('profile'))} className="font-semibold text-blue-700 dark:text-blue-300">Update personal details</button>
              </div>
            </details>

            {isFlyingMember && (
              <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5">
                  <span className="flex items-center gap-3">
                    <span className="rounded-xl bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block font-bold text-slate-950 dark:text-white">Aviation credentials</span>
                      <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">Identifiers and recorded dates</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-400 transition group-open:rotate-90" />
                </summary>
                <div className="space-y-3 border-t border-slate-100 px-5 py-4 text-sm dark:border-slate-800">
                  {usesRaaus && (
                    <>
                      <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">RAAus number</span><span className="text-right font-semibold text-slate-900 dark:text-white">{studentDetails?.raausId || 'Not recorded'}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">RAAus expiry</span><span className="text-right font-semibold text-slate-900 dark:text-white">{studentDetails?.licenceExpiry ? format(studentDetails.licenceExpiry, datePattern) : 'Not recorded'}</span></div>
                    </>
                  )}
                  {studentDetails?.casaId && (
                    <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">CASA ARN</span><span className="text-right font-semibold text-slate-900 dark:text-white">{studentDetails.casaId}</span></div>
                  )}
                  {hasRecordedMedical && (
                    <div className="flex justify-between gap-3"><span className="text-slate-500 dark:text-slate-400">Medical</span><span className="text-right font-semibold text-slate-900 dark:text-white">{studentDetails?.medicalType || 'Expiry recorded'}</span></div>
                  )}
                  {isInstructor && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500 dark:text-slate-400">Instructor currency</span>
                        <span className={`rounded-full px-2.5 py-1 text-right text-xs font-bold ${levelStyles[instructorCurrencyLevel].badge}`}>
                          {instructorCurrencyLabel}
                        </span>
                      </div>
                      <p className="text-right text-xs text-slate-500 dark:text-slate-400">
                        S&amp;P {studentDetails?.instructorCurrency?.nextSpCheckDue
                          ? `due ${format(studentDetails.instructorCurrency.nextSpCheckDue, datePattern)}`
                          : 'not recorded'}
                        {' · '}
                        rating renewal {studentDetails?.instructorCurrency?.nextRenewalDue
                          ? `due ${format(studentDetails.instructorCurrency.nextRenewalDue, datePattern)}`
                          : 'not recorded'}
                      </p>
                    </>
                  )}
                  <button type="button" onClick={() => navigate(getProfileReadinessDestination('medical'))} className="font-semibold text-blue-700 dark:text-blue-300">Update credentials</button>
                </div>
              </details>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <Settings className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-bold text-slate-950 dark:text-white">Quick settings</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Personalise how the portal works for you.</p>
                </div>
              </div>
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                {[
                  ['Calendar subscriptions', '/settings?tab=account-calendar', Calendar],
                  ['Notifications', '/settings?tab=account-notifications', AlertTriangle],
                  ['Appearance and PWA', '/settings?tab=account-appearance', Settings],
                  ['Balance and payment card', '/billing', CreditCard],
                ].map(([label, to, Icon]) => {
                  const ItemIcon = Icon as typeof Calendar;
                  return (
                    <button
                      key={label as string}
                      type="button"
                      onClick={() => navigate(to as string)}
                      className="flex w-full items-center gap-3 py-3 text-left text-sm font-semibold text-slate-700 hover:text-blue-700 dark:text-slate-200 dark:hover:text-blue-300"
                    >
                      <ItemIcon className="h-4 w-4 text-slate-400" />
                      <span className="flex-1">{label as string}</span>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>
        </div>
      </div>

      {showCalendarModal && calendarEvent && (
        <AddToCalendarModal event={calendarEvent} onClose={() => setShowCalendarModal(false)} />
      )}
    </div>
  );
};
