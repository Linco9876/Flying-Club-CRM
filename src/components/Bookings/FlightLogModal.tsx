import React, { useState, useEffect } from 'react';
import { X, Lock } from 'lucide-react';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useFlightLogSettings } from '../../hooks/useFlightLogSettings';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useAircraftRates } from '../../hooks/useAircraftRates';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface Booking {
  id: string;
  studentId: string;
  instructorId?: string;
  aircraftId: string;
  startTime: Date | string;
  endTime: Date | string;
  notes?: string;
  flightTypeId?: string;
}

interface FlightLogModalProps {
  booking: Booking;
  onClose: () => void;
  onSuccess: () => void;
}

export const FlightLogModal: React.FC<FlightLogModalProps> = ({
  booking,
  onClose,
  onSuccess,
}) => {
  const { createFlightLog } = useFlightLogs();
  const { settings } = useFlightLogSettings();
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();
  const { flightTypes, paymentMethods } = useBillingSettings();
  const { rates: aircraftRates } = useAircraftRates(booking.aircraftId);

  const aircraft = aircraftList.find((a) => a.id === booking.aircraftId);
  const currentTach = aircraft?.totalHours || 0;

  const startTime = booking.startTime instanceof Date ? booking.startTime : new Date(booking.startTime);
  const endTime = booking.endTime instanceof Date ? booking.endTime : new Date(booking.endTime);
  const defaultDuration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60) * 10) / 10;
  const isDualFlight = !!booking.instructorId;

  const [formData, setFormData] = useState({
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    start_tach: currentTach,
    end_tach: currentTach + defaultDuration,
    flight_duration: defaultDuration,
    dual_time: isDualFlight ? defaultDuration : 0,
    solo_time: isDualFlight ? 0 : defaultDuration,
    takeoffs: undefined as number | undefined,
    landings: undefined as number | undefined,
    comments: '',
    flight_type_id: booking.flightTypeId || '',
    payment_type: '',
    observations: '',
    oil_added: undefined as number | undefined,
    fuel_added: undefined as number | undefined,
    passengers: undefined as number | undefined,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tachAutoFilled, setTachAutoFilled] = useState(false);

  const selectedFlightType = flightTypes.find(ft => ft.id === formData.flight_type_id) ?? null;
  const selectedRate = aircraftRates.find(r => r.flightTypeId === formData.flight_type_id) ?? null;
  const isFree = selectedRate?.chargeType === 'free' || selectedRate?.chargeType === 'not_used';
  const isPaymentForced = !isFree && !!selectedFlightType?.forcedPaymentMethodId;

  // Auto-set or clear payment type when flight type changes
  useEffect(() => {
    if (!selectedFlightType) return;
    if (isFree) {
      setFormData(prev => ({ ...prev, payment_type: '' }));
      return;
    }
    if (selectedFlightType.forcedPaymentMethodId) {
      const forced = paymentMethods.find(pm => pm.id === selectedFlightType.forcedPaymentMethodId);
      if (forced) setFormData(prev => ({ ...prev, payment_type: forced.name }));
    } else {
      setFormData(prev => ({ ...prev, payment_type: '' }));
    }
  }, [formData.flight_type_id, isFree]);

  useEffect(() => {
    const calculateStartTach = async () => {
      if (!booking.aircraftId) return;
      try {
        const { data: logs, error } = await supabase
          .from('flight_logs')
          .select('start_time, end_time, start_tach, end_tach')
          .eq('aircraft_id', booking.aircraftId)
          .order('end_time', { ascending: false });

        if (error || !logs || logs.length === 0) return;

        const previousLog = logs.find(log => log.end_time && new Date(log.end_time) <= startTime);
        if (!previousLog) return;

        const startTach = parseFloat(previousLog.end_tach);
        const endTach = Math.round((startTach + defaultDuration) * 100) / 100;

        setFormData(prev => ({
          ...prev,
          start_tach: startTach,
          end_tach: endTach,
          flight_duration: defaultDuration,
          dual_time: isDualFlight ? defaultDuration : 0,
          solo_time: isDualFlight ? 0 : defaultDuration,
        }));
        setTachAutoFilled(true);
      } catch (err) {
        console.error('Error calculating start tach:', err);
      }
    };
    calculateStartTach();
  }, [booking.aircraftId]);

  const handleTachChange = (field: 'start_tach' | 'end_tach', value: string) => {
    const numValue = parseFloat(value) || 0;
    const newData = { ...formData, [field]: numValue };
    if (field === 'start_tach') {
      const duration = Math.max(0, formData.end_tach - numValue);
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    } else {
      const duration = Math.max(0, numValue - formData.start_tach);
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    }
    setFormData(newData);
  };

  const handleDurationChange = (value: string) => {
    const duration = parseFloat(value) || 0;
    setFormData({
      ...formData,
      flight_duration: duration,
      end_tach: formData.start_tach + duration,
      dual_time: isDualFlight ? duration : 0,
      solo_time: isDualFlight ? 0 : duration,
    });
  };

  const getFieldSetting = (fieldName: string) => settings.find((s) => s.field_name === fieldName);
  const isFieldEnabled = (fieldName: string) => getFieldSetting(fieldName)?.is_enabled || false;
  const isFieldMandatory = (fieldName: string) => getFieldSetting(fieldName)?.is_mandatory || false;

  const validateForm = (): string | null => {
    if (formData.start_tach >= formData.end_tach) return 'End tach must be greater than start tach';
    if (formData.flight_duration <= 0) return 'Flight duration must be positive';
    if (!formData.flight_type_id) return 'Please select a flight type';
    if (!isFree && !formData.payment_type) return 'Please select a payment type';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const validationError = validateForm();
      if (validationError) {
        toast.error(validationError);
        return;
      }
      setIsSubmitting(true);

      const logData = {
        booking_id: booking.id,
        aircraft_id: booking.aircraftId,
        student_id: booking.studentId,
        instructor_id: booking.instructorId,
        start_time: formData.start_time,
        end_time: formData.end_time,
        start_tach: formData.start_tach,
        end_tach: formData.end_tach,
        flight_duration: formData.flight_duration,
        dual_time: formData.dual_time,
        solo_time: formData.solo_time,
        takeoffs: formData.takeoffs,
        comments: formData.comments || undefined,
        flight_type_id: formData.flight_type_id || undefined,
        payment_type: formData.payment_type || undefined,
        ...(isFieldEnabled('landings') && { landings: formData.landings }),
        ...(isFieldEnabled('observations') && { observations: formData.observations }),
        ...(isFieldEnabled('oil_added') && { oil_added: formData.oil_added }),
        ...(isFieldEnabled('fuel_added') && { fuel_added: formData.fuel_added }),
        ...(isFieldEnabled('passengers') && { passengers: formData.passengers }),
      };

      const { error } = await createFlightLog(logData);
      if (error) {
        toast.error(error);
        return;
      }

      toast.success('Flight logged successfully');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log flight');
    } finally {
      setIsSubmitting(false);
    }
  };

  const student = users.find((u) => u.id === booking.studentId);
  const instructor = booking.instructorId ? users.find((u) => u.id === booking.instructorId) : null;
  const pilotInCommand = instructor ? instructor.name : (student?.name || 'Unknown');
  const otherPilot = instructor ? student?.name || 'Unknown' : (isDualFlight ? student?.name || 'Unknown' : 'Self');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-semibold text-gray-900">Log Flight</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Flight Summary */}
          <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Aircraft</span>
              <p className="font-medium text-gray-900">
                {aircraft ? `${aircraft.registration} – ${aircraft.make} ${aircraft.model}` : 'Unknown'}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Pilot in Command</span>
              <p className="font-medium text-gray-900">{pilotInCommand}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">
                {instructor ? 'Student' : 'Other Crew'}
              </span>
              <p className="font-medium text-gray-900">{otherPilot}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Flight Type</span>
              <p className="font-medium text-gray-900">{isDualFlight ? 'Dual (with Instructor)' : 'Solo'}</p>
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={new Date(formData.start_time).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, start_time: new Date(e.target.value).toISOString() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="datetime-local"
                value={new Date(formData.end_time).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, end_time: new Date(e.target.value).toISOString() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Tach / Duration */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.start_tach}
                onChange={(e) => handleTachChange('start_tach', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {tachAutoFilled && <p className="text-xs text-green-600 mt-1">Auto-filled from previous log</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.end_tach}
                onChange={(e) => handleTachChange('end_tach', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flight Duration (hrs) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.flight_duration}
                onChange={(e) => handleDurationChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {/* Takeoffs & Landings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Takeoffs &amp; Landings {isFieldMandatory('landings') && <span className="text-red-500">*</span>}
              </label>
              <input
                type="number"
                min="0"
                value={formData.takeoffs ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : undefined;
                  setFormData({ ...formData, takeoffs: val, landings: val });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldMandatory('landings')}
              />
            </div>
          </div>

          {/* Flight Type + Payment Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Flight Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.flight_type_id}
                onChange={(e) => setFormData(prev => ({ ...prev, flight_type_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select flight type</option>
                {flightTypes.map(ft => (
                  <option key={ft.id} value={ft.id}>{ft.name}</option>
                ))}
              </select>
              {isFree && formData.flight_type_id && (
                <p className="mt-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5 inline-block">
                  No charge — payment not required
                </p>
              )}
            </div>

            {!isFree && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <span className="flex items-center gap-1.5">
                    Payment Type <span className="text-red-500">*</span>
                    {isPaymentForced && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                        <Lock className="h-3 w-3" />
                        Required by flight type
                      </span>
                    )}
                  </span>
                </label>
                <select
                  value={formData.payment_type}
                  onChange={(e) => {
                    if (!isPaymentForced) setFormData(prev => ({ ...prev, payment_type: e.target.value }));
                  }}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isPaymentForced
                      ? 'border-amber-300 bg-amber-50 text-amber-900 cursor-not-allowed'
                      : 'border-gray-300'
                  }`}
                  required
                  disabled={isPaymentForced}
                >
                  <option value="">Select payment type</option>
                  {paymentMethods.map(pm => (
                    <option key={pm.id} value={pm.name}>{pm.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Comments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Comments</label>
            <textarea
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
              rows={3}
              placeholder="Flight notes, debrief summary, areas to work on..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Optional settings-controlled fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {isFieldEnabled('oil_added') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Oil Added (quarts) {isFieldMandatory('oil_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.oil_added || ''}
                  onChange={(e) => setFormData({ ...formData, oil_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldMandatory('oil_added')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_added') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fuel Added (gallons) {isFieldMandatory('fuel_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuel_added || ''}
                  onChange={(e) => setFormData({ ...formData, fuel_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldMandatory('fuel_added')}
                />
              </div>
            )}
            {isFieldEnabled('passengers') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Passengers {isFieldMandatory('passengers') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  value={formData.passengers || ''}
                  onChange={(e) => setFormData({ ...formData, passengers: e.target.value ? parseInt(e.target.value) : undefined })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldMandatory('passengers')}
                />
              </div>
            )}
          </div>

          {isFieldEnabled('observations') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observations {isFieldMandatory('observations') && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={formData.observations}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldMandatory('observations')}
              />
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Logging...' : 'Log Flight'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
