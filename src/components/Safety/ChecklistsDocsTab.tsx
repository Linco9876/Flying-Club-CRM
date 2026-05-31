import React, { useEffect, useState } from 'react';
import { Calendar, Download, FileText, Plus, Upload, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { hasAnyRole } from '../../utils/rbac';
import toast from 'react-hot-toast';

interface SafetyDocument {
  id: string;
  filename: string;
  category: string;
  storagePath: string;
  lastUpdated: Date;
  uploadedBy: string;
  sizeBytes: number;
  type: string;
}

const categories = ['SOPs', 'Safety Manuals', 'Emergency Procedures', 'OH&S Documents'];

const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const ChecklistsDocsTab: React.FC = () => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<SafetyDocument[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const canUpload = hasAnyRole(user, ['admin', 'instructor']);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('safety_documents')
        .select('*, uploader:users!safety_documents_uploaded_by_fkey(name)')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setDocuments((data || []).map((document: any) => ({
        id: document.id,
        filename: document.filename,
        category: document.category,
        storagePath: document.storage_path,
        lastUpdated: new Date(document.updated_at),
        uploadedBy: document.uploader?.name || 'Unknown',
        sizeBytes: Number(document.size_bytes || 0),
        type: document.filename.split('.').pop()?.toUpperCase() || 'FILE'
      })));
    } catch (error) {
      console.error('Error loading safety documents:', error);
      toast.error('Failed to load safety documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDownload = async (document: SafetyDocument) => {
    const { data, error } = await supabase.storage.from('safety-documents').createSignedUrl(document.storagePath, 60);
    if (error) {
      toast.error('Failed to download document');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    const file = form.get('file') as File;
    const category = String(form.get('category') || '');
    const storagePath = `${Date.now()}-${crypto.randomUUID()}-${file.name}`;
    try {
      const { error: storageError } = await supabase.storage.from('safety-documents').upload(storagePath, file);
      if (storageError) throw storageError;
      const { error } = await supabase.from('safety_documents').insert({
        filename: file.name,
        category,
        storage_path: storagePath,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: user.id
      });
      if (error) {
        await supabase.storage.from('safety-documents').remove([storagePath]);
        throw error;
      }
      setShowUploadForm(false);
      await fetchDocuments();
      toast.success('Document uploaded');
    } catch (error) {
      console.error('Error uploading safety document:', error);
      toast.error('Failed to upload document');
    }
  };

  const filteredDocuments = documents.filter(document => !categoryFilter || document.category === categoryFilter);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div><h2 className="text-lg font-semibold text-gray-900">Checklists & Documentation</h2><p className="text-sm text-gray-600">Club procedures and safety references</p></div>
        {canUpload && <button onClick={() => setShowUploadForm(true)} className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"><Plus className="h-4 w-4" /><span>Upload Document</span></button>}
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-md">
          <option value="">All categories</option>
          {categories.map(category => <option key={category}>{category}</option>)}
        </select>
        <p className="mt-4 text-sm text-gray-600">Showing {filteredDocuments.length} documents</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredDocuments.map(document => (
          <div key={document.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
            <div className="flex items-center space-x-3 mb-4"><FileText className="h-5 w-5 text-blue-600" /><div><h3 className="text-sm font-medium">{document.filename}</h3><p className="text-xs text-gray-500">{document.category}</p></div></div>
            <div className="space-y-2 text-sm text-gray-600 mb-4">
              <p className="flex items-center space-x-2"><Calendar className="h-4 w-4" /><span>{document.lastUpdated.toLocaleDateString()}</span></p>
              <p className="flex items-center space-x-2"><User className="h-4 w-4" /><span>{document.uploadedBy}</span></p>
              <p>{document.type} · {formatSize(document.sizeBytes)}</p>
            </div>
            <button onClick={() => handleDownload(document)} className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"><Download className="h-4 w-4" /><span>Download</span></button>
          </div>
        ))}
      </div>
      {!loading && filteredDocuments.length === 0 && <div className="text-center py-12 bg-white rounded-lg border border-gray-200"><FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No safety documents uploaded yet.</p></div>}

      {showUploadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex justify-between items-center p-6 border-b"><h2 className="text-xl font-semibold">Upload Document</h2><button onClick={() => setShowUploadForm(false)}><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              <select name="category" required className="w-full px-3 py-2 border rounded-md"><option value="">Select category</option>{categories.map(category => <option key={category}>{category}</option>)}</select>
              <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg cursor-pointer bg-gray-50"><Upload className="h-8 w-8 text-gray-500 mb-2" /><span className="text-sm text-gray-600">Choose a PDF, DOC or DOCX file</span><input name="file" type="file" required accept=".pdf,.doc,.docx" className="hidden" /></label>
              <div className="flex justify-end space-x-3 pt-4 border-t"><button type="button" onClick={() => setShowUploadForm(false)} className="px-4 py-2 bg-gray-100 rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Upload Document</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
