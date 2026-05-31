import React, { useState } from 'react';
import { X, Loader2, Calendar, Wrench, Edit } from 'lucide-react';
import { MaintenanceMilestone } from '../../hooks/useMaintenanceMilestones';

interface MaintenanceCompleteModalProps {
  milestone: MaintenanceMilestone;
  aircraftRegistration: string;
  currentTach: number;
  onClose: () => void;
  onComplete: (data: {
    completedDate: Date;
    completedTach: number;
    nextDueHours?: number;
    nextDueDate?: Date;
    notes?: string;
  }) => Promise<void>;
  onCorrect: (data: {
    nextDueHours?: number;
    nextDueDate?: Date;
  }) => Promise<void>;
}

type ModalMode = 'choose' | 'register' | 'correct';

export const MaintenanceCompleteModal: React.FC<MaintenanceCompleteModalProps> = ({
  milestone,
  aircraftRegistration,
  currentTach,
  onClose,
  onComplete,
  onCorrect
}) => {
  const [mode, setMode] = useState<ModalMode>('choose');
  const [saving, setSaving] = useState(false);

  const [registerData, setRegisterData] = useState({
    completedDate: new Date().toISOString().split('T')[0],
    completedTach: currentTach,
    nextDueHours: milestone.intervalHours > 0 ? currentTach + milestone.intervalHours : 0,
    nextDueDate: milestone.intervalMonths > 0
      ? new Date(Date.now() + milestone.intervalMonths * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : '',
    notes: ''
  });

  const [correctData, setCorrectData] = useState({
    nextDueHours: milestone.nextDueHours || 0,
    nextDueDate: milestone.nextDueDate ? milestone.nextDueDate.toISOString().split('T')[0] : ''
  });

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onComplete({
        completedDate: new Date(registerData.completedDate),
        completedTach: registerData.completedTach,
        nextDueHours: registerData.nextDueHours > 0 ? registerData.nextDueHours : undefined,
        nextDueDate: registerData.nextDueDate ? new Date(registerData.nextDueDate) : undefined,
        notes: registerData.notes || undefined
      });
      onClose();
    } catch (error) {
      console.error('Error completing maintenance:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleCorrectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCorrect({
        nextDueHours: correctData.nextDueHours > 0 ? correctData.nextDueHours : undefined,
        nextDueDate: correctData.nextDueDate ? new Date(correctData.nextDueDate) : undefined
      });
      onClose();
    } catch (error) {
      console.error('Error correcting maintenance:', error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Mark Maintenance Complete</h2>
            <p className="text-sm text-gray-600 mt-1">{aircraftRegistration} - {milestone.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {mode === 'choose' && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-700 mb-6">
              Choose how you would like to proceed:
            </p>

            <button
              onClick={() => setMode('register')}
              className="w-full p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="flex items-start space-x-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Wrench className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Register Maintenance Completion
                  </h3>
                  <p className="text-sm text-gray-600">
                    Record that the maintenance was performed, log it on the aircraft logbook,
                    and set the reminder to the next deadline based on the milestone settings.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setMode('correct')}
              className="w-full p-6 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 transition-colors text-left"
            >
              <div className="flex items-start space-x-4">
                <div className="p-3 bg-yellow-100 rounded-lg">
                  <Edit className="h-6 w-6 text-yellow-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Correct the Deadline
                  </h3>
                  <p className="text-sm text-gray-600">
                    Update the deadline because the current value is inaccurate.
                    This will not create a maintenance log entry.
                  </p>
                </div>
              </div>
            </button>
          </div>
        )}

        {mode === 'register' && (
          <form onSubmit={handleRegisterSubmit}>
            <div className="p-6 space-y-4">
              <button
                type="button"
                onClick={() => setMode('choose')}
                className="text-sm text-blue-600 hover:text-blue-700 mb-4"
              >
                ← Back to options
              </button>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Date Completed <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={registerData.completedDate}
                    onChange={(e) => setRegisterData(prev => ({ ...prev, completedDate: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tach Hours When Completed <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={registerData.completedTach}
                    onChange={(e) => setRegisterData(prev => ({ ...prev, completedTach: parseFloat(e.target.value) }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {!milestone.isOneTime && (
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-3">Next Deadline</h4>

                {(milestone.type === 'hours' || milestone.type === 'both') && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-blue-900 mb-2">
                      Next Due Tach Hours
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={registerData.nextDueHours}
                      onChange={(e) => setRegisterData(prev => ({ ...prev, nextDueHours: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <p className="text-xs text-blue-700 mt-1">
                      Calculated: {registerData.completedTach} + {milestone.intervalHours} = {registerData.completedTach + milestone.intervalHours}
                    </p>
                  </div>
                )}

                {(milestone.type === 'calendar' || milestone.type === 'both') && (
                  <div>
                    <label className="block text-sm font-medium text-blue-900 mb-2">
                      Next Due Date
                    </label>
                    <input
                      type="date"
                      value={registerData.nextDueDate}
                      onChange={(e) => setRegisterData(prev => ({ ...prev, nextDueDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-blue-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                    <p className="text-xs text-blue-700 mt-1">
                      Based on {milestone.intervalMonths} month{milestone.intervalMonths !== 1 ? 's' : ''} from completion date
                    </p>
                  </div>
                )}
              </div>
              )}

              {milestone.isOneTime && (
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                  <p className="text-sm text-blue-900">
                    This is a one-time milestone. Completing it will close the task without creating another deadline.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={registerData.notes}
                  onChange={(e) => setRegisterData(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Add any additional notes about this maintenance..."
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center space-x-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-70"
                disabled={saving}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Complete Maintenance</span>
              </button>
            </div>
          </form>
        )}

        {mode === 'correct' && (
          <form onSubmit={handleCorrectSubmit}>
            <div className="p-6 space-y-4">
              <button
                type="button"
                onClick={() => setMode('choose')}
                className="text-sm text-blue-600 hover:text-blue-700 mb-4"
              >
                ← Back to options
              </button>

              <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg mb-4">
                <p className="text-sm text-yellow-800">
                  You are correcting the deadline values. This will NOT create a maintenance log entry
                  or update the last completed date.
                </p>
              </div>

              {(milestone.type === 'hours' || milestone.type === 'both') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Next Due Tach Hours
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={correctData.nextDueHours}
                    onChange={(e) => setCorrectData(prev => ({ ...prev, nextDueHours: parseFloat(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {(milestone.type === 'calendar' || milestone.type === 'both') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Next Due Date
                  </label>
                  <input
                    type="date"
                    value={correctData.nextDueDate}
                    onChange={(e) => setCorrectData(prev => ({ ...prev, nextDueDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center space-x-2 px-5 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-70"
                disabled={saving}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Update Deadline</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
