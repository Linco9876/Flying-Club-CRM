import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Wrench,
  CheckCircle,
  Plus,
  Camera,
  Loader2,
  X,
  User,
  Clock,
  MapPin,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  Calendar,
  CheckSquare
} from 'lucide-react';
import { DefectReportForm } from './DefectReportForm';
import { MaintenanceCompleteModal } from './MaintenanceCompleteModal';
import { useAircraft } from '../../hooks/useAircraft';
import { useMaintenanceMilestones } from '../../hooks/useMaintenanceMilestones';
import { useMaintenanceSettings } from '../../hooks/useMaintenanceSettings';
import { Defect } from '../../types';
import { useAuth } from '../../context/AuthContext';

type BoardDefect = Defect & { aircraftId: string };

type StatusOption = Defect['status'];

const STATUS_CLASSES: Record<StatusOption, string> = {
  open: 'bg-red-100 text-red-800 border-red-200',
  mel: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  fixed: 'bg-green-100 text-green-800 border-green-200',
  deferred: 'bg-gray-100 text-gray-800 border-gray-200'
};

const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

const getStatusIcon = (status: StatusOption) => {
  switch (status) {
    case 'open':
      return <AlertTriangle className="h-4 w-4 text-red-600" />;
    case 'mel':
      return <Wrench className="h-4 w-4 text-yellow-600" />;
    case 'fixed':
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    default:
      return <AlertTriangle className="h-4 w-4 text-gray-600" />;
  }
};

const isImageFile = (path: string) => /\.(jpe?g|png|gif|bmp|webp)$/i.test(path);

interface DefectDetailsModalProps {
  defect: BoardDefect;
  aircraftRegistration: string;
  aircraftDescription?: string;
  onClose: () => void;
  onSelectPhoto: (photo: string) => void;
}

