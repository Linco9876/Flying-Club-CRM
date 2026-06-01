import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
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
import { ResetPasswordPage } from './components/Auth/ResetPasswordPage';
import { Dashboard } from './components/Dashboard/Dashboard';
import { Calendar } from './components/Calendar/Calendar';
import BookingForm from './components/Bookings/BookingForm';
import { StudentList } from './components/Students/StudentList';
import { StudentProfilePage } from './components/Students/StudentProfilePage';
import { MyLogbookPage } from './components/Students/MyLogbookPage';
import { AircraftList } from './components/Aircraft/AircraftList';
import { AircraftFlightLogs } from './components/Aircraft/AircraftFlightLogs';
import { AircraftProfilePage } from './components/Aircraft/AircraftProfilePage';
import { MaintenanceBoard } from './components/Maintenance/MaintenanceBoard';
import { BillingDashboard } from './components/Billing/BillingDashboard';
import { ReportsDashboard } from './components/Reports/ReportsDashboard';
import { SafetyDashboard } from './components/Safety/SafetyDashboard';
import { TrainingRecordForm } from './components/Training/TrainingRecordForm';
import { TrainingCourseCatalog } from './components/Training/TrainingCourseCatalog';
import { TrainingModuleBuilder } from './components/Training/TrainingModuleBuilder';
import { OutstandingRecordsTab } from './components/Training/OutstandingRecordsTab';
import { StudentAcknowledgementModal } from './components/Training/StudentAcknowledgementModal';
import { SettingsDashboard } from './components/Settings/SettingsDashboard';
import { format } from 'date-fns';
import { usePortalUxSettings } from './hooks/useSettings';
import { can, getAuthorizedMenuItems } from './utils/rbac';

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
    new URLSearchParams(location.search).get('type') === 'recovery';

  if (isPasswordRecovery) {
    return <ResetPasswordPage />;
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
  const { bookings, addBooking, updateBooking, deleteBooking, approveBooking, rejectBooking, refetch: refetchBookings } = useBookings();
  const { settings: portalSettings } = usePortalUxSettings();

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const useDarkTheme = portalSettings.theme === 'dark' || (portalSettings.theme === 'auto' && media.matches);
      document.documentElement.dataset.portalTheme = useDarkTheme ? 'dark' : 'light';
    };
    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [portalSettings.theme]);

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
          status: 'confirmed' as const,
          flightTypeId: bookingData.flightTypeId || undefined,
        });
      }
    } catch (error) {
      console.error('Error saving booking:', error);
    }
  };

  const handleUpdateBooking = async (bookingId: string, updates: Partial<Booking>, silent?: boolean) => {
    try {
      await updateBooking(bookingId, updates, silent);
    } catch (error) {
      console.error('Error updating booking:', error);
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
  const activeView = getViewForPath(location.pathname);
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
        return <Dashboard />;
      case 'calendar':
        return <Calendar
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
        />;
      case 'students':
        return <StudentList />;
      case 'aircraft':
        return <AircraftList />;
      case 'maintenance':
        return <MaintenanceBoard />;
      case 'billing':
        return <BillingDashboard />;
      case 'reports':
        return <ReportsDashboard />;
      case 'safety':
        return <SafetyDashboard />;
      case 'training':
        return <TrainingCourseCatalog />;
      case 'outstanding-records':
        return (
          <div className="p-0">
            <div className="px-6 pt-6 pb-2">
              <h1 className="text-2xl font-bold text-gray-900">Outstanding Records</h1>
              <p className="text-gray-600 mt-1 text-sm">Flights awaiting a training record entry</p>
            </div>
            <OutstandingRecordsTab />
          </div>
        );
      case 'syllabus-management':
        return <TrainingModuleBuilder />;
      case 'profile':
        return <StudentProfilePage />;
      case 'mylogbook':
        return <MyLogbookPage />;
      case 'settings':
        return <SettingsDashboard />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/students/:studentId" element={
        <RouteGuard requiredAction="view-students">
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView="students" onViewChange={handleViewChange} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0">
                <StudentProfilePage />
              </main>
            </div>
          </div>
        </RouteGuard>
      } />
      <Route path="/aircraft/:aircraftId/logs" element={
        <RouteGuard requiredAction="view-maintenance">
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView="aircraft" onViewChange={handleViewChange} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0 p-6">
                <AircraftFlightLogs />
              </main>
            </div>
          </div>
        </RouteGuard>
      } />
      <Route path="*" element={
        <RouteGuard requiredAction={requiredAction} resource={requiredResource}>
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView={activeView} onViewChange={handleViewChange} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0">
                <AppErrorBoundary key={activeView}>
                  {renderActiveView(activeView)}
                </AppErrorBoundary>
              </main>
            </div>
            
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
            
            <TrainingRecordForm
              isOpen={showTrainingRecordForm}
              onClose={() => {
                setShowTrainingRecordForm(false);
                setSelectedBookingForRecord(null);
              }}
              onSubmit={handleTrainingRecordSubmit}
              booking={selectedBookingForRecord || undefined}
            />

            <StudentAcknowledgementModal />
          </div>
        </RouteGuard>
      } />
      <Route path="/aircraft/:aircraftId" element={
        <RouteGuard requiredAction="view-maintenance">
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView="aircraft" onViewChange={handleViewChange} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0">
                <AircraftProfilePage />
              </main>
            </div>
          </div>
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
    'profile': 'own',
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
