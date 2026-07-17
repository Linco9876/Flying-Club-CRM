import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, FileCheck2, Loader2, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import {
  InstructorComplianceRecord,
  useInstructorCompliance,
} from '../../hooks/useInstructorCompliance';
import type { User } from '../../types';
import { hasRole } from '../../utils/rbac';

interface InstructorComplianceProfilePanelProps {
  instructor: Pick<User, 'id' | 'name' | 'role' | 'roles' | 'isSeniorInstructor'>;
}

const checkTypeLabel: Record<InstructorComplianceRecord['checkType'], string> = {
  initial_issue: 'Initial instructor issue',
  sp_check: 'Standards & Proficiency check',
  renewal: 'Instructor rating renewal',
};

const dateStatus = (date?: string) => {
  if (!date) return { label: 'Not recorded', className: 'text-gray-500 dark:text-gray-400' };
  const due = new Date(`${date}T23:59:59`);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `${format(due, 'd MMM yyyy')} (${Math.abs(days)} days overdue)`, className: 'text-red-700 dark:text-red-300' };
  if (days <= 30) return { label: `${format(due, 'd MMM yyyy')} (${days} days)`, className: 'text-amber-700 dark:text-amber-300' };
  return { label: format(due, 'd MMM yyyy'), className: 'text-emerald-700 dark:text-emerald-300' };
};

