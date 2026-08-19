import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useStudents } from '../../hooks/useStudents';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useExternalLogbook } from '../../hooks/useExternalLogbook';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import {
  buildSafetyComplianceSummary,
  type SafetyComplianceSummary,
} from '../../utils/safetyCompliance';
import { shouldOpenSafetyWarning } from '../../utils/safetyWarningGate';

const isDismissedForSession = (storageKey: string) => {
  if (!storageKey) return false;

  try {
    return sessionStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
};

export const SafetyLoginWarningModal: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { students, loading: studentsLoading, error: studentsError } = useStudents();
  const { flightLogs, loading: flightLogsLoading, error: flightLogsError } = useFlightLogs(user?.id);
  const {
    baselines: logbookBaselines,
    entries: externalLogbookEntries,
    loading: externalLogbookLoading,
    error: externalLogbookError,
  } = useExternalLogbook(user?.id);
  const { settings, loading: safetySettingsLoading } = useSafetySettings();
  const [dismissedUserId, setDismissedUserId] = React.useState<string | null>(null);
  const [displayedWarning, setDisplayedWarning] = React.useState<{
    userId: string;
    summary: SafetyComplianceSummary;
  } | null>(null);

  const student = user ? students.find((candidate) => candidate.id === user.id) : null;
  const candidateSummary = React.useMemo(
    () => student
      ? buildSafetyComplianceSummary(student, settings, flightLogs, {
          perspective: 'firstPerson',
          baselines: logbookBaselines,
          externalEntries: externalLogbookEntries,
        })
      : null,
    [externalLogbookEntries, flightLogs, logbookBaselines, settings, student]
  );
  const storageKey = user ? `safety-login-warning-dismissed:${user.id}` : '';
  const dismissed = Boolean(
    user && (dismissedUserId === user.id || isDismissedForSession(storageKey))
  );
  const dataReady = !studentsLoading
    && !flightLogsLoading
    && !externalLogbookLoading
    && !safetySettingsLoading
    && !studentsError
    && !flightLogsError
    && !externalLogbookError;

  React.useEffect(() => {
    if (!user || !candidateSummary || !shouldOpenSafetyWarning({
      userId: user?.id,
      dataReady,
      dismissed,
      displayedUserId: displayedWarning?.userId,
      concernCount: candidateSummary.concerns.length,
    })) {
      return;
    }

    // Once displayed, keep this complete-data snapshot visible until the user
    // explicitly acknowledges it. Background refetches must not close the modal.
    setDisplayedWarning({
      userId: user.id,
      summary: candidateSummary,
    });
  }, [candidateSummary, dataReady, dismissed, displayedWarning?.userId, user]);

  const summary = displayedWarning && displayedWarning.userId === user?.id
    ? displayedWarning.summary
    : null;
  const concerns = summary?.concerns ?? [];
  const hasRenewalRelatedConcern = concerns.some((concern) => ['medical', 'licence', 'bfr'].includes(concern.type));

  const handleDismiss = () => {
    if (!user) return;

    try {
      sessionStorage.setItem(storageKey, 'true');
    } catch {
      // The in-memory acknowledgement still works when storage is unavailable.
    }
    setDismissedUserId(user.id);
    setDisplayedWarning((current) => current?.userId === user.id ? null : current);
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
              <h3 className="text-base font-semibold text-gray-900">{settings.safetyLoginWarningTitle}</h3>
              <p className="mt-1 text-sm text-gray-600">{settings.safetyLoginWarningMessage}</p>
            </div>
          </div>
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
                Recorded total PIC hours: {(summary?.picHours ?? 0).toFixed(1)}
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
