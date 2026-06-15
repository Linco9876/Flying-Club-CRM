import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Download, FileJson, Loader2, RefreshCw, Search, Table } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

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
  tableName?: string;
  recordId?: string;
  changedFields?: string[];
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
  { table: 'admin_audit_log', label: 'Admin audit log', description: 'Admin-only edits and deletes audit trail' },
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

const sensitiveExportFields: Record<string, string[]> = {
  users: [
    'email',
    'phone',
    'mobile_phone',
    'home_phone',
    'work_phone',
    'address',
    'date_of_birth',
    'emergency_contact_name',
    'emergency_contact_phone',
    'emergency_contact_relationship',
    'avatar_url',
  ],
  students: [
    'email',
    'phone',
    'alternate_phone',
    'address',
    'date_of_birth',
    'emergency_contact_name',
    'emergency_contact_phone',
    'emergency_contact_relationship',
    'raaus_id',
    'casa_id',
    'medical_type',
    'medical_expiry',
    'licence_expiry',
    'last_flight_review',
  ],
  student_documents: ['file_path', 'filename', 'file_type', 'file_size'],
  safety_reports: ['reporter_name', 'reporter_email', 'reporter_phone', 'involved_persons', 'witnesses', 'attachments'],
  invoices: ['billing_address', 'customer_email', 'customer_phone'],
  account_transactions: ['payment_reference', 'external_reference', 'notes'],
};

const sanitizeRowsForExport = (table: string, rows: unknown[]) => {
  const sensitiveFields = new Set(sensitiveExportFields[table] || []);

  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;

    const sanitized = { ...(row as Record<string, unknown>) };
    sensitiveFields.forEach(field => {
      if (field in sanitized) sanitized[field] = '[redacted]';
    });
    return sanitized;
  });
};

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

const summarizeChanges = (entry: any) => {
  const changedFields = Array.isArray(entry.changed_fields) ? entry.changed_fields : [];

  if (entry.action === 'DELETE') return 'Record deleted';
  if (changedFields.length === 0) return 'Record updated';

  const oldData = entry.old_data || {};
  const newData = entry.new_data || {};
  const summary = changedFields.slice(0, 6).map((field: string) => {
    const before = oldData[field];
    const after = newData[field];
    const beforeText = before === null || before === undefined ? 'blank' : JSON.stringify(before);
    const afterText = after === null || after === undefined ? 'blank' : JSON.stringify(after);
    return `${field}: ${beforeText} -> ${afterText}`;
  });

  if (changedFields.length > 6) summary.push(`+${changedFields.length - 6} more`);
  return summary.join('; ');
};

