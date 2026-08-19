import React, { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface SettingsLoadErrorProps {
  section: string;
  error: string;
  onRetry: () => void | Promise<void>;
}

export const SettingsLoadError: React.FC<SettingsLoadErrorProps> = ({ section, error, onRetry }) => {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetry();
    } catch (caught) {
      console.error(`Retrying ${section} settings failed`, caught);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="p-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-red-900">{section} settings could not be loaded</h2>
            <p className="mt-1 text-sm text-red-800">
              No editable defaults have been substituted, so existing settings cannot be overwritten accidentally.
            </p>
            <p className="mt-2 break-words text-xs text-red-700">{error}</p>
            <button
              type="button"
              onClick={retry}
              disabled={retrying}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
