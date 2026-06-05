import React, { useState } from 'react';
import { AlertTriangle, X, Clock, Plane, User, CreditCard } from 'lucide-react';
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

interface BookingFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (bookingData: any) => void | Promise<void>;
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
  const { students } = useStudents();
  const { flightLogs } = useFlightLogs();
  const { settings: safetySettings } = useSafetySettings();
  const { settings, isFieldRequired, isFieldVisible } = useBookingFieldSettings();
  const { flightTypes } = useBillingSettings();
  const { settings: portalSettings } = usePortalUxSettings();
  const { settings: bookingRules } = useBookingRulesSettings();
  const { settings: organisationSettings } = useOrganisationSettings();
  const buildInitialFormData = React.useCallback(() => {
    const today = format(new Date(), 'yyyy-MM-dd');

    if (booking) {
      return {
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
      };
    }

    return {
      studentId: user?.id || '',
      date: prefilledData?.date || today,
      endDate: prefilledData?.date || today,
      startTime: normalizeToQuarterHour(prefilledData?.startTime) || '09:00',
      endTime: normalizeToQuarterHour(prefilledData?.endTime) || '11:00',
      aircraftId: prefilledData?.aircraftId || '',
      instructorId: prefilledData?.instructorId || '',
      paymentType: '',
      flightTypeId: '',
      notes: '',
    };
  }, [
    booking?.id,
    booking?.studentId,
    booking?.aircraftId,
    booking?.instructorId,
    booking?.paymentType,
    booking?.flightTypeId,
    booking?.notes,
    booking?.startTime,
    booking?.endTime,
    prefilledData?.date,
    prefilledData?.startTime,
    prefilledData?.endTime,
    prefilledData?.aircraftId,
    prefilledData?.instructorId,
    user?.id,
  ]);

  const [formData, setFormData] = useState(buildInitialFormData);
  const [pendingSafetySubmit, setPendingSafetySubmit] = useState<typeof formData | null>(null);
  const [safetyWarningState, setSafetyWarningState] = useState<{
    concerns: SafetyConcern[];
    blocking: boolean;
    pilotName: string;
    picHours: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Rebuild the whole form every time it opens so stale values cannot leak between bookings.
  React.useEffect(() => {
    if (!isOpen) return;
    setFormData(buildInitialFormData());
    setPendingSafetySubmit(null);
    setSafetyWarningState(null);
    setIsSubmitting(false);
  }, [buildInitialFormData, isOpen]);
  const validateFormData = () => {
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
    const userRoles = user?.roles && user.roles.length > 0 ? user.roles : [userRole];
    const isStudentOnlyUser = userRoles.includes('student') && !userRoles.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
    if (isStudentOnlyUser && !formData.instructorId) {
      toast.error('Students need an instructor assigned. Pilots can book aircraft solo.');
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

  const submitBookingData = async (data: typeof formData) => {
    if (isSubmitting || isLoading) return;
    setIsSubmitting(true);
    try {
      await onSubmit(data);
      onClose();
    } catch (error) {
      setIsSubmitting(false);
      throw error;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateFormData();
    if (!validation) return;

    const selectedPerson = students.find((student) => student.id === formData.studentId);
    if (selectedPerson) {
      const compliance = buildSafetyComplianceSummary(selectedPerson, safetySettings, flightLogs, {
        hasInstructor: Boolean(formData.instructorId)
      });
      const concerns = compliance.concerns;

      if (concerns.length > 0) {
        setSafetyWarningState({
          concerns,
          blocking: compliance.blockingConcerns.length > 0,
          pilotName: selectedPerson.name,
          picHours: compliance.picHours
        });
        setPendingSafetySubmit(formData);
        return;
      }
    }

    void submitBookingData(formData);
  };

  const availableAircraft = aircraft.filter(a => a.status === 'serviceable');
  const instructors = getInstructors();
  const userRole = user?.role || 'student';
  const displayUserRoles = user?.roles && user.roles.length > 0 ? user.roles : [userRole];
  const isStudentOnlyUser = displayUserRoles.includes('student') && !displayUserRoles.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role));
  const isLoading = aircraftLoading || usersLoading;
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

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-xs w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Booking' : 'New Booking'}
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
          {isLoading && (
            <div className="flex items-center justify-center py-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!isLoading && isFieldVisible('pilot', userRole) && (user?.role === 'admin' || user?.role === 'instructor') && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <User className="h-3.5 w-3.5 inline mr-1" />
                Pilot {isFieldRequired('pilot', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.studentId}
                onChange={(e) => setFormData(prev => ({ ...prev, studentId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('pilot', userRole)}
              >
                <option value="">Select a pilot</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
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

          {!isLoading && isFieldVisible('aircraft', userRole) && (
          <div className="flex flex-col gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                <Plane className="h-3.5 w-3.5 inline mr-1" />
                Aircraft {isFieldRequired('aircraft', userRole) && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.aircraftId}
                onChange={(e) => setFormData(prev => ({ ...prev, aircraftId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('aircraft', userRole)}
              >
                <option value="">Select aircraft</option>
                {availableAircraft.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.registration} — {a.make} {a.model}
                  </option>
                ))}
              </select>
            </div>

            {isFieldVisible('instructor', userRole) && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Instructor {(isFieldRequired('instructor', userRole) || isStudentOnlyUser) ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}
              </label>
              <select
                value={formData.instructorId}
                onChange={(e) => setFormData(prev => ({ ...prev, instructorId: e.target.value }))}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldRequired('instructor', userRole) || isStudentOnlyUser}
              >
                <option value="">{isStudentOnlyUser ? 'Select instructor' : 'Solo flight'}</option>
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              <CreditCard className="h-3.5 w-3.5 inline mr-1" />
              Flight Type {isFieldRequired('paymentType', userRole) && <span className="text-red-500">*</span>}
            </label>
            <select
              value={formData.flightTypeId}
              onChange={(e) => {
                const selected = flightTypes.find(ft => ft.id === e.target.value);
                setFormData(prev => ({
                  ...prev,
                  flightTypeId: e.target.value,
                  paymentType: selected?.name as any || '',
                }));
              }}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required={isFieldRequired('paymentType', userRole)}
            >
              <option value="">Select flight type</option>
              {flightTypes.filter(ft => ft.active).map(ft => (
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
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Booking' : 'Create Booking')}
            </button>
          </div>
        </form>
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
