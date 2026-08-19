import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import type { LegacyMembershipImportInput, LegacyMembershipImportResult } from '../../hooks/useMembership';
import type { ClubMembership, MembershipClass, User } from '../../types';
import {
  getExistingMemberCsvTemplate,
  validateExistingMemberCsv,
  type ExistingMemberCsvValidationResult,
} from '../../utils/existingMemberCsvImport';

interface ExistingMemberCsvImportModalProps {
  users: User[];
  membershipClasses: MembershipClass[];
  memberships: ClubMembership[];
  busy: boolean;
  onClose: () => void;
  onImport: (rows: LegacyMembershipImportInput[]) => Promise<LegacyMembershipImportResult[]>;
}

const downloadTemplate = () => {
  const url = URL.createObjectURL(new Blob([getExistingMemberCsvTemplate()], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'existing-club-members-import-template.csv';
  link.click();
  URL.revokeObjectURL(url);
};

export const ExistingMemberCsvImportModal: React.FC<ExistingMemberCsvImportModalProps> = ({
  users,
  membershipClasses,
  memberships,
  busy,
  onClose,
  onImport,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [validation, setValidation] = useState<ExistingMemberCsvValidationResult | null>(null);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState('');
  const [importResults, setImportResults] = useState<LegacyMembershipImportResult[] | null>(null);
  const resultByUserId = useMemo(
    () => new Map((importResults || []).map(result => [result.userId, result])),
    [importResults],
  );
  const importedCount = importResults?.filter(result => result.success).length || 0;
  const failedCount = (importResults?.length || 0) - importedCount;

  const resetFile = () => {
    setFileName('');
    setValidation(null);
    setFileError('');
    setImportResults(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFile = async (file?: File) => {
    resetFile();
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Choose a CSV file. Excel workbooks must be saved as CSV first.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setFileError('CSV files are limited to 2 MB.');
      return;
    }

    setReading(true);
    setFileName(file.name);
    try {
      const contents = await file.text();
      setValidation(validateExistingMemberCsv({
        contents,
        users,
        membershipClasses,
        existingMembershipUserIds: memberships.map(membership => membership.userId),
      }));
    } catch {
      setFileError('The CSV could not be read. Save it as UTF-8 CSV and try again.');
    } finally {
      setReading(false);
    }
  };

  const handleImport = async () => {
    if (!validation || validation.invalidRows.length > 0 || validation.validRows.length === 0) return;
    const results = await onImport(validation.validRows.map(row => ({
      userId: row.userId!,
      membershipClassCode: row.membershipClassCode,
      commencedAt: row.commencedAt,
      feeDisposition: row.feeDisposition,
      reason: row.reason || undefined,
    })));
    setImportResults(results);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="existing-member-csv-title">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <h2 id="existing-member-csv-title" className="flex items-center gap-2 text-xl font-bold text-slate-950 dark:text-white">
              <FileSpreadsheet className="h-5 w-5 text-blue-700 dark:text-blue-300" /> Import existing club members
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Match existing portal users by email and add them to the statutory membership register in bulk.
            </p>
          </div>
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800" aria-label="Close CSV import">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
            <div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={event => void handleFile(event.target.files?.[0])}
              />
              <button
                type="button"
                disabled={busy || reading}
                onClick={() => inputRef.current?.click()}
                className="flex min-h-40 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/70 px-5 py-6 text-center transition hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/30"
              >
                {reading ? <Loader2 className="h-8 w-8 animate-spin text-blue-700" /> : <Upload className="h-8 w-8 text-blue-700 dark:text-blue-300" />}
                <span className="mt-3 font-bold text-slate-950 dark:text-white">{fileName || 'Choose existing-members CSV'}</span>
                <span className="mt-1 text-sm text-slate-600 dark:text-slate-300">UTF-8 CSV, up to 2 MB and 500 rows</span>
              </button>
              {(fileError || validation?.fileErrors.length) ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  <div className="flex gap-2 font-bold"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> The file needs attention</div>
                  <ul className="mt-2 list-disc space-y-1 pl-6">
                    {fileError && <li>{fileError}</li>}
                    {validation?.fileErrors.map(error => <li key={error}>{error}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="font-bold text-slate-950 dark:text-white">CSV columns</h3>
              <dl className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <div><dt className="inline font-semibold">email</dt><dd className="inline"> — must match an existing portal user</dd></div>
                <div><dt className="inline font-semibold">membership_class</dt><dd className="inline"> — active class code or exact name</dd></div>
                <div><dt className="inline font-semibold">commenced_at</dt><dd className="inline"> — YYYY-MM-DD or DD/MM/YYYY</dd></div>
                <div><dt className="inline font-semibold">fee_disposition</dt><dd className="inline"> — paid, invoice required, or waived; leave blank for fee-exempt memberships such as Life</dd></div>
                <div><dt className="inline font-semibold">waiver_reason</dt><dd className="inline"> — required only for waived fees</dd></div>
              </dl>
              <button type="button" onClick={downloadTemplate} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:bg-slate-900 dark:text-blue-200">
                <Download className="h-4 w-4" /> Download CSV template
              </button>
              <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                This import never sends invitations or welcome emails. People without a portal profile must first be added using “Add without inviting”.
              </p>
            </div>
          </div>

          {validation?.rows.length ? (
            <div className="mt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-bold text-slate-950 dark:text-white">Import preview</h3>
                <div className="flex gap-2 text-xs font-bold">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">{validation.validRows.length} ready</span>
                  <span className={`rounded-full px-2.5 py-1 ${validation.invalidRows.length ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}>{validation.invalidRows.length} errors</span>
                </div>
              </div>
              {validation.invalidRows.length > 0 && (
                <p className="mt-2 text-sm text-red-700 dark:text-red-300">Correct every highlighted row and upload the CSV again. Nothing can be imported while errors remain.</p>
              )}
              <div className="mt-3 max-h-[42vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-700">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Row</th><th className="px-3 py-2">Member</th><th className="px-3 py-2">Class</th><th className="px-3 py-2">Commenced</th><th className="px-3 py-2">Financial status</th><th className="px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {validation.rows.map(row => {
                      const serverResult = row.userId ? resultByUserId.get(row.userId) : undefined;
                      return (
                        <tr key={row.sourceRow} className={row.errors.length ? 'bg-red-50 dark:bg-red-950/20' : 'bg-white dark:bg-slate-900'}>
                          <td className="px-3 py-3 font-mono text-xs text-slate-500">{row.sourceRow}</td>
                          <td className="px-3 py-3"><div className="font-semibold text-slate-950 dark:text-white">{row.userName || row.email || 'Unknown'}</div>{row.userName && <div className="text-xs text-slate-500">{row.email}</div>}</td>
                          <td className="px-3 py-3">{row.membershipClassName || row.membershipClassCode || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-3">{row.commencedAt || '—'}</td>
                          <td className="px-3 py-3">{row.feeDispositionLabel}</td>
                          <td className="min-w-56 px-3 py-3">
                            {row.errors.length > 0 ? (
                              <ul className="list-disc space-y-1 pl-4 text-xs font-medium text-red-700 dark:text-red-300">{row.errors.map(error => <li key={error}>{error}</li>)}</ul>
                            ) : serverResult ? (
                              serverResult.success
                                ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Imported</span>
                                : <span className="text-xs font-semibold text-red-700 dark:text-red-300">{serverResult.error || 'Import failed'}</span>
                            ) : <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Ready</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {importResults && (
            <div className={`mt-4 rounded-xl border p-4 ${failedCount ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
              <div className="flex items-center gap-2 font-bold">{failedCount ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} Import complete</div>
              <p className="mt-1 text-sm">{importedCount} imported successfully{failedCount ? `; ${failedCount} failed and can be retried after correction.` : '.'}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/70">
          <button type="button" disabled={busy} onClick={resetFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">Clear file</button>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">{importResults ? 'Done' : 'Cancel'}</button>
            {!importResults && (
              <button
                type="button"
                disabled={busy || !validation || validation.validRows.length === 0 || validation.invalidRows.length > 0}
                onClick={() => void handleImport()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Import {validation?.validRows.length || 0} member{validation?.validRows.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
