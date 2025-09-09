import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Download, Upload, Plus, FileText, Calendar, User } from 'lucide-react';
import toast from 'react-hot-toast';

interface Document {
  id: string;
  filename: string;
  category: string;
  lastUpdated: Date;
  uploadedBy: string;
  size: string;
  type: string;
}

export const ChecklistsDocsTab: React.FC = () => {
  const { user } = useAuth();
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);

  // Mock documents data
  const [documents, setDocuments] = useState<Document[]>([
    {
      id: '1',
      filename: 'Standard Operating Procedures v2.1.pdf',
      category: 'SOPs',
      lastUpdated: new Date('2024-01-15'),
      uploadedBy: 'Safety Officer',
      size: '2.4 MB',
      type: 'PDF'
    },
    {
      id: '2',
      filename: 'Emergency Procedures Checklist.pdf',
      category: 'Emergency Procedures',
      lastUpdated: new Date('2024-01-10'),
      uploadedBy: 'Chief Flying Instructor',
      size: '1.8 MB',
      type: 'PDF'
    },
    {
      id: '3',
      filename: 'Safety Manual 2024.pdf',
      category: 'Safety Manuals',
      lastUpdated: new Date('2024-01-01'),
      uploadedBy: 'Safety Committee',
      size: '5.2 MB',
      type: 'PDF'
    },
    {
      id: '4',
      filename: 'OH&S Risk Assessment Template.docx',
      category: 'OH&S Documents',
      lastUpdated: new Date('2023-12-20'),
      uploadedBy: 'Safety Officer',
      size: '156 KB',
      type: 'DOCX'
    },
    {
      id: '5',
      filename: 'Pre-flight Inspection Checklist.pdf',
      category: 'SOPs',
      lastUpdated: new Date('2023-12-15'),
      uploadedBy: 'Chief Flying Instructor',
      size: '892 KB',
      type: 'PDF'
    },
    {
      id: '6',
      filename: 'Weather Minimums Guide.pdf',
      category: 'Safety Manuals',
      lastUpdated: new Date('2023-12-10'),
      uploadedBy: 'Safety Officer',
      size: '1.2 MB',
      type: 'PDF'
    }
  ]);

  const categories = ['SOPs', 'Safety Manuals', 'Emergency Procedures', 'OH&S Documents'];

  const filteredDocuments = documents.filter(doc =>
    !categoryFilter || doc.category === categoryFilter
  );

  const sortedDocuments = [...filteredDocuments].sort((a, b) =>
    new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  );

  const handleDownload = (document: Document) => {
    toast.success(`Downloading ${document.filename}...`);
    // In a real app, this would trigger the actual download
  };

  const handleUpload = (uploadData: any) => {
    const newDocument: Document = {
      id: (documents.length + 1).toString(),
      filename: uploadData.filename,
      category: uploadData.category,
      lastUpdated: new Date(),
      uploadedBy: user?.name || 'Unknown',
      size: uploadData.size || '1.0 MB',
      type: uploadData.filename.split('.').pop()?.toUpperCase() || 'PDF'
    };

    setDocuments(prev => [newDocument, ...prev]);
    setShowUploadForm(false);
    toast.success('Document uploaded successfully');
  };

  const getFileIcon = (type: string) => {
    return <FileText className="h-5 w-5 text-blue-600" />;
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'SOPs': return 'bg-blue-100 text-blue-800';
      case 'Safety Manuals': return 'bg-green-100 text-green-800';
      case 'Emergency Procedures': return 'bg-red-100 text-red-800';
      case 'OH&S Documents': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const canUpload = user?.role === 'admin' || user?.role === 'instructor';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Checklists & Documentation</h2>
          <p className="text-sm text-gray-600">Downloadable reference documents and procedures</p>
        </div>
        {canUpload && (
          <button
            onClick={() => setShowUploadForm(true)}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Upload Document</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {categories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          Showing {sortedDocuments.length} documents
        </div>
      </div>

      {/* Documents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedDocuments.map(document => (
          <div key={document.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-6 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3">
                {getFileIcon(document.type)}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-900 truncate" title={document.filename}>
                    {document.filename}
                  </h3>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full mt-1 ${getCategoryColor(document.category)}`}>
                    {document.category}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm text-gray-600 mb-4">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4" />
                <span>Updated: {document.lastUpdated.toLocaleDateString()}</span>
              </div>
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4" />
                <span>By: {document.uploadedBy}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{document.type}</span>
                <span>{document.size}</span>
              </div>
            </div>

            <button
              onClick={() => handleDownload(document)}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Download</span>
            </button>
          </div>
        ))}
      </div>

      {sortedDocuments.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg shadow-md border border-gray-200">
          <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No documents found</h3>
          <p className="text-gray-600">No documents match the selected category filter.</p>
        </div>
      )}

      {/* Upload Form Modal */}
      {showUploadForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Upload Document</h2>
              <button
                onClick={() => setShowUploadForm(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const fileInput = e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement;
                const file = fileInput?.files?.[0];
                
                handleUpload({
                  filename: file?.name || formData.get('filename'),
                  category: formData.get('category'),
                  size: file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : '1.0 MB'
                });
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
                <select
                  name="category"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select category</option>
                  {categories.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">File *</label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-4 text-gray-500" />
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-gray-500">PDF, DOC, DOCX (MAX. 10MB)</p>
                    </div>
                    <input
                      type="file"
                      required
                      accept=".pdf,.doc,.docx"
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowUploadForm(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
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