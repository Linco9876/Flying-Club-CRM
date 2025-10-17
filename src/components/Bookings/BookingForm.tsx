import React, { useState } from 'react';
import { X, Clock, Plane, User, CreditCard } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useBookingFieldSettings } from '../../hooks/useBookingFieldSettings';
import { Booking } from '../../types';
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
  const { aircraft, loading: aircraftLoading } = useAircraft();
  const { users, getInstructors, loading: usersLoading } = useUsers();
  const { settings, isFieldRequired, isFieldVisible } = useBookingFieldSettings();
  const [formData, setFormData] = useState({
    studentId: booking?.studentId || (user?.role === 'student' ? user.id : ''),
    date: booking
      ? format(new Date(booking.startTime), 'yyyy-MM-dd')
      : prefilledData?.date || format(new Date(), 'yyyy-MM-dd'),
    endDate: booking
      ? format(new Date(booking.endTime), 'yyyy-MM-dd')
      : prefilledData?.date || format(new Date(), 'yyyy-MM-dd'),
    startTime: booking
      ? normalizeToQuarterHour(format(new Date(booking.startTime), 'HH:mm'))
      : normalizeToQuarterHour(prefilledData?.startTime) || '09:00',
    endTime: booking
      ? normalizeToQuarterHour(format(new Date(booking.endTime), 'HH:mm'))
      : normalizeToQuarterHour(prefilledData?.endTime) || '11:00',
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
        startTime: normalizeToQuarterHour(
          format(new Date(booking.startTime), 'HH:mm')
        ),
        endTime: normalizeToQuarterHour(
          format(new Date(booking.endTime), 'HH:mm')
        ),
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
        startTime:
          normalizeToQuarterHour(prefilledData.startTime) || prev.startTime,
        endTime:
          normalizeToQuarterHour(prefilledData.endTime) || prev.endTime
      }));
    }
  }, [prefilledData, booking]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const userRole = user?.role || 'student';

    if (isFieldRequired('pilot', userRole) && !formData.studentId) {
      toast.error('Pilot is required');
      return;
    }
    if (isFieldRequired('aircraft', userRole) && !formData.aircraftId) {
      toast.error('Aircraft is required');
      return;
    }
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
    if (isFieldRequired('paymentType', userRole) && !formData.paymentType) {
      toast.error('Payment type is required');
      return;
    }

    const selectedAircraft = aircraft.find(a => a.id === formData.aircraftId);
    if (selectedAircraft && selectedAircraft.status !== 'serviceable') {
      toast.error('Selected aircraft is not serviceable');
      return;
    }

    const startDateTime = new Date(`${formData.date}T${formData.startTime}`);
    const endDateTime = new Date(`${formData.endDate}T${formData.endTime}`);

    if (endDateTime <= startDateTime) {
      toast.error('End time must be after start time');
      return;
    }

    onSubmit(formData);
    onClose();
  };

  const availableAircraft = aircraft.filter(a => a.status === 'serviceable');
  const instructors = getInstructors();
  const userRole = user?.role || 'student';
  const isLoading = aircraftLoading || usersLoading;
  const timeOptions = React.useMemo(() => generateTimeOptions(6, 21), []);

  if (!isOpen) return null;

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
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!isLoading && isFieldVisible('pilot', userRole) && (user?.role === 'admin' || user?.role === 'instructor') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="h-4 w-4 inline mr-2" />
                Pilot {isFieldRequired('pilot', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.studentId}
                onChange={(e) => setFormData(prev => ({ ...prev, studentId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('pilot', userRole)}
              >
                <option value="">Select a pilot</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} - {u.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isLoading && isFieldVisible('startDate', userRole) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Start Date {isFieldRequired('startDate', userRole) && <span className="text-red-500">*</span>}
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required={isFieldRequired('startDate', userRole)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Clock className="h-4 w-4 inline mr-2" />
                Start Time {isFieldRequired('startTime', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.startTime}
                onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required={isFieldRequired('startTime', userRole)}
              >
                <option value="">Select a start time</option>
                {timeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {!isLoading && isFieldVisible('endDate', userRole) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Date {isFieldRequired('endDate', userRole) && <span className="text-red-500">*</span>}
              </label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required={isFieldRequired('endDate', userRole)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                End Time {isFieldRequired('endTime', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.endTime}
                onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-10"
                required={isFieldRequired('endTime', userRole)}
              >
                <option value="">Select an end time</option>
                {timeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          )}

          {!isLoading && isFieldVisible('aircraft', userRole) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Plane className="h-4 w-4 inline mr-2" />
              Aircraft {isFieldRequired('aircraft', userRole) && <span className="text-red-500">*</span>}
            </label>
            <select
              value={formData.aircraftId}
              onChange={(e) => setFormData(prev => ({ ...prev, aircraftId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={isFieldRequired('aircraft', userRole)}
            >
              <option value="">Select an aircraft</option>
              {availableAircraft.map(a => (
                <option key={a.id} value={a.id}>
                  {a.registration} - {a.make} {a.model} (${a.hourlyRate}/hr)
                </option>
              ))}
            </select>
          </div>

            {isFieldVisible('instructor', userRole) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Instructor {isFieldRequired('instructor', userRole) ? <span className="text-red-500">*</span> : '(Optional)'}
              </label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('instructor', userRole)}
              >
                <option value="">Solo flight</option>
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

          {!isLoading && isFieldVisible('paymentType', userRole) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <CreditCard className="h-4 w-4 inline mr-2" />
                Payment Type {isFieldRequired('paymentType', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.paymentType}
                onChange={(e) => setFormData(prev => ({ ...prev, paymentType: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('paymentType', userRole)}
              >
                <option value="prepaid">Prepaid Account</option>
                <option value="payg">Pay As You Go</option>
                <option value="account">Monthly Account</option>
              </select>
            </div>
          </div>
          )}

          {!isLoading && isFieldVisible('notes', userRole) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes {isFieldRequired('notes', userRole) && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Lesson details, special requirements, etc."
              required={isFieldRequired('notes', userRole)}
            />
          </div>
          )}

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

  for (let hour = normalizedStart; hour <= normalizedEnd; hour++) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const minute = quarter * 15;
      const time = `${hour.toString().padStart(2, '0')}:${minute
        .toString()
        .padStart(2, '0')}`;
      options.push(time);
    }
  }

  return options;
}

export default BookingForm;
