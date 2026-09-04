import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Edit, History, Info, MoreVertical, RotateCcw, X } from 'lucide-react';
import type { TrainingRecord, TrainingSequenceResult } from '../../types';
import { formatLessonRecordHours, lessonRecordAuditSummary } from '../../utils/lessonRecordPresentation';

export interface LessonRecordAssessmentItem {
  id: string;
  label: string;
  grade: string;
}

export interface LessonRecordMatrixItem {
  id: string;
  label: string;
  comments?: string;
  attempt: string;
  required: string;
  current: string;
  attemptMeetsRequirement: boolean;
  currentlyMeetsRequirement: boolean;
  resolvedLater: boolean;
}

export interface LessonRecordMatrixSummary {
  metCount: number;
  totalCount: number;
  needsAttentionCount: number;
  resolvedLaterCount: number;
  unassessedCount: number;
  items: LessonRecordMatrixItem[];
}

interface LessonRecordCardProps {
  record: TrainingRecord;
  dateLabel: string;
  dateTimeLabel: string;
  lessonName: string;
  lessonCode?: string;
  courseName: string;
  studentName: string;
  instructorName: string;
  assessments: LessonRecordAssessmentItem[];
  matrixAssessment?: LessonRecordMatrixSummary;
  highlighted?: boolean;
  onEdit?: () => void;
  onReassign?: () => void;
  onMinimise?: () => void;
  acknowledgement?: {
    loading: boolean;
    revisionSummary?: string[];
    onAcknowledge: () => void;
  };
}

