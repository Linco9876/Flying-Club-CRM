import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useGroundSessionDescriptions } from '../../hooks/useGroundSessionDescriptions';
import { useGroundSessionLogs } from '../../hooks/useGroundSessionLogs';
import { useUsers } from '../../hooks/useUsers';
import { Booking } from '../../types';

interface GroundSessionLogModalProps {
  booking: Booking;
  onClose: () => void;
  onSuccess: () => void;
  mode?: 'create' | 'edit';
  groundSessionLogId?: string;
}

export const GroundSessionLogModal: React.FC<GroundSessionLogModalProps> = ({
  booking,
  onClose,
  onSuccess,
  mode = 'create',
  groundSessionLogId,
}) => {
  const { flightTypes, paymentMethods } = useBillingSettings();
  const { options: descriptionOptions, loading: descriptionLoading } = useGroundSessionDescriptions();
  const { logs, loading: logsLoading, createGroundSessionLog, updateGroundSessionLog } = useGroundSessionLogs(booking.id);
  const { users } = useUsers();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    start_time: new Date(booking.startTime).toISOString(),
    end_time: new Date(booking.endTime).toISOString(),
    duration_hours: Math.max(
      0.25,
      Math.round((((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / (1000 * 60 * 60)) + Number.EPSILON) * 10) / 10
    ),
    flight_type_id: booking.flightTypeId || '',
    payment_type: booking.paymentType || '',
    description_option_id: '',
    description_text: '',
    notes: booking.notes || '',
  });

  const activeDescriptions = descriptionOptions.filter(option => option.active);
  const activeFlightTypes = flightTypes.filter(type => type.active);
  const activePaymentMethods = paymentMethods.filter(method => method.active);
  const selectedFlightType = activeFlightTypes.find(type => type.id === formData.flight_type_id);
  const selectedDescription = activeDescriptions.find(option => option.id === formData.description_option_id);
  const memberName = users.find(user => user.id === booking.studentId)?.name || booking.hirerName || 'Member';
  const instructorName = users.find(user => user.id === booking.instructorId)?.name || booking.instructorName || 'Instructor';
  const estimatedCost = useMemo(() => {
    const hourlyRate = Number(selectedFlightType?.groundSessionHourlyRate ?? 0);
    return Math.round((hourlyRate * Number(formData.duration_hours || 0) + Number.EPSILON) * 100) / 100;
  }, [formData.duration_hours, selectedFlightType?.groundSessionHourlyRate]);

  useEffect(() => {
    if (mode !== 'edit' || !groundSessionLogId || logsLoading) return;
    const existing = logs.find(log => log.id === groundSessionLogId);
    if (!existing) return;
    setFormData({
      start_time: existing.startTime,
      end_time: existing.endTime,
      duration_hours: existing.durationHours,
      flight_type_id: existing.flightTypeId || '',
      payment_type: existing.paymentType || '',
      description_option_id: existing.descriptionOptionId || '',
      description_text: existing.descriptionText || '',
      notes: existing.notes || '',
    });
  }, [groundSessionLogId, logs, logsLoading, mode]);

  useEffect(() => {
    if (!selectedFlightType) return;
    const forcedMethod = selectedFlightType.forcedPaymentMethodId
      ? activePaymentMethods.find(method => method.id === selectedFlightType.forcedPaymentMethodId)
      : null;
    if (forcedMethod && formData.payment_type !== forcedMethod.name) {
      setFormData(current => ({ ...current, payment_type: forcedMethod.name }));
    }
  }, [activePaymentMethods, formData.payment_type, selectedFlightType]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    if (!booking.studentId) {
      toast.error('Ground session bookings need a member linked to them');
      return;
    }
    if (!booking.instructorId) {
      toast.error('Ground session bookings need an instructor assigned');
      return;
    }
    if (!formData.flight_type_id) {
      toast.error('Booking type is required');
      return;
    }
    if (!formData.payment_type) {
      toast.error('Payment method is required');
      return;
    }
    if (!formData.description_option_id) {
      toast.error('Description is required');
      return;
    }
    if (Number(formData.duration_hours || 0) <= 0) {
      toast.error('Duration must be greater than zero');
      return;
    }

    setIsSubmitting(true);
    const payload = {
      booking_id: booking.id,
      student_id: booking.studentId,
      instructor_id: booking.instructorId,
      start_time: formData.start_time,
      end_time: formData.end_time,
      duration_hours: Number(formData.duration_hours || 0),
      flight_type_id: formData.flight_type_id,
      payment_type: formData.payment_type,
      description_option_id: formData.description_option_id,
      description_text: selectedDescription?.name || formData.description_text || '',
      notes: formData.notes,
    };

    const result = mode === 'edit' && groundSessionLogId
      ? await updateGroundSessionLog(groundSessionLogId, payload)
      : await createGroundSessionLog(payload);

    setIsSubmitting(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    toast.success(mode === 'edit' ? 'Ground session log updated' : 'Ground session logged');
    onSuccess();
    onClose();
  };

  const isLoading = logsLoading || descriptionLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {(isLoading || isSubmitting) && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/85">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-blue-100 bg-white px-5 py-4 shadow-lg">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <p className="text-sm font-semibold text-gray-900">
                {isSubmitting ? 'Saving ground session...' : 'Loading ground session details...'}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {mode === 'edit' ? 'Edit Ground Session Log' : 'Log Ground Session'}
            </h2>
            <p className="text-sm text-gray-500">
              {memberName} with {instructorName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="space-y-5 p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Session Start</span>
                <input
                  type="datetime-local"
                  value={formData.start_time.slice(0, 16)}
                  onChange={(event) => setFormData(current => ({
                    ...current,
                    start_time: new Date(event.target.value).toISOString(),
                  }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Duration (hours)</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={formData.duration_hours}
                  onChange={(event) => {
                    const duration = Number(event.target.value || 0);
                    const start = new Date(formData.start_time);
                    const end = new Date(start.getTime() + duration * 60 * 60 * 1000);
                    setFormData(current => ({
                      ...current,
                      duration_hours: duration,
                      end_time: end.toISOString(),
                    }));
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Booking Type</span>
                <select
                  value={formData.flight_type_id}
                  onChange={(event) => setFormData(current => ({ ...current, flight_type_id: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select booking type</option>
                  {activeFlightTypes.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Payment Method</span>
                <select
                  value={formData.payment_type}
                  onChange={(event) => setFormData(current => ({ ...current, payment_type: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select payment method</option>
                  {activePaymentMethods.map(method => (
                    <option key={method.id} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Description</span>
                <select
                  value={formData.description_option_id}
                  onChange={(event) => setFormData(current => ({ ...current, description_option_id: event.target.value }))}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">Select description</option>
                  {activeDescriptions.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Estimated Charge</p>
                <p className="mt-1 text-2xl font-bold text-blue-950">${estimatedCost.toFixed(2)}</p>
                <p className="mt-1 text-xs text-blue-700">
                  {selectedFlightType
                    ? `${selectedFlightType.name} at $${Number(selectedFlightType.groundSessionHourlyRate || 0).toFixed(2)} per hour`
                    : 'Select a booking type to calculate the charge'}
                </p>
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notes</span>
              <textarea
                value={formData.notes}
                onChange={(event) => setFormData(current => ({ ...current, notes: event.target.value }))}
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder="Anything else to include on the ground session record or invoice."
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mode === 'edit' ? 'Save Ground Session' : 'Log Ground Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
