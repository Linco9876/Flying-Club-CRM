import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Download, FileText, Loader2, Plane, Plus, Save, Settings, Trash2, Upload, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { AircraftFlightLogs } from './AircraftFlightLogs';
import { useAircraft } from '../../hooks/useAircraft';
import { useAircraftRates, AircraftRate } from '../../hooks/useAircraftRates';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useBookings } from '../../hooks/useBookings';
import { useMaintenanceMilestones, MaintenanceCompletion } from '../../hooks/useMaintenanceMilestones';
import { useUsers } from '../../hooks/useUsers';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { hasAnyRole } from '../../utils/rbac';

type AircraftProfileTab = 'documents' | 'flight-log' | 'milestones' | 'bookings' | 'pricing';

interface AircraftDocument {
  id: string;
  filename: string;
  filePath: string;
  fileType: string | null;
  fileSize: number;
  documentType: string;
  uploadedByName: string;
  createdAt: Date;
}

const DOCUMENT_BUCKET = 'aircraft-documents';
const DOCUMENT_TYPES = ['POH', 'Charts', 'Maintenance Release', 'Weight & Balance', 'Insurance', 'Other'];
const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_');
const createId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const AircraftProfilePage: React.FC = () => {
  const { aircraftId } = useParams<{ aircraftId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { aircraft, loading: aircraftLoading } = useAircraft();
  const { bookings, loading: bookingsLoading } = useBookings();
  const { users } = useUsers();
  const { milestones, loading: milestonesLoading } = useMaintenanceMilestones();
  const { rates, loading: ratesLoading, upsertRate, deleteRate } = useAircraftRates(aircraftId);
  const { flightTypes, paymentMethods } = useBillingSettings();
  const [activeTab, setActiveTab] = useState<AircraftProfileTab>('documents');
  const [documents, setDocuments] = useState<AircraftDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documentTypeFilter, setDocumentTypeFilter] = useState('');
  const [milestoneFilter, setMilestoneFilter] = useState<'all' | 'upcoming' | 'due' | 'overdue' | 'completed'>('all');
  const [completions, setCompletions] = useState<MaintenanceCompletion[]>([]);
  const [completionsLoading, setCompletionsLoading] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<'all' | 'future' | 'past' | 'cancelled'>('all');
  const [bookingSearch, setBookingSearch] = useState('');
  const [savingRateId, setSavingRateId] = useState<string | null>(null);

  const selectedAircraft = aircraft.find(item => item.id === aircraftId);
  const isAdmin = hasAnyRole(user, ['admin']);
  const isStudentOrPilot = hasAnyRole(user, ['student', 'pilot']) && !hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']);
  const canManageAircraft = hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']);

  useEffect(() => {
    if (isStudentOrPilot && (activeTab === 'flight-log' || activeTab === 'milestones')) {
      setActiveTab('documents');
    }
  }, [activeTab, isStudentOrPilot]);

  const fetchDocuments = async () => {
    if (!aircraftId) return;
    setDocumentsLoading(true);
    try {
      const { data, error } = await supabase
        .from('aircraft_documents')
        .select('*, uploader:users!aircraft_documents_uploaded_by_fkey(name)')
        .eq('aircraft_id', aircraftId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDocuments((data || []).map((document: any) => ({
        id: document.id,
        filename: document.filename,
        filePath: document.file_path,
        fileType: document.file_type,
        fileSize: Number(document.file_size || 0),
        documentType: document.document_type || 'Other',
        uploadedByName: document.uploader?.name || 'Unknown',
        createdAt: new Date(document.created_at),
      })));
    } catch (error) {
      console.error('Failed to load aircraft documents:', error);
      toast.error('Failed to load aircraft documents');
    } finally {
      setDocumentsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [aircraftId]);

  const fetchCompletions = async () => {
    if (!aircraftId) return;
    setCompletionsLoading(true);
    try {
      const { data, error } = await supabase
        .from('maintenance_completions')
        .select('*')
        .eq('aircraft_id', aircraftId)
        .order('completed_date', { ascending: false });
      if (error) throw error;
      setCompletions((data || []).map((completion: any) => ({
        id: completion.id,
        milestoneId: completion.milestone_id,
        aircraftId: completion.aircraft_id,
        completedDate: completion.completed_date ? new Date(completion.completed_date) : new Date(completion.completed_at),
        completedTach: completion.completed_tach != null ? Number(completion.completed_tach) : completion.tach_hours != null ? Number(completion.tach_hours) : undefined,
        completedBy: completion.completed_by || undefined,
        nextDueHours: completion.next_due_hours != null ? Number(completion.next_due_hours) : undefined,
        nextDueDate: completion.next_due_date ? new Date(completion.next_due_date) : undefined,
        notes: completion.notes || undefined,
      })));
    } catch (error) {
      console.error('Failed to load maintenance history:', error);
      toast.error('Failed to load maintenance history');
    } finally {
      setCompletionsLoading(false);
    }
  };

  useEffect(() => {
    fetchCompletions();
  }, [aircraftId]);

  const aircraftMilestones = milestones.filter(milestone => milestone.aircraftId === aircraftId);
  const filteredMilestones = aircraftMilestones.filter(milestone => milestoneFilter === 'all' || milestone.status === milestoneFilter);
  const aircraftBookings = bookings.filter(booking => booking.aircraftId === aircraftId);
  const filteredBookings = aircraftBookings.filter(booking => {
    const now = new Date();
    const student = users.find(item => item.id === booking.studentId);
    const instructor = users.find(item => item.id === booking.instructorId);
    const matchesSearch = !bookingSearch.trim()
      || student?.name.toLowerCase().includes(bookingSearch.toLowerCase())
      || instructor?.name.toLowerCase().includes(bookingSearch.toLowerCase())
      || booking.notes?.toLowerCase().includes(bookingSearch.toLowerCase());
    const matchesTime = bookingFilter === 'all'
      || (bookingFilter === 'future' && booking.startTime >= now && booking.status !== 'cancelled')
      || (bookingFilter === 'past' && booking.startTime < now && booking.status !== 'cancelled')
      || (bookingFilter === 'cancelled' && booking.status === 'cancelled');
    return matchesSearch && matchesTime;
  }).sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  const handleUploadDocument = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!aircraftId || !user || !isAdmin) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file') as File;
    const documentType = String(form.get('documentType') || 'Other');
    const displayName = String(form.get('displayName') || '').trim();
    if (!file?.name) {
      toast.error('Choose a document to upload');
      return;
    }
    const filename = displayName || file.name;
    const storagePath = `${aircraftId}/${createId()}-${safeFilename(file.name)}`;
    setUploading(true);
    try {
      const { error: storageError } = await supabase.storage.from(DOCUMENT_BUCKET).upload(storagePath, file);
      if (storageError) throw storageError;
      const { error } = await supabase.from('aircraft_documents').insert({
        aircraft_id: aircraftId,
        filename,
        file_path: storagePath,
        file_type: file.type || null,
        file_size: file.size,
        document_type: documentType,
        uploaded_by: user.id,
      });
      if (error) {
        await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
        throw error;
      }
      setShowUpload(false);
      await fetchDocuments();
      toast.success('Aircraft document uploaded');
    } catch (error) {
      console.error('Failed to upload aircraft document:', error);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadDocument = async (document: AircraftDocument) => {
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(document.filePath, 60);
    if (error) {
      toast.error('Failed to open document');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDeleteDocument = async (document: AircraftDocument) => {
    if (!isAdmin || !window.confirm(`Delete ${document.filename}?`)) return;
    try {
      const { error } = await supabase.from('aircraft_documents').delete().eq('id', document.id);
      if (error) throw error;
      await supabase.storage.from(DOCUMENT_BUCKET).remove([document.filePath]);
      setDocuments(prev => prev.filter(item => item.id !== document.id));
      toast.success('Document deleted');
    } catch (error) {
      console.error('Failed to delete aircraft document:', error);
      toast.error('Failed to delete document');
    }
  };

  const updateRateField = (flightTypeId: string, updates: Partial<AircraftRate>) => {
    const existing = rates.find(rate => rate.flightTypeId === flightTypeId);
    const next = {
      id: existing?.id,
      aircraftId: aircraftId!,
      flightTypeId,
      chargeType: existing?.chargeType || 'tach',
      soloRate: existing?.soloRate || 0,
      dualRate: existing?.dualRate || 0,
      flatSurcharge: existing?.flatSurcharge || 0,
      weekendSurcharge: existing?.weekendSurcharge || 0,
      defaultPaymentMethodId: existing?.defaultPaymentMethodId || null,
      includedTaxes: existing?.includedTaxes || 0,
      ...updates,
    };
    return next;
  };

  const saveRate = async (flightTypeId: string, updates: Partial<AircraftRate>) => {
    if (!aircraftId || !isAdmin) return;
    setSavingRateId(flightTypeId);
    try {
      await upsertRate(updateRateField(flightTypeId, updates));
    } finally {
      setSavingRateId(null);
    }
  };

  if (aircraftLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading aircraft profile...</div>;
  }

  if (!selectedAircraft) {
    return <div className="p-3 text-sm text-gray-500 sm:p-6">Aircraft not found.</div>;
  }

  const tabs: Array<{ id: AircraftProfileTab; label: string; icon: React.ReactNode; staffOnly?: boolean }> = [
    { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
    { id: 'flight-log', label: 'Flight Log', icon: <Plane className="h-4 w-4" /> },
    { id: 'milestones', label: 'Milestones', icon: <Wrench className="h-4 w-4" /> },
    { id: 'bookings', label: 'Bookings', icon: <Calendar className="h-4 w-4" /> },
    { id: 'pricing', label: 'Pricing', icon: <Settings className="h-4 w-4" /> },
  ].filter(tab => {
    if (isStudentOrPilot) return ['documents', 'bookings', 'pricing'].includes(tab.id);
    return !tab.staffOnly || canManageAircraft;
  });

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate('/aircraft')} className="mt-1 rounded-lg p-2 hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{selectedAircraft.registration}</h1>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                selectedAircraft.status === 'serviceable' ? 'bg-emerald-100 text-emerald-800' :
                selectedAircraft.status === 'maintenance' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
              }`}>
                {selectedAircraft.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">{selectedAircraft.make} {selectedAircraft.model} | {selectedAircraft.totalHours.toFixed(1)} hours</p>
          </div>
        </div>
        {canManageAircraft && (
          <button onClick={() => navigate(`/aircraft/${selectedAircraft.id}/logs`)} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Plane className="h-4 w-4" />
            Open full log
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Seats</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{selectedAircraft.seatCapacity || '-'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Fuel</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{selectedAircraft.fuelCapacity ? `${selectedAircraft.fuelCapacity} L` : '-'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Open Defects</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{selectedAircraft.defects.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Milestones</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{aircraftMilestones.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-gray-500">Bookings</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{aircraftBookings.length}</p>
        </div>
      </div>

      <div className="app-tab-scroller">
        <nav className="app-tab-list">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`app-tab-button ${
                activeTab === tab.id ? 'app-tab-button-active' : ''
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Aircraft Documents</h2>
              <p className="text-sm text-gray-500">POH, charts and school documents for this aircraft.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={documentTypeFilter} onChange={event => setDocumentTypeFilter(event.target.value)} className={inputClass}>
                <option value="">All document types</option>
                {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
              {isAdmin && (
                <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  <Plus className="h-4 w-4" />
                  Upload
                </button>
              )}
            </div>
          </div>

          {showUpload && isAdmin && (
            <form onSubmit={handleUploadDocument} className="rounded-lg border border-blue-200 bg-blue-50 p-5">
              <div className="grid gap-3 md:grid-cols-4">
                <input name="displayName" placeholder="Display name" className={inputClass} />
                <select name="documentType" className={inputClass} defaultValue="POH">
                  {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
                <input name="file" type="file" className="md:col-span-1 text-sm" required />
                <div className="flex gap-2">
                  <button disabled={uploading} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Save
                  </button>
                  <button type="button" onClick={() => setShowUpload(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm">Cancel</button>
                </div>
              </div>
            </form>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {documentsLoading ? (
              <div className="text-sm text-gray-500">Loading documents...</div>
            ) : documents.filter(document => !documentTypeFilter || document.documentType === documentTypeFilter).length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">No aircraft documents uploaded yet.</div>
            ) : (
              documents.filter(document => !documentTypeFilter || document.documentType === documentTypeFilter).map(document => (
                <div key={document.id} className="rounded-lg border border-gray-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-gray-900">{document.filename}</p>
                      <p className="mt-1 text-xs text-gray-500">{document.documentType} | {formatSize(document.fileSize)} | {document.createdAt.toLocaleDateString()}</p>
                    </div>
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">Uploaded by {document.uploadedByName}</p>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => handleDownloadDocument(document)} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                    {isAdmin && (
                      <button onClick={() => handleDeleteDocument(document)} className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'flight-log' && <AircraftFlightLogs aircraftIdOverride={aircraftId} embedded />}

      {activeTab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Maintenance Milestones</h2>
              <p className="text-sm text-gray-500">Upcoming, due, overdue and completed milestones for this aircraft.</p>
            </div>
            <select value={milestoneFilter} onChange={event => setMilestoneFilter(event.target.value as any)} className={inputClass}>
              <option value="all">All milestones</option>
              <option value="upcoming">Upcoming</option>
              <option value="due">Due</option>
              <option value="overdue">Overdue</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {milestonesLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading milestones...</div>
            ) : filteredMilestones.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No milestones match this filter.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredMilestones.map(milestone => (
                  <div key={milestone.id} className="grid gap-3 p-4 md:grid-cols-[1fr_180px_180px_120px]">
                    <div>
                      <p className="font-semibold text-gray-900">{milestone.title}</p>
                      <p className="mt-1 text-sm text-gray-500">{milestone.description || 'No description recorded'}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-gray-500">Next hours</p>
                      <p className="font-medium text-gray-900">{milestone.nextDueHours != null ? milestone.nextDueHours.toFixed(1) : '-'}</p>
                    </div>
                    <div className="text-sm">
                      <p className="text-gray-500">Next date</p>
                      <p className="font-medium text-gray-900">{milestone.nextDueDate ? milestone.nextDueDate.toLocaleDateString() : '-'}</p>
                    </div>
                    <div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        milestone.status === 'overdue' ? 'bg-red-100 text-red-700' :
                        milestone.status === 'due' ? 'bg-amber-100 text-amber-700' :
                        milestone.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {milestone.status || 'upcoming'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-200 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Maintenance History</h3>
              <p className="mt-1 text-sm text-gray-500">Completed milestones and one-time maintenance events.</p>
            </div>
            {completionsLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading maintenance history...</div>
            ) : completions.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No completed maintenance history recorded yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {completions.map(completion => {
                  const milestone = aircraftMilestones.find(item => item.id === completion.milestoneId);
                  return (
                    <div key={completion.id} className="grid gap-3 p-4 md:grid-cols-[1fr_160px_160px]">
                      <div>
                        <p className="font-semibold text-gray-900">{milestone?.title || 'Maintenance completed'}</p>
                        <p className="mt-1 text-sm text-gray-500">{completion.notes || 'No notes recorded'}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500">Completed</p>
                        <p className="font-medium text-gray-900">{completion.completedDate.toLocaleDateString()}</p>
                      </div>
                      <div className="text-sm">
                        <p className="text-gray-500">Tach</p>
                        <p className="font-medium text-gray-900">{completion.completedTach != null ? completion.completedTach.toFixed(1) : '-'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'bookings' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Aircraft Bookings</h2>
              <p className="text-sm text-gray-500">Past and future bookings for this aircraft.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={bookingFilter} onChange={event => setBookingFilter(event.target.value as any)} className={inputClass}>
                <option value="all">All bookings</option>
                <option value="future">Future</option>
                <option value="past">Past</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <input value={bookingSearch} onChange={event => setBookingSearch(event.target.value)} placeholder="Filter by pilot, instructor or notes" className={inputClass} />
            </div>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {bookingsLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading bookings...</div>
            ) : filteredBookings.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No bookings match this filter.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredBookings.map(booking => {
                  const student = users.find(item => item.id === booking.studentId);
                  const instructor = users.find(item => item.id === booking.instructorId);
                  return (
                    <div key={booking.id} className="grid gap-3 p-4 lg:grid-cols-[220px_1fr_140px]">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{booking.startTime.toLocaleString('en-AU')}</p>
                        <p className="mt-1 text-xs text-gray-500">to {booking.endTime.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{booking.hirerName || student?.name || 'Unknown pilot/student'}</p>
                        <p className="mt-1 text-xs text-gray-500">{booking.instructorName || instructor?.name ? `Instructor: ${booking.instructorName || instructor?.name}` : 'No instructor'} | {booking.notes || 'No notes'}</p>
                      </div>
                      <div className="text-right">
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-700">{booking.status.replace('_', ' ')}</span>
                        {booking.flightLog && <p className="mt-2 text-xs text-emerald-700">Logged</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'pricing' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-900">Aircraft Pricing</h2>
            <p className="text-sm text-gray-500">
              {isAdmin ? 'Define the aircraft price per flight type.' : 'Current aircraft pricing by flight type.'}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {ratesLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading pricing...</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {flightTypes.map(flightType => {
                  const rate = rates.find(item => item.flightTypeId === flightType.id);
                  return (
                    <RateRow
                      key={flightType.id}
                      flightTypeName={flightType.name}
                      rate={rate}
                      disabled={!isAdmin}
                      paymentMethods={paymentMethods.filter(method => method.active)}
                      saving={savingRateId === flightType.id}
                      onSave={updates => saveRate(flightType.id, updates)}
                      onDelete={rate?.id ? () => deleteRate(rate.id) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface RateRowProps {
  flightTypeName: string;
  rate?: AircraftRate;
  disabled: boolean;
  paymentMethods: { id: string; name: string }[];
  saving: boolean;
  onSave: (updates: Partial<AircraftRate>) => void;
  onDelete?: () => void;
}

const RateRow: React.FC<RateRowProps> = ({ flightTypeName, rate, disabled, paymentMethods, saving, onSave, onDelete }) => {
  const [draft, setDraft] = useState({
    chargeType: rate?.chargeType || 'tach',
    soloRate: String(rate?.soloRate ?? 0),
    dualRate: String(rate?.dualRate ?? 0),
    flatSurcharge: String(rate?.flatSurcharge ?? 0),
    weekendSurcharge: String(rate?.weekendSurcharge ?? 0),
    defaultPaymentMethodId: rate?.defaultPaymentMethodId || '',
    includedTaxes: String(rate?.includedTaxes ?? 0),
  });

  useEffect(() => {
    setDraft({
      chargeType: rate?.chargeType || 'tach',
      soloRate: String(rate?.soloRate ?? 0),
      dualRate: String(rate?.dualRate ?? 0),
      flatSurcharge: String(rate?.flatSurcharge ?? 0),
      weekendSurcharge: String(rate?.weekendSurcharge ?? 0),
      defaultPaymentMethodId: rate?.defaultPaymentMethodId || '',
      includedTaxes: String(rate?.includedTaxes ?? 0),
    });
  }, [rate?.id, rate?.chargeType, rate?.soloRate, rate?.dualRate, rate?.flatSurcharge, rate?.weekendSurcharge, rate?.defaultPaymentMethodId, rate?.includedTaxes]);

  const save = () => onSave({
    chargeType: draft.chargeType as AircraftRate['chargeType'],
    soloRate: Number(draft.soloRate) || 0,
    dualRate: Number(draft.dualRate) || 0,
    flatSurcharge: Number(draft.flatSurcharge) || 0,
    weekendSurcharge: Number(draft.weekendSurcharge) || 0,
    defaultPaymentMethodId: draft.defaultPaymentMethodId || null,
    includedTaxes: Number(draft.includedTaxes) || 0,
  });

  return (
    <div className="grid gap-3 p-4 xl:grid-cols-[180px_120px_repeat(5,1fr)_120px] xl:items-end">
      <div>
        <p className="text-sm font-semibold text-gray-900">{flightTypeName}</p>
        <p className="text-xs text-gray-500">{rate ? 'Configured' : 'No rate yet'}</p>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Charge</span>
        <select disabled={disabled} value={draft.chargeType} onChange={event => setDraft(prev => ({ ...prev, chargeType: event.target.value }))} className={inputClass}>
          <option value="tach">Tach</option>
          <option value="flat">Flat</option>
          <option value="per_pax">Per pax</option>
          <option value="free">Free</option>
          <option value="not_used">Not used</option>
        </select>
      </label>
      {[
        ['Solo', 'soloRate'],
        ['Dual', 'dualRate'],
        ['Flat +', 'flatSurcharge'],
        ['Weekend +', 'weekendSurcharge'],
        ['Tax %', 'includedTaxes'],
      ].map(([label, key]) => (
        <label key={key} className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
          <input disabled={disabled} type="number" step="0.01" value={(draft as any)[key]} onChange={event => setDraft(prev => ({ ...prev, [key]: event.target.value }))} className={inputClass} />
        </label>
      ))}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-500">Default method</span>
        <select disabled={disabled} value={draft.defaultPaymentMethodId} onChange={event => setDraft(prev => ({ ...prev, defaultPaymentMethodId: event.target.value }))} className={inputClass}>
          <option value="">None</option>
          {paymentMethods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={disabled || saving} onClick={save} className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        {onDelete && (
          <button type="button" disabled={disabled} onClick={onDelete} className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
