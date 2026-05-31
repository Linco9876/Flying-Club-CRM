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
    maxBookingDurationHours: 8
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
        maxBookingDurationHours: settings.max_booking_duration_hours ?? 8
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
        max_booking_duration_hours: formData.maxBookingDurationHours
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
        maxBookingDurationHours: settings.max_booking_duration_hours ?? 8
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
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="preventPastBookings"
                checked={formData.preventPastBookings}
                onChange={(e) => handleInputChange('preventPastBookings', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="preventPastBookings" className="text-sm text-gray-700">
                Prevent creating bookings in the past
              </label>
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

        <div className="pt-2 border-t border-gray-200">
          <BookingFieldSettings canEdit={canEdit} onFormChange={onFormChange} embedded />
        </div>
      </div>
    </div>
  );
};
