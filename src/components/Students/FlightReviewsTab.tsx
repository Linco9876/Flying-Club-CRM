import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useFlightReviews, type FlightReviewStatus } from '../../hooks/useFlightReviews';
import { useUsers } from '../../hooks/useUsers';
import { hasAnyRole } from '../../utils/rbac';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';

interface FlightReviewsTabProps {
  studentId: string;
  studentName: string;
}

const statusLabel: Record<FlightReviewStatus, string> = {
  draft: 'Draft',
  in_progress: 'In progress',
  further_training_required: 'Further training required',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const statusClass: Record<FlightReviewStatus, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-200',
  further_training_required: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200',
};

export const FlightReviewsTab: React.FC<FlightReviewsTabProps> = ({ studentId, studentName }) => {
  const { user } = useAuth();
  const { users } = useUsers();
  const reviews = useFlightReviews({ candidateId: studentId });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const isCandidate = user?.id === studentId;
  const isStaff = hasAnyRole(user, ['admin', 'instructor', 'senior_instructor', 'cfi']);

  const sortedRecords = useMemo(
    () => [...reviews.records].sort((a, b) => b.reviewDate.localeCompare(a.reviewDate)),
    [reviews.records]
  );

  const acknowledge = async (recordId: string) => {
    if (!user || !isCandidate) return;
    setAcknowledgingId(recordId);
    try {
      await reviews.updateReview(recordId, {
        candidateAck: true,
        candidateAckName: user.name || studentName,
        candidateAckAt: new Date().toISOString(),
      });
      toast.success('Review acknowledged');
    } catch (error) {
      console.error('Failed to acknowledge flight review:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to acknowledge review');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const openAttachment = async (path: string) => {
    try {
      const url = await reviews.createAttachmentUrl(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open flight review evidence:', error);
      toast.error('Failed to open evidence');
    }
  };

  if (reviews.loading) {
    return <PortalSectionLoader message="Loading reviews and tests" detail="Preparing outcomes, evidence and currency information..." />;
  }

  if (reviews.error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
        {reviews.error}
      </div>
    );
  }

  if (sortedRecords.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]">
        <ClipboardCheck className="mx-auto h-9 w-9 text-gray-400" />
        <h2 className="mt-3 text-lg font-bold text-gray-950 dark:text-gray-100">No reviews or tests recorded</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Flight reviews, external tests and club checks will appear here when started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="rounded-xl bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 p-5 text-white shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase text-blue-200">
          <ShieldCheck className="h-4 w-4" />
          Currency and checking history
        </div>
        <h2 className="mt-2 text-xl font-bold">Flight Reviews &amp; Tests</h2>
        <p className="mt-1 text-sm text-blue-100">Review outcomes, assessment evidence and acknowledgements for {studentName}.</p>
      </header>

      {sortedRecords.map(record => {
        const expanded = expandedId === record.id;
        const reviewer = record.externalExaminerName || users.find(item => item.id === record.reviewerUserId)?.name || 'Reviewer not recorded';
        const items = reviews.itemsByRecord.get(record.id) || [];
        const attachments = reviews.attachmentsByRecord.get(record.id) || [];
        const required = items.filter(item => item.required);
        const satisfactory = required.filter(item => item.result === 'satisfactory').length;
        const acknowledgementRequired = Boolean(record.templateSnapshot.review_configuration?.candidate_ack_required);
        return (
          <article key={record.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : record.id)}
              className="flex w-full flex-col gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-[#1d222b] sm:flex-row sm:items-center sm:justify-between sm:p-5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-gray-950 dark:text-gray-100">{record.templateSnapshot.title || record.reviewType}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusClass[record.status]}`}>{statusLabel[record.status]}</span>
                </div>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{format(parseISO(record.reviewDate), 'd MMM yyyy')} | {reviewer}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {satisfactory}/{required.length} required items satisfactory
                  {record.nextReviewDue ? ` | Next due ${format(parseISO(record.nextReviewDue), 'd MMM yyyy')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm font-bold text-blue-700 dark:text-blue-200">
                {expanded ? 'Hide details' : 'View details'}
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>

            {expanded && (
              <div className="space-y-5 border-t border-gray-200 p-4 dark:border-[#2c3440] sm:p-5">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs font-bold uppercase text-gray-500">Authority</dt><dd className="mt-1 font-semibold text-gray-950 dark:text-gray-100">{record.authority.toUpperCase()}</dd></div>
                  <div><dt className="text-xs font-bold uppercase text-gray-500">Aircraft</dt><dd className="mt-1 font-semibold text-gray-950 dark:text-gray-100">{[record.registration, record.aircraftType].filter(Boolean).join(' ') || 'Not recorded'}</dd></div>
                  <div><dt className="text-xs font-bold uppercase text-gray-500">Ground</dt><dd className="mt-1 font-semibold text-gray-950 dark:text-gray-100">{record.groundMinutes} minutes</dd></div>
                  <div><dt className="text-xs font-bold uppercase text-gray-500">Flight</dt><dd className="mt-1 font-semibold text-gray-950 dark:text-gray-100">{record.flightMinutes} minutes</dd></div>
                </dl>

                {(record.candidateObjectives || record.reviewerSummary || record.remedialPlan) && (
                  <section className="grid gap-3 lg:grid-cols-3">
                    {record.candidateObjectives && <div className="rounded-lg bg-gray-50 p-3 dark:bg-[#11141a]"><h4 className="text-xs font-bold uppercase text-gray-500">Objectives</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-200">{record.candidateObjectives}</p></div>}
                    {record.reviewerSummary && <div className="rounded-lg bg-gray-50 p-3 dark:bg-[#11141a]"><h4 className="text-xs font-bold uppercase text-gray-500">Reviewer summary</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700 dark:text-gray-200">{record.reviewerSummary}</p></div>}
                    {record.remedialPlan && <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10"><h4 className="text-xs font-bold uppercase text-amber-800 dark:text-amber-200">Further training plan</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-amber-900 dark:text-amber-100">{record.remedialPlan}</p></div>}
                  </section>
                )}

                <section>
                  <h4 className="font-bold text-gray-950 dark:text-gray-100">Assessment checklist</h4>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {items.map(item => (
                      <div key={item.id} className="rounded-lg border border-gray-200 p-3 dark:border-[#343b46]">
                        <div className="flex items-start justify-between gap-3">
                          <div><p className="text-xs font-bold uppercase text-gray-500">{item.code} | {item.section}</p><p className="mt-1 text-sm font-semibold text-gray-950 dark:text-gray-100">{item.title}</p></div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${item.result === 'satisfactory' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200' : item.result === 'further_training' ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-100'}`}>{item.result.replaceAll('_', ' ')}</span>
                        </div>
                        {item.notes && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{item.notes}</p>}
                      </div>
                    ))}
                  </div>
                </section>

                {attachments.length > 0 && (
                  <section><h4 className="font-bold text-gray-950 dark:text-gray-100">Evidence</h4><div className="mt-2 flex flex-wrap gap-2">{attachments.map(attachment => <button key={attachment.id} type="button" onClick={() => void openAttachment(attachment.filePath)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#39414d] dark:text-gray-200 dark:hover:bg-[#11141a]"><FileText className="h-4 w-4" />{attachment.fileName}<ExternalLink className="h-3.5 w-3.5" /></button>)}</div></section>
                )}

                <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-500/30 dark:bg-blue-500/10 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    {record.candidateAck ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <CalendarClock className="mt-0.5 h-5 w-5 text-blue-600" />}
                    <div><p className="font-bold text-gray-950 dark:text-gray-100">{record.candidateAck ? 'Candidate acknowledged' : acknowledgementRequired ? 'Candidate acknowledgement required' : 'Acknowledgement optional'}</p>{record.candidateAckAt && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{record.candidateAckName} | {format(parseISO(record.candidateAckAt), 'd MMM yyyy, h:mm a')}</p>}</div>
                  </div>
                  {isCandidate && record.status === 'completed' && !record.candidateAck && acknowledgementRequired && <button type="button" onClick={() => void acknowledge(record.id)} disabled={acknowledgingId === record.id} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{acknowledgingId === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}Acknowledge review</button>}
                </div>

                {isStaff && <p className="text-xs text-gray-500 dark:text-gray-400">Staff edit and complete review records from Training Courses &gt; Flight Reviews &amp; Tests.</p>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
};
