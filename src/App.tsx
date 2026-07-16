import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { RouteGuard } from './components/Layout/RouteGuard';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TrainingModulesProvider } from './context/TrainingModulesContext';
import { PageLoadGate } from './context/PageLoadContext';
import { useBookings } from './hooks/useBookings';
import { Booking } from './types';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { AppErrorBoundary } from './components/Layout/AppErrorBoundary';
import { PortalSectionLoader } from './components/Layout/PortalSectionLoader';
import { LoginForm } from './components/Auth/LoginForm';
import { format, addDays, addWeeks, addMonths } from 'date-fns';
import { usePortalUxSettings, useUserPreferences } from './hooks/useSettings';
import { applyPortalTheme, getStoredPortalTheme, storePortalTheme } from './utils/theme';
import { KioskLoginForm } from './components/Kiosk/KioskLoginForm';
import { KioskCalendarShell } from './components/Kiosk/KioskCalendarShell';
import { supabase } from './lib/supabase';
import { Plane } from 'lucide-react';

const ResetPasswordPage = lazy(() => import('./components/Auth/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
const BookingForm = lazy(() => import('./components/Bookings/BookingForm'));
const ProfileDashboard = lazy(() => import('./components/Profile/ProfileDashboard').then(module => ({ default: module.ProfileDashboard })));
const Calendar = lazy(() => import('./components/Calendar/Calendar').then(module => ({ default: module.Calendar })));
const StudentList = lazy(() => import('./components/Students/StudentList').then(module => ({ default: module.StudentList })));
const StudentProfilePage = lazy(() => import('./components/Students/StudentProfilePage').then(module => ({ default: module.StudentProfilePage })));
const MyLogbookPage = lazy(() => import('./components/Students/MyLogbookPage').then(module => ({ default: module.MyLogbookPage })));
const AircraftList = lazy(() => import('./components/Aircraft/AircraftList').then(module => ({ default: module.AircraftList })));
const AircraftFlightLogs = lazy(() => import('./components/Aircraft/AircraftFlightLogs').then(module => ({ default: module.AircraftFlightLogs })));
const AircraftProfilePage = lazy(() => import('./components/Aircraft/AircraftProfilePage').then(module => ({ default: module.AircraftProfilePage })));
const MaintenanceBoard = lazy(() => import('./components/Maintenance/MaintenanceBoard').then(module => ({ default: module.MaintenanceBoard })));
const BillingDashboard = lazy(() => import('./components/Billing/BillingDashboard').then(module => ({ default: module.BillingDashboard })));
const ReportsDashboard = lazy(() => import('./components/Reports/ReportsDashboard').then(module => ({ default: module.ReportsDashboard })));
const SafetyDashboard = lazy(() => import('./components/Safety/SafetyDashboard').then(module => ({ default: module.SafetyDashboard })));
const SafetyLoginWarningModal = lazy(() => import('./components/Safety/SafetyLoginWarningModal').then(module => ({ default: module.SafetyLoginWarningModal })));
const TrainingRecordForm = lazy(() => import('./components/Training/TrainingRecordForm').then(module => ({ default: module.TrainingRecordForm })));
const TrainingCourseCatalog = lazy(() => import('./components/Training/TrainingCourseCatalog').then(module => ({ default: module.TrainingCourseCatalog })));
const TrainingModuleBuilder = lazy(() => import('./components/Training/TrainingModuleBuilder').then(module => ({ default: module.TrainingModuleBuilder })));
const OutstandingRecordsTab = lazy(() => import('./components/Training/OutstandingRecordsTab').then(module => ({ default: module.OutstandingRecordsTab })));
const LearningCentreDashboard = lazy(() => import('./components/LearningCentre/LearningCentreDashboard').then(module => ({ default: module.LearningCentreDashboard })));
const StudentAcknowledgementModal = lazy(() => import('./components/Training/StudentAcknowledgementModal').then(module => ({ default: module.StudentAcknowledgementModal })));
const DeclarationSigningPage = lazy(() => import('./components/Training/DeclarationSigningPage').then(module => ({ default: module.DeclarationSigningPage })));
const SettingsDashboard = lazy(() => import('./components/Settings/SettingsDashboard').then(module => ({ default: module.SettingsDashboard })));
const TrialFlightVouchersPage = lazy(() => import('./components/Vouchers/TrialFlightVouchersPage').then(module => ({ default: module.TrialFlightVouchersPage })));
const TrialVoucherRedeemPage = lazy(() => import('./components/Vouchers/TrialVoucherRedeemPage').then(module => ({ default: module.TrialVoucherRedeemPage })));
const TrialVoucherSalesPage = lazy(() => import('./components/Vouchers/TrialVoucherSalesPage').then(module => ({ default: module.TrialVoucherSalesPage })));
const KIOSK_SESSION_KEY = 'bfc_kiosk_mode';

const buildCopiedBookingFormData = (booking: Booking) => ({
  bookingKind: booking.bookingKind || 'flight',
  date: format(new Date(booking.startTime), 'yyyy-MM-dd'),
  endDate: format(new Date(booking.endTime), 'yyyy-MM-dd'),
  startTime: format(new Date(booking.startTime), 'HH:mm'),
  endTime: format(new Date(booking.endTime), 'HH:mm'),
  studentId: booking.studentId || '',
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
  copiedFromBookingId: booking.id,
});

const getRecurringDateOffset = (date: Date, frequency: string, index: number, interval = 1) => {
  const step = Math.max(1, interval);
  if (frequency === 'daily') return addDays(date, index * step);
  if (frequency === 'monthly') return addMonths(date, index * step);
  return addWeeks(date, index * step);
};

const buildRecurringStartTimes = (startTime: Date, recurrence: any) => {
  if (!recurrence?.enabled) return [startTime];

  const maxOccurrences = 52;
  const requestedCount = recurrence.endMode === 'never'
    ? maxOccurrences
    : recurrence.endMode === 'on'
    ? maxOccurrences
    : Math.max(1, Math.min(Number(recurrence.count) || 1, maxOccurrences));
  const untilDate = recurrence.endMode === 'on' && recurrence.untilDate
    ? new Date(`${recurrence.untilDate}T23:59:59`)
    : null;
  const frequency = recurrence.frequency || 'weekly';
  const interval = Math.max(1, Number(recurrence.interval) || 1);

  if (frequency !== 'weekly') {
    const dates: Date[] = [];
    for (let index = 0; index < requestedCount; index += 1) {
      const candidate = getRecurringDateOffset(startTime, frequency, index, interval);
      if (untilDate && candidate > untilDate) break;
      dates.push(candidate);
    }
    return dates.length > 0 ? dates : [startTime];
  }

  const selectedWeekdays = Array.isArray(recurrence.weekdays) && recurrence.weekdays.length > 0
    ? [...recurrence.weekdays].map(Number).filter(day => day >= 0 && day <= 6)
    : [startTime.getDay()];
  const startWeekAnchor = addDays(startTime, -startTime.getDay());
  const dates: Date[] = [];

  for (let weekIndex = 0; dates.length < requestedCount && weekIndex < maxOccurrences * interval; weekIndex += interval) {
    for (const weekday of selectedWeekdays) {
      const candidate = addDays(startWeekAnchor, weekIndex * 7 + weekday);
      candidate.setHours(startTime.getHours(), startTime.getMinutes(), startTime.getSeconds(), startTime.getMilliseconds());
      if (candidate < startTime) continue;
      if (untilDate && candidate > untilDate) return dates.length > 0 ? dates : [startTime];
      dates.push(new Date(candidate));
      if (dates.length >= requestedCount) break;
    }
  }

  return dates.length > 0 ? dates : [startTime];
};

const PortalBootScreen = ({
  message = 'Preparing your flight desk',
  detail = 'Loading schedule, members and records...',
}: {
  message?: string;
  detail?: string;
}) => (
  <div className="portal-boot-screen fixed inset-0 z-[9999] flex min-h-screen items-center justify-center overflow-hidden bg-[#07111f] px-6 text-white">
    <div className="portal-boot-sky" />
    <div className="portal-boot-cloud portal-boot-cloud-a" />
    <div className="portal-boot-cloud portal-boot-cloud-b" />
    <div className="portal-boot-cloud portal-boot-cloud-c" />
    <div className="relative z-10 w-full max-w-md text-center">
      <div className="portal-boot-orbit mx-auto mb-7 flex h-28 w-28 items-center justify-center rounded-full border border-white/15 bg-white/10 shadow-2xl shadow-blue-950/60 backdrop-blur">
        <div className="portal-boot-runway" />
        <img src="/favicon.svg" alt="" className="relative z-10 h-16 w-16 drop-shadow-xl" />
        <Plane className="portal-boot-plane absolute h-6 w-6 text-white" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blue-200/90">Bendigo Flying Club</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Members Flight Management System</h1>
      <p className="mt-3 text-sm leading-6 text-blue-100/80">{message}</p>
      <div className="mx-auto mt-7 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/10">
        <div className="portal-boot-progress h-full rounded-full bg-gradient-to-r from-sky-300 via-white to-amber-200" />
      </div>
      <p className="mt-3 text-xs text-blue-100/60">{detail}</p>
    </div>
  </div>
);

const PageLoader = () => <PortalSectionLoader />;

const OverdueTrainingRecordsLoginAlert = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    const roles = user.roles?.length ? user.roles : [user.role];
    const isInstructor = roles.some((role) => ['admin', 'senior_instructor', 'instructor'].includes(role));
    if (!isInstructor) return;

    const todayKey = new Date().toISOString().slice(0, 10);
    const storageKey = `bfc_overdue_training_records_alert:${user.id}:${todayKey}`;
    if (localStorage.getItem(storageKey)) return;

    let cancelled = false;

    const loadOutstandingCount = async () => {
      const { data: logs, error } = await supabase
        .from('flight_logs')
        .select('id, booking_id, start_time')
        .eq('instructor_id', user.id)
        .eq('training_record_status', 'pending')
        .lt('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(100);

      if (error || cancelled || !logs?.length) return;

      const logIds = logs.map((log) => log.id).filter(Boolean);
      const bookingIds = logs.map((log) => log.booking_id).filter(Boolean);
      const { data: linkedRecords } =
        logIds.length > 0 || bookingIds.length > 0
          ? await supabase
              .from('training_records')
              .select('flight_log_id, booking_id')
              .or([
                logIds.length > 0 ? `flight_log_id.in.(${logIds.join(',')})` : '',
                bookingIds.length > 0 ? `booking_id.in.(${bookingIds.join(',')})` : '',
              ].filter(Boolean).join(','))
          : { data: [] };

      if (cancelled) return;
      const recordedFlightLogIds = new Set((linkedRecords ?? []).map((record: any) => record.flight_log_id).filter(Boolean));
      const recordedBookingIds = new Set((linkedRecords ?? []).map((record: any) => record.booking_id).filter(Boolean));
      const outstanding = logs.filter((log: any) =>
        !recordedFlightLogIds.has(log.id) &&
        !(log.booking_id && recordedBookingIds.has(log.booking_id))
      );

      if (outstanding.length === 0) return;
      localStorage.setItem(storageKey, 'shown');
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const olderThanSevenDays = outstanding.filter((log: any) => new Date(log.start_time).getTime() < sevenDaysAgo).length;
      toast.custom((toastInstance) => (
        <div className="max-w-sm rounded-xl border border-amber-200 bg-white p-4 shadow-xl">
          <p className="text-sm font-semibold text-gray-900">Outstanding training records</p>
          <p className="mt-1 text-sm text-gray-600">
            You have {outstanding.length} training {outstanding.length === 1 ? 'record' : 'records'} waiting to be submitted.
            {olderThanSevenDays > 0 ? ` ${olderThanSevenDays} are over 7 days old.` : ''}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => toast.dismiss(toastInstance.id)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(toastInstance.id);
                navigate('/training/outstanding-records');
              }}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Open records
            </button>
          </div>
        </div>
      ), { duration: 12000 });
    };

    void loadOutstandingCount();

    return () => {
      cancelled = true;
    };
  }, [navigate, user]);

  return null;
};

