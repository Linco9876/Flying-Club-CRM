import React, { useState } from 'react';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';

interface BookingRulesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const BookingRulesSettings: React.FC<BookingRulesSettingsProps> = ({ canEdit, onFormChange }) => {
  const [formData, setFormData] = useState({
    maxAdvanceBookingDays: 30,
    maxBookingDuration: 4,
    allowOverlappingBookings: false,
    requireInstructorForSolo: false,
    autoCancelNoShowMinutes: 30,
    blockGroundedAircraftBookings: true,
    requireCurrencyCheck: true,
    requireMedicalCheck: true,
    requireEndorsementCheck: true,
    minTimeBetweenBookings: 0,
    maxDailyBookingsPerStudent: 3
  });

  const handleInputChange = (field: string, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Clock className="h-5 w-5 mr-2" />
          Bookings & Rules
        </h2>
        <p className="text-gray-600">Configure booking constraints and validation rules</p>
      </div>

      {/* Booking Limits */}
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
                value={formData.maxAdvanceBookingDays}
                onChange={(e) => handleInputChange('maxAdvanceBookingDays', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">How far in advance students can book</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Booking Duration (hours)</label>
              <input
                type="number"
                min="0.5"
                max="12"
                step="0.5"
                value={formData.maxBookingDuration}
                onChange={(e) => handleInputChange('maxBookingDuration', parseFloat(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">Maximum duration for a single booking</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Daily Bookings per Student</label>
              <input
                type="number"
                min="1"
                max="10"
                value={formData.maxDailyBookingsPerStudent}
                onChange={(e) => handleInputChange('maxDailyBookingsPerStudent', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Min Time Between Bookings (minutes)</label>
              <input
                type="number"
                min="0"
                max="120"
                step="15"
                value={formData.minTimeBetweenBookings}
                onChange={(e) => handleInputChange('minTimeBetweenBookings', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
            </div>
          </div>
        </div>

        {/* Validation Rules */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Pre-flight Validation</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireCurrencyCheck"
                checked={formData.requireCurrencyCheck}
                onChange={(e) => handleInputChange('requireCurrencyCheck', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireCurrencyCheck" className="text-sm text-gray-700">
                Check pilot currency before booking
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireMedicalCheck"
                checked={formData.requireMedicalCheck}
                onChange={(e) => handleInputChange('requireMedicalCheck', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireMedicalCheck" className="text-sm text-gray-700">
                Check medical certificate validity
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireEndorsementCheck"
                checked={formData.requireEndorsementCheck}
                onChange={(e) => handleInputChange('requireEndorsementCheck', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireEndorsementCheck" className="text-sm text-gray-700">
                Check required endorsements for aircraft type
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="requireInstructorForSolo"
                checked={formData.requireInstructorForSolo}
                onChange={(e) => handleInputChange('requireInstructorForSolo', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="requireInstructorForSolo" className="text-sm text-gray-700">
                Require instructor approval for solo flights
              </label>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="blockGroundedAircraftBookings"
                checked={formData.blockGroundedAircraftBookings}
                onChange={(e) => handleInputChange('blockGroundedAircraftBookings', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="blockGroundedAircraftBookings" className="text-sm text-gray-700">
                Block bookings for grounded aircraft
              </label>
            </div>
          </div>
        </div>

        {/* No-Show Management */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">No-Show Management</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Auto-cancel after (minutes)</label>
              <input
                type="number"
                min="0"
                max="120"
                step="5"
                value={formData.autoCancelNoShowMinutes}
                onChange={(e) => handleInputChange('autoCancelNoShowMinutes', parseInt(e.target.value))}
                disabled={!canEdit}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500 mt-1">0 = disabled, auto-cancel no-show bookings</p>
            </div>
          </div>
        </div>

        {/* Overlap Settings */}
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-4">Overlap & Conflicts</h3>
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="allowOverlappingBookings"
                checked={formData.allowOverlappingBookings}
                onChange={(e) => handleInputChange('allowOverlappingBookings', e.target.checked)}
                disabled={!canEdit}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
              />
              <label htmlFor="allowOverlappingBookings" className="text-sm text-gray-700">
                Allow overlapping bookings (with warnings)
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};