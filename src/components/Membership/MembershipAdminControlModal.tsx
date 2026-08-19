import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeCheck,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  ClubMembership,
  MembershipClass,
  MembershipFinancialPeriod,
  MembershipLegalStatus,
} from '../../types';
import {
  availableMembershipStatusChanges,
  membershipStatusActionLabel,
  membershipStatusChangeNeedsClass,
  membershipStatusReasonIsValid,
} from '../../utils/membershipAdminActions';
import {
  localDateString,
  membershipClassEligibility,
} from '../../utils/membershipChangeRules';
import { SearchableSelect } from '../common/SearchableSelect';
import { StudentFileLink } from '../Students/StudentFileLink';

interface MembershipAdminControlModalProps {
  membership: ClubMembership;
  period?: MembershipFinancialPeriod;
  classes: MembershipClass[];
  financeEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onChangeClass: () => void;
  onUpdateStatus: (input: {
    legalStatus: MembershipLegalStatus;
    reason: string;
    membershipClassCode?: string;
  }) => Promise<unknown>;
}

const statusLabel = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());

const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value))
  : 'Not recorded';

export const MembershipAdminControlModal: React.FC<MembershipAdminControlModalProps> = ({
  membership,
  period,
  classes,
  financeEnabled,
  busy,
  onClose,
  onChangeClass,
  onUpdateStatus,
}) => {
  const [nextStatus, setNextStatus] = useState<MembershipLegalStatus | ''>('');
  const [reason, setReason] = useState('');
  const [membershipClassCode, setMembershipClassCode] = useState('');
  const today = localDateString();
  const statusOptions = availableMembershipStatusChanges(membership.legalStatus);
  const restoring = nextStatus !== ''
    && membershipStatusChangeNeedsClass(membership.legalStatus, nextStatus);
  const eligibleClasses = useMemo(() => classes.filter(item =>
    item.isActive
    && membershipClassEligibility(item.code, membership.dateOfBirth, today).eligible
  ), [classes, membership.dateOfBirth, today]);

  useEffect(() => {
    if (!restoring) return;
    const existingClass = eligibleClasses.find(item => item.id === membership.membershipClassId);
    setMembershipClassCode(existingClass?.code || eligibleClasses[0]?.code || '');
  }, [eligibleClasses, membership.membershipClassId, restoring]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const selectedStatus = statusOptions.find(option => option.value === nextStatus);
  const canSubmit = Boolean(
    nextStatus
    && membershipStatusReasonIsValid(reason)
    && (!restoring || membershipClassCode),
  );

  const submit = async () => {
    if (!nextStatus || !canSubmit) return;
    await onUpdateStatus({
      legalStatus: nextStatus,
      reason: reason.trim(),
      membershipClassCode: restoring ? membershipClassCode : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="membership-admin-title"
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="membership-admin-title" className="truncate text-lg font-extrabold text-slate-950 dark:text-white">
                Manage {membership.userName || 'member'}
              </h2>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {membership.userEmail || 'No email recorded'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
            aria-label="Close membership controls"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Membership</p>
              <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{membership.membershipClassName || 'Unclassified'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Legal status</p>
              <p className="mt-1 font-extrabold text-slate-950 dark:text-white">{statusLabel(membership.legalStatus)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Annual fee</p>
              <p className="mt-1 font-extrabold text-slate-950 dark:text-white">
                {!financeEnabled ? 'Finance disabled' : period ? statusLabel(period.feeDisposition) : 'No current period'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <StudentFileLink
              studentId={membership.userId}
              name="Open member profile"
              linkClassName="inline-flex items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 no-underline hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            />
            {membership.legalStatus === 'current' && (
              <button
                type="button"
                onClick={onChangeClass}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-300 px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-950/50"
              >
                <ArrowRightLeft className="h-4 w-4" /> Change membership class
              </button>
            )}
          </div>

          <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-start gap-3">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-300" />
              <div>
                <h3 className="font-extrabold text-slate-950 dark:text-white">Update legal membership status</h3>
                <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                  Every change records the administrator, time and reason in the membership history.
                </p>
              </div>
            </div>

            <label className="mt-4 block text-sm font-bold text-slate-800 dark:text-slate-200">
              New status
              <SearchableSelect
                value={nextStatus}
                onChange={event => setNextStatus(event.target.value as MembershipLegalStatus | '')}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              >
                <option value="">Select a new status</option>
                {statusOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </SearchableSelect>
            </label>

            {selectedStatus && (
              <div className={`mt-3 flex gap-2 rounded-xl border p-3 text-sm ${selectedStatus.destructive ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' : 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'}`}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{selectedStatus.description}</span>
              </div>
            )}

            {restoring && (
              <label className="mt-3 block text-sm font-bold text-slate-800 dark:text-slate-200">
                Membership class on restoration
                <SearchableSelect
                  value={membershipClassCode}
                  onChange={event => setMembershipClassCode(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  {eligibleClasses.length === 0 && <option value="">No age-eligible active membership class</option>}
                  {eligibleClasses.map(item => <option key={item.id} value={item.code}>{item.name}</option>)}
                </SearchableSelect>
                <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
                  Full and Junior options are filtered using the member&apos;s recorded date of birth.
                </span>
              </label>
            )}

            <label className="mt-3 block text-sm font-bold text-slate-800 dark:text-slate-200">
              Reason or authority
              <textarea
                rows={3}
                value={reason}
                onChange={event => setReason(event.target.value)}
                placeholder="Committee authority, member request, or other reason"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white"
              />
              <span className={`mt-1 block text-xs font-normal ${reason.length > 0 && !membershipStatusReasonIsValid(reason) ? 'text-red-700 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}>
                Minimum 10 characters. This becomes part of the audit history.
              </span>
            </label>

            {nextStatus && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Existing Xero invoices, Stripe payments, waivers and completed fee records will not be changed. Ending a membership turns off future auto-renewal; restoring it prepares a current-year fee only when required.
              </div>
            )}
          </section>

          {membership.endedAt && membership.legalStatus !== 'current' && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ended {dateLabel(membership.endedAt)}{membership.endReason ? ` · ${membership.endReason}` : ''}
            </p>
          )}
        </div>

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => void submit()}
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 ${nextStatus === 'current' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-blue-700 hover:bg-blue-800'}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {nextStatus ? membershipStatusActionLabel(nextStatus) : 'Update membership'}
          </button>
        </footer>
      </section>
    </div>
  );
};
