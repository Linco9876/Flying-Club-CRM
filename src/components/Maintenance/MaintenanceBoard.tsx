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
  CheckSquare,
  MoreVertical,
  Edit as EditIcon,
  History as HistoryIcon,
  Trash2,
  Plane
} from 'lucide-react';
import { DefectReportForm } from './DefectReportForm';
import { DefectEditForm } from './DefectEditForm';
import { MaintenanceCompleteModal } from './MaintenanceCompleteModal';
import { useAircraft } from '../../hooks/useAircraft';
import { useMaintenanceMilestones } from '../../hooks/useMaintenanceMilestones';
import { useMaintenanceSettings } from '../../hooks/useMaintenanceSettings';
import { usePageLoadState } from '../../context/PageLoadContext';
import { Defect } from '../../types';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

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

const isImageFile = (path: string) => /\.(jpe?g|png|gif|bmp|webp)(?:$|[?#])/i.test(path);

interface DefectDetailsModalProps {
  defect: BoardDefect;
  aircraftRegistration: string;
  aircraftDescription?: string;
  onClose: () => void;
  onSelectPhoto: (photo: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowHistory: () => void;
  onChangeStatus: () => void;
}

const DefectDetailsModal: React.FC<DefectDetailsModalProps> = ({
  defect,
  aircraftRegistration,
  aircraftDescription,
  onClose,
  onSelectPhoto,
  onEdit,
  onDelete,
  onShowHistory,
  onChangeStatus
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

          {defect.fixNotes && (
            <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
              <h3 className="text-sm font-semibold text-green-900 mb-1">Fix Notes</h3>
              <p className="text-sm text-green-800">{defect.fixNotes}</p>
            </div>
          )}

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

        <div className="flex justify-between items-center p-6 border-t border-gray-200">
          <div className="flex space-x-2">
            <button
              onClick={onShowHistory}
              className="flex items-center space-x-2 px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <HistoryIcon className="h-4 w-4" />
              <span>History</span>
            </button>
            <button
              onClick={onEdit}
              className="flex items-center space-x-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <EditIcon className="h-4 w-4" />
              <span>Edit</span>
            </button>
            <button
              onClick={onChangeStatus}
              className="flex items-center space-x-2 px-4 py-2 text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
            >
              <AlertTriangle className="h-4 w-4" />
              <span>Change Status</span>
            </button>
            <button
              onClick={onDelete}
              className="flex items-center space-x-2 px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete</span>
            </button>
          </div>
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
  onSave: (status: StatusOption, melNotes?: string, fixNotes?: string) => Promise<void>;
  canMarkFixed: boolean;
}

const StatusUpdateModal: React.FC<StatusUpdateModalProps> = ({ defect, onClose, onSave, canMarkFixed }) => {
  const [status, setStatus] = useState<StatusOption>(defect.status);
  const [melNotes, setMelNotes] = useState(defect.melNotes ?? '');
  const [fixNotes, setFixNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (status === 'fixed' && !fixNotes.trim()) {
      return;
    }

    setSaving(true);
    try {
      await onSave(
        status,
        melNotes.trim() ? melNotes : undefined,
        status === 'fixed' && fixNotes.trim() ? fixNotes : undefined
      );
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
              {(['open', 'mel', 'fixed', 'deferred'] as StatusOption[])
                .filter(option => option !== 'fixed' || canMarkFixed || defect.status === 'fixed')
                .map(option => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
            {!canMarkFixed && defect.status !== 'fixed' && (
              <p className="text-xs text-gray-500 mt-1">An administrator must approve return to service.</p>
            )}
          </div>

          {status === 'fixed' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Fix Notes <span className="text-red-500">*</span>
              </label>
              <textarea
                value={fixNotes}
                onChange={(event) => setFixNotes(event.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Describe the fix that was applied"
                required
              />
              {!fixNotes.trim() && (
                <p className="text-xs text-red-600 mt-1">Fix notes are required when marking as fixed</p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              MEL / Additional Notes
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

interface OneTimeMilestoneModalProps {
  aircraft: Array<{ id: string; registration: string; totalHours: number }>;
  onClose: () => void;
  onSave: (data: {
    aircraftId: string;
    title: string;
    dueCondition: 'hours' | 'date';
    dueValue: string;
    description?: string;
  }) => Promise<void>;
}

const OneTimeMilestoneModal: React.FC<OneTimeMilestoneModalProps> = ({ aircraft, onClose, onSave }) => {
  const [formData, setFormData] = useState({
    aircraftId: aircraft[0]?.id || '',
    title: '',
    dueCondition: 'hours' as 'hours' | 'date',
    dueValue: '',
    description: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...formData,
        description: formData.description.trim() || undefined
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Add One-Time Milestone</h2>
            <p className="text-sm text-gray-600 mt-1">Create maintenance work for a single aircraft and deadline.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Aircraft</label>
            <select
              value={formData.aircraftId}
              onChange={(event) => setFormData(prev => ({ ...prev, aircraftId: event.target.value }))}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {aircraft.map(item => <option key={item.id} value={item.id}>{item.registration}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Task Name</label>
            <input
              type="text"
              value={formData.title}
              onChange={(event) => setFormData(prev => ({ ...prev, title: event.target.value }))}
              placeholder="e.g. Replace left brake pads"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Due By</label>
              <select
                value={formData.dueCondition}
                onChange={(event) => setFormData(prev => ({ ...prev, dueCondition: event.target.value as 'hours' | 'date', dueValue: '' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="hours">Tach hours</option>
                <option value="date">Calendar date</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {formData.dueCondition === 'hours' ? 'Due Tach Hours' : 'Due Date'}
              </label>
              <input
                type={formData.dueCondition === 'hours' ? 'number' : 'date'}
                step={formData.dueCondition === 'hours' ? '0.1' : undefined}
                value={formData.dueValue}
                onChange={(event) => setFormData(prev => ({ ...prev, dueValue: event.target.value }))}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
            <textarea
              value={formData.description}
              onChange={(event) => setFormData(prev => ({ ...prev, description: event.target.value }))}
              rows={3}
              placeholder="Optional instructions or context"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-70">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Add Milestone</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export const MaintenanceBoard: React.FC = () => {
  const { user } = useAuth();
  const { aircraft, loading, reportDefect, updateDefect, updateDefectStatus, getDefectHistory, deleteDefect } = useAircraft();
  const { milestones, loading: milestonesLoading, completeMaintenance, updateMilestone, createMilestone, deleteMilestone } = useMaintenanceMilestones();
  const { templates, settings: maintenanceSettings, loading: templatesLoading } = useMaintenanceSettings();
  const [selectedStatus, setSelectedStatus] = useState<'all' | StatusOption>('open');
  const [showDefectForm, setShowDefectForm] = useState(false);
  const [selectedDefect, setSelectedDefect] = useState<BoardDefect | null>(null);
  const [editingDefect, setEditingDefect] = useState<BoardDefect | null>(null);
  const [statusModalDefect, setStatusModalDefect] = useState<BoardDefect | null>(null);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);
  const [selectedMaintenance, setSelectedMaintenance] = useState<{ milestone: any; aircraftId: string } | null>(null);
  const [selectedMilestoneFilters, setSelectedMilestoneFilters] = useState<string[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [defectHistory, setDefectHistory] = useState<any[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showOneTimeMilestoneForm, setShowOneTimeMilestoneForm] = useState(false);

  usePageLoadState(
    loading || milestonesLoading || templatesLoading,
    'Loading maintenance',
    'Preparing aircraft defects, maintenance milestones, templates and settings...'
  );

  const selectedAircraftInfo = selectedDefect
    ? aircraft.find(a => a.id === selectedDefect.aircraftId)
    : undefined;

  const canMarkFixed =
    !maintenanceSettings.requireMaintenanceApproval ||
    user?.role === 'admin' ||
    user?.roles?.includes('admin');
  const canManageMaintenanceMilestones =
    user?.role === 'admin' ||
    user?.roles?.includes('admin');

  useEffect(() => {
    setSelectedStatus(maintenanceSettings.defaultDefectFilter);
  }, [maintenanceSettings.defaultDefectFilter]);

  useEffect(() => {
    const initializeMilestones = async () => {
      if (!canManageMaintenanceMilestones || aircraft.length === 0 || templates.length === 0 || milestonesLoading || templatesLoading) return;

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
              }, false);
            } catch (error) {
              console.error('Error creating milestone:', error);
            }
          }
        }
      }
    };

    initializeMilestones();
  }, [aircraft.length, canManageMaintenanceMilestones, templates.length, milestonesLoading, templatesLoading]);

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

  const handleStatusSave = async (status: StatusOption, melNotes?: string, fixNotes?: string) => {
    if (!statusModalDefect) return;
    try {
      await updateDefectStatus(statusModalDefect.id, { status, melNotes, fixNotes }, user?.id);
      setStatusModalDefect(null);
    } catch (error) {
      console.error('Failed to update defect status', error);
    }
  };

  const handleDeleteDefect = async (defectId: string) => {
    if (!confirm('Are you sure you want to delete this defect report? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteDefect(defectId);
    } catch (error) {
      console.error('Failed to delete defect', error);
    }
  };

  const handleShowHistory = async (defect: BoardDefect) => {
    if (!getDefectHistory) return;
    const history = await getDefectHistory(defect.id);
    setDefectHistory(history);
    setSelectedDefect(defect);
    setShowHistoryModal(true);
  };

  const handleDefectUpdate = async (defectId: string, updates: Partial<Defect>) => {
    await updateDefect(defectId, updates, user?.id);
    setEditingDefect(null);
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

  const handleAddOneTimeMilestone = async (data: {
    aircraftId: string;
    title: string;
    dueCondition: 'hours' | 'date';
    dueValue: string;
    description?: string;
  }) => {
    if (milestones.some(m => m.aircraftId === data.aircraftId && m.title.toLowerCase() === data.title.trim().toLowerCase())) {
      toast.error('This aircraft already has a milestone with that name');
      throw new Error('Duplicate milestone title');
    }

    const dueHours = data.dueCondition === 'hours' ? Number(data.dueValue) : undefined;
    if (data.dueCondition === 'hours' && (!Number.isFinite(dueHours) || dueHours! <= 0)) {
      toast.error('Enter a valid due tach value');
      throw new Error('Invalid due hours');
    }

    await createMilestone({
      aircraftId: data.aircraftId,
      title: data.title.trim(),
      type: data.dueCondition === 'hours' ? 'hours' : 'calendar',
      intervalHours: 0,
      intervalMonths: 0,
      nextDueHours: dueHours,
      nextDueDate: data.dueCondition === 'date' ? new Date(`${data.dueValue}T00:00:00`) : undefined,
      description: data.description,
      dueCondition: data.dueCondition,
      dueValue: data.dueValue,
      isOneTime: true
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
      milestones.filter(m => m.aircraftId === ac.id && m.status !== 'completed').forEach(milestone => {
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
        } else if (hoursRemaining !== null && hoursRemaining < maintenanceSettings.urgentReminderHours) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'urgent',
            message: `${ac.registration} - ${milestone.title} due in ${hoursRemaining.toFixed(1)} hours`
          });
        } else if (daysRemaining !== null && daysRemaining < maintenanceSettings.urgentReminderDays) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'urgent',
            message: `${ac.registration} - ${milestone.title} due in ${daysRemaining} days`
          });
        } else if (hoursRemaining !== null && hoursRemaining < maintenanceSettings.upcomingReminderHours) {
          warnings.push({
            aircraft: ac.registration,
            milestone: milestone.title,
            type: 'upcoming',
            message: `${ac.registration} - ${milestone.title} due in ${hoursRemaining.toFixed(1)} hours`
          });
        } else if (daysRemaining !== null && daysRemaining < maintenanceSettings.upcomingReminderDays) {
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

  const uniqueMilestoneNames = Array.from(
    new Set([
      ...templates.map(t => t.name),
      ...milestones
        .filter(m => !m.isOneTime && m.status !== 'completed')
        .map(m => m.title)
        .filter(Boolean),
    ])
  ).sort((left, right) => left.localeCompare(right));
  const oneTimeMilestones = milestones.filter(m => m.isOneTime && m.status !== 'completed');
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
    <div className="p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:mb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Maintenance Board</h1>
          <p className="mt-1 text-sm text-gray-500 lg:hidden">
            Track defects, alerts, and upcoming aircraft maintenance.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:items-center lg:gap-3">
          {canManageMaintenanceMilestones && (
            <button
              onClick={() => setShowOneTimeMilestoneForm(true)}
              className="flex items-center justify-center space-x-2 rounded-xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-200 lg:rounded-lg lg:py-2"
            >
              <Plus className="h-4 w-4" />
              <span>One-Time Milestone</span>
            </button>
          )}
          <button
            onClick={() => setShowDefectForm(true)}
            className="flex items-center justify-center space-x-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 lg:rounded-lg lg:py-2"
          >
            <Plus className="h-4 w-4" />
            <span>Report Defect</span>
          </button>
        </div>
      </div>

      {!milestonesLoading && milestones.length > 0 && getWarnings().length > 0 && (
        <div className="mb-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:rounded-lg lg:shadow-md">
            <h2 className="mb-3 flex items-center text-base font-semibold text-gray-900 sm:text-lg">
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

      {oneTimeMilestones.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
            <Wrench className="h-5 w-5 mr-2" />
            One-Time Maintenance
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {oneTimeMilestones.map(milestone => (
              <div key={milestone.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:rounded-lg">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase text-gray-500">{getAircraftRegistration(milestone.aircraftId)}</p>
                    <h3 className="font-semibold text-gray-900 mt-1">{milestone.title}</h3>
                    {milestone.description && <p className="text-sm text-gray-600 mt-1">{milestone.description}</p>}
                  </div>
                  {canManageMaintenanceMilestones && (
                    <button
                      onClick={() => deleteMilestone(milestone.id)}
                      title="Delete one-time milestone"
                      aria-label="Delete one-time milestone"
                      className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="text-sm text-gray-700">
                    {milestone.nextDueHours !== undefined && <p>Due at {milestone.nextDueHours.toFixed(1)} tach hours</p>}
                    {milestone.nextDueDate && <p>Due by {milestone.nextDueDate.toLocaleDateString()}</p>}
                  </div>
                  {canManageMaintenanceMilestones && (
                    <button
                      onClick={() => setSelectedMaintenance({ milestone, aircraftId: milestone.aircraftId })}
                      className="flex items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 sm:rounded sm:py-1.5"
                    >
                      <CheckSquare className="h-3 w-3" />
                      <span>Mark Complete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!templatesLoading && templates.length > 0 && (
        <div className="mb-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
              <Calendar className="h-5 w-5 mr-2" />
              Upcoming Maintenance
            </h2>
            <div className="relative">
              <button
                onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                className="flex w-full items-center justify-center space-x-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-auto lg:rounded-lg lg:py-2"
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
                <div className="absolute right-0 z-10 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white shadow-lg">
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

          <div className="space-y-3 lg:hidden">
            {aircraft.map(ac => {
              const aircraftMilestones = filteredMilestoneNames
                .map(milestoneTitle => milestones.find(m => !m.isOneTime && m.aircraftId === ac.id && m.title === milestoneTitle))
                .filter(Boolean);

              return (
                <article key={ac.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">{ac.registration}</h3>
                        <p className="text-xs text-gray-500">{ac.make} {ac.model} | {ac.totalHours.toFixed(1)} hrs</p>
                      </div>
                      <Plane className="h-5 w-5 text-gray-400" />
                    </div>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {aircraftMilestones.length === 0 ? (
                      <p className="px-4 py-4 text-sm text-gray-500">No matching milestones.</p>
                    ) : (
                      aircraftMilestones.map(milestone => {
                        if (!milestone) return null;
                        const hoursRemaining = calculateHoursRemaining(milestone.nextDueHours, ac.totalHours);
                        const daysRemaining = calculateDaysRemaining(milestone.nextDueDate);

                        let statusClasses = 'bg-green-50 text-green-700 border-green-100';
                        if (
                          (hoursRemaining !== null && hoursRemaining < maintenanceSettings.urgentReminderHours) ||
                          (daysRemaining !== null && daysRemaining < maintenanceSettings.urgentReminderDays)
                        ) {
                          statusClasses = 'bg-red-50 text-red-700 border-red-100';
                        } else if (
                          (hoursRemaining !== null && hoursRemaining < maintenanceSettings.upcomingReminderHours) ||
                          (daysRemaining !== null && daysRemaining < maintenanceSettings.upcomingReminderDays)
                        ) {
                          statusClasses = 'bg-yellow-50 text-yellow-700 border-yellow-100';
                        }

                        return (
                          <div key={milestone.id} className={`px-4 py-3 ${statusClasses}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{milestone.title}</p>
                                <div className="mt-1 space-y-0.5 text-xs">
                                  {milestone.nextDueHours !== undefined && (
                                    <p>Due: {milestone.nextDueHours.toFixed(1)} hrs{hoursRemaining !== null ? ` (${hoursRemaining.toFixed(1)} remaining)` : ''}</p>
                                  )}
                                  {milestone.nextDueDate && (
                                    <p>Due: {new Date(milestone.nextDueDate).toLocaleDateString()}{daysRemaining !== null ? ` (${daysRemaining} days)` : ''}</p>
                                  )}
                                </div>
                              </div>
                              {canManageMaintenanceMilestones && (
                                <button
                                  onClick={() => setSelectedMaintenance({ milestone, aircraftId: ac.id })}
                                  className="flex-shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                                >
                                  Complete
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="hidden bg-white rounded-lg shadow-md border border-gray-200 overflow-x-auto lg:block">
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
                      const milestone = milestones.find(m => !m.isOneTime && m.aircraftId === ac.id && m.title === milestoneTitle);

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
                      if (hoursRemaining !== null && hoursRemaining < maintenanceSettings.urgentReminderHours) {
                        statusColor = 'text-red-600';
                        bgColor = 'bg-red-50';
                      } else if (hoursRemaining !== null && hoursRemaining < maintenanceSettings.upcomingReminderHours) {
                        statusColor = 'text-yellow-600';
                        bgColor = 'bg-yellow-50';
                      } else if (daysRemaining !== null && daysRemaining < maintenanceSettings.urgentReminderDays) {
                        statusColor = 'text-red-600';
                        bgColor = 'bg-red-50';
                      } else if (daysRemaining !== null && daysRemaining < maintenanceSettings.upcomingReminderDays) {
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
                            {canManageMaintenanceMilestones && (
                              <button
                                onClick={() => setSelectedMaintenance({ milestone, aircraftId: ac.id })}
                                className="flex items-center space-x-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors"
                              >
                                <CheckSquare className="h-3 w-3" />
                                <span>Mark Complete</span>
                              </button>
                            )}
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
        <h2 className="mb-4 flex items-center text-lg font-semibold text-gray-900 sm:text-xl">
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
            <div key={defect.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:rounded-lg lg:p-6 lg:shadow-md">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center space-x-3">
                  <div className="flex-shrink-0">{getStatusIcon(defect.status)}</div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 sm:text-lg">
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
                <div className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 lg:rounded-lg">
                  <p className="text-xs font-medium text-yellow-900">MEL Notes:</p>
                  <p className="text-xs text-yellow-800 mt-1">{defect.melNotes}</p>
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center space-x-2">
                  <Camera className="h-4 w-4 text-gray-400" />
                  <span className="text-xs text-gray-500">
                    {defect.photos?.length || 0} photos
                  </span>
                </div>
                <button
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 lg:rounded-lg lg:py-2"
                  onClick={() => {
                    setActivePhoto(null);
                    setSelectedDefect(defect);
                    setShowHistoryModal(false);
                  }}
                >
                  View Details
                </button>
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

      {showDefectForm && (
        <DefectReportForm
          isOpen
          onClose={() => setShowDefectForm(false)}
          onSubmit={handleDefectSubmit}
        />
      )}

      {showOneTimeMilestoneForm && canManageMaintenanceMilestones && (
        <OneTimeMilestoneModal
          aircraft={aircraft.map(item => ({ id: item.id, registration: item.registration, totalHours: item.totalHours }))}
          onClose={() => setShowOneTimeMilestoneForm(false)}
          onSave={handleAddOneTimeMilestone}
        />
      )}

      {statusModalDefect && (
        <StatusUpdateModal
          defect={statusModalDefect}
          onClose={() => setStatusModalDefect(null)}
          onSave={handleStatusSave}
          canMarkFixed={canMarkFixed}
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
          onEdit={() => {
            setEditingDefect(selectedDefect);
            setSelectedDefect(null);
          }}
          onDelete={() => {
            setSelectedDefect(null);
            handleDeleteDefect(selectedDefect.id);
          }}
          onShowHistory={() => {
            handleShowHistory(selectedDefect);
          }}
          onChangeStatus={() => {
            setStatusModalDefect(selectedDefect);
            setSelectedDefect(null);
          }}
        />
      )}

      {activePhoto && (
        <PhotoLightbox photo={activePhoto} onClose={() => setActivePhoto(null)} />
      )}

      {selectedMaintenance && canManageMaintenanceMilestones && (
        <MaintenanceCompleteModal
          milestone={selectedMaintenance.milestone}
          aircraftRegistration={aircraft.find(a => a.id === selectedMaintenance.aircraftId)?.registration || 'Unknown'}
          currentTach={aircraft.find(a => a.id === selectedMaintenance.aircraftId)?.totalHours || 0}
          onClose={() => setSelectedMaintenance(null)}
          onComplete={handleMaintenanceComplete}
          onCorrect={handleMaintenanceCorrect}
        />
      )}

      {editingDefect && (
        <DefectEditForm
          isOpen
          onClose={() => setEditingDefect(null)}
          onSubmit={handleDefectUpdate}
          defect={editingDefect}
          aircraftRegistration={aircraft.find(a => a.id === editingDefect.aircraftId)?.registration}
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
