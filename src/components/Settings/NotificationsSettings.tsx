import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNotificationSettings } from '../../hooks/useSettings';

interface NotificationsSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const NotificationsSettings: React.FC<NotificationsSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useNotificationSettings();
  const [formData, setFormData] = useState({
    bookingConfirmationEnabled: true,
    bookingReminder24hEnabled: true,
    bookingReminder2hEnabled: true,
    cancellationNotificationEnabled: true,
    maintenanceAlertEnabled: true,
    currencyExpiryAlertDays: 30
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        bookingConfirmationEnabled: settings.booking_confirmation_enabled,
        bookingReminder24hEnabled: settings.booking_reminder_24h_enabled,
        bookingReminder2hEnabled: settings.booking_reminder_2h_enabled,
        cancellationNotificationEnabled: settings.cancellation_notification_enabled,
        maintenanceAlertEnabled: settings.maintenance_alert_enabled,
        currencyExpiryAlertDays: settings.currency_expiry_alert_days
      });
    }
  }, [settings]);

  useEffect(() => {
    (window as any).__notificationsSettingsSave = async () => {
      await updateSettings({
        booking_confirmation_enabled: formData.bookingConfirmationEnabled,
        booking_reminder_24h_enabled: formData.bookingReminder24hEnabled,
        booking_reminder_2h_enabled: formData.bookingReminder2hEnabled,
        cancellation_notification_enabled: formData.cancellationNotificationEnabled,
        maintenance_alert_enabled: formData.maintenanceAlertEnabled,
        currency_expiry_alert_days: formData.currencyExpiryAlertDays
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
          <Bell className="h-5 w-5 mr-2" />
          Notifications
        </h2>
        <p className="text-gray-600">Configure system-wide notification preferences</p>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Booking Notifications</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="bookingConfirmationEnabled"
                checked={formData.bookingConfirmationEnabled}
                onChange={(e) => handleInputChange('bookingConfirmationEnabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="bookingConfirmationEnabled" className="text-sm text-gray-700">
                Send booking confirmation notifications
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="bookingReminder24hEnabled"
                checked={formData.bookingReminder24hEnabled}
                onChange={(e) => handleInputChange('bookingReminder24hEnabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="bookingReminder24hEnabled" className="text-sm text-gray-700">
                Send booking reminders 24 hours before flight
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="bookingReminder2hEnabled"
                checked={formData.bookingReminder2hEnabled}
                onChange={(e) => handleInputChange('bookingReminder2hEnabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="bookingReminder2hEnabled" className="text-sm text-gray-700">
                Send booking reminders 2 hours before flight
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="cancellationNotificationEnabled"
                checked={formData.cancellationNotificationEnabled}
                onChange={(e) => handleInputChange('cancellationNotificationEnabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="cancellationNotificationEnabled" className="text-sm text-gray-700">
                Send cancellation notifications
              </label>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Safety & Maintenance</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="maintenanceAlertEnabled"
                checked={formData.maintenanceAlertEnabled}
                onChange={(e) => handleInputChange('maintenanceAlertEnabled', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="maintenanceAlertEnabled" className="text-sm text-gray-700">
                Send aircraft maintenance alerts
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Currency Expiry Alert (days before)
              </label>
              <input
                type="number"
                min="1"
                max="90"
                value={formData.currencyExpiryAlertDays}
                onChange={(e) => handleInputChange('currencyExpiryAlertDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 max-w-xs"
              />
              <p className="text-xs text-gray-500 mt-1">
                Send alerts this many days before medical/licence expiry
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