const AppNotifications = () => {
  const location = useLocation();
  const isKioskRoute = location.pathname.startsWith('/kiosk');

  if (isKioskRoute) {
    return null;
  }

  return (
    <>
      <OverdueTrainingRecordsLoginAlert />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#fff',
            color: '#374151',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          },
        }}
      />
    </>
  );
};

const AppShell = ({
  activeSidebarView,
  children,
  onViewChange,
  backgroundColor,
  mainClassName = 'min-w-0 flex-1 overflow-x-hidden lg:ml-0 ml-0',
}: {
  activeSidebarView: string;
  children: React.ReactNode;
  onViewChange: (view: string) => void;
  backgroundColor: string;
  mainClassName?: string;
}) => (
  <div className="portal-app-shell relative min-h-screen bg-gray-50 dark:bg-[#0f1117]" style={{ backgroundColor }}>
    <div className="relative z-10 min-h-screen">
      <Header />
      <div className="flex items-start lg:ml-0 ml-0">
        <Sidebar activeView={activeSidebarView} onViewChange={onViewChange} />
        <main className={`${mainClassName} relative`}>
          <PageLoadGate routeKey={activeSidebarView}>
            <Suspense fallback={<PageLoader />}>
              {children}
            </Suspense>
          </PageLoadGate>
        </main>
      </div>
      <Suspense fallback={null}>
        <SafetyLoginWarningModal />
      </Suspense>
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [showTrainingRecordForm, setShowTrainingRecordForm] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [selectedBookingForRecord, setSelectedBookingForRecord] = useState<Booking | null>(null);
  const [bookingFormData, setBookingFormData] = useState<{
    date?: string;
    startTime?: string;
    endTime?: string;
  }>({});
  const isPasswordRecovery =
    location.pathname === '/reset-password' ||
    new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'recovery' ||
    new URLSearchParams(location.search).get('type') === 'recovery' ||
    new URLSearchParams(location.hash.replace(/^#/, '')).get('type') === 'invite' ||
    new URLSearchParams(location.search).get('type') === 'invite';
  const normalisedPathname = location.pathname.replace(/\/+$/, '') || '/';
  const isKioskRoute = location.pathname.startsWith('/kiosk');

  if (normalisedPathname === '/declaration-sign') {
    return (
      <PageLoadGate routeKey="declaration-sign">
        <Suspense fallback={<PageLoader />}>
          <DeclarationSigningPage />
        </Suspense>
      </PageLoadGate>
    );
  }

  if (isPasswordRecovery) {
    return (
      <PageLoadGate routeKey="reset-password">
        <Suspense fallback={<PageLoader />}>
          <ResetPasswordPage />
        </Suspense>
      </PageLoadGate>
    );
  }

  if (normalisedPathname === '/trial-flight-voucher') {
    return (
      <PageLoadGate routeKey="trial-flight-voucher">
        <Suspense fallback={<PageLoader />}>
          <TrialVoucherRedeemPage />
        </Suspense>
      </PageLoadGate>
    );
  }

  if (normalisedPathname === '/trial-flight-gift-vouchers') {
    if (!isLoading && user?.portalAccessScope === 'trial_voucher') {
      return <Navigate to="/trial-flight-voucher" replace />;
    }

    return (
      <PageLoadGate routeKey="trial-flight-gift-vouchers">
        <Suspense fallback={<PageLoader />}>
          <TrialVoucherSalesPage />
        </Suspense>
      </PageLoadGate>
    );
  }

  if (isLoading) {
    return <PortalBootScreen message="Checking your secure session" detail="Connecting to Bendigo Flying Club..." />;
  }

  if (user?.portalAccessScope === 'trial_voucher' && normalisedPathname !== '/trial-flight-voucher') {
    return <Navigate to={`/trial-flight-voucher${location.search || ''}`} replace />;
  }

  if (isKioskRoute) {
    return (
      <AppErrorBoundary key="kiosk">
        <KioskRoute
          user={user}
          showBookingForm={showBookingForm}
          setShowBookingForm={setShowBookingForm}
          editingBooking={editingBooking}
          setEditingBooking={setEditingBooking}
          bookingFormData={bookingFormData}
          setBookingFormData={setBookingFormData}
        />
      </AppErrorBoundary>
    );
  }

  if (user && localStorage.getItem(KIOSK_SESSION_KEY) === 'true') {
    const userRoles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
    if (userRoles.includes('admin')) {
      return <Navigate to="/kiosk" replace />;
    }
    localStorage.removeItem(KIOSK_SESSION_KEY);
  }

  if (!user) {
    return <LoginForm />;
  }

  return <AuthenticatedApp
    user={user}
    showBookingForm={showBookingForm}
    setShowBookingForm={setShowBookingForm}
    showTrainingRecordForm={showTrainingRecordForm}
    setShowTrainingRecordForm={setShowTrainingRecordForm}
    editingBooking={editingBooking}
    setEditingBooking={setEditingBooking}
    selectedBookingForRecord={selectedBookingForRecord}
    setSelectedBookingForRecord={setSelectedBookingForRecord}
    bookingFormData={bookingFormData}
    setBookingFormData={setBookingFormData}
  />;
};

const KioskRoute: React.FC<{
  user: any;
  showBookingForm: boolean;
  setShowBookingForm: (show: boolean) => void;
  editingBooking: Booking | null;
  setEditingBooking: (booking: Booking | null) => void;
  bookingFormData: any;
  setBookingFormData: (data: any) => void;
}> = (props) => {
  if (!props.user) {
    return <KioskLoginForm sessionKey={KIOSK_SESSION_KEY} />;
  }

  return <KioskAuthenticatedRoute {...props} user={props.user} />;
};

const KioskAuthenticatedRoute: React.FC<{
  user: any;
  showBookingForm: boolean;
  setShowBookingForm: (show: boolean) => void;
  editingBooking: Booking | null;
  setEditingBooking: (booking: Booking | null) => void;
  bookingFormData: any;
  setBookingFormData: (data: any) => void;
}> = ({
  user,
  showBookingForm,
  setShowBookingForm,
  editingBooking,
  setEditingBooking,
  bookingFormData,
  setBookingFormData,
}) => {
  const { logout } = useAuth();
  const { bookings, addBooking, updateBooking, deleteBooking, restoreBooking, approveBooking, refetch: refetchBookings } = useBookings(true);
  const { settings: portalSettings } = usePortalUxSettings();
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : [user?.role];
  const isAdminUser = userRoles.includes('admin');

  React.useEffect(() => {
    if (isAdminUser) {
      localStorage.setItem(KIOSK_SESSION_KEY, 'true');
      return;
    }
    localStorage.removeItem(KIOSK_SESSION_KEY);
    toast.error('Kiosk mode is restricted to admin users.');
  }, [isAdminUser]);

  if (!isAdminUser) {
    return <Navigate to="/" replace />;
  }

  const handleNewBooking = (date?: Date) => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }
    setEditingBooking(null);
    setBookingFormData(date ? { date: format(date, 'yyyy-MM-dd') } : {});
    setShowBookingForm(true);
  };

  const handleNewBookingWithResource = (
    date: Date,
    startTime: string,
    endTime?: string,
    resourceId?: string,
    resourceType?: 'aircraft' | 'instructor'
  ) => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }

    const formData: any = {
      date: format(date, 'yyyy-MM-dd'),
      startTime,
      endTime,
    };
    if (resourceType === 'aircraft') {
      formData.aircraftId = resourceId;
    } else if (resourceType === 'instructor') {
      formData.instructorId = resourceId;
    }
    setEditingBooking(null);
    setBookingFormData(formData);
    setShowBookingForm(true);
  };

  const handleBookingSubmit = async (bookingData: any) => {
    const startTime = new Date(`${bookingData.date}T${bookingData.startTime}:00`);
    const endTime = new Date(`${bookingData.endDate}T${bookingData.endTime}:00`);
    const bookingKind = bookingData.bookingKind === 'ground' || !bookingData.aircraftId ? 'ground' : 'flight';

    if (editingBooking) {
        await updateBooking(editingBooking.id, {
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingKind === 'ground' ? undefined : bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: editingBooking.status,
          bookingKind,
          flightTypeId: bookingData.flightTypeId || undefined,
          isGuestBooking: bookingData.isGuestBooking || false,
          guestName: bookingData.guestName || undefined,
          guestEmail: bookingData.guestEmail || undefined,
          guestPhone: bookingData.guestPhone || undefined,
          trialFlightVoucherId: bookingData.trialFlightVoucherId || undefined,
        });
    } else {
      const recurrence = bookingData.recurrence;
      const occurrenceStarts = buildRecurringStartTimes(startTime, recurrence);
      const occurrenceCount = occurrenceStarts.length;
      const durationMs = endTime.getTime() - startTime.getTime();

      for (const occurrenceStart of occurrenceStarts) {
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
          await addBooking({
            studentId: bookingData.studentId,
            instructorId: bookingData.instructorId || undefined,
            aircraftId: bookingKind === 'ground' ? undefined : bookingData.aircraftId,
            startTime: occurrenceStart,
            endTime: occurrenceEnd,
            paymentType: bookingData.paymentType,
            notes: bookingData.notes,
            status: bookingData.status || 'confirmed' as const,
            bookingKind,
            flightTypeId: bookingData.flightTypeId || undefined,
            isGuestBooking: bookingData.isGuestBooking || false,
            guestName: bookingData.guestName || undefined,
            guestEmail: bookingData.guestEmail || undefined,
            guestPhone: bookingData.guestPhone || undefined,
            trialFlightVoucherId: bookingData.trialFlightVoucherId || undefined,
          }, { silent: occurrenceCount > 1 });
        }

      if (occurrenceCount > 1) {
        toast.success(`${occurrenceCount} recurring bookings created`);
      }
    }
  };

  const handleExit = async () => {
    localStorage.removeItem(KIOSK_SESSION_KEY);
    await logout();
  };

  return (
    <KioskCalendarShell onExit={handleExit} themePreference={portalSettings.kiosk_theme}>
      <PageLoadGate routeKey="kiosk-calendar">
        <Suspense fallback={<PageLoader />}>
          <Calendar
            bookings={bookings}
            onNewBooking={handleNewBooking}
            onNewBookingWithTime={handleNewBookingWithResource}
            onEditBooking={(booking) => {
              setEditingBooking(booking);
              setBookingFormData({});
              setShowBookingForm(true);
            }}
            onCopyBooking={(booking) => {
              setEditingBooking(null);
              setBookingFormData(buildCopiedBookingFormData(booking));
              setShowBookingForm(true);
            }}
            onUpdateBooking={async (bookingId, updates, silent) => {
              await updateBooking(bookingId, updates, silent);
            }}
            onDeleteBooking={async (bookingId, cancellation) => {
              try {
                await deleteBooking(bookingId, cancellation);
              } catch (error) {
                console.error('Error deleting booking:', error);
                throw error;
              }
            }}
            onRestoreBooking={async (bookingId) => {
              try {
                await restoreBooking(bookingId);
              } catch (error) {
                console.error('Error reinstating booking:', error);
                throw error;
              }
            }}
            onApproveBooking={async (bookingId) => {
              try {
                await approveBooking(bookingId);
              } catch (error) {
                console.error('Error approving booking:', error);
                throw error;
              }
            }}
            onRefresh={refetchBookings}
            isKioskMode
          />
        </Suspense>
      </PageLoadGate>

      {showBookingForm && (
        <Suspense fallback={null}>
          <BookingForm
            isOpen={showBookingForm}
            onClose={() => {
              setShowBookingForm(false);
              setBookingFormData({});
              setEditingBooking(null);
            }}
            prefilledData={bookingFormData}
            onSubmit={handleBookingSubmit}
            booking={editingBooking}
            isEdit={!!editingBooking}
            isKioskMode
          />
        </Suspense>
      )}
    </KioskCalendarShell>
  );
};

