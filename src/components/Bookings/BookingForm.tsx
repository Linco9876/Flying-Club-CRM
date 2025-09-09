import React, { useState } from 'react';
import { X, Calendar, Clock, Plane, User, CreditCard } from 'lucide-react';
import { mockAircraft, mockStudents } from '../../data/mockData';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

interface BookingFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bookingData: any) => void;
  booking?: Booking | null;
  isEdit?: boolean;
  prefilledData?: {
    date?: string;
    startTime?: string;
    endTime?: string;
    aircraftId?: string;
    instructorId?: string;
  };
}

const BookingForm: React.FC<BookingFormProps> = ({ isOpen, onClose, onSubmit, booking, isEdit, prefilledData }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    studentId: booking?.studentId || (user?.role === 'student' ? user.id : ''),
    date: booking ? format(new Date(booking.startTime), 'yyyy-MM-dd') : (prefilledData?.date || format(new Date(), 'yyyy-MM-dd')),
    endDate: booking ? format(new Date(booking.endTime), 'yyyy-MM-dd') : (prefilledData?.date || format(new Date(), 'yyyy-MM-dd')),
    startTime: booking ? format(new Date(booking.startTime), 'HH:mm') : (prefilledData?.startTime || '09:00'),
    endTime: booking ? format(new Date(booking.endTime), 'HH:mm') : (prefilledData?.endTime || '11:00'),
    aircraftId: booking?.aircraftId || prefilledData?.aircraftId || '',
    instructorId: booking?.instructorId || prefilledData?.instructorId || '',
    paymentType: booking?.paymentType || 'prepaid' as const,
    notes: booking?.notes || ''
  });

  // Update form data when prefilledData changes
  React.useEffect(() => {
    if (booking) {
      setFormData({
        studentId: booking.studentId,
        date: format(new Date(booking.startTime), 'yyyy-MM-dd'),
        endDate: format(new Date(booking.endTime), 'yyyy-MM-dd'),
        startTime: format(new Date(booking.startTime), 'HH:mm'),
        endTime: format(new Date(booking.endTime), 'HH:mm'),
        aircraftId: booking.aircraftId,
        instructorId: booking.instructorId || '',
        paymentType: booking.paymentType,
        notes: booking.notes || ''
      });
    } else if (prefilledData) {
      setFormData(prev => ({
        ...prev,
        date: prefilledData.date || prev.date,
        endDate: prefilledData.date || prev.endDate,
        startTime: prefilledData.startTime || prev.startTime,
        endTime: prefilledData.endTime || prev.endTime
      }));
    }
  }, [prefilledData, booking]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!formData.studentId || !formData.aircraftId || !formData.date || !formData.endDate || !formData.startTime || !formData.endTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Check aircraft availability
    const aircraft = mockAircraft.find(a => a.id === formData.aircraftId);
    if (aircraft?.status !== 'serviceable') {
      toast.error('Selected aircraft is not serviceable');
      return;
    }

    onSubmit(formData);
    onClose();
  };

  if (!isOpen) return null;

  const availableAircraft = mockAircraft.filter(a => a.status === 'serviceable');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEdit ? 'Edit Booking' : 'New Booking'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {(user?.role === 'admin' || user?.role === 'instructor') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="h-4 w-4 inline mr-2" />
                Student *
              </label>
              <select
                value={formData.studentId}
                onChange={(e) => setFormData(prev => ({ ...prev, studentId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a student</option>
                {mockStudents.map(student => (
                  <option key={student.id} value={student.id}>
                    {student.name} - {student.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Clock className="h-4 w-4 inline mr-2" />
                Start Time *
              </label>
              <input
                type="time"
                value={formData.startTime}
                onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date *
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Time *
              </label>
              <input
                type="time"
                value={formData.endTime}
                onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Plane className="h-4 w-4 inline mr-2" />
              Aircraft *
            </label>
            <select
              value={formData.aircraftId}
              onChange={(e) => setFormData(prev => ({ ...prev, aircraftId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select an aircraft</option>
              {availableAircraft.map(aircraft => (
                <option key={aircraft.id} value={aircraft.id}>
                  {aircraft.registration} - {aircraft.make} {aircraft.model} (${aircraft.hourlyRate}/hr)
                </option>
              ))}
            </select>
          </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instructor (Optional)
              </label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Solo flight</option>
                <option value="2">Chief Flying Instructor</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CreditCard className="h-4 w-4 inline mr-2" />
                Payment Type *
              </label>
              <select
                value={formData.paymentType}
                onChange={(e) => setFormData(prev => ({ ...prev, paymentType: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="prepaid">Prepaid Account</option>
                <option value="payg">Pay As You Go</option>
                <option value="account">Monthly Account</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Lesson details, special requirements, etc."
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {isEdit ? 'Update Booking' : 'Create Booking'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Helper function for date formatting
function format(date: Date | number, formatStr: string): string {
  // Simple format implementation for demo
  const d = new Date(date);
  
  if (formatStr === 'yyyy-MM-dd') {
    return d.toISOString().split('T')[0];
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

export default BookingForm;