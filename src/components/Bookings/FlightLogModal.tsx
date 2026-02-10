import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useFlightLogSettings } from '../../hooks/useFlightLogSettings';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
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

  const aircraft = aircraftList.find((a) => a.id === booking.aircraftId);
  const currentTach = aircraft?.totalHours || 0;

  const startTime = booking.startTime instanceof Date ? booking.startTime : new Date(booking.startTime);
  const endTime = booking.endTime instanceof Date ? booking.endTime : new Date(booking.endTime);
  const defaultDuration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  const [formData, setFormData] = useState({
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    start_tach: currentTach,
    end_tach: currentTach + defaultDuration,
    flight_duration: defaultDuration,
    landings: undefined as number | undefined,
    payment_type: '',
    observations: '',
    oil_added: undefined as number | undefined,
    fuel_added: undefined as number | undefined,
    passengers: undefined as number | undefined,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tachAutoFilled, setTachAutoFilled] = useState(false);

  useEffect(() => {
    const calculateStartTach = async () => {
      if (!booking.aircraftId) {
        console.log('Skipping tach calculation - no aircraft ID');
        return;
      }

      console.log('Calculating start tach for aircraft:', booking.aircraftId);

      try {
        const { data: logs, error } = await supabase
          .from('flight_logs')
          .select('start_time, end_time, start_tach, end_tach')
          .eq('aircraft_id', booking.aircraftId)
          .order('end_time', { ascending: false });

        if (error) {
          console.error('Error fetching flight logs:', error);
          return;
        }

        console.log('Found flight logs:', logs?.length || 0);

        if (!logs || logs.length === 0) {
          console.log('No previous logs found');
          return;
        }

        const bookingStartTime = startTime;
        console.log('Booking start time:', bookingStartTime);

        const previousLog = logs.find(log => new Date(log.end_time) <= bookingStartTime);

        if (!previousLog) {
          console.log('No logs before this booking time');
          return;
        }

        console.log('Found previous log ending at:', previousLog.end_time, 'with end tach:', previousLog.end_tach);

        const startTach = parseFloat(previousLog.end_tach);
        console.log('Setting start tach to:', startTach);

        setFormData(prev => ({
          ...prev,
          start_tach: startTach,
          end_tach: startTach + defaultDuration,
        }));
        setTachAutoFilled(true);
      } catch (err) {
        console.error('Error calculating start tach:', err);
      }
    };

    calculateStartTach();
  }, [booking.aircraftId, startTime, defaultDuration]);

  const handleTachChange = (field: 'start_tach' | 'end_tach', value: string) => {
    const numValue = parseFloat(value) || 0;
    const newData = { ...formData, [field]: numValue };

    if (field === 'start_tach') {
      newData.flight_duration = Math.max(0, formData.end_tach - numValue);
    } else {
      newData.flight_duration = Math.max(0, numValue - formData.start_tach);
    }

    setFormData(newData);
  };

  const handleDurationChange = (value: string) => {
    const duration = parseFloat(value) || 0;
    setFormData({
      ...formData,
      flight_duration: duration,
      end_tach: formData.start_tach + duration,
    });
  };

  const getFieldSetting = (fieldName: string) => {
    return settings.find((s) => s.field_name === fieldName);
  };

  const isFieldEnabled = (fieldName: string) => {
    const setting = getFieldSetting(fieldName);
    return setting?.is_enabled || false;
  };

  const isFieldMandatory = (fieldName: string) => {
    const setting = getFieldSetting(fieldName);
    return setting?.is_mandatory || false;
  };

  const validateForm = (): string | null => {
    if (formData.start_tach >= formData.end_tach) {
      return 'End tach must be greater than start tach';
    }

    if (formData.flight_duration <= 0) {
      return 'Flight duration must be positive';
    }

    settings.forEach((setting) => {
      if (setting.is_mandatory && setting.is_enabled) {
        const value = formData[setting.field_name as keyof typeof formData];
        if (value === undefined || value === '' || value === null) {
          throw new Error(`${setting.field_name} is required`);
        }
      }
    });

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
        ...(isFieldEnabled('landings') && { landings: formData.landings }),
        ...(isFieldEnabled('payment_type') && { payment_type: formData.payment_type }),
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-xl font-semibold text-gray-900">Log Flight</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Aircraft
              </label>
              <input
                type="text"
                value={aircraft ? `${aircraft.registration} - ${aircraft.make} ${aircraft.model}` : 'Unknown'}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pilot
              </label>
              <input
                type="text"
                value={student?.name || 'Unknown'}
                disabled
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
              />
            </div>

            {instructor && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instructor
                </label>
                <input
                  type="text"
                  value={instructor.name || 'Unknown'}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="datetime-local"
                value={new Date(formData.start_time).toISOString().slice(0, 16)}
                onChange={(e) =>
                  setFormData({ ...formData, start_time: new Date(e.target.value).toISOString() })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="datetime-local"
                value={new Date(formData.end_time).toISOString().slice(0, 16)}
                onChange={(e) =>
                  setFormData({ ...formData, end_time: new Date(e.target.value).toISOString() })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

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
              {tachAutoFilled && (
                <p className="text-xs text-green-600 mt-1">
                  Auto-filled from previous flight log
                </p>
              )}
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
                value={formData.flight_duration.toFixed(1)}
                onChange={(e) => handleDurationChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {isFieldEnabled('landings') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Landings {isFieldMandatory('landings') && <span className="text-red-500">*</span>}
              </label>
              <input
                type="number"
                value={formData.landings || ''}
                onChange={(e) =>
                  setFormData({ ...formData, landings: e.target.value ? parseInt(e.target.value) : undefined })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldMandatory('landings')}
              />
            </div>
          )}

          {isFieldEnabled('payment_type') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Type {isFieldMandatory('payment_type') && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.payment_type}
                onChange={(e) => setFormData({ ...formData, payment_type: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={isFieldMandatory('payment_type')}
              >
                <option value="">Select payment type</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="account">Account</option>
                <option value="voucher">Voucher</option>
              </select>
            </div>
          )}

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
                  onChange={(e) =>
                    setFormData({ ...formData, oil_added: e.target.value ? parseFloat(e.target.value) : undefined })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, fuel_added: e.target.value ? parseFloat(e.target.value) : undefined })
                  }
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
                  onChange={(e) =>
                    setFormData({ ...formData, passengers: e.target.value ? parseInt(e.target.value) : undefined })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={isFieldMandatory('passengers')}
                />
              </div>
            )}
          </div>

          {isFieldEnabled('observations') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Observations/Comments {isFieldMandatory('observations') && <span className="text-red-500">*</span>}
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
