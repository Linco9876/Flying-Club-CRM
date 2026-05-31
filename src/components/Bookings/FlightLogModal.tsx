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
import { calculateFlightCost } from '../../utils/billing';

interface Booking {
  id: string;
  studentId: string;
  instructorId?: string;
  aircraftId: string;
  startTime: Date | string;
  endTime: Date | string;
  notes?: string;
  flightTypeId?: string;
  status?: string;
}

interface FlightLogModalProps {
  booking: Booking;
  onClose: () => void;
  onSuccess: () => void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
}

export const FlightLogModal: React.FC<FlightLogModalProps> = ({
  booking,
  onClose,
  onSuccess,
  onApproveBooking,
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
  const isDualFlight = !!booking.instructorId;
  const fieldClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tachAutoFilled, setTachAutoFilled] = useState(false);

  // Derive payment type from the pre-filled flight type (respects forced payment and free types)
  const derivePaymentType = (flightTypeId: string) => {
    if (!flightTypeId) return '';
    const ft = flightTypes.find(f => f.id === flightTypeId);
    if (!ft) return '';
    const rate = aircraftRates.find(r => r.flightTypeId === flightTypeId);
    const free = rate?.chargeType === 'free' || rate?.chargeType === 'not_used';
    if (free) return '';
    if (ft.forcedPaymentMethodId) {
      const pm = paymentMethods.find(p => p.id === ft.forcedPaymentMethodId);
      return pm?.name ?? '';
    }
    if (rate?.defaultPaymentMethodId) {
      const pm = paymentMethods.find(p => p.id === rate.defaultPaymentMethodId);
      return pm?.name ?? '';
    }
    return '';
  };

  const [formData, setFormData] = useState({
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    start_tach: currentTach,
    end_tach: '' as number | '',
    flight_duration: '' as number | '',
    dual_time: 0,
    solo_time: 0,
    takeoffs: undefined as number | undefined,
    landings: undefined as number | undefined,
    comments: '',
    flight_type_id: booking.flightTypeId || '',
    payment_type: derivePaymentType(booking.flightTypeId || ''),
    observations: '',
    oil_added: undefined as number | undefined,
    fuel_added: undefined as number | undefined,
    passengers: undefined as number | undefined,
  });

  const selectedFlightType = flightTypes.find(ft => ft.id === formData.flight_type_id) ?? null;
  const selectedRate = aircraftRates.find(r => r.flightTypeId === formData.flight_type_id) ?? null;
  const isFree = selectedRate?.chargeType === 'free' || selectedRate?.chargeType === 'not_used';
  const isPaymentForced = !isFree && !!selectedFlightType?.forcedPaymentMethodId;
  const estimatedCost = calculateFlightCost({
    rate: selectedRate,
    durationHours: formData.flight_duration === '' ? 0 : formData.flight_duration,
    isDual: isDualFlight,
    passengerCount: formData.passengers,
    startTime: formData.start_time,
  });

  // Re-derive payment type when billing data loads (paymentMethods/flightTypes async) or flight type changes
  useEffect(() => {
    if (!formData.flight_type_id || !flightTypes.length) return;
    const derived = derivePaymentType(formData.flight_type_id);
    setFormData(prev => ({ ...prev, payment_type: derived }));
  }, [formData.flight_type_id, flightTypes.length, aircraftRates.length, paymentMethods.length]);

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
        setFormData(prev => ({
          ...prev,
          start_tach: startTach,
        }));
        setTachAutoFilled(true);
      } catch (err) {
        console.error('Error calculating start tach:', err);
      }
    };
    calculateStartTach();
  }, [booking.aircraftId]);

  const handleTachChange = (field: 'start_tach' | 'end_tach', value: string) => {
    const numValue = value === '' ? '' : parseFloat(value);
    const newData = { ...formData, [field]: numValue };

    if (numValue === '' || Number.isNaN(numValue)) {
      if (field === 'end_tach') {
        newData.flight_duration = '';
        newData.dual_time = 0;
        newData.solo_time = 0;
      }
      setFormData(newData);
      return;
    }

    if (field === 'start_tach' && formData.end_tach !== '') {
      const duration = Math.max(0, formData.end_tach - numValue);
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    } else if (field === 'end_tach') {
      const duration = Math.max(0, numValue - formData.start_tach);
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    }
    setFormData(newData);
  };

  const handleDurationChange = (value: string) => {
    const duration = value === '' ? '' : parseFloat(value);
    if (duration === '' || Number.isNaN(duration)) {
      setFormData({
        ...formData,
        flight_duration: '',
        dual_time: 0,
        solo_time: 0,
      });
      return;
    }

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
    if (formData.end_tach === '') return 'Please enter end tach';
    if (formData.flight_duration === '') return 'Please enter flight duration';
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

      if (booking.status === 'pending_approval' && onApproveBooking) {
        await onApproveBooking(booking.id);
      }

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
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">Log Flight</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Flight Summary */}
          <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Time</label>
              <input
                type="datetime-local"
                value={new Date(formData.start_time).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, start_time: new Date(e.target.value).toISOString() })}
                className={fieldClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>End Time</label>
              <input
                type="datetime-local"
                value={new Date(formData.end_time).toISOString().slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, end_time: new Date(e.target.value).toISOString() })}
                className={fieldClass}
                required
              />
            </div>
          </div>

          {/* Tach / Duration */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>
                Start Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.start_tach}
                onChange={(e) => handleTachChange('start_tach', e.target.value)}
                className={fieldClass}
                required
              />
              {tachAutoFilled && <p className="text-xs text-green-600 mt-1">Auto-filled from previous log</p>}
            </div>
            <div>
              <label className={labelClass}>
                End Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.end_tach}
                onChange={(e) => handleTachChange('end_tach', e.target.value)}
                className={fieldClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>
                Duration <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.flight_duration}
                onChange={(e) => handleDurationChange(e.target.value)}
                className={fieldClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>
                T/O &amp; Landings {isFieldMandatory('landings') && <span className="text-red-500">*</span>}
              </label>
              <input
                type="number"
                min="0"
                value={formData.takeoffs ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : undefined;
                  setFormData({ ...formData, takeoffs: val, landings: val });
                }}
                className={fieldClass}
                required={isFieldMandatory('landings')}
              />
            </div>
          </div>

          {/* Flight Type + Payment Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                Flight Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.flight_type_id}
                onChange={(e) => setFormData(prev => ({ ...prev, flight_type_id: e.target.value }))}
                className={fieldClass}
                required
              >
                <option value="">Select flight type</option>
                {flightTypes.filter(ft => ft.active).map(ft => (
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
                <label className={labelClass}>
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
                  className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isPaymentForced
                      ? 'border-amber-300 bg-amber-50 text-amber-900 cursor-not-allowed'
                      : 'border-gray-300'
                  }`}
                  required
                  disabled={isPaymentForced}
                >
                  <option value="">Select payment type</option>
                  {paymentMethods.filter(pm => pm.active).map(pm => (
                    <option key={pm.id} value={pm.name}>{pm.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {formData.flight_type_id && formData.flight_duration !== '' && (
            <div className="rounded-lg border border-gray-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Estimated charge: <span className="font-semibold">${estimatedCost.toFixed(2)}</span>
              {selectedRate && (
                <span className="ml-2 text-xs text-blue-700">
                  {selectedRate.chargeType === 'tach'
                    ? `${isDualFlight ? 'Dual' : 'Solo'} tach rate`
                    : selectedRate.chargeType.replace('_', ' ')}
                </span>
              )}
            </div>
          )}

          {/* Comments */}
          <div>
            <label className={labelClass}>Comments</label>
            <textarea
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
              rows={2}
              placeholder="Flight notes, debrief summary, areas to work on..."
              className={fieldClass}
            />
          </div>

          {/* Optional settings-controlled fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {isFieldEnabled('oil_added') && (
              <div>
                <label className={labelClass}>
                  Oil Added (quarts) {isFieldMandatory('oil_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.oil_added || ''}
                  onChange={(e) => setFormData({ ...formData, oil_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('oil_added')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_added') && (
              <div>
                <label className={labelClass}>
                  Fuel Added (gallons) {isFieldMandatory('fuel_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuel_added || ''}
                  onChange={(e) => setFormData({ ...formData, fuel_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('fuel_added')}
                />
              </div>
            )}
            {isFieldEnabled('passengers') && (
              <div>
                <label className={labelClass}>
                  Passengers {isFieldMandatory('passengers') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  value={formData.passengers || ''}
                  onChange={(e) => setFormData({ ...formData, passengers: e.target.value ? parseInt(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('passengers')}
                />
              </div>
            )}
          </div>

          {isFieldEnabled('observations') && (
            <div>
              <label className={labelClass}>
                Observations {isFieldMandatory('observations') && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={formData.observations}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                rows={2}
                className={fieldClass}
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
