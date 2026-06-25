import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useBookingRulesSettings } from '../../hooks/useSettings';
import { BookingFieldSettings } from './BookingFieldSettings';

interface BookingRulesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const BookingRulesSettings: React.FC<BookingRulesSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useBookingRulesSettings();
  const [formData, setFormData] = useState({
    minBookingNoticeHours: 2,
    maxBookingAdvanceDays: 30,
    allowDoubleBooking: false,
    requireInstructorApproval: false,
    cancellationNoticeHours: 24,
    enforceMinNotice: true,
    enforceMaxAdvance: true,
    enforceCancellationNotice: true,
    preventPastBookings: true,
    enforceMaxDuration: true,
    maxBookingDurationHours: 8,
    fatigueRulesEnabled: true,
    fatigueLateFinishTime: '22:00',
    fatigueEarlyStartTime: '07:00',
    fatigueMinRestHours: 10,
    fatigueMaxDutyHoursPerDay: 10,
    fatigueMaxFlightHoursPerDay: 7,
    fatigueMaxLateFinishes7Days: 3,
    fatigueIncludeSupervision: true,
    fatigueBlockOnBreach: true
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        minBookingNoticeHours: settings.min_booking_notice_hours,
        maxBookingAdvanceDays: settings.max_booking_advance_days,
        allowDoubleBooking: settings.allow_double_booking,
        requireInstructorApproval: settings.require_instructor_approval,
        cancellationNoticeHours: settings.cancellation_notice_hours,
        enforceMinNotice: settings.enforce_min_notice,
        enforceMaxAdvance: settings.enforce_max_advance,
        enforceCancellationNotice: settings.enforce_cancellation_notice,
        preventPastBookings: settings.prevent_past_bookings ?? true,
        enforceMaxDuration: settings.enforce_max_duration ?? true,
        maxBookingDurationHours: settings.max_booking_duration_hours ?? 8,
        fatigueRulesEnabled: settings.fatigue_rules_enabled ?? true,
        fatigueLateFinishTime: settings.fatigue_late_finish_time ?? '22:00',
        fatigueEarlyStartTime: settings.fatigue_early_start_time ?? '07:00',
        fatigueMinRestHours: settings.fatigue_min_rest_hours ?? 10,
        fatigueMaxDutyHoursPerDay: settings.fatigue_max_duty_hours_per_day ?? 10,
        fatigueMaxFlightHoursPerDay: settings.fatigue_max_flight_hours_per_day ?? 7,
        fatigueMaxLateFinishes7Days: settings.fatigue_max_late_finishes_7_days ?? 3,
        fatigueIncludeSupervision: settings.fatigue_include_supervision ?? true,
        fatigueBlockOnBreach: settings.fatigue_block_on_breach ?? true
      });
    }
  }, [settings]);

  useEffect(() => {
    (window as any).__bookingrulesSettingsSave = async () => {
      await updateSettings({
        min_booking_notice_hours: formData.minBookingNoticeHours,
        max_booking_advance_days: formData.maxBookingAdvanceDays,
        allow_double_booking: formData.allowDoubleBooking,
        require_instructor_approval: formData.requireInstructorApproval,
        cancellation_notice_hours: formData.cancellationNoticeHours,
        enforce_min_notice: formData.enforceMinNotice,
        enforce_max_advance: formData.enforceMaxAdvance,
        enforce_cancellation_notice: formData.enforceCancellationNotice,
        prevent_past_bookings: formData.preventPastBookings,
        enforce_max_duration: formData.enforceMaxDuration,
        max_booking_duration_hours: formData.maxBookingDurationHours,
        fatigue_rules_enabled: formData.fatigueRulesEnabled,
        fatigue_late_finish_time: formData.fatigueLateFinishTime,
        fatigue_early_start_time: formData.fatigueEarlyStartTime,
        fatigue_min_rest_hours: formData.fatigueMinRestHours,
        fatigue_max_duty_hours_per_day: formData.fatigueMaxDutyHoursPerDay,
        fatigue_max_flight_hours_per_day: formData.fatigueMaxFlightHoursPerDay,
        fatigue_max_late_finishes_7_days: formData.fatigueMaxLateFinishes7Days,
        fatigue_include_supervision: formData.fatigueIncludeSupervision,
        fatigue_block_on_breach: formData.fatigueBlockOnBreach
      });
      await (window as any).__bookingFieldsEmbeddedSave?.();
    };
    (window as any).__bookingrulesSettingsCancel = () => {
      if (!settings) return;
      setFormData({
        minBookingNoticeHours: settings.min_booking_notice_hours,
        maxBookingAdvanceDays: settings.max_booking_advance_days,
        allowDoubleBooking: settings.allow_double_booking,
        requireInstructorApproval: settings.require_instructor_approval,
        cancellationNoticeHours: settings.cancellation_notice_hours,
        enforceMinNotice: settings.enforce_min_notice,
        enforceMaxAdvance: settings.enforce_max_advance,
        enforceCancellationNotice: settings.enforce_cancellation_notice,
        preventPastBookings: settings.prevent_past_bookings ?? true,
        enforceMaxDuration: settings.enforce_max_duration ?? true,
        maxBookingDurationHours: settings.max_booking_duration_hours ?? 8,
        fatigueRulesEnabled: settings.fatigue_rules_enabled ?? true,
        fatigueLateFinishTime: settings.fatigue_late_finish_time ?? '22:00',
        fatigueEarlyStartTime: settings.fatigue_early_start_time ?? '07:00',
        fatigueMinRestHours: settings.fatigue_min_rest_hours ?? 10,
        fatigueMaxDutyHoursPerDay: settings.fatigue_max_duty_hours_per_day ?? 10,
        fatigueMaxFlightHoursPerDay: settings.fatigue_max_flight_hours_per_day ?? 7,
        fatigueMaxLateFinishes7Days: settings.fatigue_max_late_finishes_7_days ?? 3,
        fatigueIncludeSupervision: settings.fatigue_include_supervision ?? true,
        fatigueBlockOnBreach: settings.fatigue_block_on_breach ?? true
      });
      (window as any).__bookingFieldsEmbeddedCancel?.();
    };
    return () => {
      delete (window as any).__bookingrulesSettingsSave;
      delete (window as any).__bookingrulesSettingsCancel;
    };
  }, [formData, settings, updateSettings]);

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Bookings & Rules
        </h2>
        <p className="text-gray-600">Configure booking constraints and validation rules</p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Booking Limits</h3>
          <div className="space-y-6">
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="enforceMaxAdvance"
                    checked={formData.enforceMaxAdvance}
                    onChange={(e) => handleInputChange('enforceMaxAdvance', e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                  />
                  <label htmlFor="enforceMaxAdvance" className="text-sm font-medium text-gray-700">
                    Enforce Maximum Advance Booking
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Advance Booking (days)</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={formData.maxBookingAdvanceDays}
                  onChange={(e) => handleInputChange('maxBookingAdvanceDays', parseInt(e.target.value))}
                  disabled={!canEdit || !formData.enforceMaxAdvance}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">How far in advance users can book</p>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="enforceMinNotice"
                    checked={formData.enforceMinNotice}
                    onChange={(e) => handleInputChange('enforceMinNotice', e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                  />
                  <label htmlFor="enforceMinNotice" className="text-sm font-medium text-gray-700">
                    Enforce Minimum Booking Notice
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Booking Notice (hours)</label>
                <input
                  type="number"
                  min="0"
                  max="48"
                  value={formData.minBookingNoticeHours}
                  onChange={(e) => handleInputChange('minBookingNoticeHours', parseInt(e.target.value))}
                  disabled={!canEdit || !formData.enforceMinNotice}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Minimum notice required before flight</p>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="enforceCancellationNotice"
                    checked={formData.enforceCancellationNotice}
                    onChange={(e) => handleInputChange('enforceCancellationNotice', e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                  />
                  <label htmlFor="enforceCancellationNotice" className="text-sm font-medium text-gray-700">
                    Enforce Cancellation Notice
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cancellation Notice (hours)</label>
                <input
                  type="number"
                  min="0"
                  max="72"
                  value={formData.cancellationNoticeHours}
                  onChange={(e) => handleInputChange('cancellationNoticeHours', parseInt(e.target.value))}
                  disabled={!canEdit || !formData.enforceCancellationNotice}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
                <p className="text-xs text-gray-500 mt-1">Required notice for cancellations</p>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <div className="flex items-center space-x-3 mb-3">
                <input
                  type="checkbox"
                  id="enforceMaxDuration"
                  checked={formData.enforceMaxDuration}
                  onChange={(e) => handleInputChange('enforceMaxDuration', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="enforceMaxDuration" className="text-sm font-medium text-gray-700">
                  Enforce Maximum Booking Duration
                </label>
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Duration (hours)</label>
              <input
                type="number"
                min="1"
                max="24"
                value={formData.maxBookingDurationHours}
                onChange={(e) => handleInputChange('maxBookingDurationHours', parseInt(e.target.value))}
                disabled={!canEdit || !formData.enforceMaxDuration}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Stops accidental all-day or overnight allocations</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Booking Permissions</h3>
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">Past bookings are allowed</p>
              <p className="mt-1 text-sm text-amber-800">
                The booking form warns users when a start time is in the past, but still allows the booking to be created for backdating and admin corrections.
              </p>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allowDoubleBooking"
                checked={formData.allowDoubleBooking}
                onChange={(e) => handleInputChange('allowDoubleBooking', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="allowDoubleBooking" className="text-sm text-gray-700">
                Allow overlapping requests on the waiting list
              </label>
            </div>

            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id="requireInstructorApproval"
                  checked={formData.requireInstructorApproval}
                  onChange={(e) => handleInputChange('requireInstructorApproval', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 mt-0.5"
                />
                <div>
                  <label htmlFor="requireInstructorApproval" className="text-sm font-medium text-gray-700 block">
                    Require instructor approval for solo flights
                  </label>
                  <p className="text-xs text-gray-600 mt-1">
                    When enabled, solo flight bookings will be set to pending status and all admins and instructors will receive a notification to approve the booking.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Fatigue Management</h3>
          <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                id="fatigueRulesEnabled"
                checked={formData.fatigueRulesEnabled}
                onChange={(e) => handleInputChange('fatigueRulesEnabled', e.target.checked)}
                disabled={!canEdit}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <div>
                <label htmlFor="fatigueRulesEnabled" className="text-sm font-semibold text-gray-900">
                  Apply instructor fatigue checks to bookings
                </label>
                <p className="mt-1 text-xs text-blue-900">
                  Reference: CASA plain English fatigue guide. These are configurable local controls for rostering and supervision; they do not replace the operator's full fatigue management obligations.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Late finish starts after</label>
                <input
                  type="time"
                  value={formData.fatigueLateFinishTime}
                  onChange={(e) => handleInputChange('fatigueLateFinishTime', e.target.value)}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Early start before</label>
                <input
                  type="time"
                  value={formData.fatigueEarlyStartTime}
                  onChange={(e) => handleInputChange('fatigueEarlyStartTime', e.target.value)}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Minimum rest between instructor duties (hours)</label>
                <input
                  type="number"
                  min="0"
                  max="24"
                  value={formData.fatigueMinRestHours}
                  onChange={(e) => handleInputChange('fatigueMinRestHours', parseFloat(e.target.value))}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Maximum instructor duty span per day (hours)</label>
                <input
                  type="number"
                  min="1"
                  max="16"
                  step="0.5"
                  value={formData.fatigueMaxDutyHoursPerDay}
                  onChange={(e) => handleInputChange('fatigueMaxDutyHoursPerDay', parseFloat(e.target.value))}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Maximum booked flight/supervision time per day (hours)</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="0.5"
                  value={formData.fatigueMaxFlightHoursPerDay}
                  onChange={(e) => handleInputChange('fatigueMaxFlightHoursPerDay', parseFloat(e.target.value))}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Maximum late finishes in 7 days</label>
                <input
                  type="number"
                  min="0"
                  max="7"
                  value={formData.fatigueMaxLateFinishes7Days}
                  onChange={(e) => handleInputChange('fatigueMaxLateFinishes7Days', parseInt(e.target.value))}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formData.fatigueIncludeSupervision}
                  onChange={(e) => handleInputChange('fatigueIncludeSupervision', e.target.checked)}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span>
                  Count supervision and instructor bookings in fatigue limits
                  <span className="block text-xs text-gray-500">Use this for senior instructors supervising other instructors as part of their duty day.</span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formData.fatigueBlockOnBreach}
                  onChange={(e) => handleInputChange('fatigueBlockOnBreach', e.target.checked)}
                  disabled={!canEdit || !formData.fatigueRulesEnabled}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span>
                  Block bookings that breach fatigue rules
                  <span className="block text-xs text-gray-500">Turn off to warn only while you are testing the limits.</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-200">
          <BookingFieldSettings canEdit={canEdit} onFormChange={onFormChange} embedded />
        </div>
      </div>
    </div>
  );
};
