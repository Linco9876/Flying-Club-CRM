import type { SafetyComplianceSettings } from '../hooks/useSafetySettings';

const inRange = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) && value >= minimum && value <= maximum;

export const getSafetySettingsValidationError = (settings: SafetyComplianceSettings) => {
  if (!inRange(settings.recencyDays, 30, 365)) return 'Recency period must be between 30 and 365 days.';
  if (!inRange(settings.medicalWarningDays, 7, 180)) return 'Medical warning must be between 7 and 180 days.';
  if (!inRange(settings.licenceWarningDays, 7, 180)) return 'Licence warning must be between 7 and 180 days.';
  if (!inRange(settings.bfrWarningDays, 7, 90)) return 'BFR warning must be between 7 and 90 days.';
  if (settings.autoAssignIncidents && !settings.defaultSafetyOfficer.trim()) return 'Default safety officer is required when incident auto-assignment is on.';
  if (!settings.recencyWarningMessage.trim()) return 'Recency guidance message cannot be empty.';
  if (!settings.safetyLoginWarningTitle.trim()) return 'Safety login warning title cannot be empty.';
  if (!settings.safetyLoginWarningMessage.trim()) return 'Safety login warning message cannot be empty.';
  if (!settings.recencyNoFlightMessage.trim()) return 'No-flight recency message cannot be empty.';
  if (!settings.recencyLastFlightMessage.trim()) return 'Last-flight recency message cannot be empty.';
  return null;
};