const DefectDetailsModal: React.FC<DefectDetailsModalProps> = ({
  defect,
  aircraftRegistration,
  aircraftDescription,
  onClose,
  onSelectPhoto
}) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start p-6 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">{aircraftRegistration}</p>
            {aircraftDescription && (
              <p className="text-xs text-gray-500 mt-1">{aircraftDescription}</p>
            )}
            <h2 className="text-xl font-semibold text-gray-900 mt-2">{defect.summary || defect.description}</h2>
          </div>
          <div className="flex items-start space-x-3">
            <span
              className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${STATUS_CLASSES[defect.status]}`}
            >
              {defect.status.toUpperCase()}
            </span>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center space-x-3">
              <User className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Reported By</p>
                <p className="text-sm font-medium text-gray-900">{defect.reportedBy}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Clock className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Reported On</p>
                <p className="text-sm font-medium text-gray-900">
                  {defect.dateReported.toLocaleString()}
                </p>
              </div>
            </div>
            {defect.location && (
              <div className="flex items-center space-x-3">
                <MapPin className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Location</p>
                  <p className="text-sm font-medium text-gray-900">{defect.location}</p>
                </div>
              </div>
            )}
            {defect.severity && (
              <div className="flex items-center space-x-3">
                <AlertTriangle className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Severity</p>
                  <p className="text-sm font-medium text-gray-900">{defect.severity}</p>
                </div>
              </div>
            )}
            {defect.tachHours !== undefined && (
              <div className="flex items-center space-x-3">
                <FileText className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Tach Hours</p>
                  <p className="text-sm font-medium text-gray-900">{defect.tachHours}</p>
                </div>
              </div>
            )}
            {defect.hobbsHours !== undefined && (
              <div className="flex items-center space-x-3">
                <FileText className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Hobbs Hours</p>
                  <p className="text-sm font-medium text-gray-900">{defect.hobbsHours}</p>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Detailed Description</h3>
            <p className="text-sm text-gray-700 leading-relaxed">{defect.description}</p>
          </div>

          {defect.melNotes && (
            <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-yellow-900 mb-1">MEL / Notes</h3>
              <p className="text-sm text-yellow-800">{defect.melNotes}</p>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center space-x-2">
              <Camera className="h-4 w-4 text-gray-500" />
              <span>Attachments</span>
            </h3>
            {defect.photos && defect.photos.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {defect.photos.map((photo, index) => (
                  <button
                    key={`${photo}-${index}`}
                    type="button"
                    onClick={() => onSelectPhoto(photo)}
                    className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm transition"
                  >
                    {isImageFile(photo) ? (
                      <div className="w-16 h-16 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center">
                        <img
                          src={photo}
                          alt={`Defect attachment ${index + 1}`}
                          className="object-cover w-full h-full"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-md bg-gray-100 flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-gray-400" />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">{photo}</p>
                      <p className="text-xs text-blue-600">Click to view</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No attachments uploaded.</p>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

interface StatusUpdateModalProps {
  defect: BoardDefect;
  onClose: () => void;
  onSave: (status: StatusOption, melNotes?: string) => Promise<void>;
}

const StatusUpdateModal: React.FC<StatusUpdateModalProps> = ({ defect, onClose, onSave }) => {
  const [status, setStatus] = useState<StatusOption>(defect.status);
  const [melNotes, setMelNotes] = useState(defect.melNotes ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(status, melNotes.trim() ? melNotes : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-xl w-full max-w-lg"
      >
        <div className="flex justify-between items-start p-6 border-b border-gray-200">
          <div>
            <p className="text-xs text-gray-500 mb-1">Update Defect</p>
            <h2 className="text-lg font-semibold text-gray-900">{defect.summary || defect.description}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusOption)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {(['open', 'mel', 'fixed', 'deferred'] as StatusOption[]).map(option => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              MEL / Notes
            </label>
            <textarea
              value={melNotes}
              onChange={(event) => setMelNotes(event.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Add additional notes for the maintenance team"
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
            <span>Save Changes</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface PhotoLightboxProps {
  photo: string;
  onClose: () => void;
}

const PhotoLightbox: React.FC<PhotoLightboxProps> = ({ photo, onClose }) => (
  <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60] p-4">
    <div className="relative bg-white rounded-lg shadow-2xl max-w-4xl w-full p-4">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>
      {isImageFile(photo) ? (
        <img src={photo} alt="Defect attachment" className="w-full h-[70vh] object-contain rounded" />
      ) : (
        <div className="flex flex-col items-center justify-center space-y-4 py-12">
          <ImageIcon className="h-12 w-12 text-gray-400" />
          <p className="text-sm text-gray-600">This attachment cannot be previewed. Use the link below to open it.</p>
          <a
            href={photo}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Open attachment</span>
          </a>
        </div>
      )}
    </div>
  </div>
);

export const MaintenanceBoard: React.FC = () => {
  const { user } = useAuth();
  const { aircraft, loading, reportDefect, updateDefectStatus, getDefectHistory } = useAircraft();
  const { milestones, loading: milestonesLoading, completeMaintenance, updateMilestone, createMilestone } = useMaintenanceMilestones();
  const { templates, loading: templatesLoading } = useMaintenanceSettings();
  const [selectedStatus, setSelectedStatus] = useState<'all' | StatusOption>('all');
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<BoardDefect | null>(null);
  const [statusModalDefect, setStatusModalDefect] = useState<BoardDefect | null>(null);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);
  const [selectedMaintenance, setSelectedMaintenance] = useState<{ milestone: any; aircraftId: string } | null>(null);
  const [selectedMilestoneFilters, setSelectedMilestoneFilters] = useState<string[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [defectHistory, setDefectHistory] = useState<any[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const selectedAircraftInfo = selectedDefect
    ? aircraft.find(a => a.id === selectedDefect.aircraftId)
    : undefined;

  useEffect(() => {
    const initializeMilestones = async () => {
      if (aircraft.length === 0 || templates.length === 0 || milestonesLoading || templatesLoading) return;

      for (const ac of aircraft) {
        for (const template of templates) {
          const existingMilestone = milestones.find(
            m => m.aircraftId === ac.id && m.title === template.name
          );

          if (!existingMilestone) {
            try {
              await createMilestone({
                aircraftId: ac.id,
                title: template.name,
                type: template.type,
                intervalHours: template.intervalHours,
                intervalMonths: template.intervalMonths,
                description: template.description,
                nextDueHours: template.type === 'hours' || template.type === 'both'
                  ? ac.totalHours + template.intervalHours
                  : undefined,
                nextDueDate: template.type === 'calendar' || template.type === 'both'
                  ? new Date(Date.now() + template.intervalMonths * 30 * 24 * 60 * 60 * 1000)
                  : undefined
              });
            } catch (error) {
              console.error('Error creating milestone:', error);
            }
          }
        }
      }
    };

    initializeMilestones();
  }, [aircraft.length, templates.length, milestonesLoading, templatesLoading]);

  const allDefects: BoardDefect[] = aircraft.flatMap(a =>
    a.defects.map(d => ({ ...d, aircraftId: a.id }))
  );

  const filteredDefects = selectedStatus === 'all'
    ? allDefects
    : allDefects.filter(defect => defect.status === selectedStatus);

  const getAircraftRegistration = (aircraftId: string) => {
    const aircraftMatch = aircraft.find(a => a.id === aircraftId);
    return aircraftMatch?.registration || 'Unknown';
  };

  const handleDefectSubmit = async (defectData: Omit<Defect, 'id'>) => {
    try {
      await reportDefect(defectData);
      setShowDefectForm(false);
    } catch (error) {
      console.error('Error reporting defect:', error);
      throw error;
    }
  };

  const handleStatusSave = async (status: StatusOption, melNotes?: string) => {
    if (!statusModalDefect) return;
    try {
      await updateDefectStatus(statusModalDefect.id, { status, melNotes }, user?.id);
      setStatusModalDefect(null);
    } catch (error) {
      console.error('Failed to update defect status', error);
    }
  };

  const handleShowHistory = async (defect: BoardDefect) => {
    if (!getDefectHistory) return;
    const history = await getDefectHistory(defect.id);
    setDefectHistory(history);
    setSelectedDefect(defect);
    setShowHistoryModal(true);
  };

  const handleMaintenanceComplete = async (data: {
    completedDate: Date;
    completedTach: number;
    nextDueHours?: number;
    nextDueDate?: Date;
    notes?: string;
  }) => {
    if (!selectedMaintenance) return;
    await completeMaintenance({
      milestoneId: selectedMaintenance.milestone.id,
      aircraftId: selectedMaintenance.aircraftId,
      completedDate: data.completedDate,
      completedTach: data.completedTach,
      completedBy: user?.id,
      nextDueHours: data.nextDueHours,
      nextDueDate: data.nextDueDate,
      notes: data.notes
    });
  };

  const handleMaintenanceCorrect = async (data: {
    nextDueHours?: number;
    nextDueDate?: Date;
  }) => {
    if (!selectedMaintenance) return;
    await updateMilestone(selectedMaintenance.milestone.id, {
      nextDueHours: data.nextDueHours,
      nextDueDate: data.nextDueDate
    });
  };

  const calculateDaysRemaining = (dueDate?: Date) => {
    if (!dueDate) return null;
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const calculateHoursRemaining = (nextDueHours?: number, currentHours?: number) => {
    if (nextDueHours === undefined || currentHours === undefined) return null;
    return Math.max(0, nextDueHours - currentHours);
  };

  const getMilestonesByType = () => {
    const milestoneTypes = new Map<string, typeof milestones[0][]>();
    milestones.forEach(m => {
      const key = m.title;
      if (!milestoneTypes.has(key)) {
        milestoneTypes.set(key, []);
      }
      milestoneTypes.get(key)!.push(m);
    });
    return milestoneTypes;
  };

  const getWarnings = () => {
    const warnings: Array<{
      aircraft: string;
      milestone: string;
      type: 'overdue' | 'urgent' | 'upcoming';
      message: string;
    }> = [];

    aircraft.forEach(ac => {
      milestones.filter(m => m.aircraftId === ac.id).forEach(milestone => {
        const hoursRemaining = calculateHoursRemaining(milestone.nextDueHours, ac.totalHours);
        const daysRemaining = calculateDaysRemaining(milestone.nextDueDate);

        if (hoursRemaining !== null && hoursRemaining <= 0) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'overdue',
            message: `${ac.registration} - ${milestone.title} is ${Math.abs(hoursRemaining).toFixed(1)} hours overdue`
          });
        } else if (daysRemaining !== null && daysRemaining <= 0) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'overdue',
            message: `${ac.registration} - ${milestone.title} is ${Math.abs(daysRemaining)} days overdue`
          });
        } else if (hoursRemaining !== null && hoursRemaining < 10) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'urgent',
            message: `${ac.registration} - ${milestone.title} due in ${hoursRemaining.toFixed(1)} hours`
          });
        } else if (daysRemaining !== null && daysRemaining < 7) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'urgent',
            message: `${ac.registration} - ${milestone.title} due in ${daysRemaining} days`
          });
        } else if (hoursRemaining !== null && hoursRemaining < 25) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'upcoming',
            message: `${ac.registration} - ${milestone.title} due in ${hoursRemaining.toFixed(1)} hours`
          });
        } else if (daysRemaining !== null && daysRemaining < 30) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'upcoming',
            message: `${ac.registration} - ${milestone.title} due in ${daysRemaining} days`
          });
        }
      });
    });

    return warnings.sort((a, b) => {
      const typeOrder = { overdue: 0, urgent: 1, upcoming: 2 };
      return typeOrder[a.type] - typeOrder[b.type];
    });
  };

  const uniqueMilestoneNames = templates.map(t => t.name).sort();
  const filteredMilestoneNames = selectedMilestoneFilters.length === 0
    ? uniqueMilestoneNames
    : uniqueMilestoneNames.filter(name => selectedMilestoneFilters.includes(name));

  const toggleMilestoneFilter = (name: string) => {
    setSelectedMilestoneFilters(prev =>
      prev.includes(name)
        ? prev.filter(n => n !== name)
        : [...prev, name]
    );
  };

  const clearAllFilters = () => {
    setSelectedMilestoneFilters([]);
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
          className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Report Defect</span>
        </button>
      </div>

      {!milestonesLoading && milestones.length > 0 && getWarnings().length > 0 && (
        <div className="mb-6">
          <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-orange-600" />
              Maintenance Alerts
            </h2>
            <div className="space-y-2">
              {getWarnings().map((warning, idx) => (
                <div
                  key={idx}
                  className={`flex items-start space-x-3 p-3 rounded-lg ${
                    warning.type === 'overdue'
                      ? 'bg-red-50 border border-red-200'
                      : warning.type === 'urgent'
                      ? 'bg-orange-50 border border-orange-200'
                      : 'bg-yellow-50 border border-yellow-200'
                  }`}
                >
                  <AlertTriangle
                    className={`h-5 w-5 mt-0.5 ${
                      warning.type === 'overdue'
                        ? 'text-red-600'
                        : warning.type === 'urgent'
                        ? 'text-orange-600'
                        : 'text-yellow-600'
                    }`}
                  />
                  <div>
                    <p
                      className={`text-sm font-medium ${
                        warning.type === 'overdue'
                          ? 'text-red-900'
                          : warning.type === 'urgent'
                          ? 'text-orange-900'
                          : 'text-yellow-900'
                      }`}
                    >
                      {warning.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!templatesLoading && templates.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <Calendar className="h-5 w-5 mr-2" />
              Upcoming Maintenance
            </h2>
            <div className="relative">
              <button
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white hover:bg-gray-50 flex items-center space-x-2"
              >
                <span>
                  {selectedMilestoneFilters.length === 0
                    ? 'All Milestones'
                    : `${selectedMilestoneFilters.length} Selected`}
                </span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showFilterDropdown && (
                <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                  <div className="p-3 border-b border-gray-200 flex justify-between items-center">
                    <span className="font-medium text-sm text-gray-700">Filter Milestones</span>
                    <button
                      onClick={clearAllFilters}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="p-2 max-h-64 overflow-y-auto">
                    {uniqueMilestoneNames.map(name => (
                      <label
                        key={name}
                        className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMilestoneFilters.length === 0 || selectedMilestoneFilters.includes(name)}
                          onChange={() => toggleMilestoneFilter(name)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 sticky left-0 bg-gray-50">
                    Aircraft
                  </th>
                  {filteredMilestoneNames.map(milestoneTitle => (
                    <th key={milestoneTitle} className="px-4 py-3 text-left text-sm font-semibold text-gray-700 min-w-[200px]">
                      {milestoneTitle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {aircraft.map(ac => (
                  <tr key={ac.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 sticky left-0 bg-white">
                      {ac.registration}
                    </td>
                    {filteredMilestoneNames.map(milestoneTitle => {
                      const milestone = milestones.find(m => m.aircraftId === ac.id && m.title === milestoneTitle);

                      if (!milestone) {
                        return (
                          <td key={`${ac.id}-${milestoneTitle}`} className="px-4 py-3 text-sm text-gray-400">
                            -
                          </td>
                        );
                      }

                      const hoursRemaining = calculateHoursRemaining(milestone.nextDueHours, ac.totalHours);
                      const daysRemaining = calculateDaysRemaining(milestone.nextDueDate);

                      let statusColor = 'text-green-600';
                      let bgColor = 'bg-green-50';
                      if (hoursRemaining !== null && hoursRemaining < 10) {
                        statusColor = 'text-red-600';
                        bgColor = 'bg-red-50';
                      } else if (hoursRemaining !== null && hoursRemaining < 25) {
                        statusColor = 'text-yellow-600';
                        bgColor = 'bg-yellow-50';
                      } else if (daysRemaining !== null && daysRemaining < 7) {
                        statusColor = 'text-red-600';
                        bgColor = 'bg-red-50';
                      } else if (daysRemaining !== null && daysRemaining < 30) {
                        statusColor = 'text-yellow-600';
                        bgColor = 'bg-yellow-50';
                      }

                      return (
                        <td key={`${ac.id}-${milestoneTitle}`} className={`px-4 py-3 ${bgColor}`}>
                          <div className="space-y-2">
                            {milestone.nextDueHours !== undefined && (
                              <div className={`text-sm ${statusColor}`}>
                                <span className="font-medium">Due: {milestone.nextDueHours.toFixed(1)} hrs</span>
                                {hoursRemaining !== null && (
                                  <span className="block text-xs">({hoursRemaining.toFixed(1)} hrs remaining)</span>
                                )}
                              </div>
                            )}
                            {milestone.nextDueDate && (
                              <div className={`text-sm ${statusColor}`}>
                                <span className="font-medium">Due: {new Date(milestone.nextDueDate).toLocaleDateString()}</span>
                                {daysRemaining !== null && (
                                  <span className="block text-xs">({daysRemaining} days remaining)</span>
                                )}
                              </div>
                            )}
                            <button
                              onClick={() => setSelectedMaintenance({ milestone, aircraftId: ac.id })}
                              className="flex items-center space-x-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors"
                            >
                              <CheckSquare className="h-3 w-3" />
                              <span>Mark Complete</span>
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <AlertTriangle className="h-5 w-5 mr-2" />
          Defect Reports
        </h2>
        <div className="flex space-x-2 overflow-x-auto pb-1">
          {(['all', 'open', 'mel', 'fixed', 'deferred'] as const).map(status => (
            <button
              key={status}
              onClick={() => setSelectedStatus(status)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                selectedStatus === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {statusLabel(status)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredDefects.map(defect => {
          return (
            <div key={defect.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(defect.status)}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {getAircraftRegistration(defect.aircraftId)}
                    </h3>
                    <p className="text-sm text-gray-600">
                      Reported by {defect.reportedBy}
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex px-3 py-1 text-xs font-medium rounded-full border ${STATUS_CLASSES[defect.status]}`}
                >
                  {defect.status.toUpperCase()}
                </span>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-900 mb-2">{defect.summary || defect.description}</p>
                <p className="text-xs text-gray-500">
                  Reported: {defect.dateReported.toLocaleDateString()}
                </p>
              </div>

              {defect.melNotes && (
                <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg mb-4">
                  <p className="text-xs font-medium text-yellow-900">MEL Notes:</p>
                  <p className="text-xs text-yellow-800 mt-1">{defect.melNotes}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Camera className="h-4 w-4 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {defect.photos?.length || 0} photos
                  </span>
                </div>
                <div className="flex space-x-2">
                  <button
                    className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                    onClick={() => {
                      setActivePhoto(null);
                      setSelectedDefect(defect);
                      setShowHistoryModal(false);
                    }}
                  >
                    View Details
                  </button>
                  <button
                    className="px-3 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 rounded transition-colors"
                    onClick={() => handleShowHistory(defect)}
                  >
                    History
                  </button>
                  <button
                    className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                    onClick={() => setStatusModalDefect(defect)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredDefects.length === 0 && (
        <div className="text-center py-12">
          <CheckCircle className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No defects found</h3>
          <p className="text-gray-600">
            {selectedStatus === 'all'
              ? 'All aircraft are in good condition!'
              : `No defects with status: ${selectedStatus}`}
          </p>
        </div>
      )}

      <DefectReportForm
        isOpen={showDefectForm}
        onClose={() => setShowDefectForm(false)}
        onSubmit={handleDefectSubmit}
      />

      {statusModalDefect && (
        <StatusUpdateModal
          defect={statusModalDefect}
          onClose={() => setStatusModalDefect(null)}
          onSave={handleStatusSave}
        />
      )}

      {selectedDefect && (
        <DefectDetailsModal
          defect={selectedDefect}
          aircraftRegistration={getAircraftRegistration(selectedDefect.aircraftId)}
          aircraftDescription={selectedAircraftInfo ? `${selectedAircraftInfo.make} ${selectedAircraftInfo.model}` : undefined}
          onClose={() => {
            setActivePhoto(null);
            setSelectedDefect(null);
          }}
          onSelectPhoto={setActivePhoto}
        />
      )}

      {activePhoto && (
        <PhotoLightbox photo={activePhoto} onClose={() => setActivePhoto(null)} />
      )}

      {selectedMaintenance && (
        <MaintenanceCompleteModal
          milestone={selectedMaintenance.milestone}
          aircraftRegistration={aircraft.find(a => a.id === selectedMaintenance.aircraftId)?.registration || 'Unknown'}
          currentTach={aircraft.find(a => a.id === selectedMaintenance.aircraftId)?.totalHours || 0}
          onClose={() => setSelectedMaintenance(null)}
          onComplete={handleMaintenanceComplete}
          onCorrect={handleMaintenanceCorrect}
        />
      )}

      {showHistoryModal && selectedDefect && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Defect History</h2>
                <p className="text-sm text-gray-600 mt-1">{selectedDefect.summary || selectedDefect.description}</p>
              </div>
              <button
                onClick={() => {
                  setShowHistoryModal(false);
                  setSelectedDefect(null);
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              {defectHistory.length > 0 ? (
                <div className="space-y-4">
                  {defectHistory.map((entry: any, index: number) => (
                    <div key={entry.id} className="border-l-4 border-blue-500 pl-4 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-900 capitalize">{entry.field_name.replace('_', ' ')}</span>
                        <span className="text-xs text-gray-500">
                          {new Date(entry.changed_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-gray-600">Changed by: </span>
                        <span className="font-medium">{entry.changed_by_user?.name || 'Unknown'}</span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-red-50 p-2 rounded">
                          <span className="text-gray-600">Old: </span>
                          <span className="text-red-800">{entry.old_value || 'None'}</span>
                        </div>
                        <div className="bg-green-50 p-2 rounded">
                          <span className="text-gray-600">New: </span>
                          <span className="text-green-800">{entry.new_value || 'None'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">No history available for this defect.</p>
              )}
            </div>

            <div className="flex justify-end p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowHistoryModal(false);
                  setSelectedDefect(null);
                }}
                className="px-6 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};