import React from 'react';
import { Save } from 'lucide-react';
import { useFlightLogSettings } from '../../hooks/useFlightLogSettings';
import toast from 'react-hot-toast';

const FlightLogSettings: React.FC = () => {
  const { settings, loading, updateSetting } = useFlightLogSettings();

  const handleToggleEnabled = async (id: string, currentValue: boolean) => {
    const { error } = await updateSetting(id, { is_enabled: !currentValue });
    if (error) {
      toast.error(error);
    } else {
      toast.success('Setting updated successfully');
    }
  };

  const handleToggleMandatory = async (id: string, currentValue: boolean) => {
    const { error } = await updateSetting(id, { is_mandatory: !currentValue });
    if (error) {
      toast.error(error);
    } else {
      toast.success('Setting updated successfully');
    }
  };

  const getFieldLabel = (fieldName: string): string => {
    const labels: Record<string, string> = {
      landings: 'Number of Landings',
      payment_type: 'Payment Type',
      observations: 'Observations/Comments',
      oil_added: 'Oil Added (quarts)',
      fuel_added: 'Fuel Added (gallons)',
      passengers: 'Number of Passengers',
    };
    return labels[fieldName] || fieldName;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Flight Log Form Settings</h2>
        <p className="mt-1 text-sm text-gray-600">
          Configure which fields appear in the flight log form and whether they are required.
        </p>
      </div>

      <div className="bg-white shadow rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Optional Fields</h3>
          <p className="mt-1 text-sm text-gray-600">
            The following fields are always shown: Aircraft, Pilot, Instructor, Start Time, End Time, Start Tach, End Tach, Flight Duration.
          </p>
        </div>

        <div className="p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-12 gap-4 text-sm font-medium text-gray-700 pb-2 border-b border-gray-200">
              <div className="col-span-6">Field Name</div>
              <div className="col-span-3 text-center">Show in Form</div>
              <div className="col-span-3 text-center">Required</div>
            </div>

            {settings.map((setting) => (
              <div key={setting.id} className="grid grid-cols-12 gap-4 items-center py-3 border-b border-gray-100 last:border-0">
                <div className="col-span-6">
                  <label className="text-sm font-medium text-gray-900">
                    {getFieldLabel(setting.field_name)}
                  </label>
                </div>

                <div className="col-span-3 flex justify-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.is_enabled}
                      onChange={() => handleToggleEnabled(setting.id, setting.is_enabled)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="col-span-3 flex justify-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setting.is_mandatory}
                      onChange={() => handleToggleMandatory(setting.id, setting.is_mandatory)}
                      disabled={!setting.is_enabled}
                      className="sr-only peer disabled:cursor-not-allowed"
                    />
                    <div className={`w-11 h-6 ${setting.is_enabled ? 'bg-gray-200' : 'bg-gray-100'} peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] ${setting.is_enabled ? 'after:bg-white' : 'after:bg-gray-300'} after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 ${!setting.is_enabled ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <Save className="h-5 w-5 text-blue-600" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">Settings Auto-Save</h3>
                <div className="mt-1 text-sm text-blue-700">
                  Changes are saved automatically when you toggle a setting.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlightLogSettings;
