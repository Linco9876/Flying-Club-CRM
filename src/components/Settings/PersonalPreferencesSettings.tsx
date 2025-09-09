import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { User, Bell, Globe, Palette } from 'lucide-react';

interface PersonalPreferencesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const PersonalPreferencesSettings: React.FC<PersonalPreferencesSettingsProps> = ({ canEdit, onFormChange }) => {
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    // Notification Preferences
    emailNotifications: true,
    smsNotifications: false,
    bookingReminders: true,
    currencyAlerts: true,
    maintenanceAlerts: true,
    
    // Display Preferences
    timezone: 'Australia/Melbourne',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    defaultCalendarView: 'day',
    theme: 'light',
    
    // Portal Preferences (for students)
    showProgressDashboard: true,
    showUpcomingBookings: true,
    showRecentActivity: true,
    compactView: false
  });

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  const timezones = [
    'Australia/Melbourne',
    'Australia/Sydney',
    'Australia/Brisbane',
    'Australia/Adelaide',
    'Australia/Perth',
    'Australia/Darwin'
  ];

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <User className="h-5 w-5 mr-2" />
          Personal Preferences
        </h2>
        <p className="text-gray-600">Configure your personal settings and preferences</p>
      </div>

      {/* Notification Preferences */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Bell className="h-5 w-5 mr-2" />
            Notification Preferences
          </h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="emailNotifications"
                checked={formData.emailNotifications}
                onChange={(e) => handleInputChange('emailNotifications', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="emailNotifications" className="text-sm text-gray-700">
                Receive email notifications
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="smsNotifications"
                checked={formData.smsNotifications}
                onChange={(e) => handleInputChange('smsNotifications', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="smsNotifications" className="text-sm text-gray-700">
                Receive SMS notifications
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="bookingReminders"
                checked={formData.bookingReminders}
                onChange={(e) => handleInputChange('bookingReminders', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="bookingReminders" className="text-sm text-gray-700">
                Booking reminders (24h and 2h before)
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="currencyAlerts"
                checked={formData.currencyAlerts}
                onChange={(e) => handleInputChange('currencyAlerts', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="currencyAlerts" className="text-sm text-gray-700">
                Currency expiry alerts (medical, licence, BFR)
              </label>
            </div>

            {(user?.role === 'admin' || user?.role === 'instructor') && (
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="maintenanceAlerts"
                  checked={formData.maintenanceAlerts}
                  onChange={(e) => handleInputChange('maintenanceAlerts', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="maintenanceAlerts" className="text-sm text-gray-700">
                  Aircraft maintenance alerts
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Display Preferences */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            <Globe className="h-5 w-5 mr-2" />
            Display Preferences
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
              <select
                value={formData.timezone}
                onChange={(e) => handleInputChange('timezone', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                {timezones.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
              <select
                value={formData.dateFormat}
                onChange={(e) => handleInputChange('dateFormat', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                <option value="MM/dd/yyyy">MM/DD/YYYY</option>
                <option value="yyyy-MM-dd">YYYY-MM-DD</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time Format</label>
              <select
                value={formData.timeFormat}
                onChange={(e) => handleInputChange('timeFormat', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="24h">24 Hour (14:30)</option>
                <option value="12h">12 Hour (2:30 PM)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Calendar View</label>
              <select
                value={formData.defaultCalendarView}
                onChange={(e) => handleInputChange('defaultCalendarView', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="day">Day View</option>
                <option value="week">Week View</option>
                <option value="month">Month View</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
              <select
                value={formData.theme}
                onChange={(e) => handleInputChange('theme', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="auto">Auto (System)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Student Portal Preferences */}
        {user?.role === 'student' && (
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Portal Preferences</h3>
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="showProgressDashboard"
                  checked={formData.showProgressDashboard}
                  onChange={(e) => handleInputChange('showProgressDashboard', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="showProgressDashboard" className="text-sm text-gray-700">
                  Show training progress dashboard
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="showUpcomingBookings"
                  checked={formData.showUpcomingBookings}
                  onChange={(e) => handleInputChange('showUpcomingBookings', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="showUpcomingBookings" className="text-sm text-gray-700">
                  Show upcoming bookings on dashboard
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="showRecentActivity"
                  checked={formData.showRecentActivity}
                  onChange={(e) => handleInputChange('showRecentActivity', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="showRecentActivity" className="text-sm text-gray-700">
                  Show recent activity feed
                </label>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="compactView"
                  checked={formData.compactView}
                  onChange={(e) => handleInputChange('compactView', e.target.checked)}
                  disabled={!canEdit}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="compactView" className="text-sm text-gray-700">
                  Use compact view for lists and tables
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};