import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Download, FileJson, Loader2, RefreshCw, Search, Table } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface AuditDataSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface AuditLogEntry {
  id: string;
  timestamp: Date;
  userName: string;
  action: string;
  resource: string;
  details: string;
  source: string;
}

interface ExportTable {
  table: string;
  label: string;
  description: string;
}

interface TableSummary {
  table: string;
  label: string;
  count: number | null;
  error?: string;
}

const exportTables: ExportTable[] = [
  { table: 'users', label: 'Users', description: 'User profiles and contact details' },
  { table: 'user_roles', label: 'User roles', description: 'Role assignments used by access control' },
  { table: 'students', label: 'Students', description: 'Student/pilot operational file records' },
  { table: 'aircraft', label: 'Aircraft', description: 'Aircraft records and operational status' },
  { table: 'aircraft_rates', label: 'Aircraft rates', description: 'Aircraft billing rates' },
  { table: 'bookings', label: 'Bookings', description: 'Calendar bookings and waitlist records' },
  { table: 'flight_logs', label: 'Flight logs', description: 'Logged aircraft flights' },
  { table: 'training_records', label: 'Training records', description: 'Student training records and embedded audit history' },
  { table: 'training_sequence_results', label: 'Training results', description: 'Training criteria/result rows' },
  { table: 'training_courses', label: 'Training courses', description: 'Course and lesson library records' },
  { table: 'defect_reports', label: 'Defect reports', description: 'Aircraft defect reports' },
  { table: 'maintenance_milestones', label: 'Maintenance milestones', description: 'Aircraft maintenance due items' },
  { table: 'maintenance_completions', label: 'Maintenance completions', description: 'Completed maintenance records' },
  { table: 'maintenance_audit_log', label: 'Maintenance audit', description: 'Maintenance and defect audit events' },
  { table: 'safety_reports', label: 'Safety reports', description: 'Incident, hazard and risk reports' },
  { table: 'invoices', label: 'Invoices', description: 'Invoice headers' },
  { table: 'invoice_items', label: 'Invoice items', description: 'Invoice line items' },
  { table: 'account_transactions', label: 'Account transactions', description: 'Pilot account ledger transactions' },
];

