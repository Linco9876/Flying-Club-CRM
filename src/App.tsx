import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { RouteGuard } from './components/Layout/RouteGuard';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TrainingModulesProvider } from './context/TrainingModulesContext';
import { useBookings } from './hooks/useBookings';
import { Booking } from './types';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { AppErrorBoundary } from './components/Layout/AppErrorBoundary';
import { LoginForm } from './components/Auth/LoginForm';
import BookingForm from './components/Bookings/BookingForm';
import { format } from 'date-fns';
import { usePortalUxSettings, useUserPreferences } from './hooks/useSettings';
import { can, getAuthorizedMenuItems } from './utils/rbac';
import { applyPortalTheme, getStoredPortalTheme, storePortalTheme } from './utils/theme';
import { KioskLoginForm } from './components/Kiosk/KioskLoginForm';
import { KioskCalendarShell } from './components/Kiosk/KioskCalendarShell';

const ResetPasswordPage = lazy(() => import('./components/Auth/ResetPasswordPage').then(module => ({ default: module.ResetPasswordPage })));
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
const StudentAcknowledgementModal = lazy(() => import('./components/Training/StudentAcknowledgementModal').then(module => ({ default: module.StudentAcknowledgementModal })));
const SettingsDashboard = lazy(() => import('./components/Settings/SettingsDashboard').then(module => ({ default: module.SettingsDashboard })));
const KIOSK_SESSION_KEY = 'bfc_kiosk_mode';

