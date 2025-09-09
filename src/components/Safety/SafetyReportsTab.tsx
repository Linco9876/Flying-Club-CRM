import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plus, Search, Download, Eye, Edit, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

interface SafetyReport {
  id: string;
  date: Date;
  type: 'Incident' | 'Hazard' | 'Risk Assessment';
  reporter: string;
  title: string;
  description: string;
  status: 'Open' | 'Under Review' | 'Closed';
  investigator?: string;
  attachments: string[];
}

export const SafetyReportsTab: React.FC = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showReportForm, setShowReportForm] = useState(false);

  // Mock safety reports data
  const [safetyReports, setSafetyReports] = useState<SafetyReport[]>([
    {
      id: 'SR-001',
      date: new Date('2024-01-20'),
      type: 'Incident',
      reporter: 'John Pilot',
      title: 'Hard landing during training',
      description: 'Student pilot made hard landing during circuit training. No damage to aircraft.',
      status: 'Under Review',
      investigator: 'Chief Flying Instructor',
      attachments: ['incident_photo.jpg']
    },
    {
      id: 'SR-002',
      date: new Date('2024-01-18'),
      type: 'Hazard',
      reporter: 'Chief Flying Instructor',
      title: 'Runway surface deterioration',
      description: 'Noticed cracks in runway surface near threshold. Potential hazard for aircraft operations.',
      status: 'Open',
      attachments: []
    },
    {
      id: 'SR-003',
      date: new Date('2024-01-15'),
      type: 'Risk Assessment',
      reporter: 'Safety Officer',
      title: 'Weather minimums review',
      description: 'Assessment of current weather minimums for student solo flights.',
      status: 'Closed',
      investigator: 'Safety Committee',
      attachments: ['weather_analysis.pdf']
    }
  ]);

  const filteredReports = safetyReports.filter(report => {
    // If user is a student, only show reports they're involved in
    if (user?.role === 'student') {
      const isInvolved = report.reporter === user.name || 
                        report.title.toLowerCase().includes(user.name.toLowerCase()) ||
                        report.description.toLowerCase().includes(user.name.toLowerCase());
      if (!isInvolved) return false;
    }
    
    const matchesSearch = report.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         report.reporter.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = !statusFilter || report.status === statusFilter;
    const matchesType = !typeFilter || report.type === typeFilter;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  const sortedReports = [...filteredReports].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const handleExport = (format: 'csv' | 'xlsx') => {
    toast.success(`Exporting safety reports to ${format.toUpperCase()}...`);
  };

  const handleAddReport = () => {
    setShowReportForm(true);
  };

  const handleSubmitReport = (reportData: any) => {
    const newReport: SafetyReport = {
      id: `SR-${String(safetyReports.length + 1).padStart(3, '0')}`,
      date: new Date(),
      type: reportData.type,
      reporter: reportData.reporter,
      title: reportData.title,
      description: reportData.description,
      status: 'Open',
      attachments: reportData.attachments || []
    };

    setSafetyReports(prev => [newReport, ...prev]);
    setShowReportForm(false);
    toast.success('Safety report submitted successfully');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Open': return 'bg-red-100 text-red-800 border-red-200';
      case 'Under Review': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Closed': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'Incident': return 'bg-red-100 text-red-800';
      case 'Hazard': return 'bg-orange-100 text-orange-800';
      case 'Risk Assessment': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Add Report Button */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Safety Reports</h2>
          <p className="text-sm text-gray-600">
            {user?.role === 'student' 
              ? 'Safety reports involving you' 
              : 'Centralized log of all safety occurrences and assessments'
            }
          </p>
        </div>
        {(user?.role === 'admin' || user?.role === 'instructor') && (
          <button
            onClick={handleAddReport}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Add Report</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search reports..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="Open">Open</option>
              <option value="Under Review">Under Review</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="Incident">Incident</option>
              <option value="Hazard">Hazard</option>
              <option value="Risk Assessment">Risk Assessment</option>
            </select>
          </div>

          <div className="flex items-end">
            <div className="flex space-x-2 w-full">
              <button
                onClick={() => handleExport('csv')}
                className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => handleExport('xlsx')}
                className="flex-1 flex items-center justify-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>XLSX</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600">
          Showing {sortedReports.length} reports
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Report ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reporter
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedReports.map(report => (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {report.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {report.date.toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getTypeColor(report.type)}`}>
                      {report.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-xs">
                    <div className="truncate" title={report.title}>
                      {report.title}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {report.reporter}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(report.status)}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button className="text-blue-600 hover:text-blue-900 flex items-center space-x-1">
                        <Eye className="h-4 w-4" />
                        <span>View</span>
                      </button>
                      {report.status !== 'Closed' && (
                        <button className="text-gray-600 hover:text-gray-900 flex items-center space-x-1">
                          <Edit className="h-4 w-4" />
                          <span>Edit</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedReports.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No safety reports found matching the selected filters.</p>
          </div>
        )}
      </div>

      {/* Add Report Form Modal */}
      {showReportForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">Add Safety Report</h2>
              <button
                onClick={() => setShowReportForm(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                handleSubmitReport({
                  type: formData.get('type'),
                  reporter: formData.get('reporter'),
                  title: formData.get('title'),
                  description: formData.get('description')
                });
              }}
              className="p-6 space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
                  <select
                    name="type"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select type</option>
                    <option value="Incident">Incident</option>
                    <option value="Hazard">Hazard</option>
                    <option value="Risk Assessment">Risk Assessment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reporter *</label>
                  <input
                    type="text"
                    name="reporter"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Your name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
                <input
                  type="text"
                  name="title"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description of the occurrence"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
                <textarea
                  name="description"
                  required
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Detailed description of what happened, when, where, and any contributing factors..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Attachments</label>
                <div className="flex items-center justify-center w-full">
                  <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      <Upload className="w-8 h-8 mb-4 text-gray-500" />
                      <p className="mb-2 text-sm text-gray-500">
                        <span className="font-semibold">Click to upload</span> photos or documents
                      </p>
                      <p className="text-xs text-gray-500">JPG, PNG, PDF (MAX. 10MB each)</p>
                    </div>
                    <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" className="hidden" />
                  </label>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowReportForm(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};