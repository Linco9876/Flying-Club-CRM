import React, { useState } from 'react';
import { Download, Eye, Plus, Search, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStudents } from '../../hooks/useStudents';
import { SafetyReport, SafetyReportStatus, useSafetyReports } from '../../hooks/useSafetyReports';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import { hasAnyRole } from '../../utils/rbac';
import toast from 'react-hot-toast';

const labels = {
  incident: 'Incident',
  hazard: 'Hazard',
  risk_assessment: 'Risk Assessment',
  open: 'Open',
  under_review: 'Under Review',
  closed: 'Closed'
};

const escapeCsv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export const SafetyReportsTab: React.FC = () => {
  const { user } = useAuth();
  const { students } = useStudents();
  const { categories } = useSafetySettings();
  const { reports, loading, createReport, updateStatus } = useSafetyReports();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showReportForm, setShowReportForm] = useState(false);
  const [selectedReport, setSelectedReport] = useState<SafetyReport | null>(null);
  const isStaff = hasAnyRole(user, ['admin', 'instructor']);

  const filteredReports = reports.filter(report => {
    const search = searchTerm.toLowerCase();
    return (!search || [report.title, report.description, report.reporterName, report.location]
      .some(value => value?.toLowerCase().includes(search)))
      && (!statusFilter || report.status === statusFilter)
      && (!typeFilter || report.reportType === typeFilter);
  });

  const exportCsv = () => {
    const header = ['Report ID', 'Date', 'Type', 'Severity', 'Title', 'Reporter', 'Status', 'Assigned To'];
    const rows = filteredReports.map(report => [
      `SR-${report.id.slice(0, 8).toUpperCase()}`,
      report.createdAt.toLocaleDateString(),
      labels[report.reportType],
      report.severity,
      report.title,
      report.reporterName,
      labels[report.status],
      report.assignedTo
    ]);
    const blob = new Blob([[header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'safety-reports.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await createReport({
        categoryId: String(form.get('categoryId') || '') || undefined,
        reportType: form.get('reportType') as any,
        severity: form.get('severity') as any,
        title: String(form.get('title') || ''),
        description: String(form.get('description') || ''),
        location: String(form.get('location') || ''),
        immediateActions: String(form.get('immediateActions') || ''),
        involvedUserIds: form.getAll('involvedUserIds').map(String)
      });
      setShowReportForm(false);
    } catch (error) {
      console.error('Error creating safety report:', error);
      toast.error('Failed to submit safety report');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Safety Reports</h2>
          <p className="text-sm text-gray-600">
            {isStaff ? 'Manage club hazards, incidents and risk assessments' : 'Reports submitted by you or involving you'}
          </p>
        </div>
        <button onClick={() => setShowReportForm(true)} className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus className="h-4 w-4" />
          <span>Add Report</span>
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
            <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md" placeholder="Search reports..." />
          </div>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-md">
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="under_review">Under Review</option>
            <option value="closed">Closed</option>
          </select>
          <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="px-3 py-2 border border-gray-300 rounded-md">
            <option value="">All types</option>
            <option value="incident">Incident</option>
            <option value="hazard">Hazard</option>
            <option value="risk_assessment">Risk Assessment</option>
          </select>
          <button onClick={exportCsv} className="flex items-center justify-center space-x-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-600">Showing {filteredReports.length} reports</p>
      </div>

      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50"><tr>
              {['Report ID', 'Date', 'Type', 'Title', 'Reporter', 'Status', 'Actions'].map(label => <th key={label} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-200">
              {filteredReports.map(report => (
                <tr key={report.id}>
                  <td className="px-6 py-4 text-sm font-medium">SR-{report.id.slice(0, 8).toUpperCase()}</td>
                  <td className="px-6 py-4 text-sm">{report.createdAt.toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-sm">{labels[report.reportType]}</td>
                  <td className="px-6 py-4 text-sm">{report.title}</td>
                  <td className="px-6 py-4 text-sm">{report.reporterName}</td>
                  <td className="px-6 py-4 text-sm">{labels[report.status]}</td>
                  <td className="px-6 py-4"><button onClick={() => setSelectedReport(report)} className="text-blue-600 flex items-center space-x-1"><Eye className="h-4 w-4" /><span>View</span></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filteredReports.length === 0 && <p className="text-center py-12 text-gray-500">No safety reports found.</p>}
        {loading && <p className="text-center py-12 text-gray-500">Loading safety reports...</p>}
      </div>

      {showReportForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-6 border-b"><h2 className="text-xl font-semibold">Add Safety Report</h2><button onClick={() => setShowReportForm(false)}><X className="h-5 w-5" /></button></div>
            <form onSubmit={submitReport} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select name="reportType" required className="px-3 py-2 border rounded-md"><option value="">Select type</option><option value="incident">Incident</option><option value="hazard">Hazard</option><option value="risk_assessment">Risk Assessment</option></select>
                <select name="severity" required className="px-3 py-2 border rounded-md"><option value="low">Low severity</option><option value="medium">Medium severity</option><option value="high">High severity</option><option value="critical">Critical severity</option></select>
                <select name="categoryId" className="px-3 py-2 border rounded-md"><option value="">No category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              </div>
              <input name="title" required className="w-full px-3 py-2 border rounded-md" placeholder="Brief occurrence title" />
              <input name="location" className="w-full px-3 py-2 border rounded-md" placeholder="Location" />
              <textarea name="description" required rows={5} className="w-full px-3 py-2 border rounded-md" placeholder="Describe what happened and any contributing factors" />
              <textarea name="immediateActions" rows={3} className="w-full px-3 py-2 border rounded-md" placeholder="Immediate actions taken" />
              <div><label className="block text-sm font-medium mb-2">People involved</label><select name="involvedUserIds" multiple className="w-full px-3 py-2 border rounded-md h-28">{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></div>
              <div className="flex justify-end space-x-3 pt-4 border-t"><button type="button" onClick={() => setShowReportForm(false)} className="px-4 py-2 bg-gray-100 rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Submit Report</button></div>
            </form>
          </div>
        </div>
      )}

      {selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex justify-between"><div><p className="text-xs text-gray-500">SR-{selectedReport.id.slice(0, 8).toUpperCase()}</p><h2 className="text-xl font-semibold">{selectedReport.title}</h2></div><button onClick={() => setSelectedReport(null)}><X className="h-5 w-5" /></button></div>
            <p className="text-sm text-gray-600">{labels[selectedReport.reportType]} · {selectedReport.severity} severity · reported by {selectedReport.reporterName}</p>
            <p className="text-sm whitespace-pre-wrap">{selectedReport.description}</p>
            {selectedReport.location && <p className="text-sm"><strong>Location:</strong> {selectedReport.location}</p>}
            {selectedReport.immediateActions && <p className="text-sm whitespace-pre-wrap"><strong>Immediate actions:</strong> {selectedReport.immediateActions}</p>}
            {selectedReport.assignedTo && <p className="text-sm"><strong>Assigned to:</strong> {selectedReport.assignedTo}</p>}
            {isStaff && <select value={selectedReport.status} onChange={async event => { const status = event.target.value as SafetyReportStatus; await updateStatus(selectedReport.id, status); setSelectedReport({ ...selectedReport, status }); }} className="px-3 py-2 border rounded-md"><option value="open">Open</option><option value="under_review">Under Review</option><option value="closed">Closed</option></select>}
          </div>
        </div>
      )}
    </div>
  );
};
