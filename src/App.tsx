import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { RouteGuard } from './components/Layout/RouteGuard';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useBookings } from './hooks/useBookings';
import { Booking } from './types';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { LoginForm } from './components/Auth/LoginForm';
import { Dashboard } from './components/Dashboard/Dashboard';
import { Calendar } from './components/Calendar/Calendar';
import BookingForm from './components/Bookings/BookingForm';
import { BookingsList } from './components/Bookings/BookingsList';
import { StudentProfile } from './components/Students/StudentProfile';
import { StudentList } from './components/Students/StudentList';
import { StudentProfilePage } from './components/Students/StudentProfilePage';
import { AircraftList } from './components/Aircraft/AircraftList';
import { MaintenanceBoard } from './components/Maintenance/MaintenanceBoard';
import { BillingDashboard } from './components/Billing/BillingDashboard';
import { ReportsDashboard } from './components/Reports/ReportsDashboard';
import { SafetyDashboard } from './components/Safety/SafetyDashboard';
import { TrainingRecordForm } from './components/Training/TrainingRecordForm';
import { SettingsDashboard } from './components/Settings/SettingsDashboard';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const AppContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const { bookings, loading: bookingsLoading, addBooking, updateBooking, deleteBooking } = useBookings();
  const [activeView, setActiveView] = useState('dashboard');
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [showTrainingRecordForm, setShowTrainingRecordForm] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [selectedBookingForRecord, setSelectedBookingForRecord] = useState<Booking | null>(null);
  const [bookingFormData, setBookingFormData] = useState<{
    date?: string;
    startTime?: string;
    endTime?: string;
  }>({});

  if (isLoading || bookingsLoading) {
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
const handleNewBookingWithTime = (
  date: Date,
  startTime: string,
  endTime?: string
) => {
  setBookingFormData({
    date: format(date, 'yyyy-MM-dd'),  // use local date
    startTime,
    endTime,
  });
  setShowBookingForm(true);
};

const handleNewBookingWithResource = (
  date: Date,
  startTime: string,
  endTime?: string,
  resourceId?: string,
  resourceType?: 'aircraft' | 'instructor'
) => {
  const formData: any = {
    date: format(date, 'yyyy-MM-dd'),  // use local date
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
      console.log('Form data received:', bookingData);

      const startTime = new Date(`${bookingData.date}T${bookingData.startTime}`);
      const endTime = new Date(`${bookingData.endDate}T${bookingData.endTime}`);

      console.log('Parsed times:', { startTime, endTime });

      if (editingBooking) {
        await updateBooking(editingBooking.id, {
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: editingBooking.status
        });
      } else {
        const newBookingData = {
          studentId: bookingData.studentId,
          instructorId: bookingData.instructorId || undefined,
          aircraftId: bookingData.aircraftId,
          startTime,
          endTime,
          paymentType: bookingData.paymentType,
          notes: bookingData.notes,
          status: 'confirmed' as const
        };

        console.log('Creating new booking:', newBookingData);
        await addBooking(newBookingData);
      }
    } catch (error) {
      console.error('Error saving booking:', error);
    }
  };

  const handleUpdateBooking = async (bookingId: string, updates: Partial<Booking>) => {
    try {
      await updateBooking(bookingId, updates);
    } catch (error) {
      console.error('Error updating booking:', error);
    }
  };

  const handleCancelBooking = async (bookingId: string) => {
    try {
      await updateBooking(bookingId, { status: 'cancelled' as const });
    } catch (error) {
      console.error('Error cancelling booking:', error);
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
  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard />;
      case 'calendar':
        return <Calendar 
          bookings={bookings}
          onNewBooking={() => setShowBookingForm(true)} 
          onNewBookingWithTime={handleNewBookingWithResource}
          onEditBooking={(booking) => {
            setEditingBooking(booking);
            setShowBookingForm(true);
          }}
          onUpdateBooking={handleUpdateBooking}
        />;
      case 'bookings':
        return <BookingsList
          bookings={bookings}
          onUpdateBooking={handleUpdateBooking}
          onDeleteBooking={async (bookingId) => {
            try {
              await deleteBooking(bookingId);
            } catch (error) {
              console.error('Error deleting booking:', error);
            }
          }}
          onOpenTrainingRecord={handleOpenTrainingRecord}
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
      case 'syllabus-management':
        return <Dashboard />;
      case 'profile':
        return <StudentProfile />;
      case 'settings':
        return <SettingsDashboard />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Routes>
      <Route path="/students/:studentId" element={
        <RouteGuard requiredAction="view-students">
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView="students" onViewChange={setActiveView} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0">
                <StudentProfilePage 
                  onOpenTrainingRecord={(booking) => {
                    setSelectedBookingForRecord(booking);
                    setShowTrainingRecordForm(true);
                  }}
                />
              </main>
            </div>
          </div>
        </RouteGuard>
      } />
      <Route path="*" element={
        <RouteGuard requiredAction={getRequiredActionForView(activeView)} resource={getRequiredResourceForView(activeView)}>
          <div className="min-h-screen bg-gray-50">
            <Header />
            <div className="flex lg:ml-0 ml-0">
              <Sidebar activeView={activeView} onViewChange={setActiveView} />
              <main className="flex-1 overflow-x-hidden lg:ml-0 ml-0">
                {renderActiveView()}
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
              onCancelBooking={editingBooking ? handleCancelBooking : undefined}
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
          </div>
        </RouteGuard>
      } />
    </Routes>
  );
};

// Helper functions for route guards
const getRequiredActionForView = (view: string) => {
  const actionMap: Record<string, any> = {
    'dashboard': 'view-dashboard',
    'calendar': 'view-calendar',
    'bookings': 'view-bookings',
    'students': 'view-students',
    'aircraft': 'view-aircraft',
    'maintenance': 'view-maintenance',
    'training': 'view-training',
    'syllabus-management': 'view-training',
    'billing': 'view-billing',
    'reports': 'view-reports',
    'safety': 'view-safety',
    'profile': 'view-students',
    'settings': 'view-settings'
  };
  return actionMap[view] || 'view-dashboard';
};

const getRequiredResourceForView = (view: string) => {
  const resourceMap: Record<string, 'all' | 'own'> = {
    'bookings': 'own',
    'profile': 'own',
    'settings': 'own'
  };
  return resourceMap[view] || 'all';
};

function App() {
  return (
    <Router>
      <AuthProvider>
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
      </AuthProvider>
    </Router>
  );
}

export default App;