const formatDateTime = (date: Date) => date.toLocaleString('en-AU', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const escapeCsv = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const downloadFile = (filename: string, contents: string, type: string) => {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const actionClass = (action: string) => {
  const normalized = action.toLowerCase();
  if (normalized.includes('delete') || normalized.includes('remove')) return 'bg-red-100 text-red-800';
  if (normalized.includes('create') || normalized.includes('insert') || normalized.includes('add')) return 'bg-green-100 text-green-800';
  if (normalized.includes('update') || normalized.includes('edit') || normalized.includes('resolve')) return 'bg-blue-100 text-blue-800';
  if (normalized.includes('sign') || normalized.includes('ack')) return 'bg-indigo-100 text-indigo-800';
  return 'bg-gray-100 text-gray-800';
};

export const AuditDataSettings: React.FC<AuditDataSettingsProps> = () => {
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [tableSummaries, setTableSummaries] = useState<TableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [actionFilter, setActionFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const loadAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResults, maintenanceResult, trainingResult, usersResult] = await Promise.all([
        Promise.all(exportTables.map(async table => {
          const { count, error } = await supabase
            .from(table.table)
            .select('*', { count: 'exact', head: true });

          return {
            table: table.table,
            label: table.label,
            count: error ? null : count ?? 0,
            error: error?.message,
          };
        })),
        supabase
          .from('maintenance_audit_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('training_records')
          .select('id, date, student_id, instructor_id, audit_log, updated_at')
          .order('date', { ascending: false })
          .limit(300),
        supabase
          .from('users')
          .select('id, name, email'),
      ]);

      setTableSummaries(summaryResults);

      const userMap = new Map<string, string>();
      if (!usersResult.error) {
        (usersResult.data || []).forEach(user => {
          userMap.set(user.id, user.name || user.email || user.id);
        });
      }

      const maintenanceEntries: AuditLogEntry[] = maintenanceResult.error ? [] : (maintenanceResult.data || []).map(row => ({
        id: `maintenance-${row.id}`,
        timestamp: new Date(row.created_at),
        userName: userMap.get(row.performed_by) || row.performed_by || 'Unknown user',
        action: row.action || 'MAINTENANCE',
        resource: row.defect_report_id ? 'Defect report' : row.aircraft_id ? 'Aircraft maintenance' : 'Maintenance',
        details: row.notes || JSON.stringify({ oldValues: row.old_values, newValues: row.new_values }),
        source: 'Maintenance',
      }));

      const trainingEntries: AuditLogEntry[] = trainingResult.error ? [] : (trainingResult.data || []).flatMap(row => {
        const entries = Array.isArray(row.audit_log) ? row.audit_log : [];
        return entries.map((entry: any, index: number) => ({
          id: `training-${row.id}-${entry.id || index}`,
          timestamp: new Date(entry.timestamp || row.updated_at || row.date),
          userName: entry.userName || userMap.get(entry.userId) || entry.userId || 'Unknown user',
          action: entry.action || 'TRAINING_RECORD',
          resource: 'Training record',
          details: entry.changes ? JSON.stringify(entry.changes) : `Training record ${row.id}`,
          source: 'Training',
        }));
      });

      setAuditLog([...maintenanceEntries, ...trainingEntries].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()));

      if (maintenanceResult.error || trainingResult.error) {
        toast.error('Some audit sources could not be loaded');
      }
    } catch (err) {
      console.error('Failed to load audit data:', err);
      toast.error('Failed to load audit data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuditData();
  }, [loadAuditData]);

  const filteredAuditLog = useMemo(() => auditLog.filter(entry => {
    const query = searchTerm.trim().toLowerCase();
    const matchesSearch = !query
      || entry.userName.toLowerCase().includes(query)
      || entry.action.toLowerCase().includes(query)
      || entry.resource.toLowerCase().includes(query)
      || entry.details.toLowerCase().includes(query)
      || entry.source.toLowerCase().includes(query);

    const startDate = dateRange.start ? new Date(`${dateRange.start}T00:00:00`) : null;
    const endDate = dateRange.end ? new Date(`${dateRange.end}T23:59:59`) : null;
    const matchesDateRange = (!startDate || entry.timestamp >= startDate) && (!endDate || entry.timestamp <= endDate);
    const matchesAction = !actionFilter || entry.action === actionFilter;
    const matchesSource = !sourceFilter || entry.source === sourceFilter;

    return matchesSearch && matchesDateRange && matchesAction && matchesSource;
  }), [actionFilter, auditLog, dateRange.end, dateRange.start, searchTerm, sourceFilter]);

  const actionOptions = useMemo(() => Array.from(new Set(auditLog.map(entry => entry.action))).sort(), [auditLog]);
  const sourceOptions = useMemo(() => Array.from(new Set(auditLog.map(entry => entry.source))).sort(), [auditLog]);
  const availableTables = tableSummaries.filter(summary => summary.count !== null);
  const unavailableTables = tableSummaries.filter(summary => summary.error);
  const totalRows = availableTables.reduce((total, summary) => total + (summary.count || 0), 0);

  const exportSystemJson = async () => {
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const results: Record<string, unknown[] | { error: string }> = {};

      await Promise.all(exportTables.map(async table => {
        const { data, error } = await supabase
          .from(table.table)
          .select('*')
          .limit(10000);

        results[table.table] = error ? { error: error.message } : data || [];
      }));

      downloadFile(
        `crm-system-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({ exportedAt, tables: results }, null, 2),
        'application/json'
      );
      toast.success('System data export downloaded');
    } catch (err) {
      console.error('Failed to export system data:', err);
      toast.error('Failed to export system data');
    } finally {
      setExporting(false);
    }
  };

  const exportInventoryCsv = () => {
    const rows = [
      ['Table', 'Label', 'Rows', 'Status', 'Notes'],
      ...tableSummaries.map(summary => [
        summary.table,
        summary.label,
        summary.count ?? '',
        summary.error ? 'Unavailable' : 'Available',
        summary.error || '',
      ]),
    ];
    downloadFile(
      `crm-data-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map(row => row.map(escapeCsv).join(',')).join('\n'),
      'text/csv'
    );
    toast.success('Data inventory downloaded');
  };

  const exportAuditCsv = () => {
    const rows = [
      ['Timestamp', 'User', 'Action', 'Resource', 'Source', 'Details'],
      ...filteredAuditLog.map(entry => [
        entry.timestamp.toISOString(),
        entry.userName,
        entry.action,
        entry.resource,
        entry.source,
        entry.details,
      ]),
    ];
    downloadFile(
      `crm-audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      rows.map(row => row.map(escapeCsv).join(',')).join('\n'),
      'text/csv'
    );
    toast.success('Audit log CSV downloaded');
  };

  const exportAuditJson = () => {
    downloadFile(
      `crm-audit-log-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(filteredAuditLog.map(entry => ({
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      })), null, 2),
      'application/json'
    );
    toast.success('Audit log JSON downloaded');
  };

  return (
    <div className="p-6 space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
            <Database className="h-5 w-5 mr-2" />
            Audit & Data
          </h2>
          <p className="text-gray-600">Review real audit history and export CRM data from Supabase.</p>
        </div>
        <button
          onClick={loadAuditData}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Available tables</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{availableTables.length}</p>
          <p className="mt-1 text-xs text-gray-500">{totalRows.toLocaleString()} rows visible to this admin session</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Audit events</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{auditLog.length}</p>
          <p className="mt-1 text-xs text-gray-500">from maintenance and training record audit sources</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Unavailable tables</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{unavailableTables.length}</p>
          <p className="mt-1 text-xs text-gray-500">usually old migrations or tables not present in this project</p>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Data Export</h3>
          <p className="text-sm text-gray-500 mt-1">Exports are downloaded in your browser from data your current admin session can read.</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Complete System Data</h4>
            <p className="text-xs text-gray-600 mb-3">Downloads visible CRM tables as a structured JSON file.</p>
            <button onClick={exportSystemJson} disabled={exporting} className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              JSON
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Data Inventory</h4>
            <p className="text-xs text-gray-600 mb-3">Downloads table availability and row counts for audit checks.</p>
            <button onClick={exportInventoryCsv} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
              <Table className="h-4 w-4" />
              CSV
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Filtered Audit Log</h4>
            <p className="text-xs text-gray-600 mb-3">Downloads the currently filtered audit timeline.</p>
            <div className="flex gap-2">
              <button onClick={exportAuditCsv} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
                <Download className="h-4 w-4" />
                CSV
              </button>
              <button onClick={exportAuditJson} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                <FileJson className="h-4 w-4" />
                JSON
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Data Inventory</h3>
          <p className="text-sm text-gray-500 mt-1">A quick check of the main operational tables included in export.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {tableSummaries.map(summary => {
            const meta = exportTables.find(table => table.table === summary.table);
            return (
              <div key={summary.table} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-medium text-gray-900">{summary.label}</h4>
                    <p className="text-xs text-gray-500 mt-1">{meta?.description}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${summary.error ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                    {summary.error ? 'Unavailable' : `${summary.count}`}
                  </span>
                </div>
                {summary.error && <p className="mt-2 text-xs text-amber-700">{summary.error}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Audit Log</h3>
          <p className="text-sm text-gray-500 mt-1">This combines real maintenance audit rows and embedded training record audit history.</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={event => setSearchTerm(event.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Search audit log..."
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input type="date" value={dateRange.start} onChange={event => setDateRange(prev => ({ ...prev, start: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input type="date" value={dateRange.end} onChange={event => setDateRange(prev => ({ ...prev, end: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Action</label>
              <select value={actionFilter} onChange={event => setActionFilter(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All actions</option>
                {actionOptions.map(action => <option key={action} value={action}>{action}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Source</label>
              <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">All sources</option>
                {sourceOptions.map(source => <option key={source} value={source}>{source}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 text-sm text-gray-600">Showing {filteredAuditLog.length} entries</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-8 flex items-center justify-center text-gray-500">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Loading audit data...
            </div>
          ) : filteredAuditLog.length === 0 ? (
            <div className="p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No audit entries found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Resource</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredAuditLog.map(entry => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{formatDateTime(entry.timestamp)}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{entry.userName}</td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${actionClass(entry.action)}`}>{entry.action}</span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">{entry.resource}</td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{entry.source}</td>
                      <td className="px-4 py-4 text-sm text-gray-900 max-w-md truncate" title={entry.details}>{entry.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
