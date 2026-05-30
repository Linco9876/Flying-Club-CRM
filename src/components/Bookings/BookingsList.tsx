import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Booking } from '../../types';
import { Calendar, Clock, Plane, User, MapPin } from 'lucide-react';
import { BookingActionMenu } from './BookingActionMenu';
import { FlightLogForm } from './FlightLogForm';
import BookingForm from './BookingForm';
import { isPastBooking } from '../../utils/timeUtils';
import toast from 'react-hot-toast';
import { useAircraft } from '../../hooks/useAircraft';
import { useStudents } from '../../hooks/useStudents';
import { usePortalUxSettings } from '../../hooks/useSettings';

interface BookingsListProps {
  bookings: Booking[];
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>) => void;
  onDeleteBooking?: (bookingId: string) => void;
  onOpenTrainingRecord?: (booking: Booking) => void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  onRejectBooking?: (bookingId: string) => void;
}

export const BookingsList: React.FC<BookingsListProps> = ({
  bookings,
  onUpdateBooking,
  onDeleteBooking,
  onOpenTrainingRecord,
  onApproveBooking,
  onRejectBooking
}) => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { students } = useStudents();
  const { settings: portalSettings } = usePortalUxSettings();
  const [showFlightLogForm, setShowFlightLogForm] = React.useState(false);
  const [showEditForm, setShowEditForm] = React.useState(false);
  const [selectedBooking, setSelectedBooking] = React.useState<Booking | null>(null);

  const userBookings = user?.role === 'student' || user?.role === 'pilot'
    ? bookings.filter(b => b.studentId === user.id)
    : bookings;
  const canCancelOwnBookings = user?.role !== 'student' && user?.role !== 'pilot'
    ? true
    : portalSettings.allow_booking_cancellation;

  const formatBookingDate = (date: Date) => {
    if (portalSettings.date_format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
    return date.toLocaleDateString(portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU');
  };

  const formatBookingTime = (date: Date) =>
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: portalSettings.time_format === '12h',
    });

  const getAircraftInfo = (aircraftId: string) => {
    return aircraft.find(a => a.id === aircraftId);
  };

  const handleFlightLog = async (flightLogData: any) => {
    if (selectedBooking && onUpdateBooking) {
      if (selectedBooking.status === 'pending_approval' && onApproveBooking) {
        await onApproveBooking(selectedBooking.id);
      }

      const student = students.find(s => s.id === selectedBooking.studentId);
      if (student) {
        student.prepaidBalance -= flightLogData.totalCost;
      }
      
      // Update booking with flight log
      onUpdateBooking(selectedBooking.id, {
        status: 'completed',
        flightLog: {
          id: Date.now().toString(),
          ...flightLogData
        }
      });
    }
    setShowFlightLogForm(false);
    setSelectedBooking(null);
  };

  const handleEditBooking = (bookingData: any) => {
    if (selectedBooking && onUpdateBooking) {
      onUpdateBooking(selectedBooking.id, {
        startTime: new Date(`${bookingData.date}T${bookingData.startTime}`),
        endTime: new Date(`${bookingData.endDate}T${bookingData.endTime}`),
        aircraftId: bookingData.aircraftId,
        instructorId: bookingData.instructorId || undefined,
        paymentType: bookingData.paymentType,
        notes: bookingData.notes
      });
      toast.success('Booking updated successfully!');
    }
    setShowEditForm(false);
    setSelectedBooking(null);
  };

  const handleDeleteBooking = (booking: Booking) => {
    if (onDeleteBooking) {
      onDeleteBooking(booking.id);
      toast.success('Booking deleted successfully!');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'pending_approval':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'cancelled':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'completed':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'no-show':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatPaymentType = (paymentType?: string) => {
    const normalised = (paymentType || '').trim().toLowerCase().replace(/[_-]/g, ' ');
    if (!normalised) return 'Not set';
    if (normalised === 'prepaid' || normalised === 'pre paid' || normalised === 'pre paid account') return 'Pre-paid Account';
    if (normalised === 'payg' || normalised === 'pay as you go') return 'Pay as You Go';
    if (normalised === 'account') return 'Account';
    if (normalised === 'bank transfer') return 'Bank Transfer';
    if (normalised === 'card') return 'Card';
    if (normalised === 'cash') return 'Cash';
    return normalised.replace(/\b\w/g, char => char.toUpperCase());
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {user?.role === 'student' ? 'My Bookings' : 'All Bookings'}
        </h1>
      </div>

      <div className="space-y-4">
        {userBookings.map(booking => {
          const aircraft = getAircraftInfo(booking.aircraftId);
          const startTime = new Date(booking.startTime);
          const endTime = new Date(booking.endTime);
          const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
          const isPast = isPastBooking(booking);

          return (
            <div key={booking.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div
                className={`flex items-center justify-between mb-4 ${!isPast ? 'cursor-pointer' : ''}`}
                onClick={!isPast ? () => {
                  setSelectedBooking(booking);
                  setShowEditForm(true);
                } : undefined}
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {aircraft?.registration} - {aircraft?.make} {aircraft?.model}
                  </h3>
                  <p className="text-sm text-gray-600">{booking.notes}</p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${getStatusColor(booking.status)}`}>
                    {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                  </span>
                  
                  {/* Action Menu - Always Rendered */}
                  <BookingActionMenu
                    booking={booking}
                    onEdit={() => {
                      setSelectedBooking(booking);
                      setShowEditForm(true);
                    }}
                    onDelete={() => handleDeleteBooking(booking)}
                    onLogFlight={() => {
                      setSelectedBooking(booking);
                      setShowFlightLogForm(true);
                    }}
                    onViewTrainingRecord={() => onOpenTrainingRecord && onOpenTrainingRecord(booking)}
                    onApprove={onApproveBooking ? () => onApproveBooking(booking.id) : undefined}
                    onReject={onRejectBooking ? () => onRejectBooking(booking.id) : undefined}
                    hasTrainingRecord={!!booking.flightLog}
                    canDelete={canCancelOwnBookings}
                    canApprove={user?.role === 'admin' || user?.role === 'instructor'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">{formatBookingDate(startTime)}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {formatBookingTime(startTime)} - {formatBookingTime(endTime)}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {booking.instructorId ? 'With Instructor' : 'Solo Flight'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">{duration.toFixed(portalSettings.flight_time_decimals)} hours</span>
                </div>
              </div>

              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm">
                  <span className="text-gray-500">Payment: </span>
                  <span className="font-medium text-gray-900">{formatPaymentType(booking.paymentType)}</span>
                  {aircraft && (
                    <>
                      <span className="text-gray-500 ml-4">Est. Cost: </span>
                      <span className="font-medium text-gray-900">
                        ${(duration * aircraft.hourlyRate + (booking.instructorId ? duration * 85 : 0)).toFixed(portalSettings.currency_decimals)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {!isPastBooking(booking) && (
                    /* Quick Action Buttons for Future Bookings */
                    booking.status === 'confirmed' && (
                    <>
                      <button onClick={() => { setSelectedBooking(booking); setShowEditForm(true); }} className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors">
                        Modify
                      </button>
                      {canCancelOwnBookings && (
                        <button onClick={() => handleDeleteBooking(booking)} className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">
                          Cancel
                        </button>
                      )}
                    </>
                    )
                  )}
                  {booking.status === 'completed' && !booking.flightLog && (
                    <button className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">
                      Log Flight
                    </button>
                  )}
                </div>
              </div>
              
              {booking.status === 'completed' && (
                <button 
                  onClick={() => onOpenTrainingRecord && onOpenTrainingRecord(booking)}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors mt-2"
                >
                  Submit Training Record
                </button>
              )}
            </div>
          );
        })}

        {userBookings.length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg shadow-md border border-gray-200">
            <Calendar className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No bookings found</h3>
            <p className="text-gray-600">You don't have any bookings yet. Create your first booking to get started!</p>
          </div>
        )}
      </div>

      {/* Flight Log Form */}
      {selectedBooking && (
        <FlightLogForm
          isOpen={showFlightLogForm}
          onClose={() => {
            setShowFlightLogForm(false);
            setSelectedBooking(null);
          }}
          onSubmit={handleFlightLog}
          booking={selectedBooking}
        />
      )}

      {/* Edit Booking Form */}
      {selectedBooking && (
        <BookingForm
          isOpen={showEditForm}
          onClose={() => {
            setShowEditForm(false);
            setSelectedBooking(null);
          }}
          onSubmit={handleEditBooking}
          booking={selectedBooking}
          isEdit={true}
        />
      )}
    </div>
  );
};