export const AuditDataSettings: React.FC<AuditDataSettingsProps> = () => {
  const { user } = useAuth();
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [tableSummaries, setTableSummaries] = useState<TableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showSensitiveConfirm, setShowSensitiveConfirm] = useState(false);
  const [sensitiveConfirmText, setSensitiveConfirmText] = useState('');
  const [sensitiveConfirmChecked, setSensitiveConfirmChecked] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [actionFilter, setActionFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const loadAuditData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResults, adminAuditResult, maintenanceResult, trainingResult, usersResult] = await Promise.all([
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
          .from('admin_audit_log')
          .select('*')
          .order('occurred_at', { ascending: false })
          .limit(500),
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

      const adminAuditEntries: AuditLogEntry[] = adminAuditResult.error ? [] : (adminAuditResult.data || []).map(row => ({
        id: `admin-audit-${row.id}`,
        timestamp: new Date(row.occurred_at),
        userName: row.actor_id ? userMap.get(row.actor_id) || row.actor_id : 'System / service role',
        action: row.action === 'DELETE' ? 'DELETE' : 'UPDATE',
        resource: row.record_label || `${row.table_name} ${row.record_id}`,
        details: summarizeChanges(row),
        source: row.area || 'Admin Audit',
        tableName: row.table_name,
        recordId: row.record_id,
        changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
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

      setAuditLog([...adminAuditEntries, ...maintenanceEntries, ...trainingEntries].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()));

      if (adminAuditResult.error || maintenanceResult.error || trainingResult.error) {
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
      || entry.source.toLowerCase().includes(query)
      || entry.tableName?.toLowerCase().includes(query)
      || entry.recordId?.toLowerCase().includes(query)
      || entry.changedFields?.some(field => field.toLowerCase().includes(query));

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
  const canExportSensitive = sensitiveConfirmChecked && sensitiveConfirmText.trim().toUpperCase() === 'EXPORT PRIVATE DATA';

  const recordExportAudit = async (exportType: 'sanitized' | 'sensitive', rowCounts: Record<string, number | string>) => {
    const timestamp = new Date();
    const localEntry: AuditLogEntry = {
      id: `data-export-${timestamp.toISOString()}-${exportType}`,
      timestamp,
      userName: user?.name || user?.email || 'Unknown admin',
      action: exportType === 'sensitive' ? 'SENSITIVE_DATA_EXPORT' : 'SANITIZED_DATA_EXPORT',
      resource: 'System data export',
      details: JSON.stringify({
        exportType,
        rowCounts,
        sensitiveDataIncluded: exportType === 'sensitive',
      }),
      source: 'Audit & Data',
    };

    setAuditLog(prev => [localEntry, ...prev]);

    try {
      const { error } = await supabase.from('maintenance_audit_log').insert({
        action: localEntry.action,
        performed_by: user?.id || null,
        details: {
          resource: localEntry.resource,
          exportType,
          rowCounts,
          sensitiveDataIncluded: exportType === 'sensitive',
        },
      });

      if (error) {
        console.warn('Failed to persist export audit event:', error);
      }
    } catch (error) {
      console.warn('Failed to persist export audit event:', error);
    }
  };

  const exportSystemJson = async (includeSensitiveData = false) => {
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const results: Record<string, unknown[] | { error: string }> = {};
      const rowCounts: Record<string, number | string> = {};

      await Promise.all(exportTables.map(async table => {
        const { data, error } = await supabase
          .from(table.table)
          .select('*')
          .limit(10000);

        if (error) {
          results[table.table] = { error: error.message };
          rowCounts[table.table] = 'error';
        } else {
          const rows = data || [];
          results[table.table] = includeSensitiveData ? rows : sanitizeRowsForExport(table.table, rows);
          rowCounts[table.table] = rows.length;
        }
      }));

      downloadFile(
        `crm-system-${includeSensitiveData ? 'private' : 'sanitized'}-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({
          exportedAt,
          exportType: includeSensitiveData ? 'sensitive-private-data' : 'sanitized-default',
          redactedByDefault: !includeSensitiveData,
          redactedFields: includeSensitiveData ? {} : sensitiveExportFields,
          tables: results,
        }, null, 2),
        'application/json'
      );
      await recordExportAudit(includeSensitiveData ? 'sensitive' : 'sanitized', rowCounts);
      toast.success(includeSensitiveData ? 'Private system data export downloaded' : 'Sanitized system data export downloaded');
    } catch (err) {
      console.error('Failed to export system data:', err);
      toast.error('Failed to export system data');
    } finally {
      setExporting(false);
      setShowSensitiveConfirm(false);
      setSensitiveConfirmText('');
      setSensitiveConfirmChecked(false);
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
      ['Timestamp', 'User', 'Action', 'Resource', 'Source', 'Table', 'Record ID', 'Changed Fields', 'Details'],
      ...filteredAuditLog.map(entry => [
        entry.timestamp.toISOString(),
        entry.userName,
        entry.action,
        entry.resource,
        entry.source,
        entry.tableName || '',
        entry.recordId || '',
        entry.changedFields?.join('; ') || '',
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
    <div className="min-w-0 space-y-8 p-4 sm:p-6">
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

      <section className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Available tables</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{availableTables.length}</p>
          <p className="mt-1 text-xs text-gray-500">{totalRows.toLocaleString()} rows visible to this admin session</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Audit events</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{auditLog.length}</p>
          <p className="mt-1 text-xs text-gray-500">from admin audit, maintenance, and training sources</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Unavailable tables</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{unavailableTables.length}</p>
          <p className="mt-1 text-xs text-gray-500">usually old migrations or tables not present in this project</p>
        </div>
      </section>

      <section className="min-w-0 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Data Export</h3>
          <p className="text-sm text-gray-500 mt-1">Exports are downloaded in your browser from data your current admin session can read.</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Safer System Data</h4>
            <p className="text-xs text-gray-600 mb-3">Downloads CRM tables as JSON, redacting contact, emergency, medical and credential fields by default.</p>
            <button onClick={() => exportSystemJson(false)} disabled={exporting} className="inline-flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              JSON
            </button>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h4 className="text-sm font-medium text-red-950 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Complete Private Data
            </h4>
            <p className="text-xs text-red-800 mb-3">Contains private member, billing, emergency contact, medical and student record data. Use only for controlled admin recovery or legal/accounting export.</p>
            <button onClick={() => setShowSensitiveConfirm(true)} disabled={exporting} className="inline-flex items-center gap-2 px-3 py-2 bg-red-700 text-white rounded-md hover:bg-red-800 disabled:opacity-50">
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
              Private JSON
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

      {showSensitiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2 text-red-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Export complete private CRM data?</h3>
                <p className="mt-2 text-sm text-gray-600">
                  This download contains private member, billing, emergency contact, medical/compliance and student record data. The export action will be added to the audit trail.
                </p>
              </div>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-900">
              <input
                type="checkbox"
                checked={sensitiveConfirmChecked}
                onChange={event => setSensitiveConfirmChecked(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-red-300 text-red-700 focus:ring-red-600"
              />
              I understand this file contains private CRM data and must be stored, shared and deleted carefully.
            </label>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Type EXPORT PRIVATE DATA to continue</label>
              <input
                value={sensitiveConfirmText}
                onChange={event => setSensitiveConfirmText(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                placeholder="EXPORT PRIVATE DATA"
              />
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowSensitiveConfirm(false);
                  setSensitiveConfirmText('');
                  setSensitiveConfirmChecked(false);
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => exportSystemJson(true)}
                disabled={!canExportSensitive || exporting}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
              >
                {exporting && <Loader2 className="h-4 w-4 animate-spin" />}
                Export private data
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="min-w-0 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Data Inventory</h3>
          <p className="text-sm text-gray-500 mt-1">A quick check of the main operational tables included in export.</p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tableSummaries.map(summary => {
            const meta = exportTables.find(table => table.table === summary.table);
            return (
              <div key={summary.table} className="min-w-0 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-gray-900">{summary.label}</h4>
                    <p className="text-xs text-gray-500 mt-1">{meta?.description}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${summary.error ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                    {summary.error ? 'Unavailable' : `${summary.count}`}
                  </span>
                </div>
                {summary.error && <p className="mt-2 break-words text-xs text-amber-700">{summary.error}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="min-w-0 space-y-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Audit Log</h3>
          <p className="text-sm text-gray-500 mt-1">Admin-only audit trail for booking, flight log, billing, training, and member profile edits/deletes.</p>
        </div>

        <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-4">
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

        <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
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
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-[980px] divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Record</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Changed Fields</th>
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
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{entry.source}</td>
                      <td className="px-4 py-4 text-sm text-gray-900">
                        <div className="max-w-xs">
                          <p className="truncate font-medium" title={entry.resource}>{entry.resource}</p>
                          {entry.tableName && (
                            <p className="mt-1 truncate text-xs text-gray-500" title={`${entry.tableName} ${entry.recordId || ''}`}>
                              {entry.tableName}{entry.recordId ? ` / ${entry.recordId}` : ''}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-600">
                        {entry.changedFields?.length ? (
                          <div className="flex max-w-xs flex-wrap gap-1">
                            {entry.changedFields.slice(0, 5).map(field => (
                              <span key={field} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{field}</span>
                            ))}
                            {entry.changedFields.length > 5 && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">+{entry.changedFields.length - 5}</span>}
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
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
