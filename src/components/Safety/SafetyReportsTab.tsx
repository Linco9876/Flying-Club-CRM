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

  const statusCounts = reports.reduce((counts, report) => {
    counts[report.status] = (counts[report.status] ?? 0) + 1;
    return counts;
  }, {} as Record<SafetyReportStatus, number>);

  const severityClass = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-amber-100 text-amber-800 border-amber-200';
      default: return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  const statusClass = (status: SafetyReportStatus) => {
    switch (status) {
      case 'open': return 'bg-red-50 text-red-700 border-red-200';
      case 'under_review': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'closed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Safety Reports</h2>
          <p className="text-sm text-gray-600">
            {isStaff ? 'Manage club hazards, incidents and risk assessments' : 'Reports submitted by you or involving you'}
          </p>
        </div>
        <button onClick={() => setShowReportForm(true)} className="flex w-full items-center justify-center space-x-2 rounded-lg bg-blue-600 px-4 py-2.5 text-white hover:bg-blue-700 sm:w-auto sm:py-2">
          <Plus className="h-4 w-4" />
          <span>Add Report</span>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Open', value: statusCounts.open ?? 0, className: 'border-red-200 bg-red-50 text-red-700' },
          { label: 'Review', value: statusCounts.under_review ?? 0, className: 'border-blue-200 bg-blue-50 text-blue-700' },
          { label: 'Closed', value: statusCounts.closed ?? 0, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-3 sm:p-4 ${card.className}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{card.label}</p>
            <p className="mt-1 text-2xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,1fr)_170px_180px_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
            <span className="relative block">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Title, reporter or location" />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Status</span>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="under_review">Under Review</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Type</span>
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">All types</option>
              <option value="incident">Incident</option>
              <option value="hazard">Hazard</option>
              <option value="risk_assessment">Risk Assessment</option>
            </select>
          </label>
          <button onClick={exportCsv} className="flex items-center justify-center space-x-2 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-green-700">
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-600">Showing {filteredReports.length} reports</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="space-y-3 p-4 md:hidden">
          {loading && <p className="py-8 text-center text-sm text-gray-500">Loading safety reports...</p>}
          {!loading && filteredReports.length === 0 && <p className="py-8 text-center text-sm text-gray-500">No safety reports found.</p>}
          {!loading && filteredReports.map(report => (
            <article key={report.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">SR-{report.id.slice(0, 8).toUpperCase()}</p>
                  <h3 className="mt-1 line-clamp-2 text-base font-semibold text-gray-900">{report.title}</h3>
                  <p className="mt-1 text-xs text-gray-500">{report.createdAt.toLocaleDateString()} - {report.reporterName}</p>
                </div>
                <button onClick={() => setSelectedReport(report)} className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                  View
                </button>
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-gray-600">{report.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">{labels[report.reportType]}</span>
                <span className={`rounded-full border px-2 py-1 text-xs font-medium ${severityClass(report.severity)}`}>{report.severity}</span>
                <span className={`rounded-full border px-2 py-1 text-xs font-medium ${statusClass(report.status)}`}>{labels[report.status]}</span>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50"><tr>
              {['Report ID', 'Date', 'Type', 'Title', 'Reporter', 'Status', 'Actions'].map(label => <th key={label} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-200">
              {filteredReports.map(report => (
                <tr key={report.id} className="hover:bg-gray-50">
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
        {!loading && filteredReports.length === 0 && <p className="hidden text-center py-12 text-gray-500 md:block">No safety reports found.</p>}
        {loading && <p className="hidden text-center py-12 text-gray-500 md:block">Loading safety reports...</p>}
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
