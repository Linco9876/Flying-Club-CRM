import React from 'react';
import { CheckCircle2, ClipboardCheck, Clock3, Loader2, Plane, ShieldAlert, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { orderLessonRecordAssessments } from '../../utils/lessonRecordPresentation';

interface CourseCriterion {
  id?: string;
  name?: string;
}

interface SequenceResult {
  code?: string;
  title?: string;
  competence?: string;
}

interface LessonAcknowledgementRequest {
  valid: boolean;
  error?: string;
  expiresAt?: string;
  recordId?: string;
  studentName?: string;
  instructorName?: string;
  courseTitle?: string;
  lessonTitle?: string;
  lessonCode?: string;
  lessonDate?: string;
  aircraftType?: string;
  registration?: string;
  dualTimeMin?: number;
  soloTimeMin?: number;
  comments?: string;
  formalBriefing?: boolean;
  briefingComments?: string;
  nextLesson?: string;
  criteriaGrades?: Record<string, string>;
  courseCriteria?: CourseCriterion[];
  sequenceResults?: SequenceResult[];
  isFlightReview?: boolean;
  reviewType?: string;
  reviewResult?: string;
  formalFindings?: string;
}

const formatMinutes = (minutes = 0) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
};

const formatDate = (value?: string) => {
  if (!value) return 'Date not recorded';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const resultLabel = (value?: string) => {
  if (value === 'pass') return 'Pass';
  if (value === 'fail') return 'Further training required';
  if (value === 'not_assessed') return 'Not assessed';
  return value || '';
};

export const LessonAcknowledgementPage: React.FC = () => {
  const tokenRef = React.useRef(new URLSearchParams(window.location.search).get('token') || '');
  const [request, setRequest] = React.useState<LessonAcknowledgementRequest | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [approved, setApproved] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loadRecord = async () => {
      try {
        const { data, error } = await supabase.rpc('get_training_record_acknowledgement', {
          p_token: tokenRef.current,
        });
        if (error) throw error;
        setRequest(data as LessonAcknowledgementRequest);
      } catch (error) {
        console.error('Failed to load lesson acknowledgement:', error);
        setRequest({ valid: false, error: 'This lesson approval link could not be loaded.' });
      } finally {
        setLoading(false);
      }
    };

    void loadRecord();
  }, []);

  const handleApprove = async () => {
    if (!request?.valid || !confirmed) {
      toast.error('Confirm that you have reviewed the lesson record');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('acknowledge_training_record_with_token', {
        p_token: tokenRef.current,
        p_user_agent: navigator.userAgent,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'The record could not be approved');
      tokenRef.current = '';
      setApproved(true);
      toast.success('Lesson record approved');
    } catch (error) {
      console.error('Failed to approve lesson record:', error);
      toast.error(error instanceof Error ? error.message : 'The record could not be approved');
    } finally {
      setSubmitting(false);
    }
  };

  const courseCriteria = Array.isArray(request?.courseCriteria) ? request.courseCriteria : [];
  const criteriaGrades = request?.criteriaGrades || {};
  const criteriaRows = orderLessonRecordAssessments(criteriaGrades, courseCriteria)
    .map(item => ({ ...item, name: item.label }));
  const sequenceRows = (request?.sequenceResults || []).filter((sequence) => sequence.competence && sequence.competence !== '-');

  return (
    <div className="lesson-ack-page min-h-screen bg-slate-100 px-4 py-7 text-slate-950 sm:px-6 sm:py-10">
      <style>{`@media (prefers-color-scheme:dark){.lesson-ack-page{background:#07111f;color:#f8fafc}.lesson-ack-card,.lesson-ack-panel{background:#111827!important;border-color:#334155!important}.lesson-ack-copy{color:#cbd5e1!important}.lesson-ack-heading{color:#f8fafc!important}.lesson-ack-subtle{color:#94a3b8!important}}`}</style>
      <main className="lesson-ack-card mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="bg-slate-950 px-5 py-5 text-white sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600">
              <ClipboardCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">Bendigo Flying Club</p>
              <h1 className="text-xl font-bold sm:text-2xl">Review your lesson record</h1>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[22rem] items-center justify-center p-8" aria-live="polite">
            <div className="lesson-ack-copy text-center text-slate-600">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
              Loading your lesson record…
            </div>
          </div>
        ) : approved ? (
          <div className="p-7 text-center sm:p-10" role="status">
            <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-emerald-600" aria-hidden="true" />
            <h2 className="lesson-ack-heading text-2xl font-bold text-slate-950">Lesson record approved</h2>
            <p className="lesson-ack-copy mx-auto mt-2 max-w-md text-slate-600">
              Thank you. Your acknowledgement is now recorded in your student file. This private link can no longer be used.
            </p>
          </div>
        ) : !request?.valid ? (
          <div className="p-7 text-center sm:p-10" role="alert">
            <ShieldAlert className="mx-auto mb-4 h-14 w-14 text-red-600" aria-hidden="true" />
            <h2 className="lesson-ack-heading text-2xl font-bold text-slate-950">Lesson link unavailable</h2>
            <p className="lesson-ack-copy mx-auto mt-2 max-w-md text-slate-600">
              {request?.error || 'This link is invalid or expired.'}
            </p>
            <p className="lesson-ack-subtle mt-4 text-sm text-slate-500">Ask your instructor to save the record again if you need a new link.</p>
          </div>
        ) : (
          <div className="space-y-6 p-5 sm:p-7">
            <section aria-labelledby="lesson-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">{request.courseTitle}</p>
                  <h2 id="lesson-title" className="lesson-ack-heading mt-1 text-2xl font-bold text-slate-950">{request.lessonTitle}</h2>
                  {request.lessonCode && <p className="lesson-ack-subtle mt-1 text-sm text-slate-500">Lesson {request.lessonCode}</p>}
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">Approval required</span>
              </div>
            </section>

            <section className="lesson-ack-panel grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2" aria-label="Lesson summary">
              <div className="flex gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                <div><p className="lesson-ack-subtle text-xs font-semibold uppercase text-slate-500">Date and time</p><p className="lesson-ack-heading mt-0.5 font-semibold text-slate-900">{formatDate(request.lessonDate)}</p><p className="lesson-ack-copy text-sm text-slate-600">Dual {formatMinutes(request.dualTimeMin)} · Solo {formatMinutes(request.soloTimeMin)}</p></div>
              </div>
              <div className="flex gap-3">
                <Plane className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                <div><p className="lesson-ack-subtle text-xs font-semibold uppercase text-slate-500">Aircraft</p><p className="lesson-ack-heading mt-0.5 font-semibold text-slate-900">{request.registration || 'Not recorded'}</p><p className="lesson-ack-copy text-sm text-slate-600">{request.aircraftType || 'Aircraft type not recorded'}</p></div>
              </div>
              <div className="flex gap-3 sm:col-span-2">
                <UserRound className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
                <div><p className="lesson-ack-subtle text-xs font-semibold uppercase text-slate-500">Instructor</p><p className="lesson-ack-heading mt-0.5 font-semibold text-slate-900">{request.instructorName}</p></div>
              </div>
            </section>

            <section className="lesson-ack-panel rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="flight-comments-heading">
              <h3 id="flight-comments-heading" className="lesson-ack-heading text-base font-bold text-slate-950">Flight comments</h3>
              <p className="lesson-ack-copy mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.comments || 'No comments recorded.'}</p>
            </section>

            {request.formalBriefing && (
              <section className="lesson-ack-panel rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="lesson-ack-heading text-base font-bold text-slate-950">Formal briefing comments</h3>
                <p className="lesson-ack-copy mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.briefingComments || 'No briefing comments recorded.'}</p>
              </section>
            )}

            {(criteriaRows.length > 0 || sequenceRows.length > 0) && (
              <section className="lesson-ack-panel rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="assessment-heading">
                <h3 id="assessment-heading" className="lesson-ack-heading text-base font-bold text-slate-950">Assessment</h3>
                <div className="mt-3 divide-y divide-slate-200">
                  {criteriaRows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-sm"><span className="lesson-ack-copy text-slate-700">{row.name}</span><span className="rounded-md bg-blue-100 px-2 py-1 font-bold text-blue-900">{row.grade}</span></div>)}
                  {sequenceRows.map((row, index) => <div key={`${row.code}-${index}`} className="flex items-center justify-between gap-4 py-2.5 text-sm"><span className="lesson-ack-copy text-slate-700"><strong>{row.code}</strong>{row.title ? ` — ${row.title}` : ''}</span><span className="rounded-md bg-blue-100 px-2 py-1 font-bold text-blue-900">{row.competence}</span></div>)}
                </div>
              </section>
            )}

            {request.isFlightReview && (
              <section className="lesson-ack-panel rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="lesson-ack-heading text-base font-bold text-slate-950">{request.reviewType || 'Review or test'} outcome</h3>
                <p className="lesson-ack-heading mt-2 font-semibold text-slate-900">{resultLabel(request.reviewResult)}</p>
                {request.formalFindings && <p className="lesson-ack-copy mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.formalFindings}</p>}
              </section>
            )}

            {request.nextLesson && (
              <section className="lesson-ack-panel rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Next lesson</p>
                <p className="mt-1 font-semibold text-blue-950">{request.nextLesson}</p>
              </section>
            )}

            <section className="lesson-ack-panel rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                <span className="lesson-ack-copy">I have reviewed this lesson record and confirm that I acknowledge its comments, assessment and recorded flight time.</span>
              </label>
            </section>

            <button type="button" onClick={handleApprove} disabled={submitting || !confirmed} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              {submitting ? 'Approving…' : 'Approve lesson record'}
            </button>
            <p className="lesson-ack-subtle text-center text-xs text-slate-500">Private link · No login required · Expires {request.expiresAt ? new Date(request.expiresAt).toLocaleString('en-AU') : 'in 14 days'}</p>
          </div>
        )}
      </main>
    </div>
  );
};
