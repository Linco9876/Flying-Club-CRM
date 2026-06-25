import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Info, Loader2, RotateCcw } from 'lucide-react';
import { FlightLogFieldSetting, useFlightLogSettings } from '../../hooks/useFlightLogSettings';
import toast from 'react-hot-toast';
import { useAircraft } from '../../hooks/useAircraft';

interface FlightLogSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface FieldMeta {
  fieldName: string;
  label: string;
  description: string;
  group: 'Core Flight Details' | 'Billing' | 'Operational Notes' | 'Aircraft Servicing' | 'Aircraft Status';
  alwaysRequired?: boolean;
  lockVisibility?: boolean;
}

const fieldMeta: FieldMeta[] = [
  {
    fieldName: 'start_time',
    label: 'Start Time',
    description: 'The booked or actual engine/flight start time.',
    group: 'Core Flight Details',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'end_time',
    label: 'End Time',
    description: 'The booked or actual end time used for the log period.',
    group: 'Core Flight Details',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'start_tach',
    label: 'Start Tach',
    description: 'Auto-fills from the previous aircraft log where possible.',
    group: 'Core Flight Details',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'end_tach',
    label: 'End Tach',
    description: 'Required so aircraft hours and maintenance tracking stay accurate.',
    group: 'Core Flight Details',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'flight_duration',
    label: 'Flight Duration',
    description: 'Can be typed directly and will update end tach.',
    group: 'Core Flight Details',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'flight_type',
    label: 'Flight Type',
    description: 'Drives the aircraft rate and payment rules used for billing.',
    group: 'Billing',
    alwaysRequired: true,
    lockVisibility: true,
  },
  {
    fieldName: 'payment_type',
    label: 'Payment Type',
    description: 'Manual payment selector for non-free flights. Forced/default payment methods still apply.',
    group: 'Billing',
  },
  {
    fieldName: 'takeoffs_landings',
    label: 'Takeoffs & Landings',
    description: 'A compact field that records both takeoffs and landings together.',
    group: 'Core Flight Details',
  },
  {
    fieldName: 'comments',
    label: 'Debrief Comments',
    description: 'General flight notes and student debrief summary.',
    group: 'Operational Notes',
  },
  {
    fieldName: 'observations',
    label: 'Operational Observations',
    description: 'Aircraft or operational notes that should appear on the aircraft flight log.',
    group: 'Operational Notes',
  },
  {
    fieldName: 'passengers',
    label: 'Passenger Count',
    description: 'Used by per-passenger rates and passenger-carrying records.',
    group: 'Operational Notes',
  },
  {
    fieldName: 'hobbs_start',
    label: 'Hobbs Start',
    description: 'Optional Hobbs meter start reading for aircraft with a Hobbs meter.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'hobbs_end',
    label: 'Hobbs End',
    description: 'Optional Hobbs meter end reading for cross-checking utilisation.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'fuel_start',
    label: 'Fuel Before Flight',
    description: 'Fuel quantity before departure, useful for fuel tracking and reconciliation.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'fuel_end',
    label: 'Fuel After Flight',
    description: 'Fuel quantity remaining after the flight.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'oil_added',
    label: 'Oil Added',
    description: 'Oil quantity added after the flight.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'oil_start',
    label: 'Oil Before Flight',
    description: 'Oil level before departure.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'oil_end',
    label: 'Oil After Flight',
    description: 'Oil level after shutdown.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'fuel_added',
    label: 'Fuel Added',
    description: 'Fuel quantity added after the flight.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'fuel_type',
    label: 'Fuel Type',
    description: 'Fuel used or uplifted, such as Avgas, Mogas or Jet A-1.',
    group: 'Aircraft Servicing',
  },
  {
    fieldName: 'aircraft_condition',
    label: 'Aircraft Condition',
    description: 'Post-flight condition summary such as serviceable, monitor, or attention required.',
    group: 'Aircraft Status',
  },
  {
    fieldName: 'maintenance_notes',
    label: 'Maintenance Notes',
    description: 'Notes for engineering or aircraft management that do not need a defect report.',
    group: 'Aircraft Status',
  },
];

