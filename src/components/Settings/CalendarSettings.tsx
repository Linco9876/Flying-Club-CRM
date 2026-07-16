import React, { useState, useEffect } from 'react';
import { Calendar, Eye, RotateCcw } from 'lucide-react';
import { useCalendarSettings } from '../../hooks/useSettings';

interface CalendarSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const CalendarSettings: React.FC<CalendarSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = useCalendarSettings();
  const [formData, setFormData] = useState({
    defaultView: 'day',
    showCurrentTimeIndicator: true,
    snapDuration: 15,
    doubleHeightSlots: false,
    resourceDisplayOrder: 'aircraft-first',
    conflictRules: 'waitlist',
    weekStartsOn: 'monday',
    showWeekends: true,
    highlightUnloggedBookings: false,
  });
  const [resetResourceLayout, setResetResourceLayout] = useState(false);

  useEffect(() => {
    if (settings) {
      setFormData({
        defaultView: settings.default_view,
        showCurrentTimeIndicator: settings.show_current_time_indicator,
        snapDuration: settings.snap_duration,
        doubleHeightSlots: settings.double_height_slots,
        resourceDisplayOrder: settings.resource_display_order,
        conflictRules: settings.conflict_rules,
        weekStartsOn: settings.week_starts_on,
        showWeekends: settings.show_weekends ?? true,
        highlightUnloggedBookings: settings.highlight_unlogged_bookings ?? false,
      });
    }
  }, [settings]);

  useEffect(() => {
    (window as any).__calendarSettingsSave = async () => {
      await updateSettings({
        default_view: formData.defaultView,
        show_current_time_indicator: formData.showCurrentTimeIndicator,
        snap_duration: formData.snapDuration,
        double_height_slots: formData.doubleHeightSlots,
        resource_display_order: formData.resourceDisplayOrder,
        conflict_rules: formData.conflictRules,
        week_starts_on: formData.weekStartsOn,
        show_weekends: formData.showWeekends,
        highlight_unlogged_bookings: formData.highlightUnloggedBookings,
        ...(resetResourceLayout ? { hidden_resources: [], resource_order: [] } : {}),
      });
      setResetResourceLayout(false);
    };
    (window as any).__calendarSettingsCancel = () => {
      if (!settings) return;
      setFormData({
        defaultView: settings.default_view,
        showCurrentTimeIndicator: settings.show_current_time_indicator,
        snapDuration: settings.snap_duration,
        doubleHeightSlots: settings.double_height_slots,
        resourceDisplayOrder: settings.resource_display_order,
        conflictRules: settings.conflict_rules,
        weekStartsOn: settings.week_starts_on,
        showWeekends: settings.show_weekends ?? true,
        highlightUnloggedBookings: settings.highlight_unlogged_bookings ?? false,
      });
      setResetResourceLayout(false);
    };
    return () => {
      delete (window as any).__calendarSettingsSave;
      delete (window as any).__calendarSettingsCancel;
    };
  }, [formData, resetResourceLayout, settings, updateSettings]);

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
                onChange={(e) => {
                  handleInputChange('resourceDisplayOrder', e.target.value);
                  setResetResourceLayout(true);
                }}
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

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="showWeekends"
                checked={formData.showWeekends}
                onChange={(e) => handleInputChange('showWeekends', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="showWeekends" className="text-sm text-gray-700">
                Show weekends in week and month views
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="highlightUnloggedBookings"
                checked={formData.highlightUnloggedBookings}
                onChange={(e) => handleInputChange('highlightUnloggedBookings', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="highlightUnloggedBookings" className="text-sm text-gray-700">
                Highlight overdue unlogged flights by default
              </label>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Resource Layout</h3>
          <button
            type="button"
            onClick={() => {
              setResetResourceLayout(true);
              onFormChange();
            }}
            disabled={!canEdit}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" />
            Reset hidden resources and manual ordering
          </button>
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
              <option value="waitlist">Waiting list - keep the new booking out of the confirmed lane</option>
              <option value="block">Block - do not allow the conflicting booking</option>
              <option value="approval">Staff approval - waitlist it until staff review</option>
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
