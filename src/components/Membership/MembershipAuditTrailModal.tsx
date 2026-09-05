import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  FileCheck2,
  History,
  Loader2,
  RefreshCw,
  UserCheck,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { membershipStatusLabel } from '../../hooks/useMembership';
import type {
  ClubMembership,
  MembershipApplication,
  MembershipChangeRequest,
  MembershipFinancialPeriod,
  MembershipStatusEvent,
} from '../../types';
import {
  membershipAuditActorLabel,
  membershipAuditEventDescription,
  membershipAuditEventTitle,
} from '../../utils/membershipAuditTrail';

interface MembershipAuditTrailModalProps {
  membership: ClubMembership;
  applications: MembershipApplication[];
  changes: MembershipChangeRequest[];
  periods: MembershipFinancialPeriod[];
  onClose: () => void;
}

interface MembershipStatusEventRow {
  id: string;
  membership_id: string | null;
  application_id: string | null;
  user_id: string;
  event_type: string;
  event_at: string;
  actor_id: string | null;
  details: Record<string, unknown> | null;
}

const dateTimeLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  : 'Not recorded';

const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(value))
  : 'Not recorded';

const moneyLabel = (value: number) => new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
}).format(value);

const statusTone = (value?: string | null) => {
  if (['current', 'paid', 'waived', 'fee_exempt', 'approved', 'auto_commenced', 'applied'].includes(value || '')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200';
  }
  if (['pending', 'invoice_required', 'invoiced', 'overdue', 'needs_review'].includes(value || '')) {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200';
};

const StatusPill = ({ value }: { value?: string | null }) => (
  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(value)}`}>
    {membershipStatusLabel(value)}
  </span>
);

const mapEvent = (row: MembershipStatusEventRow): MembershipStatusEvent => ({
  id: row.id,
  membershipId: row.membership_id,
  applicationId: row.application_id,
  userId: row.user_id,
  eventType: row.event_type,
  eventAt: row.event_at,
  actorId: row.actor_id,
  details: row.details || {},
});

const decisionLabel = (application: MembershipApplication) => {
  if (application.status === 'approved') return 'Approved';
  if (application.status === 'auto_commenced') return 'Automatically commenced';
  if (application.status === 'rejected') return 'Rejected';
  if (application.status === 'withdrawn') return 'Withdrawn';
  return 'Awaiting decision';
};

export const MembershipAuditTrailModal: React.FC<MembershipAuditTrailModalProps> = ({
  membership,
  applications,
  changes,
  periods,
  onClose,
}) => {
  const [events, setEvents] = useState<MembershipStatusEvent[]>([]);
  const [actors, setActors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const memberApplications = useMemo(() => applications
    .filter(application => application.userId === membership.userId)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt)), [applications, membership.userId]);
  const memberChanges = useMemo(() => changes
    .filter(change => change.userId === membership.userId)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt)), [changes, membership.userId]);
  const memberPeriods = useMemo(() => periods
    .filter(period => period.membershipId === membership.id)
    .sort((left, right) => right.financialYearStart.localeCompare(left.financialYearStart)), [membership.id, periods]);
  const actorIdsFromRecords = useMemo(() => Array.from(new Set([
    ...memberApplications.flatMap(application => application.decidedBy ? [application.decidedBy] : []),
    ...memberChanges.flatMap(change => [change.requestedBy, change.decidedBy].filter((value): value is string => Boolean(value))),
    ...memberPeriods.flatMap(period => period.waiverAuthorisedBy ? [period.waiverAuthorisedBy] : []),
  ])), [memberApplications, memberChanges, memberPeriods]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: eventError } = await supabase
        .from('membership_status_events')
        .select('id,membership_id,application_id,user_id,event_type,event_at,actor_id,details')
        .eq('user_id', membership.userId)
        .order('event_at', { ascending: false });

      if (eventError) {
        if (!cancelled) {
          setError(eventError.message || 'The membership history could not be loaded.');
          setLoading(false);
        }
        return;
      }

      const mappedEvents = ((data || []) as MembershipStatusEventRow[]).map(mapEvent);
      const actorIds = Array.from(new Set([
        ...actorIdsFromRecords,
        ...mappedEvents.flatMap(event => event.actorId ? [event.actorId] : []),
      ]));
      let nextActors: Record<string, string> = {};
      if (actorIds.length > 0) {
        const { data: actorRows, error: actorError } = await supabase
          .from('users')
          .select('id,name,email')
          .in('id', actorIds);
        if (actorError) {
          if (!cancelled) {
            setError('The history loaded, but staff names could not be resolved.');
          }
        } else {
          nextActors = Object.fromEntries((actorRows || []).map(actor => [
            actor.id,
            actor.name || actor.email || 'Staff account',
          ]));
        }
      }

      if (!cancelled) {
        setEvents(mappedEvents);
        setActors(nextActors);
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [actorIdsFromRecords, membership.userId, reloadKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const actorLabel = (actorId?: string | null) => membershipAuditActorLabel({
    actorId,
    actorName: actorId ? actors[actorId] : null,
    memberId: membership.userId,
  });
  const currentPeriod = memberPeriods[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-2 sm:p-4" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-history-title"
        className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 sm:max-h-[92vh]"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-slate-700 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <History className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="membership-history-title" className="break-words text-base font-extrabold leading-tight text-slate-950 dark:text-white sm:truncate sm:text-xl">
                Membership history — {membership.userName || 'Member'}
              </h2>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400 sm:text-sm">{membership.userEmail || 'No email recorded'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close membership history" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current membership</p>
              <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{membership.membershipClassName || 'Unclassified'}</p>
              <div className="mt-2"><StatusPill value={membership.legalStatus} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Commenced</p>
              <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{dateLabel(membership.commencedAt)}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{membershipStatusLabel(membership.commencementMethod)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current fee record</p>
              {currentPeriod ? <>
                <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{moneyLabel(currentPeriod.amountDue)}</p>
                <div className="mt-2"><StatusPill value={currentPeriod.feeDisposition} /></div>
              </> : <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-slate-300">No financial period</p>}
            </div>
          </div>

          <section className="mt-6">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-blue-700 dark:text-blue-300" />
              <h3 className="font-extrabold text-slate-950 dark:text-white">Applications and decisions</h3>
            </div>
            {memberApplications.length === 0 ? (
              <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">No portal application is attached. This membership may have been imported from existing club records.</p>
            ) : (
              <div className="mt-3 space-y-3">{memberApplications.map(application => (
                <article key={application.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-950 dark:text-white">{application.membershipClassName || 'Membership'} application</p>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Submitted {dateTimeLabel(application.submittedAt)}</p>
                    </div>
                    <StatusPill value={application.status} />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {decisionLabel(application)}{application.decidedAt ? ` ${dateTimeLabel(application.decidedAt)}` : ''}{application.decidedBy ? ` by ${actorLabel(application.decidedBy)}` : ''}
                  </p>
                  {application.decisionReason && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Reason: {application.decisionReason}</p>}
                </article>
              ))}</div>
            )}
          </section>

          {memberChanges.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-blue-700 dark:text-blue-300" /><h3 className="font-extrabold text-slate-950 dark:text-white">Membership changes</h3></div>
              <div className="mt-3 space-y-3">{memberChanges.map(change => (
                <article key={change.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold text-slate-950 dark:text-white">{change.fromMembershipClassName || 'Previous class'} → {change.toMembershipClassName || 'New class'}</p><StatusPill value={change.status} /></div>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Requested {dateTimeLabel(change.submittedAt)} by {actorLabel(change.requestedBy)}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Effective {dateLabel(change.effectiveOn)} · {membershipStatusLabel(change.requestedEffectiveTiming)}</p>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{change.requestReason}</p>
                  {change.decidedAt && <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Decision {dateTimeLabel(change.decidedAt)} by {actorLabel(change.decidedBy)}{change.decisionReason ? ` · ${change.decisionReason}` : ''}</p>}
                </article>
              ))}</div>
            </section>
          )}

          {memberPeriods.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-blue-700 dark:text-blue-300" /><h3 className="font-extrabold text-slate-950 dark:text-white">Financial-year records</h3></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{memberPeriods.map(period => (
                <article key={period.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-bold text-slate-950 dark:text-white">{dateLabel(period.financialYearStart)} – {dateLabel(period.financialYearEnd)}</p><StatusPill value={period.feeDisposition} /></div>
                  <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">{moneyLabel(period.amountDue)} · due {dateLabel(period.dueDate)}</p>
                  {period.xeroInvoiceNumber && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Xero invoice {period.xeroInvoiceNumber}{period.xeroInvoiceStatus ? ` · ${period.xeroInvoiceStatus}` : ''}</p>}
                  {period.financiallyClearedAt && <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Cleared {dateTimeLabel(period.financiallyClearedAt)}</p>}
                  {period.waiverReason && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Waiver: {period.waiverReason}</p>}
                </article>
              ))}</div>
            </section>
          )}

          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-blue-700 dark:text-blue-300" /><div><h3 className="font-extrabold text-slate-950 dark:text-white">Permanent audit timeline</h3><p className="text-xs text-slate-500 dark:text-slate-400">Newest activity first</p></div></div>
              <button type="button" onClick={() => setReloadKey(key => key + 1)} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            </div>
            {loading ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-slate-200 p-8 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"><Loader2 className="h-5 w-5 animate-spin text-blue-700" /> Loading membership history…</div>
            ) : error && events.length === 0 ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"><p>{error}</p><button type="button" onClick={() => setReloadKey(key => key + 1)} className="mt-2 font-bold underline">Try again</button></div>
            ) : events.length === 0 ? (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">No audit events were recorded for this member.</p>
            ) : (
              <ol className="relative mt-4 space-y-0 border-l-2 border-slate-200 pl-5 dark:border-slate-700">{events.map(event => (
                <li key={event.id} className="relative pb-5 last:pb-0">
                  <span className="absolute -left-[1.69rem] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-blue-600 ring-2 ring-blue-100 dark:border-slate-900 dark:ring-blue-950" />
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3"><p className="font-bold text-slate-950 dark:text-white">{membershipAuditEventTitle(event.eventType)}</p><time className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">{dateTimeLabel(event.eventAt)}</time></div>
                    <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">{membershipAuditEventDescription(event)}</p>
                    <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Recorded by {actorLabel(event.actorId)}</p>
                  </div>
                </li>
              ))}</ol>
            )}
            {error && events.length > 0 && <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">{error}</p>}
          </section>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:px-6">
          <button type="button" onClick={onClose} autoFocus className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800">Close</button>
        </footer>
      </section>
    </div>
  );
};