const defaults: Record<string, Pick<FlightLogFieldSetting, 'is_enabled' | 'is_mandatory' | 'display_order'>> = {
  start_time: { is_enabled: true, is_mandatory: true, display_order: 1 },
  end_time: { is_enabled: true, is_mandatory: true, display_order: 2 },
  start_tach: { is_enabled: true, is_mandatory: true, display_order: 3 },
  end_tach: { is_enabled: true, is_mandatory: true, display_order: 4 },
  flight_duration: { is_enabled: true, is_mandatory: true, display_order: 5 },
  flight_type: { is_enabled: true, is_mandatory: true, display_order: 6 },
  payment_type: { is_enabled: true, is_mandatory: true, display_order: 7 },
  takeoffs_landings: { is_enabled: true, is_mandatory: false, display_order: 8 },
  comments: { is_enabled: true, is_mandatory: false, display_order: 9 },
  observations: { is_enabled: false, is_mandatory: false, display_order: 10 },
  passengers: { is_enabled: false, is_mandatory: false, display_order: 11 },
  hobbs_start: { is_enabled: false, is_mandatory: false, display_order: 12 },
  hobbs_end: { is_enabled: false, is_mandatory: false, display_order: 13 },
  fuel_start: { is_enabled: false, is_mandatory: false, display_order: 14 },
  fuel_end: { is_enabled: false, is_mandatory: false, display_order: 15 },
  oil_added: { is_enabled: false, is_mandatory: false, display_order: 16 },
  oil_start: { is_enabled: false, is_mandatory: false, display_order: 17 },
  oil_end: { is_enabled: false, is_mandatory: false, display_order: 18 },
  fuel_added: { is_enabled: false, is_mandatory: false, display_order: 19 },
  fuel_type: { is_enabled: false, is_mandatory: false, display_order: 20 },
  aircraft_condition: { is_enabled: false, is_mandatory: false, display_order: 21 },
  maintenance_notes: { is_enabled: false, is_mandatory: false, display_order: 22 },
};

const makeDraft = (settings: FlightLogFieldSetting[], aircraftId: string | null) => {
  const globalByName = new Map(settings.filter(setting => !setting.aircraft_id).map(setting => [setting.field_name, setting]));
  const aircraftByName = new Map(settings.filter(setting => aircraftId && setting.aircraft_id === aircraftId).map(setting => [setting.field_name, setting]));
  return fieldMeta.map(meta => {
    const global = globalByName.get(meta.fieldName);
    const override = aircraftByName.get(meta.fieldName);
    const existing = override || global;
    const fallback = defaults[meta.fieldName];
    return {
      id: override?.id || (!aircraftId && global?.id) || `flight-log-field-${aircraftId || 'global'}-${meta.fieldName}`,
      aircraft_id: aircraftId,
      field_name: meta.fieldName,
      is_enabled: meta.lockVisibility ? true : existing?.is_enabled ?? fallback.is_enabled,
      is_mandatory: meta.alwaysRequired ? true : existing?.is_mandatory ?? fallback.is_mandatory,
      display_order: fallback.display_order,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: existing?.updated_at || new Date().toISOString(),
    };
  });
};