const statusClasses: Record<TrainingRecord['status'], string> = {
  draft: 'border-gray-200 bg-gray-100 text-gray-700',
  submitted: 'border-blue-200 bg-blue-50 text-blue-700',
  locked: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const gradeClasses = (grade: string) => {
  if (grade === 'C' || grade === 'Pass') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (grade === 'S') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (grade === 'NC' || grade === 'Fail') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
};

const actionLabel = (action: string) => action
  .replace(/_/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase());

const DetailField = ({ label, value, prominent = false }: { label: string; value: React.ReactNode; prominent?: boolean }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</dt>
    <dd className={`mt-1 truncate text-sm ${prominent ? 'font-semibold text-gray-950' : 'font-medium text-gray-800'}`} title={typeof value === 'string' ? value : undefined}>
      {value}
    </dd>
  </div>
);

const AssessmentChip = ({ label, grade }: { label: string; grade: string }) => (
  <div className={`flex min-w-[10rem] flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2 ${gradeClasses(grade)}`}>
    <span className="min-w-0 truncate text-xs font-medium" title={label}>{label}</span>
    <span className="shrink-0 text-sm font-bold">{grade}</span>
  </div>
);

const SequenceChip = ({ sequence }: { sequence: TrainingSequenceResult }) => (
  <AssessmentChip
    label={`${sequence.sequenceCode}${sequence.sequenceTitle ? ` — ${sequence.sequenceTitle}` : ''}`}
    grade={sequence.competence}
  />
);

export const LessonRecordCard: React.FC<LessonRecordCardProps> = ({
  record,
  dateLabel,
  dateTimeLabel,
  lessonName,
  lessonCode,
  courseName,
  studentName,
  instructorName,
  assessments,
  matrixAssessment,
  highlighted = false,
  onEdit,
  onReassign,
  onMinimise,
  acknowledgement,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const totalMinutes = record.dualTimeMin + record.soloTimeMin;
  const sequences = record.sequences || [];
  const lessonCodes = record.lessonCodes || [];
  const attachments = record.attachments || [];
  const hasAssessment = assessments.length > 0 || sequences.length > 0 || Boolean(matrixAssessment);
  const historyEntries = useMemo(() => [...(record.auditLog || [])].sort(
    (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
  ), [record.auditLog]);

  useEffect(() => {
    if (!moreInfoOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreInfoOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreInfoOpen]);

  const openMoreInfo = () => {
    setMenuOpen(false);
    setMoreInfoOpen(true);
  };

  return (
    <article
      id={`training-record-${record.id}`}
      className={`overflow-hidden rounded-xl border bg-white shadow-sm ${highlighted ? 'border-blue-400 ring-4 ring-blue-200 ring-offset-2' : 'border-gray-200'}`}
    >
      <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 sm:px-5">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 md:grid-cols-8">
          <DetailField label="Date" value={dateLabel} />
          <div className="col-span-2 min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">Lesson</dt>
            <dd className="mt-1 line-clamp-2 break-words text-sm font-semibold leading-5 text-gray-950" title={lessonName}>
              {lessonName}{lessonCode ? <span className="ml-2 font-normal text-gray-500">{lessonCode}</span> : null}
            </dd>
          </div>
          <DetailField label="Aircraft type" value={record.aircraftType || '—'} />
          <DetailField label="Aircraft reg" value={record.registration || '—'} />
          <DetailField label="Dual" value={formatLessonRecordHours(record.dualTimeMin)} />
          <DetailField label="Solo" value={formatLessonRecordHours(record.soloTimeMin)} />
          <DetailField label="Total" value={formatLessonRecordHours(totalMinutes)} prominent />
        </dl>

        <div className="flex shrink-0 items-center gap-2">
          <span className={`hidden rounded-full border px-2 py-1 text-[11px] font-semibold capitalize sm:inline-flex ${statusClasses[record.status]}`}>
            {record.status === 'locked' && record.studentAck ? 'Acknowledged' : record.status}
          </span>
          <div
            className="relative"
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
            }}
          >
            <button
              type="button"
              aria-label={`Actions for ${lessonName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(open => !open)}
              className="rounded-lg border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 z-30 mt-2 w-48 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                <button type="button" role="menuitem" onClick={openMoreInfo} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                  <Info className="h-4 w-4" /> More info
                </button>
                {onEdit && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    <Edit className="h-4 w-4" /> Edit record
                  </button>
                )}
                {onReassign && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onReassign(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-50">
                    <RotateCcw className="h-4 w-4" /> Reassign flight
                  </button>
                )}
                {onMinimise && (
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onMinimise(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
                    Minimise card
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">Lesson comments</h4>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-900">
            {record.comments || 'No lesson comments recorded.'}
          </p>
        </section>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-gray-100 pt-4 md:grid-cols-4">
          <DetailField label="Instructor" value={instructorName} />
          <DetailField label="Student" value={studentName} />
          <DetailField label="Formal brief" value={record.formalBriefing ? 'Yes' : 'No'} />
          <DetailField label="Next lesson" value={record.nextLesson || '—'} />
        </dl>

        <section className="border-t border-gray-100 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">Assessment</h4>
            {matrixAssessment && (
              <span className="text-xs font-semibold text-indigo-700">
                Matrix {matrixAssessment.metCount}/{matrixAssessment.totalCount} currently met
              </span>
            )}
          </div>
          {hasAssessment ? (
            <div className="flex flex-wrap gap-2">
              {assessments.map(item => <AssessmentChip key={item.id} label={item.label} grade={item.grade} />)}
              {sequences.map(sequence => <SequenceChip key={sequence.id} sequence={sequence} />)}
              {matrixAssessment && matrixAssessment.needsAttentionCount > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  {matrixAssessment.needsAttentionCount} matrix item{matrixAssessment.needsAttentionCount === 1 ? ' needs' : 's need'} attention
                </div>
              )}
              {matrixAssessment && matrixAssessment.resolvedLaterCount > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                  {matrixAssessment.resolvedLaterCount} resolved later
                </div>
              )}
              {matrixAssessment && matrixAssessment.unassessedCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  {matrixAssessment.unassessedCount} carried forward
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No assessment scores recorded.</p>
          )}
        </section>

        {acknowledgement && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Your acknowledgement is required</p>
            <p className="mt-1 text-xs text-amber-700">Confirm that you have read the lesson comments and assessment above.</p>
            {acknowledgement.revisionSummary && acknowledgement.revisionSummary.length > 0 && (
              <div className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3">
                <p className="text-xs font-semibold text-amber-900">What changed</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-amber-800">
                  {acknowledgement.revisionSummary.map(change => <li key={change}>{change}</li>)}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={acknowledgement.onAcknowledge}
              disabled={acknowledgement.loading}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {acknowledgement.loading
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                : <CheckCircle className="h-4 w-4" />}
              I have read and agree
            </button>
          </section>
        )}
      </div>

      {moreInfoOpen && createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-6" onMouseDown={event => {
          if (event.target === event.currentTarget) setMoreInfoOpen(false);
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby={`lesson-record-info-${record.id}`} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Complete lesson record</p>
                <h2 id={`lesson-record-info-${record.id}`} className="mt-1 truncate text-xl font-semibold text-gray-950">{lessonName}</h2>
                <p className="mt-1 text-sm text-gray-500">{dateTimeLabel} · {studentName}</p>
              </div>
              <button type="button" onClick={() => setMoreInfoOpen(false)} aria-label="Close lesson record details" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-6 p-5 sm:p-6">
              <section>
                <h3 className="text-sm font-semibold text-gray-950">Record details</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4 md:grid-cols-4">
                  <DetailField label="Course" value={courseName} />
                  <DetailField label="Lesson code" value={lessonCode || '—'} />
                  <DetailField label="Status" value={record.studentAck ? 'Acknowledged' : actionLabel(record.status)} />
                  <DetailField label="Lesson date/time" value={dateTimeLabel} />
                  <DetailField label="Instructor" value={instructorName} />
                  <DetailField label="Student" value={studentName} />
                  <DetailField label="Aircraft type" value={record.aircraftType || '—'} />
                  <DetailField label="Aircraft reg" value={record.registration || '—'} />
                  <DetailField label="Formal brief" value={record.formalBriefing ? 'Yes' : 'No'} />
                  <DetailField label="Dual" value={formatLessonRecordHours(record.dualTimeMin)} />
                  <DetailField label="Solo" value={formatLessonRecordHours(record.soloTimeMin)} />
                  <DetailField label="Total" value={formatLessonRecordHours(totalMinutes)} prominent />
                  <DetailField label="Next lesson" value={record.nextLesson || '—'} />
                  <DetailField label="Submitted" value={record.instructorSignTimestamp?.toLocaleString('en-AU') || 'Not submitted'} />
                  <DetailField label="Acknowledged by" value={record.studentAckName || (record.studentAck ? studentName : 'Not acknowledged')} />
                  <DetailField label="Acknowledged at" value={record.studentAckTimestamp?.toLocaleString('en-AU') || '—'} />
                  <DetailField label="Origin" value={record.recordOrigin === 'csv_import' ? 'Imported record' : 'Portal record'} />
                </dl>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-950">Lesson comments</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{record.comments || 'No lesson comments recorded.'}</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                  <h3 className="text-sm font-semibold text-blue-950">Briefing comments</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-900">{record.briefingComments || 'No briefing comments recorded.'}</p>
                </div>
              </section>

              {(record.studentComments || record.isFlightReview) && (
                <section className="grid gap-4 md:grid-cols-2">
                  {record.studentComments && (
                    <div className="rounded-xl border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-950">Student comments</h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{record.studentComments}</p>
                    </div>
                  )}
                  {record.isFlightReview && (
                    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                      <h3 className="text-sm font-semibold text-orange-950">{record.flightReviewType || 'Review / test'}</h3>
                      <p className="mt-1 text-xs font-semibold uppercase text-orange-700">Result: {(record.flightReviewResult || 'not_assessed').replace(/_/g, ' ')}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-orange-900">{record.flightReviewNotes || 'No review findings recorded.'}</p>
                    </div>
                  )}
                </section>
              )}

              <section>
                <h3 className="text-sm font-semibold text-gray-950">Assessment detail</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {assessments.map(item => <AssessmentChip key={item.id} label={item.label} grade={item.grade} />)}
                  {sequences.map(sequence => <SequenceChip key={sequence.id} sequence={sequence} />)}
                  {assessments.length === 0 && sequences.length === 0 && !matrixAssessment && <p className="text-sm text-gray-500">No assessment results recorded.</p>}
                </div>
                {matrixAssessment && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-indigo-100">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50 px-4 py-3">
                      <p className="text-sm font-semibold text-indigo-950">Lesson matrix</p>
                      <p className="text-xs font-semibold text-indigo-700">{matrixAssessment.metCount}/{matrixAssessment.totalCount} currently met</p>
                    </div>
                    <div className="divide-y divide-indigo-50">
                      {matrixAssessment.items.map(item => (
                        <div key={item.id} className="px-4 py-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-950">{item.label}</p>
                              {item.comments && <p className="mt-1 text-xs leading-5 text-gray-600">{item.comments}</p>}
                              {item.resolvedLater && <p className="mt-1 text-xs font-medium text-blue-700">Resolved in a later lesson.</p>}
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-1 text-[11px] font-semibold">
                              <span className={`rounded-full border px-2 py-0.5 ${item.attemptMeetsRequirement ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>Attempt {item.attempt}</span>
                              <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-indigo-700">Required {item.required}</span>
                              <span className={`rounded-full border px-2 py-0.5 ${item.currentlyMeetsRequirement ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>Current {item.current}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-950">Additional information</h3>
                <dl className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
                  {lessonCodes.length > 0 && <DetailField label="Lesson codes" value={lessonCodes.join(', ')} />}
                  <DetailField label="Booking" value={record.bookingId ? 'Linked to booking' : 'No booking linked'} />
                  <DetailField label="Flight log" value={record.flightLogId ? 'Linked to flight log' : 'No flight log linked'} />
                  <DetailField label="Instructor signature" value={record.instructorSignatureUrl ? 'Recorded' : 'Not recorded'} />
                  {record.sourceOrganisation && <DetailField label="Source organisation" value={record.sourceOrganisation} />}
                  {record.sourceReference && <DetailField label="Source reference" value={record.sourceReference} />}
                  {record.importBatchId && <DetailField label="Import batch" value={record.importBatchId} />}
                  {record.importSourceRow !== undefined && <DetailField label="Import source row" value={String(record.importSourceRow)} />}
                  {record.pilotRoleGranted && <DetailField label="Pilot status" value="Granted by this record" />}
                  <DetailField label="Attachments" value={attachments.length > 0 ? `${attachments.length} recorded` : 'None'} />
                </dl>
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg border border-gray-200 px-4 py-3 text-xs text-gray-600">
                    {attachments.map((attachment, index) => (
                      <li key={`${attachment}-${index}`} className="break-all">
                        {attachment.split(/[\\/]/).pop() || `Attachment ${index + 1}`}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-gray-500" />
                  <h3 className="text-sm font-semibold text-gray-950">Change history</h3>
                </div>
                <div className="mt-3 space-y-3">
                  {historyEntries.length > 0 ? historyEntries.map(entry => {
                    const summaries = lessonRecordAuditSummary(entry.changes || {});
                    return (
                      <div key={entry.id} className="rounded-xl border border-gray-200 px-4 py-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{actionLabel(entry.action)}</p>
                            <p className="text-xs text-gray-500">{entry.userName || 'System'}</p>
                          </div>
                          <time className="text-xs text-gray-500">{entry.timestamp.toLocaleString('en-AU')}</time>
                        </div>
                        {summaries.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-gray-700">
                            {summaries.map(summary => <li key={summary}>{summary}</li>)}
                          </ul>
                        )}
                      </div>
                    );
                  }) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      No edits have been recorded for this lesson.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      ), document.body)}
    </article>
  );
};
