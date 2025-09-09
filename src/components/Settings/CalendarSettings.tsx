import React, { useState } from 'react';
import { Calendar, Eye, Clock, Users } from 'lucide-react';

interface CalendarSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const CalendarSettings: React.FC<CalendarSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    defaultView: 'day',
    showCurrentTimeIndicator: true,
    snapDuration: 15,
    doubleHeightSlots: false,
    resourceDisplayOrder: 'aircraft-first',
    conflictRules: 'hard-block',
    weekStartsOn: 'monday'
  });

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Calendar className="h-5 w-5 mr-2" />
          Calendar Settings
        </h2>
        <p className="text-gray-600">Configure calendar display preferences and behavior</p>
      </div>

      {/* Display Settings */}
      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Display Settings</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default View</label>
              <select
                value={formData.defaultView}
                onChange={(e) => handleInputChange('defaultView', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="day">Day View</option>
                <option value="week">Week View</option>
                <option value="month">Month View</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Week Starts On</label>
              <select
                value={formData.weekStartsOn}
                onChange={(e) => handleInputChange('weekStartsOn', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Resource Display Order</label>
              <select
                value={formData.resourceDisplayOrder}
                onChange={(e) => handleInputChange('resourceDisplayOrder', e.target.value)}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value="aircraft-first">Aircraft First</option>
                <option value="instructors-first">Instructors First</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Snap Duration (minutes)</label>
              <select
                value={formData.snapDuration}
                onChange={(e) => handleInputChange('snapDuration', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>
          </div>
        </div>

        {/* Visual Options */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Visual Options</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="showCurrentTimeIndicator"
                checked={formData.showCurrentTimeIndicator}
                onChange={(e) => handleInputChange('showCurrentTimeIndicator', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="showCurrentTimeIndicator" className="text-sm text-gray-700">
                Show current time indicator
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="doubleHeightSlots"
                checked={formData.doubleHeightSlots}
                onChange={(e) => handleInputChange('doubleHeightSlots', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="doubleHeightSlots" className="text-sm text-gray-700">
                Use double-height time slots
              </label>
            </div>
          </div>
        </div>

        {/* Conflict Rules */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Booking Conflicts</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Conflict Rules</label>
            <select
              value={formData.conflictRules}
              onChange={(e) => handleInputChange('conflictRules', e.target.value)}
              disabled={!canEdit}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            >
              <option value="hard-block">Hard Block - Prevent overlapping bookings</option>
              <option value="warn">Warn - Allow with warning message</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              How to handle booking conflicts when resources are double-booked
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};