const AuthenticatedApp: React.FC<{
  user: any;
  showBookingForm: boolean;
  setShowBookingForm: (show: boolean) => void;
  showTrainingRecordForm: boolean;
  setShowTrainingRecordForm: (show: boolean) => void;
  editingBooking: Booking | null;
  setEditingBooking: (booking: Booking | null) => void;
  selectedBookingForRecord: Booking | null;
  setSelectedBookingForRecord: (booking: Booking | null) => void;
  bookingFormData: any;
  setBookingFormData: (data: any) => void;
}> = ({
  user,
  showBookingForm,
  setShowBookingForm,
  showTrainingRecordForm,
  setShowTrainingRecordForm,
  editingBooking,
  setEditingBooking,
  selectedBookingForRecord,
  setSelectedBookingForRecord,
  bookingFormData,
  setBookingFormData
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activeView = getViewForPath(location.pathname);
  const bookingsEnabled = activeView === 'calendar' || showBookingForm || showTrainingRecordForm || Boolean(editingBooking || selectedBookingForRecord);
  const { bookings, addBooking, updateBooking, deleteBooking, restoreBooking, approveBooking, rejectBooking, refetch: refetchBookings } = useBookings(bookingsEnabled);
  const { settings: portalSettings, loading: portalSettingsLoading } = usePortalUxSettings();
  const { preferences: userPreferences, loading: userPreferencesLoading } = useUserPreferences(user?.id || '');
  const effectiveTheme = userPreferences?.theme || getStoredPortalTheme(user?.id) || 'auto';
  const backgroundColor = userPreferences?.background_color || '#f3f4f6';

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      applyPortalTheme(effectiveTheme, media);
    };
    applyTheme();
    storePortalTheme(effectiveTheme, user?.id);
    media.addEventListener('change', applyTheme);
    const dayNightTimer = window.setInterval(applyTheme, 60_000);
    return () => {
      media.removeEventListener('change', applyTheme);
      window.clearInterval(dayNightTimer);
    };
  }, [effectiveTheme, user?.id]);

  const handleViewChange = (view: string) => {
    navigate(getPathForView(view));
  };

  const handleNewBooking = (date?: Date) => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }
    setEditingBooking(null);
    setBookingFormData(date ? { date: format(date, 'yyyy-MM-dd') } : {});
    setShowBookingForm(true);
  };

  const handleNewBookingWithResource = (
    date: Date,
    startTime: string,
    endTime?: string,
    resourceId?: string,
    resourceType?: 'aircraft' | 'instructor'
  ) => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }

    const formData: any = {
      date: format(date, 'yyyy-MM-dd'),
      startTime,
      endTime,
    };
    if (resourceType === 'aircraft') {
      formData.aircraftId = resourceId;
    } else if (resourceType === 'instructor') {
      formData.instructorId = resourceId;
    }
    setBookingFormData(formData);
    setShowBookingForm(true);
  };

  const handleBookingSubmit = async (bookingData: any) => {
    try {
      // Parse as local time by appending seconds — avoids UTC date-shift
      const startTime = new Date(`${bookingData.date}T${bookingData.startTime}:00`);
      const endTime = new Date(`${bookingData.endDate}T${bookingData.endTime}:00`);
      const bookingKind = bookingData.bookingKind === 'ground' || !bookingData.aircraftId ? 'ground' : 'flight';

      if (editingBooking) {
        await updateBooking(editingBooking.id, {
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingKind === 'ground' ? undefined : bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: editingBooking.status,
          bookingKind,
          flightTypeId: bookingData.flightTypeId || undefined,
          isGuestBooking: bookingData.isGuestBooking || false,
          guestName: bookingData.guestName || undefined,
          guestEmail: bookingData.guestEmail || undefined,
          guestPhone: bookingData.guestPhone || undefined,
          trialFlightVoucherId: bookingData.trialFlightVoucherId || undefined,
        });
    } else {
      const recurrence = bookingData.recurrence;
      const occurrenceStarts = buildRecurringStartTimes(startTime, recurrence);
      const occurrenceCount = occurrenceStarts.length;
      const durationMs = endTime.getTime() - startTime.getTime();

      for (const occurrenceStart of occurrenceStarts) {
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
          await addBooking({
            studentId: bookingData.studentId,
            instructorId: bookingData.instructorId || undefined,
            aircraftId: bookingKind === 'ground' ? undefined : bookingData.aircraftId,
            startTime: occurrenceStart,
            endTime: occurrenceEnd,
            paymentType: bookingData.paymentType,
            notes: bookingData.notes,
            status: bookingData.status || 'confirmed' as const,
            bookingKind,
            flightTypeId: bookingData.flightTypeId || undefined,
            isGuestBooking: bookingData.isGuestBooking || false,
            guestName: bookingData.guestName || undefined,
            guestEmail: bookingData.guestEmail || undefined,
            guestPhone: bookingData.guestPhone || undefined,
            trialFlightVoucherId: bookingData.trialFlightVoucherId || undefined,
          }, { silent: occurrenceCount > 1 });
        }

        if (occurrenceCount > 1) {
          toast.success(`${occurrenceCount} recurring bookings created`);
        }
      }
    } catch (error) {
      console.error('Error saving booking:', error);
      throw error;
    }
  };

  const handleUpdateBooking = async (bookingId: string, updates: Partial<Booking>, silent?: boolean) => {
    try {
      await updateBooking(bookingId, updates, silent);
    } catch (error) {
      console.error('Error updating booking:', error);
      throw error;
    }
  };

  const handleTrainingRecordSubmit = async (recordData: any) => {
    console.log('Training record submitted:', recordData);

    if (selectedBookingForRecord) {
      try {
        await updateBooking(selectedBookingForRecord.id, { status: 'completed' as const });
      } catch (error) {
        console.error('Error updating booking status:', error);
      }
    }

    setShowTrainingRecordForm(false);
    setSelectedBookingForRecord(null);
  };

  const handleOpenTrainingRecord = (booking: Booking) => {
    setSelectedBookingForRecord(booking);
    setShowTrainingRecordForm(true);
  };
  const requiredAction = getRequiredActionForView(activeView);
  const requiredResource = getRequiredResourceForView(activeView);

  React.useEffect(() => {
    if (location.pathname.startsWith('/bookings')) {
      navigate('/calendar?view=list', { replace: true });
    }
  }, [location.pathname, navigate]);

  if (portalSettingsLoading || userPreferencesLoading) {
    return <PortalBootScreen message="Applying your portal preferences" detail="Setting up theme, calendar defaults and account options..." />;
  }

  const renderActiveView = (view: string) => {
    switch (view) {
      case 'dashboard':
        return <ProfileDashboard />;
      case 'calendar':
        return (
          <div className="bg-transparent p-3 sm:p-6">
            <Calendar
              bookings={bookings}
              onNewBooking={handleNewBooking}
              onNewBookingWithTime={handleNewBookingWithResource}
              onEditBooking={(booking) => {
                setEditingBooking(booking);
                setBookingFormData({});
                setShowBookingForm(true);
              }}
              onCopyBooking={(booking) => {
                setEditingBooking(null);
                setBookingFormData(buildCopiedBookingFormData(booking));
                setShowBookingForm(true);
              }}
              onUpdateBooking={handleUpdateBooking}
              onDeleteBooking={async (bookingId, cancellation) => {
                try {
                  await deleteBooking(bookingId, cancellation);
                } catch (error) {
                  console.error('Error deleting booking:', error);
                  throw error;
                }
              }}
              onRestoreBooking={async (bookingId) => {
                try {
                  await restoreBooking(bookingId);
                } catch (error) {
                  console.error('Error reinstating booking:', error);
                  throw error;
                }
              }}
              onApproveBooking={async (bookingId) => {
                try {
                  await approveBooking(bookingId);
                } catch (error) {
                  console.error('Error approving booking:', error);
                  throw error;
                }
              }}
              onRefresh={refetchBookings}
            />
          </div>
        );
      case 'students':
        return <StudentList />;
      case 'aircraft':
        return <AircraftList />;
      case 'maintenance':
        return <MaintenanceBoard />;
      case 'billing':
        return <BillingDashboard mode="own" />;
      case 'financial-dashboard':
        return <BillingDashboard mode="financial" />;
      case 'gift-vouchers':
        return <TrialFlightVouchersPage />;
      case 'reports':
        return <ReportsDashboard />;
      case 'safety':
        return <SafetyDashboard />;
      case 'training':
        if (user?.role === 'student' || user?.role === 'pilot') {
          return <StudentProfilePage portalSection="training" />;
        }
        return <TrainingCourseCatalog />;
      case 'learning-centre':
        return <LearningCentreDashboard />;
      case 'pilot-file':
        return <StudentProfilePage portalSection="training" />;
      case 'documents':
        return <StudentProfilePage portalSection="documents" />;
      case 'outstanding-records':
        return <OutstandingRecordsTab />;
      case 'syllabus-management':
        return <TrainingModuleBuilder />;
      case 'profile':
        return <ProfileDashboard />;
      case 'mylogbook':
        return <MyLogbookPage />;
      case 'settings':
        return <SettingsDashboard />;
      default:
        return <ProfileDashboard />;
    }
  };

  return (
    <Routes>
      <Route path="/reset-password" element={<Suspense fallback={<PageLoader />}><ResetPasswordPage /></Suspense>} />
      <Route path="/trial-flight-voucher" element={<Suspense fallback={<PageLoader />}><TrialVoucherRedeemPage /></Suspense>} />
      <Route path="/trial-flight-gift-vouchers" element={<Suspense fallback={<PageLoader />}><TrialVoucherSalesPage /></Suspense>} />
      <Route path="/students/:studentId" element={
        <RouteGuard requiredAction="view-students">
          <AppShell activeSidebarView="students" onViewChange={handleViewChange} backgroundColor={backgroundColor}>
            <StudentProfilePage />
          </AppShell>
        </RouteGuard>
      } />
      <Route path="/aircraft/:aircraftId/logs" element={
        <RouteGuard requiredAction="view-maintenance">
          <AppShell activeSidebarView="aircraft" onViewChange={handleViewChange} backgroundColor={backgroundColor} mainClassName="min-w-0 flex-1 overflow-x-hidden p-3 sm:p-6 lg:ml-0 ml-0">
            <AircraftFlightLogs />
          </AppShell>
        </RouteGuard>
      } />
      <Route path="/aircraft/:aircraftId" element={
        <RouteGuard requiredAction="view-aircraft">
          <AppShell activeSidebarView="aircraft" onViewChange={handleViewChange} backgroundColor={backgroundColor}>
            <AircraftProfilePage />
          </AppShell>
        </RouteGuard>
      } />
      <Route path="*" element={
        <RouteGuard requiredAction={requiredAction} resource={requiredResource}>
          <AppShell activeSidebarView={activeView} onViewChange={handleViewChange} backgroundColor={backgroundColor}>
            <AppErrorBoundary key={activeView}>
              {renderActiveView(activeView)}
            </AppErrorBoundary>
            
            {showBookingForm && (
              <Suspense fallback={null}>
                <BookingForm
                  isOpen={showBookingForm}
                  onClose={() => {
                    setShowBookingForm(false);
                    setBookingFormData({});
                    setEditingBooking(null);
                  }}
                  prefilledData={bookingFormData}
                  onSubmit={handleBookingSubmit}
                  booking={editingBooking}
                  isEdit={!!editingBooking}
                />
              </Suspense>
            )}
            
            {showTrainingRecordForm && (
              <Suspense fallback={null}>
                <TrainingRecordForm
                  isOpen={showTrainingRecordForm}
                  onClose={() => {
                    setShowTrainingRecordForm(false);
                    setSelectedBookingForRecord(null);
                  }}
                  onSubmit={handleTrainingRecordSubmit}
                  booking={selectedBookingForRecord || undefined}
                />
              </Suspense>
            )}

            <Suspense fallback={null}>
              <StudentAcknowledgementModal />
            </Suspense>
          </AppShell>
        </RouteGuard>
      } />
    </Routes>
  );
};

