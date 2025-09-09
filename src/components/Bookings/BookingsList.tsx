import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { mockAircraft, mockStudents } from '../../data/mockData';
import { Booking } from '../../types';
import { Calendar, Clock, Plane, User, MapPin } from 'lucide-react';
import { BookingActionMenu } from './BookingActionMenu';
import { FlightLogForm } from './FlightLogForm';
import BookingForm from './BookingForm';
import { isPastBooking } from '../../utils/timeUtils';
import toast from 'react-hot-toast';

interface BookingsListProps {
  bookings: Booking[];
  onUpdateBooking?: (bookingId: string, updates: Partial<Booking>) => void;
  onDeleteBooking?: (bookingId: string) => void;
  onOpenTrainingRecord?: (booking: Booking) => void;
}

export const BookingsList: React.FC<BookingsListProps> = ({ 
  bookings, 
  onUpdateBooking,
  onDeleteBooking,
  onOpenTrainingRecord 
}) => {
  const { user } = useAuth();
  const [showFlightLogForm, setShowFlightLogForm] = React.useState(false);
  const [showEditForm, setShowEditForm] = React.useState(false);
  const [selectedBooking, setSelectedBooking] = React.useState<Booking | null>(null);
  
  const userBookings = user?.role === 'student' 
    ? bookings.filter(b => b.studentId === user.id)
    : bookings;

  const getAircraftInfo = (aircraftId: string) => {
    return mockAircraft.find(a => a.id === aircraftId);
  };


  const handleFlightLog = (flightLogData: any) => {
    if (selectedBooking && onUpdateBooking) {
      // Update student balance
      const student = mockStudents.find(s => s.id === selectedBooking.studentId);
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
                    hasTrainingRecord={!!booking.flightLog}
                    canDelete={user?.role !== 'student'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">{startTime.toLocaleDateString()}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-900">
                    {startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - 
                    {endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                  <span className="text-gray-900">{duration.toFixed(1)} hours</span>
                </div>
              </div>

              <div className="mt-4 flex justify-between items-center">
                <div className="text-sm">
                  <span className="text-gray-500">Payment: </span>
                  <span className="font-medium text-gray-900 capitalize">{booking.paymentType}</span>
                  {aircraft && (
                    <>
                      <span className="text-gray-500 ml-4">Est. Cost: </span>
                      <span className="font-medium text-gray-900">
                        ${(duration * aircraft.hourlyRate + (booking.instructorId ? duration * 85 : 0)).toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  {!isPastBooking(booking) && (
                    /* Quick Action Buttons for Future Bookings */
                    booking.status === 'confirmed' && (
                    <>
                      <button className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors">
                        Modify
                      </button>
                      <button className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors">
                        Cancel
                      </button>
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