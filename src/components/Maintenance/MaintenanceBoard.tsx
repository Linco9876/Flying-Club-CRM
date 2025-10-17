import React, { useState } from 'react';
import { DefectReportForm } from './DefectReportForm';
import {
  AlertTriangle,
  Wrench,
  CheckCircle,
  Plus,
  Loader2,
  Clock,
  User,
  MapPin,
  Plane,
  Edit,
  X,
  Save,
  Eye
} from 'lucide-react';
import { useDefectReports, DefectReport, MaintenanceAuditLog } from '../../hooks/useDefectReports';
import { useAuth } from '../../context/AuthContext';
import { useAircraft } from '../../hooks/useAircraft';
import toast from 'react-hot-toast';

export const MaintenanceBoard: React.FC = () => {
  const { user } = useAuth();
  const { aircraft } = useAircraft();
  const { defectReports, loading, updateDefectReport, resolveDefect, fetchAuditLog } = useDefectReports();
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<DefectReport | null>(null);
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState<MaintenanceAuditLog[]>([]);

  const canModifyDefect = (defect: DefectReport) => {
    return user?.role === 'admin' ||
           user?.role === 'instructor' ||
           user?.id === defect.reporterId;
  };

  const canResolveDefect = () => {
    return user?.role === 'admin' || user?.role === 'instructor';
  };

  const filteredDefects = selectedStatus === 'all'
    ? defectReports
    : defectReports.filter(defect => defect.status === selectedStatus);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'resolved':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'major':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'minor':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'in_progress':
        return <Wrench className="h-4 w-4 text-yellow-600" />;
      case 'resolved':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-600" />;
    }
  };

  const handleToggleUnserviceable = async (defect: DefectReport) => {
    if (!canResolveDefect()) {
      toast.error('Only admins and instructors can change aircraft serviceability status');
      return;
    }

    const newStatus = !defect.isUnserviceable;
    const action = newStatus ? 'ground' : 'return to service';

    const confirmed = window.confirm(
      `Are you sure you want to ${action} this aircraft?\n\n` +
      (newStatus
        ? 'This will mark the aircraft as unserviceable and block all future bookings.'
        : 'This will mark the aircraft as serviceable and allow future bookings.')
    );

    if (!confirmed) return;

    try {
      await updateDefectReport(defect.id, {
        isUnserviceable: newStatus
      });
      toast.success(`Aircraft ${action === 'ground' ? 'grounded' : 'returned to service'} successfully`);
    } catch (error) {
      console.error('Error updating serviceability status:', error);
    }
  };

  const handleResolve = async () => {
    if (!selectedDefect || !user) return;

    if (!resolutionNotes.trim()) {
      toast.error('Please provide resolution notes');
      return;
    }

    try {
      await resolveDefect(selectedDefect.id, user.id, resolutionNotes);
      setShowResolveModal(false);
      setResolutionNotes('');
      setSelectedDefect(null);
    } catch (error) {
      console.error('Error resolving defect:', error);
    }
  };

  const handleViewAuditLog = async (defect: DefectReport) => {
    setSelectedDefect(defect);
    const logs = await fetchAuditLog(defect.id);
    setAuditLog(logs);
    setShowAuditLog(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Maintenance Board</h1>
        <button
          onClick={() => setShowDefectForm(true)}
          className="flex items-center space-x-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Report Defect</span>
        </button>
      </div>

      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'in_progress', label: 'In Progress' },
            { value: 'resolved', label: 'Resolved' }
          ].map(status => (
            <button
              key={status.value}
              onClick={() => setSelectedStatus(status.value)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                selectedStatus === status.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>
      </div>

      {filteredDefects.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-12 text-center">
          <CheckCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No defects found</h3>
          <p className="text-gray-500">
            {selectedStatus === 'all'
              ? 'No maintenance defects have been reported.'
              : `No ${selectedStatus} defects at this time.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredDefects.map(defect => (
            <div key={defect.id} className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(defect.status)}
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {defect.briefSummary}
                      </h3>
                      <div className="flex items-center space-x-2 mt-1">
                        <Plane className="h-3 w-3 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          {defect.aircraft?.registration || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end space-y-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getSeverityColor(defect.severity)}`}>
                      {defect.severity.charAt(0).toUpperCase() + defect.severity.slice(1)}
                    </span>
                    <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${getStatusColor(defect.status)}`}>
                      {defect.status.replace('_', ' ').charAt(0).toUpperCase() + defect.status.replace('_', ' ').slice(1)}
                    </span>
                  </div>
                </div>

                <p className="text-sm text-gray-700 mb-4">
                  {defect.detailedSummary}
                </p>

                <div className="space-y-2 text-xs text-gray-600 mb-4">
                  <div className="flex items-center space-x-2">
                    <User className="h-3 w-3" />
                    <span>Reported by: {defect.reporter?.name || 'Unknown'}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="h-3 w-3" />
                    <span>Discovered: {new Date(defect.discoveryDate).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <MapPin className="h-3 w-3" />
                    <span>Location: {defect.location}</span>
                  </div>
                  {defect.engineHours && (
                    <div className="flex items-center space-x-2">
                      <Wrench className="h-3 w-3" />
                      <span>Engine hours: {defect.engineHours.toFixed(1)}</span>
                    </div>
                  )}
                </div>

                {defect.isUnserviceable && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-xs font-medium text-red-700">
                      Aircraft is currently UNSERVICEABLE
                    </p>
                  </div>
                )}

                {defect.status === 'resolved' && defect.resolutionNotes && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                    <p className="text-xs font-medium text-green-700 mb-1">Resolution:</p>
                    <p className="text-xs text-green-600">{defect.resolutionNotes}</p>
                    {defect.resolver && (
                      <p className="text-xs text-green-600 mt-1">
                        Resolved by: {defect.resolver.name}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="flex space-x-2">
                    {canResolveDefect() && defect.status !== 'resolved' && (
                      <>
                        <button
                          onClick={() => handleToggleUnserviceable(defect)}
                          className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                            defect.isUnserviceable
                              ? 'bg-green-100 text-green-700 hover:bg-green-200'
                              : 'bg-red-100 text-red-700 hover:bg-red-200'
                          }`}
                        >
                          {defect.isUnserviceable ? 'Return to Service' : 'Ground Aircraft'}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedDefect(defect);
                            setShowResolveModal(true);
                          }}
                          className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 font-medium transition-colors"
                        >
                          Resolve
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => handleViewAuditLog(defect)}
                    className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium transition-colors flex items-center space-x-1"
                  >
                    <Eye className="h-3 w-3" />
                    <span>Audit Log</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <DefectReportForm
        isOpen={showDefectForm}
        onClose={() => setShowDefectForm(false)}
        onRefresh={() => {}}
      />

      {showResolveModal && selectedDefect && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Resolve Defect</h2>
              <button
                onClick={() => {
                  setShowResolveModal(false);
                  setResolutionNotes('');
                  setSelectedDefect(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-700 mb-4">
                <strong>Defect:</strong> {selectedDefect.briefSummary}
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Resolution Notes *
              </label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="Describe how the defect was resolved..."
                required
              />
            </div>
            <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowResolveModal(false);
                  setResolutionNotes('');
                  setSelectedDefect(null);
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Save className="h-4 w-4" />
                <span>Mark as Resolved</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuditLog && selectedDefect && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-xl font-semibold text-gray-900">Audit Log</h2>
              <button
                onClick={() => {
                  setShowAuditLog(false);
                  setAuditLog([]);
                  setSelectedDefect(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm font-medium text-gray-700 mb-4">
                Defect: {selectedDefect.briefSummary}
              </p>
              {auditLog.length === 0 ? (
                <p className="text-sm text-gray-500">No audit log entries found.</p>
              ) : (
                <div className="space-y-4">
                  {auditLog.map(log => (
                    <div key={log.id} className="border-l-4 border-blue-500 pl-4 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">
                          {log.action}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        By: {log.performer?.name || 'System'}
                      </p>
                      {log.notes && (
                        <p className="text-xs text-gray-600 mt-1">{log.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