const viewPathMap: Record<string, string> = {
  dashboard: '/',
  calendar: '/calendar',
  students: '/students',
  aircraft: '/aircraft',
  maintenance: '/maintenance',
  training: '/training',
  'learning-centre': '/learning-centre',
  'pilot-file': '/pilot-file',
  documents: '/documents',
  'outstanding-records': '/training/outstanding-records',
  'syllabus-management': '/training/syllabus',
  billing: '/billing',
  'financial-dashboard': '/financial-dashboard',
  'gift-vouchers': '/gift-vouchers',
  reports: '/reports',
  safety: '/safety',
  profile: '/profile',
  mylogbook: '/my-logbook',
  settings: '/settings'
};

const pathViewMap: Record<string, string> = Object.entries(viewPathMap).reduce(
  (acc, [view, path]) => ({ ...acc, [path]: view }),
  {} as Record<string, string>
);

const getPathForView = (view: string) => viewPathMap[view] || '/';

const getViewForPath = (pathname: string) => {
  if (pathViewMap[pathname]) return pathViewMap[pathname];
  if (pathname.startsWith('/bookings')) return 'calendar';
  if (pathname.startsWith('/students')) return 'students';
  if (pathname.startsWith('/aircraft')) return 'aircraft';
  if (pathname.startsWith('/training/outstanding-records')) return 'outstanding-records';
  if (pathname.startsWith('/training/syllabus')) return 'syllabus-management';
  if (pathname.startsWith('/training')) return 'training';
  if (pathname.startsWith('/learning-centre')) return 'learning-centre';
  if (pathname.startsWith('/pilot-file')) return 'pilot-file';
  if (pathname.startsWith('/documents')) return 'documents';
  if (pathname.startsWith('/gift-vouchers')) return 'gift-vouchers';
  return 'dashboard';
};