export const InstructorComplianceProfilePanel: React.FC<InstructorComplianceProfilePanelProps> = ({ instructor }) => {
  const { user } = useAuth();
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [openingFormId, setOpeningFormId] = useState<string | null>(null);
  const instructorRoles = instructor.roles || [instructor.role];
  const isInstructor = instructorRoles.includes('instructor') || instructorRoles.includes('senior_instructor') || Boolean(instructor.isSeniorInstructor);
  const isCfi = hasRole(user, 'cfi');
  const canView = Boolean(isInstructor && user && (isCfi || user.id === instructor.id));
  const { courses, items, records, loading, error, createFormUrl } = useInstructorCompliance(canView);

  const instructorRecords = useMemo(
    () => records
      .filter(record => record.candidateInstructorId === instructor.id && record.status !== 'voided')
      .sort((a, b) => b.checkDate.localeCompare(a.checkDate)),
    [instructor.id, records]
  );
  const latestRecord = instructorRecords[0];
  const latestRenewal = instructorRecords.find(record => record.nextRenewalDue);
  const spStatus = dateStatus(latestRecord?.nextSpCheckDue);
  const renewalStatus = dateStatus(latestRenewal?.nextRenewalDue);
  const course = courses.find(item => item.id === latestRecord?.courseId) || courses[0];
  const itemsById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  if (!canView) return null;

  const openRenewalForm = async (record: InstructorComplianceRecord) => {
    if (!record.raausFormPath) return;
    try {
      setOpeningFormId(record.id);
      const url = await createFormUrl(record.raausFormPath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (openError) {
      console.error('Failed to open instructor renewal form:', openError);
      toast.error('Failed to open the protected renewal form');
    } finally {
      setOpeningFormId(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-900/20 bg-white shadow-md shadow-gray-200/70 dark:border-cyan-400/20 dark:bg-[#171a21] dark:shadow-black/20">
      <header className="bg-gradient-to-r from-slate-950 via-cyan-950 to-slate-900 px-4 py-5 text-white sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-cyan-200">
              <ShieldCheck className="h-4 w-4" /> Protected instructor record
            </div>
            <h2 className="mt-2 text-lg font-bold">Instructor Standards &amp; Proficiency</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-cyan-100">
              {course?.description || 'Initial issue, recurring Standards & Proficiency checks and instructor rating renewals.'}
            </p>
          </div>
          <span className="w-fit rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {isCfi && user?.id !== instructor.id ? 'CFI view' : 'Your record'}
          </span>
        </div>
      </header>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin text-cyan-600" /> Loading protected records...
        </div>
      ) : error ? (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      ) : (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#303641] dark:bg-[#11141a]">
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Latest check</p>
              <p className="mt-1 font-bold text-gray-950 dark:text-gray-100">{latestRecord ? format(new Date(`${latestRecord.checkDate}T00:00:00`), 'd MMM yyyy') : 'No record'}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{latestRecord ? checkTypeLabel[latestRecord.checkType] : 'A CFI has not completed a check yet.'}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#303641] dark:bg-[#11141a]">
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Next S&amp;P due</p>
              <p className={`mt-1 font-bold ${spStatus.className}`}>{spStatus.label}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">90 days for Instructors; 12 months for Senior Instructors.</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-[#303641] dark:bg-[#11141a]">
              <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Rating renewal due</p>
              <p className={`mt-1 font-bold ${renewalStatus.className}`}>{renewalStatus.label}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Instructor ratings renew every two years.</p>
            </div>
          </div>

          {course && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-950 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-100">
              <p className="font-semibold">{course.name} <span className="font-normal opacity-75">v{course.version}</span></p>
              {course.sourceDocuments.length > 0 && (
                <p className="mt-1 text-xs opacity-80">Based on {course.sourceDocuments.map(document => document.name).join(' and ')}.</p>
              )}
            </div>
          )}

          {instructorRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center dark:border-[#3b414c]">
              <CalendarClock className="mx-auto h-7 w-7 text-gray-400" />
              <p className="mt-2 font-semibold text-gray-900 dark:text-gray-100">No instructor compliance record yet</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Completed S&amp;P checks and instructor renewals will appear here after the CFI submits them. Initial issue assessments are recorded under Flight Reviews &amp; Tests.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {instructorRecords.map(record => {
                const expanded = expandedRecordId === record.id;
                const belowStandard = record.checklist.filter(item => item.result === 'unsatisfactory');
                const satisfactory = record.checklist.filter(item => item.result === 'satisfactory').length;
                return (
                  <article key={record.id} className="overflow-hidden rounded-lg border border-gray-200 dark:border-[#303641]">
                    <button
                      type="button"
                      onClick={() => setExpandedRecordId(expanded ? null : record.id)}
                      className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-gray-50 dark:hover:bg-[#11141a] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-gray-950 dark:text-gray-100">{checkTypeLabel[record.checkType]}</p>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${record.outcome === 'satisfactory' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' : 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200'}`}>
                            {record.outcome === 'satisfactory' ? 'Satisfactory' : 'Remedial action required'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          {format(new Date(`${record.checkDate}T00:00:00`), 'd MMM yyyy')} &middot; {record.groundMinutes} min ground &middot; {record.flightMinutes} min flight
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-sm font-semibold text-gray-600 dark:text-gray-300">
                        <span>{satisfactory}/{record.checklist.length} satisfactory</span>
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>

                    {expanded && (
                      <div className="space-y-4 border-t border-gray-200 bg-gray-50 p-4 dark:border-[#303641] dark:bg-[#11141a]">
                        <div className="grid gap-3 text-sm sm:grid-cols-2">
                          <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]">
                            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Examiner-nominated briefing</p>
                            <p className="mt-1 font-medium text-gray-900 dark:text-gray-100">{record.briefingLesson}</p>
                          </div>
                          <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]">
                            <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Pre-check confirmations</p>
                            <p className="mt-1 text-gray-700 dark:text-gray-200">Medical sighted: {record.medicalSighted ? 'Yes' : 'No'}</p>
                            <p className="text-gray-700 dark:text-gray-200">Emergency control plan: {record.emergencyControlPlanConfirmed ? 'Confirmed' : 'Not confirmed'}</p>
                          </div>
                        </div>

                        <div>
                          <h3 className="text-sm font-bold text-gray-950 dark:text-gray-100">Assessment checklist</h3>
                          <div className="mt-2 space-y-2">
                            {record.checklist.map(result => {
                              const item = itemsById.get(result.itemId);
                              return (
                                <div key={result.itemId} className={`rounded-lg border p-3 ${result.result === 'satisfactory' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10' : 'border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/10'}`}>
                                  <div className="flex items-start gap-2">
                                    {result.result === 'satisfactory' ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />}
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">{item?.section || 'Assessment'} &middot; {result.code}</p>
                                      <p className="mt-0.5 text-sm font-semibold text-gray-950 dark:text-gray-100">{result.title}</p>
                                      {result.notes && <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{result.notes}</p>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {(record.strengths || record.deficiencies || record.developmentPlan || record.cfiComments) && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {record.strengths && <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]"><p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Strengths</p><p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{record.strengths}</p></div>}
                            {record.deficiencies && <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]"><p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Areas requiring attention</p><p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{record.deficiencies}</p></div>}
                            {record.developmentPlan && <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]"><p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">Development plan</p><p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{record.developmentPlan}</p></div>}
                            {record.cfiComments && <div className="rounded-lg bg-white p-3 dark:bg-[#171a21]"><p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">CFI comments</p><p className="mt-1 text-sm text-gray-800 dark:text-gray-200">{record.cfiComments}</p></div>}
                          </div>
                        )}

                        {belowStandard.length > 0 && (
                          <p className="text-sm font-semibold text-red-700 dark:text-red-300">{belowStandard.length} checklist item{belowStandard.length === 1 ? '' : 's'} require remedial action.</p>
                        )}

                        {record.raausFormPath && (
                          <button
                            type="button"
                            onClick={() => void openRenewalForm(record)}
                            disabled={openingFormId === record.id}
                            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-cyan-300 bg-white px-3 py-2 text-sm font-semibold text-cyan-800 hover:bg-cyan-50 disabled:opacity-60 dark:border-cyan-500/30 dark:bg-[#171a21] dark:text-cyan-200 dark:hover:bg-cyan-500/10"
                          >
                            {openingFormId === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                            {record.raausFormName || 'Open RAAus renewal form'}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-500 dark:text-gray-400">
            This protected information is visible only to the instructor named on the record and users holding the CFI authority.
          </p>
        </div>
      )}
    </section>
  );
};
