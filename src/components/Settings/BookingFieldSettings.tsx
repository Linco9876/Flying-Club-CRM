import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { useBookingFieldSettings } from '../../hooks/useBookingFieldSettings';
import toast from 'react-hot-toast';

interface BookingFieldSettingsProps {
  canEdit: boolean;
  onFormChange?: () => void;
  embedded?: boolean;
}

export const BookingFieldSettings: React.FC<BookingFieldSettingsProps> = ({ canEdit, onFormChange, embedded = false }) => {
  const { settings, loading, updateSetting } = useBookingFieldSettings();
  const [hasChanges, setHasChanges] = useState(false);
  const [localSettings, setLocalSettings] = useState(settings);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleToggleRequired = (id: string) => {
    if (!canEdit) return;
    setLocalSettings(prev =>
      prev.map(s =>
        s.id === id ? { ...s, isRequired: !s.isRequired } : s
      )
    );
    setHasChanges(true);
    onFormChange?.();
  };

  const handleToggleVisible = (id: string) => {
    if (!canEdit) return;
    setLocalSettings(prev =>
      prev.map(s =>
        s.id === id ? { ...s, isVisible: !s.isVisible } : s
      )
    );
    setHasChanges(true);
    onFormChange?.();
  };

  const handleToggleRole = (id: string, role: string) => {
    if (!canEdit) return;
    setLocalSettings(prev =>
      prev.map(s => {
        if (s.id === id) {
          const roles = s.appliesToRoles.includes(role)
            ? s.appliesToRoles.filter(r => r !== role)
            : [...s.appliesToRoles, role];
          return { ...s, appliesToRoles: roles };
        }
        return s;
      })
    );
    setHasChanges(true);
    onFormChange?.();
  };

  const handleSaveChanges = async () => {
    try {
      for (const setting of localSettings) {
        const original = settings.find(s => s.id === setting.id);
        if (original && (
          original.isRequired !== setting.isRequired ||
          original.isVisible !== setting.isVisible ||
          JSON.stringify(original.appliesToRoles) !== JSON.stringify(setting.appliesToRoles)
        )) {
          await updateSetting(setting.id, {
            isRequired: setting.isRequired,
            isVisible: setting.isVisible,
            appliesToRoles: setting.appliesToRoles
          }, false);
        }
      }
      setHasChanges(false);
      if (!embedded) toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    }
  };

  const handleResetChanges = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  React.useEffect(() => {
    if (!embedded) return;
    (window as any).__bookingFieldsEmbeddedSave = handleSaveChanges;
    (window as any).__bookingFieldsEmbeddedCancel = handleResetChanges;
    return () => {
      delete (window as any).__bookingFieldsEmbeddedSave;
      delete (window as any).__bookingFieldsEmbeddedCancel;
    };
  }, [embedded, localSettings, settings]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : 'p-6 space-y-6'}>
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Settings className="h-5 w-5 mr-2" />
          Booking Form Field Configuration
        </h2>
        <p className="text-gray-600">
          Configure which fields are required, visible, and applicable to different user roles
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Field
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Required
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Visible
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Applies To Roles
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {localSettings.map(setting => (
              <tr key={setting.id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{setting.label}</div>
                    {setting.helpText && (
                      <div className="text-xs text-gray-500 mt-1">{setting.helpText}</div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.isRequired}
                      onChange={() => handleToggleRequired(setting.id)}
                      disabled={!canEdit}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                </td>
                <td className="px-6 py-4">
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.isVisible}
                      onChange={() => handleToggleVisible(setting.id)}
                      disabled={!canEdit}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </label>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center space-x-4">
                    {['admin', 'instructor', 'student', 'pilot'].map(role => (
                      <label key={role} className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={setting.appliesToRoles.includes(role)}
                          onChange={() => handleToggleRole(setting.id, role)}
                          disabled={!canEdit}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <span className="ml-2 text-sm text-gray-700 capitalize">{role}</span>
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!embedded && canEdit && hasChanges && (
        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
          <button
            onClick={handleResetChanges}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Reset Changes
          </button>
          <button
            onClick={handleSaveChanges}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Save className="h-4 w-4" />
            <span>Save Changes</span>
          </button>
        </div>
      )}

    </div>
  );
};
