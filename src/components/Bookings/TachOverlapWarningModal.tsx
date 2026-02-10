import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface OverlappingLog {
  id: string;
  start_tach: number;
  end_tach: number;
  start_time: string;
  end_time: string;
}

interface TachOverlapWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  overlappingLogs: OverlappingLog[];
  tachStart: number;
  tachEnd: number;
}

export const TachOverlapWarningModal: React.FC<TachOverlapWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  overlappingLogs,
  tachStart,
  tachEnd
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center">
            <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
            Tachometer Overlap Warning
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              The tachometer range you entered <strong>({tachStart.toFixed(1)} - {tachEnd.toFixed(1)})</strong> overlaps with {overlappingLogs.length} existing flight log{overlappingLogs.length > 1 ? 's' : ''}:
            </p>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {overlappingLogs.map((log) => (
              <div key={log.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      Tach: {log.start_tach.toFixed(1)} - {log.end_tach.toFixed(1)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {new Date(log.start_time).toLocaleString()} - {new Date(log.end_time).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              This might indicate an error in tachometer readings. Do you want to continue anyway?
            </p>
          </div>
        </div>

        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
          >
            Continue Anyway
          </button>
        </div>
      </div>
    </div>
  );
};
