import React, { useEffect, useState } from 'react';
import { Globe, Loader, Monitor, Palette } from 'lucide-react';
import { usePortalUxSettings } from '../../hooks/useSettings';

interface PortalUxSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

export const PortalUxSettings: React.FC<PortalUxSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings } = usePortalUxSettings();
  const [formData, setFormData] = useState(settings);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    (window as any).__portalSettingsSave = async () => {
      await updateSettings({
        theme: formData.theme,
        date_format: formData.date_format,
        time_format: formData.time_format,
        flight_time_decimals: formData.flight_time_decimals,
        currency_decimals: formData.currency_decimals,
        show_invoices_in_portal: formData.show_invoices_in_portal,
        show_progress_tracking: formData.show_progress_tracking,
        allow_self_booking: formData.allow_self_booking,
        allow_booking_cancellation: formData.allow_booking_cancellation,
        max_advance_booking_days: formData.max_advance_booking_days,
      });
    };
    (window as any).__portalSettingsCancel = () => {
      setFormData(settings);
    };
    return () => {
      delete (window as any).__portalSettingsSave;
      delete (window as any).__portalSettingsCancel;
    };
  }, [formData, settings, updateSettings]);

  const handleInputChange = (field: keyof typeof formData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    onFormChange();
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader className="mr-2 h-5 w-5 animate-spin text-blue-500" />
        <span className="text-gray-500">Loading settings...</span>
      </div>
    );
  }

  const selectClass = 'w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

  return (
    <div className="space-y-8 p-6">
      <div>
        <h2 className="mb-2 flex items-center text-xl font-semibold text-gray-900">
          <Monitor className="mr-2 h-5 w-5" />
          Portal & UX
        </h2>
        <p className="text-gray-600">Configure student portal features and user experience settings.</p>
      </div>

      <section>
        <h3 className="mb-4 flex items-center text-lg font-medium text-gray-900">
          <Palette className="mr-2 h-5 w-5" />
          Theme & Display
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-gray-700">
            Theme
            <select value={formData.theme} onChange={e => handleInputChange('theme', e.target.value)} disabled={!canEdit} className={`mt-2 ${selectClass}`}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto (System)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Date Format
            <select value={formData.date_format} onChange={e => handleInputChange('date_format', e.target.value)} disabled={!canEdit} className={`mt-2 ${selectClass}`}>
              <option value="dd/MM/yyyy">DD/MM/YYYY</option>
              <option value="MM/dd/yyyy">MM/DD/YYYY</option>
              <option value="yyyy-MM-dd">YYYY-MM-DD</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Time Format
            <select value={formData.time_format} onChange={e => handleInputChange('time_format', e.target.value)} disabled={!canEdit} className={`mt-2 ${selectClass}`}>
              <option value="24h">24 Hour (14:30)</option>
              <option value="12h">12 Hour (2:30 PM)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Flight Time Decimals
            <select value={formData.flight_time_decimals} onChange={e => handleInputChange('flight_time_decimals', Number(e.target.value))} disabled={!canEdit} className={`mt-2 ${selectClass}`}>
              <option value={1}>1 decimal (1.5 hrs)</option>
              <option value={2}>2 decimals (1.50 hrs)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Currency Decimals
            <select value={formData.currency_decimals} onChange={e => handleInputChange('currency_decimals', Number(e.target.value))} disabled={!canEdit} className={`mt-2 ${selectClass}`}>
              <option value={0}>No decimals ($125)</option>
              <option value={2}>2 decimals ($125.00)</option>
            </select>
          </label>
        </div>
      </section>

      <section>
        <h3 className="mb-4 flex items-center text-lg font-medium text-gray-900">
          <Globe className="mr-2 h-5 w-5" />
          Student Portal Features
        </h3>
        <div className="space-y-4">
          <PortalToggle id="showInvoicesInPortal" label="Show invoices and billing history" checked={formData.show_invoices_in_portal} disabled={!canEdit} onChange={value => handleInputChange('show_invoices_in_portal', value)} />
          <PortalToggle id="showProgressTracking" label="Show training progress tracking" checked={formData.show_progress_tracking} disabled={!canEdit} onChange={value => handleInputChange('show_progress_tracking', value)} />
          <PortalToggle id="allowSelfBooking" label="Allow students to create their own bookings" checked={formData.allow_self_booking} disabled={!canEdit} onChange={value => handleInputChange('allow_self_booking', value)} />
          <PortalToggle id="allowBookingCancellation" label="Allow students to cancel their own bookings" checked={formData.allow_booking_cancellation} disabled={!canEdit} onChange={value => handleInputChange('allow_booking_cancellation', value)} />
          <label className="block max-w-xs text-sm font-medium text-gray-700">
            Maximum advance booking days
            <input
              type="number"
              min={1}
              max={365}
              value={formData.max_advance_booking_days}
              onChange={e => handleInputChange('max_advance_booking_days', Math.min(365, Math.max(1, Number(e.target.value) || 1)))}
              disabled={!canEdit}
              className={`mt-2 ${selectClass}`}
            />
          </label>
        </div>
      </section>
    </div>
  );
};

const PortalToggle: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}> = ({ id, label, checked, disabled, onChange }) => (
  <label htmlFor={id} className="flex items-center space-x-3 text-sm text-gray-700">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={event => onChange(event.target.checked)}
      disabled={disabled}
      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
    />
    <span>{label}</span>
  </label>
);
