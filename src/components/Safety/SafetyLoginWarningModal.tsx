import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useStudents } from '../../hooks/useStudents';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import { buildSafetyComplianceSummary } from '../../utils/safetyCompliance';

export const SafetyLoginWarningModal: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { students } = useStudents();
  const { flightLogs } = useFlightLogs(user?.id);
  const { settings } = useSafetySettings();
  const [dismissed, setDismissed] = React.useState(false);

  const student = user ? students.find((candidate) => candidate.id === user.id) : null;
  const summary = student
    ? buildSafetyComplianceSummary(student, settings, flightLogs, { perspective: 'firstPerson' })
    : null;
  const concerns = summary?.concerns ?? [];
  const hasRenewalRelatedConcern = concerns.some((concern) => ['medical', 'licence', 'bfr'].includes(concern.type));
  const storageKey = user ? `safety-login-warning-dismissed:${user.id}` : '';

  React.useEffect(() => {
    if (!storageKey) return;
    setDismissed(sessionStorage.getItem(storageKey) === 'true');
  }, [storageKey]);

  const handleDismiss = () => {
    if (storageKey) sessionStorage.setItem(storageKey, 'true');
    setDismissed(true);
  };

  const handleUpdateInfo = () => {
    handleDismiss();
    navigate('/settings?section=account-info');
  };

  if (!user || !student || dismissed || concerns.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-amber-100 p-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Safety items need attention</h3>
              <p className="mt-1 text-sm text-gray-600">{settings.safetyLoginWarningMessage}</p>
            </div>
          </div>
          <button type="button" onClick={handleDismiss} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-2 px-5 py-4">
          {concerns.map((concern) => (
            <div key={`${concern.type}-${concern.label}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-sm font-semibold text-amber-950">{concern.label}</p>
              <p className="text-sm text-amber-900">{concern.message}</p>
            </div>
          ))}
          {concerns.some((concern) => concern.type === 'recency') && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
              <p>{settings.recencyWarningMessage}</p>
              <p className="mt-2 text-xs font-semibold text-blue-800">
                Recorded solo/PIC hours in this system: {(summary?.picHours ?? 0).toFixed(1)}
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4">
          {hasRenewalRelatedConcern && (
            <button
              type="button"
              onClick={handleUpdateInfo}
              className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
            >
              Update my info
            </button>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            I understand
          </button>
        </div>
      </div>
    </div>
  );
};