const PageLoader = () => (
  <div className="flex min-h-[18rem] items-center justify-center">
    <div className="text-center">
      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      <p className="text-sm text-gray-500">Loading...</p>
    </div>
  </div>
);

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
  <div className="relative min-h-screen bg-gray-50 dark:bg-[#0f1117]" style={{ backgroundColor }}>
    <div className="relative z-10 min-h-screen">
      <Header />
      <div className="flex lg:ml-0 ml-0">
        <Sidebar activeView={activeSidebarView} onViewChange={onViewChange} />
        <main className={mainClassName}>
          <Suspense fallback={<PageLoader />}>
            {children}
          </Suspense>
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
  const isKioskRoute = location.pathname.startsWith('/kiosk');

  if (isPasswordRecovery) {
    return (
      <Suspense fallback={<PageLoader />}>
        <ResetPasswordPage />
      </Suspense>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (isKioskRoute) {
    return (
      <KioskRoute
        user={user}
        showBookingForm={showBookingForm}
        setShowBookingForm={setShowBookingForm}
        editingBooking={editingBooking}
        setEditingBooking={setEditingBooking}
        bookingFormData={bookingFormData}
        setBookingFormData={setBookingFormData}
      />
    );
  }

  if (user && localStorage.getItem(KIOSK_SESSION_KEY) === 'true') {
    return <Navigate to="/kiosk" replace />;
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
  const { bookings, addBooking, updateBooking, deleteBooking, approveBooking, refetch: refetchBookings } = useBookings(true);
  const { settings: portalSettings } = usePortalUxSettings();

  React.useEffect(() => {
    localStorage.setItem(KIOSK_SESSION_KEY, 'true');
  }, []);

  const handleNewBooking = () => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }
    setEditingBooking(null);
    setBookingFormData({});
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

    if (editingBooking) {
      await updateBooking(editingBooking.id, {
        studentId: bookingData.studentId,
        instructorId: bookingData.instructorId || undefined,
        aircraftId: bookingData.aircraftId,
        startTime,
        endTime,
        paymentType: bookingData.paymentType,
        notes: bookingData.notes,
        status: editingBooking.status,
        flightTypeId: bookingData.flightTypeId || undefined,
      });
    } else {
      await addBooking({
        studentId: bookingData.studentId,
        instructorId: bookingData.instructorId || undefined,
        aircraftId: bookingData.aircraftId,
        startTime,
        endTime,
        paymentType: bookingData.paymentType,
        notes: bookingData.notes,
        status: bookingData.status || 'confirmed' as const,
        flightTypeId: bookingData.flightTypeId || undefined,
      });
    }
  };

  const handleExit = async () => {
    localStorage.removeItem(KIOSK_SESSION_KEY);
    await logout();
  };

  return (
    <KioskCalendarShell onExit={handleExit}>
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
          onUpdateBooking={async (bookingId, updates, silent) => {
            await updateBooking(bookingId, updates, silent);
          }}
          onDeleteBooking={async (bookingId) => {
            try {
              await deleteBooking(bookingId);
            } catch (error) {
              console.error('Error deleting booking:', error);
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

      {showBookingForm && (
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
  const { bookings, addBooking, updateBooking, deleteBooking, approveBooking, rejectBooking, refetch: refetchBookings } = useBookings(bookingsEnabled);
  const { settings: portalSettings } = usePortalUxSettings();
  const { preferences: userPreferences } = useUserPreferences(user?.id || '');
  const effectiveTheme = userPreferences?.theme || getStoredPortalTheme(user?.id) || getStoredPortalTheme() || portalSettings.theme || 'auto';
  const backgroundColor = userPreferences?.background_color || '#f3f4f6';

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      applyPortalTheme(effectiveTheme, media);
    };
    applyTheme();
    storePortalTheme(effectiveTheme, user?.id);
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [effectiveTheme, user?.id]);

  const handleViewChange = (view: string) => {
    navigate(getPathForView(view));
  };

  const handleNewBooking = () => {
    if ((user.role === 'student' || user.role === 'pilot') && !portalSettings.allow_self_booking) {
      toast.error('Student self-booking is disabled. Please contact the club.');
      return;
    }
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

      if (editingBooking) {
        await updateBooking(editingBooking.id, {
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: editingBooking.status,
          flightTypeId: bookingData.flightTypeId || undefined,
        });
      } else {
        await addBooking({
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: bookingData.status || 'confirmed' as const,
          flightTypeId: bookingData.flightTypeId || undefined,
        });
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

  React.useEffect(() => {
    if (can(user, requiredAction, requiredResource)) return;

    const firstAllowedView = getAuthorizedMenuItems(user)[0]?.id || 'dashboard';
    const firstAllowedPath = getPathForView(firstAllowedView);

    if (location.pathname !== firstAllowedPath) {
      navigate(firstAllowedPath, { replace: true });
    }
  }, [activeView, location.pathname, navigate, requiredAction, requiredResource, user]);

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
                setShowBookingForm(true);
              }}
              onUpdateBooking={handleUpdateBooking}
              onDeleteBooking={async (bookingId) => {
                try {
                  await deleteBooking(bookingId);
                } catch (error) {
                  console.error('Error deleting booking:', error);
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
      case 'reports':
        return <ReportsDashboard />;
      case 'safety':
        return <SafetyDashboard />;
      case 'training':
        if (user?.role === 'student' || user?.role === 'pilot') {
          return <StudentProfilePage />;
        }
        return <TrainingCourseCatalog />;
      case 'outstanding-records':
        return (
          <div className="p-0">
            <div className="px-4 pt-4 pb-2 sm:px-6 sm:pt-6">
              <h1 className="text-2xl font-bold text-gray-900">Outstanding Records</h1>
              <p className="text-gray-600 mt-1 text-sm">Flights awaiting a training record entry</p>
            </div>
            <OutstandingRecordsTab />
          </div>
        );
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
      <Route path="*" element={
        <RouteGuard requiredAction={requiredAction} resource={requiredResource}>
          <AppShell activeSidebarView={activeView} onViewChange={handleViewChange} backgroundColor={backgroundColor}>
            <AppErrorBoundary key={activeView}>
              {renderActiveView(activeView)}
            </AppErrorBoundary>
            
            {showBookingForm && (
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
      <Route path="/aircraft/:aircraftId" element={
        <RouteGuard requiredAction="view-maintenance">
          <AppShell activeSidebarView="aircraft" onViewChange={handleViewChange} backgroundColor={backgroundColor}>
            <AircraftProfilePage />
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
  'outstanding-records': '/training/outstanding-records',
  'syllabus-management': '/training/syllabus',
  billing: '/billing',
  'financial-dashboard': '/financial-dashboard',
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
    'outstanding-records': 'view-outstanding-records',
    'syllabus-management': 'edit-settings',
    'billing': 'view-billing',
    'financial-dashboard': 'view-billing',
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
        </TrainingModulesProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