const Toggle = ({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      checked ? 'bg-blue-600' : 'bg-gray-200'
    }`}
  >
    <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
  </button>
);

const FlightLogSettings: React.FC<FlightLogSettingsProps> = ({ canEdit, onFormChange }) => {
  const { settings, loading, updateSettings, deleteAircraftSettings } = useFlightLogSettings();
  const { aircraft } = useAircraft();
  const [selectedAircraftId, setSelectedAircraftId] = useState<string>('');
  const [draft, setDraft] = useState<FlightLogFieldSetting[]>([]);
  const selectedAircraft = aircraft.find(item => item.id === selectedAircraftId) ?? null;
  const hasAircraftOverride = selectedAircraftId
    ? settings.some(setting => setting.aircraft_id === selectedAircraftId)
    : false;

  useEffect(() => {
    setDraft(makeDraft(settings, selectedAircraftId || null));
  }, [settings, selectedAircraftId]);

  useEffect(() => {
    (window as any).__flightlogSettingsSave = async () => {
      const { error } = await updateSettings(draft);
      if (error) toast.error(error);
      else toast.success(selectedAircraft ? `Flight log settings saved for ${selectedAircraft.registration}` : 'Global flight log form settings saved');
    };
    (window as any).__flightlogSettingsCancel = () => setDraft(makeDraft(settings, selectedAircraftId || null));
    return () => {
      delete (window as any).__flightlogSettingsSave;
      delete (window as any).__flightlogSettingsCancel;
    };
  }, [draft, selectedAircraft, selectedAircraftId, settings, updateSettings]);

  const settingsByName = useMemo(() => new Map(draft.map(setting => [setting.field_name, setting])), [draft]);

  const updateDraft = (fieldName: string, updates: Partial<FlightLogFieldSetting>) => {
    setDraft(current => current.map(setting => {
      if (setting.field_name !== fieldName) return setting;
      const next = { ...setting, ...updates };
      if (!next.is_enabled) next.is_mandatory = false;
      return next;
    }));
    onFormChange();
  };

  const handleResetAircraftOverride = async () => {
    if (!selectedAircraftId) return;
    const { error } = await deleteAircraftSettings(selectedAircraftId);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success('Aircraft override removed. This aircraft now uses the global defaults.');
    onFormChange();
  };

  const grouped = fieldMeta.reduce<Record<FieldMeta['group'], FieldMeta[]>>((groups, meta) => {
    groups[meta.group] = groups[meta.group] || [];
    groups[meta.group].push(meta);
    return groups;
  }, {} as Record<FieldMeta['group'], FieldMeta[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <ClipboardList className="h-5 w-5 mr-2" />
          Flight Log Form Settings
        </h2>
        <p className="text-gray-600">Choose which fields appear when staff log a flight and which fields must be completed before saving.</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">Settings scope</span>
            <select
              value={selectedAircraftId}
              onChange={event => {
                setSelectedAircraftId(event.target.value);
                onFormChange();
              }}
              disabled={!canEdit}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">Global defaults - used by every aircraft unless overridden</option>
              {aircraft.map(item => (
                <option key={item.id} value={item.id}>
                  {item.registration} - {item.make} {item.model}
                </option>
              ))}
            </select>
          </label>
          {selectedAircraftId && (
            <button
              type="button"
              onClick={handleResetAircraftOverride}
              disabled={!canEdit || !hasAircraftOverride}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Use Global Defaults
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-gray-600">
          {selectedAircraft
            ? hasAircraftOverride
              ? `${selectedAircraft.registration} has its own form settings. Changes here affect only this aircraft.`
              : `${selectedAircraft.registration} is currently previewing the global defaults. Saving will create an aircraft-specific override.`
            : 'Edit the global defaults first, then select an aircraft only when it needs different fields.'}
        </p>
      </section>

      {Object.entries(grouped).map(([group, fields]) => (
        <section key={group} className="space-y-3">
          <h3 className="text-lg font-medium text-gray-900">{group}</h3>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="grid grid-cols-[1fr_110px_110px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <div>Field</div>
              <div className="text-center">Show</div>
              <div className="text-center">Required</div>
            </div>
            {fields.map(meta => {
              const setting = settingsByName.get(meta.fieldName);
              if (!setting) return null;
              return (
                <div key={meta.fieldName} className="grid grid-cols-[1fr_110px_110px] gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{meta.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
                    {(meta.alwaysRequired || meta.lockVisibility) && (
                      <p className="mt-1 text-xs text-blue-700">Locked on because the flight log cannot be saved reliably without this field.</p>
                    )}
                  </div>
                  <div className="flex justify-center pt-1">
                    <Toggle
                      checked={setting.is_enabled}
                      disabled={!canEdit || meta.lockVisibility}
                      onChange={checked => updateDraft(meta.fieldName, { is_enabled: checked })}
                    />
                  </div>
                  <div className="flex justify-center pt-1">
                    <Toggle
                      checked={setting.is_mandatory}
                      disabled={!canEdit || meta.alwaysRequired || !setting.is_enabled}
                      onChange={checked => updateDraft(meta.fieldName, { is_mandatory: checked })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex gap-3">
          <Info className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900">Useful defaults</h3>
            <p className="mt-1 text-sm text-blue-800">
              Start/end tach and duration stay locked on for aircraft hours, maintenance tracking and billing. Optional servicing and observation fields can be enabled only when your club wants to capture that detail on every logged flight.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default FlightLogSettings;
