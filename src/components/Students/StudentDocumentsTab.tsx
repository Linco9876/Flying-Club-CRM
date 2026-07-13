import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Download, Edit3, FileText, Loader2, Plus, Save, Trash2, Upload, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Student } from '../../types';
import { hasAnyRole } from '../../utils/rbac';

interface StudentDocumentsTabProps {
  student: Student;
}

interface StudentDocument {
  id: string;
  studentId: string;
  displayName: string;
  originalFilename: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const BUCKET = 'student-documents';
const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

const formatSize = (bytes: number) => {
  if (!bytes) return '0 KB';
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const createUploadId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const safeFilename = (filename: string) => filename.replace(/[^a-zA-Z0-9._-]/g, '_');

export const StudentDocumentsTab: React.FC<StudentDocumentsTabProps> = ({ student }) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<StudentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const canManage = Boolean(user && (student.id === user.id || hasAnyRole(user, ['admin', 'instructor', 'senior_instructor'])));

  const credentialSummary = useMemo(() => [
    ['RAAus Membership', student.licenceExpiry?.toLocaleDateString() || 'Expiry not recorded'],
    ['Medical Certificate', student.medicalExpiry?.toLocaleDateString() || 'Expiry not recorded'],
    ['CASA / RAAus ID', student.casaId || student.raausId || 'ID not recorded'],
    ['Emergency Contact', student.emergencyContact ? `${student.emergencyContact.name} recorded` : 'Missing'],
  ], [student]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('student_documents')
        .select('*, uploader:users!student_documents_uploaded_by_fkey(name)')
        .eq('student_id', student.id)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      setDocuments((data || []).map((document: any) => ({
        id: document.id,
        studentId: document.student_id,
        displayName: document.display_name,
        originalFilename: document.original_filename,
        storagePath: document.storage_path,
        mimeType: document.mime_type,
        sizeBytes: Number(document.size_bytes || 0),
        uploadedBy: document.uploaded_by,
        uploadedByName: document.uploader?.name || 'Unknown',
        createdAt: new Date(document.created_at),
        updatedAt: new Date(document.updated_at),
      })));
    } catch (error) {
      console.error('Error loading student documents:', error);
      toast.error('Failed to load student documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [student.id]);

  const handleDownload = async (document: StudentDocument) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(document.storagePath, 60);
    if (error) {
      toast.error('Failed to open document');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !canManage) return;

    const form = new FormData(event.currentTarget);
    const file = form.get('file') as File;
    const displayName = String(form.get('displayName') || '').trim();

    if (!file?.name || !displayName) {
      toast.error('Add a document name and choose a file');
      return;
    }

    const storagePath = `${student.id}/${createUploadId()}-${safeFilename(file.name)}`;

    try {
      setUploading(true);
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(storagePath, file);
      if (storageError) throw storageError;

      const { error } = await supabase.from('student_documents').insert({
        student_id: student.id,
        display_name: displayName,
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: user.id,
      });

      if (error) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        throw error;
      }

      setShowUploadForm(false);
      await fetchDocuments();
      toast.success('Document uploaded');
    } catch (error) {
      console.error('Error uploading student document:', error);
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleRename = async (document: StudentDocument) => {
    const nextName = editingName.trim();
    if (!nextName) {
      toast.error('Document name cannot be blank');
      return;
    }

    try {
      const { error } = await supabase
        .from('student_documents')
        .update({ display_name: nextName, updated_at: new Date().toISOString() })
        .eq('id', document.id);

      if (error) throw error;
      setEditingId(null);
      setEditingName('');
      await fetchDocuments();
      toast.success('Document renamed');
    } catch (error) {
      console.error('Error renaming student document:', error);
      toast.error('Failed to rename document');
    }
  };

  const handleDelete = async (document: StudentDocument) => {
    if (!window.confirm(`Delete "${document.displayName}" from this member file?`)) return;

    try {
      const { error } = await supabase
        .from('student_documents')
        .delete()
        .eq('id', document.id);

      if (error) throw error;

      const { error: storageError } = await supabase.storage.from(BUCKET).remove([document.storagePath]);
      if (storageError) {
        console.warn('Student document row deleted but file cleanup failed:', storageError);
      }

      setDocuments(prev => prev.filter(item => item.id !== document.id));
      toast.success('Document deleted');
    } catch (error) {
      console.error('Error deleting student document:', error);
      toast.error('Failed to delete document');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Documents & Credentials
            </h2>
            <p className="text-sm text-gray-500 mt-1">Upload licence, medical, membership, ID, consent and club paperwork for this member file.</p>
          </div>
          {canManage && (
            <button
              onClick={() => setShowUploadForm(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Add Document
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {credentialSummary.map(([title, detail]) => (
            <div key={title} className="border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-900">{title}</p>
              <p className="text-sm text-gray-500 mt-1">{detail}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Uploaded Documents</h3>
            <p className="text-xs text-gray-500">{documents.length} document{documents.length === 1 ? '' : 's'} on file</p>
          </div>
          {loading && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
        </div>

        {!loading && documents.length === 0 ? (
          <div className="text-center py-12 px-6">
            <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900">No documents uploaded yet</p>
            <p className="text-sm text-gray-500 mt-1">Add any document the student or club needs to keep on file.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {documents.map(document => (
              <div key={document.id} className="p-4 sm:p-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    {editingId === document.id ? (
                      <input
                        value={editingName}
                        onChange={event => setEditingName(event.target.value)}
                        className={`${inputClass} max-w-md`}
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-semibold text-gray-900 truncate">{document.displayName}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1 truncate">{document.originalFilename}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {document.updatedAt.toLocaleDateString()}</span>
                      <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" /> {document.uploadedByName}</span>
                      <span>{document.mimeType || 'File'} - {formatSize(document.sizeBytes)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {editingId === document.id ? (
                    <>
                      <button onClick={() => handleRename(document)} className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        <Save className="h-4 w-4" />
                        Save
                      </button>
                      <button onClick={() => setEditingId(null)} className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                        <X className="h-4 w-4" />
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleDownload(document)} className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                        <Download className="h-4 w-4" />
                        Open
                      </button>
                      {canManage && (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(document.id);
                              setEditingName(document.displayName);
                            }}
                            className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                          >
                            <Edit3 className="h-4 w-4" />
                            Rename
                          </button>
                          <button onClick={() => handleDelete(document)} className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-red-50 text-red-700 rounded-lg hover:bg-red-100">
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showUploadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Add Student Document</h2>
                <p className="text-sm text-gray-500 mt-1">{student.name}</p>
              </div>
              <button onClick={() => setShowUploadForm(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Document Name</label>
                <input name="displayName" required placeholder="e.g. RAAus membership card" className={inputClass} />
              </div>
              <label className="flex flex-col items-center justify-center h-36 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                <Upload className="h-8 w-8 text-gray-500 mb-2" />
                <span className="text-sm font-medium text-gray-700">Choose a file</span>
                <span className="text-xs text-gray-500 mt-1">PDF, image, Word document or spreadsheet</span>
                <input name="file" type="file" required className="hidden" />
              </label>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={() => setShowUploadForm(false)} disabled={uploading} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={uploading} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Upload Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