// Helper functions for route guards
const getRequiredActionForView = (view: string) => {
  const actionMap: Record<string, any> = {
    'dashboard': 'view-dashboard',
    'calendar': 'view-calendar',
    'students': 'view-students',
    'aircraft': 'view-aircraft',
    'maintenance': 'view-maintenance',
    'training': 'view-training',
    'learning-centre': 'view-learning-centre',
    'pilot-file': 'view-training',
    'outstanding-records': 'view-outstanding-records',
    'syllabus-management': 'edit-settings',
    'documents': 'view-training',
    'billing': 'view-billing',
    'financial-dashboard': 'view-billing',
    'gift-vouchers': 'view-billing',
    'reports': 'view-reports',
    'safety': 'view-safety',
    'profile': 'edit-personal-settings',
    'mylogbook': 'view-logbook',
    'settings': 'view-settings'
  };
  return actionMap[view] || 'view-dashboard';
};

const getRequiredResourceForView = (view: string) => {
  const resourceMap: Record<string, 'all' | 'own'> = {
    'billing': 'own',
    'financial-dashboard': 'all',
    'profile': 'own',
    'learning-centre': 'own',
    'documents': 'own',
    'pilot-file': 'own',
    'training': 'own',
    'mylogbook': 'own',
    'safety': 'own',
    'settings': 'own'
  };
  return resourceMap[view] || 'all';
};

function App() {
  const basename = import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL;
  return (
    <Router basename={basename}>
      <AuthProvider>
        <TrainingModulesProvider>
          <AppContent />
          <AppNotifications />
        </TrainingModulesProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
