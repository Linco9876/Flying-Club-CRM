import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useBookingRulesSettings } from '../../hooks/useSettings';

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
    cancellationNoticeHours: 24
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        minBookingNoticeHours: settings.min_booking_notice_hours,
        maxBookingAdvanceDays: settings.max_booking_advance_days,
        allowDoubleBooking: settings.allow_double_booking,
        requireInstructorApproval: settings.require_instructor_approval,
        cancellationNoticeHours: settings.cancellation_notice_hours
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
        cancellation_notice_hours: formData.cancellationNoticeHours
      });
    };
  }, [formData, updateSettings]);

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Advance Booking (days)</label>
              <input
                type="number"
                min="1"
                max="365"
                value={formData.maxBookingAdvanceDays}
                onChange={(e) => handleInputChange('maxBookingAdvanceDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">How far in advance users can book</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Booking Notice (hours)</label>
              <input
                type="number"
                min="0"
                max="48"
                value={formData.minBookingNoticeHours}
                onChange={(e) => handleInputChange('minBookingNoticeHours', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Minimum notice required before flight</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Cancellation Notice (hours)</label>
              <input
                type="number"
                min="0"
                max="72"
                value={formData.cancellationNoticeHours}
                onChange={(e) => handleInputChange('cancellationNoticeHours', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Required notice for cancellations</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Booking Permissions</h3>
          <div className="space-y-4">
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
                Allow double booking (with warnings)
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireInstructorApproval"
                checked={formData.requireInstructorApproval}
                onChange={(e) => handleInputChange('requireInstructorApproval', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireInstructorApproval" className="text-sm text-gray-700">
                Require instructor approval for solo flights
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
