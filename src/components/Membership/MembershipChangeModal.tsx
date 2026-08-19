import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Loader2, X } from 'lucide-react';
import type {
  ClubMembership,
  MembershipChangeTiming,
  MembershipClass,
} from '../../types';
import {
  isUnder18On,
  localDateString,
  membershipClassEligibility,
  membershipClassRequiresFinancialStatus,
  nextMembershipRenewalDate,
} from '../../utils/membershipChangeRules';
import { SearchableSelect } from '../common/SearchableSelect';

interface MembershipChangeModalProps {
  membership: ClubMembership;
  classes: MembershipClass[];
  currentFinancialYearEnd?: string | null;
  financialYearStartMonth: number;
  financialYearStartDay: number;
  adminMode?: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    toMembershipClassCode: string;
    effectiveTiming: MembershipChangeTiming;
    reason: string;
  }) => Promise<unknown>;
}

const dateLabel = (value: string) => new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${value}T00:00:00Z`));

const moneyLabel = (value: number) => new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
}).format(value);

export const MembershipChangeModal: React.FC<MembershipChangeModalProps> = ({
  membership,
  classes,
  currentFinancialYearEnd,
  financialYearStartMonth,
  financialYearStartDay,
  adminMode = false,
  busy,
  onClose,
  onSubmit,
}) => {
  const [effectiveTiming, setEffectiveTiming] = useState<MembershipChangeTiming>('next_renewal');
  const [toMembershipClassCode, setToMembershipClassCode] = useState('');
  const [reason, setReason] = useState('');
  const today = localDateString();
  const renewalDate = nextMembershipRenewalDate(
    currentFinancialYearEnd,
    financialYearStartMonth,
    financialYearStartDay,
    today,
  );
  const effectiveOn = effectiveTiming === 'immediate' ? today : renewalDate;

  const availableClasses = useMemo(() => classes.filter(item =>
    item.isActive
    && item.id !== membership.membershipClassId
    && (adminMode || item.code !== 'life')
    && !(item.code === 'full' && isUnder18On(membership.dateOfBirth, today))
    && membershipClassEligibility(item.code, membership.dateOfBirth, effectiveOn).eligible
  ), [adminMode, classes, effectiveOn, membership.dateOfBirth, membership.membershipClassId, today]);

  const juniorClass = classes.find(item => item.code === 'junior' && item.isActive);
  const juniorEligibility = juniorClass
    ? membershipClassEligibility('junior', membership.dateOfBirth, effectiveOn)
    : null;
  const selectedClass = availableClasses.find(item => item.code === toMembershipClassCode);

  useEffect(() => {
    if (availableClasses.some(item => item.code === toMembershipClassCode)) return;
    setToMembershipClassCode(availableClasses[0]?.code || '');
  }, [availableClasses, toMembershipClassCode]);

  const submit = async () => {
    if (!toMembershipClassCode || reason.trim().length < 5) return;
    await onSubmit({
      toMembershipClassCode,
      effectiveTiming,
      reason: reason.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <ArrowRightLeft className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-slate-950">Change membership</h2>
              <p className="text-xs text-slate-500">Current: {membership.membershipClassName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {adminMode && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              Changing membership for <strong>{membership.userName}</strong>.
            </div>
          )}

          <fieldset>
            <legend className="text-sm font-bold text-slate-800">When should it change?</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([
                { value: 'next_renewal' as const, title: 'Next renewal', detail: renewalDate ? dateLabel(renewalDate) : 'Next membership year' },
                { value: 'immediate' as const, title: 'Immediately', detail: 'Membership rights change now' },
              ]).map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setEffectiveTiming(option.value)}
                  className={`rounded-xl border-2 p-3 text-left transition ${effectiveTiming === option.value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}
                >
                  <span className="block text-sm font-bold text-slate-950">{option.title}</span>
                  <span className="mt-1 block text-xs text-slate-600">{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-bold text-slate-800">
            New membership
            <SearchableSelect
              value={toMembershipClassCode}
              onChange={event => setToMembershipClassCode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
            >
              {availableClasses.length === 0 && <option value="">No eligible memberships</option>}
              {availableClasses.map(item => (
                <option key={item.id} value={item.code}>
                  {item.name} — {item.isFeeExempt ? 'Fee exempt' : `${moneyLabel(item.annualFee)}/year`}
                </option>
              ))}
            </SearchableSelect>
          </label>

          {juniorEligibility && !juniorEligibility.eligible && juniorClass?.id !== membership.membershipClassId && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Junior is unavailable: {juniorEligibility.reason}</span>
            </div>
          )}

          {selectedClass && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              <p className="font-bold">{membership.membershipClassName} → {selectedClass.name}</p>
              <p className="mt-1 leading-5">
                {!membershipClassRequiresFinancialStatus(selectedClass)
                  ? effectiveTiming === 'immediate'
                    ? `${selectedClass.name} is fee-exempt, so no financial status is required. Membership rights change immediately; existing invoices and completed payment history remain unchanged.`
                    : `The current membership continues until ${renewalDate ? dateLabel(renewalDate) : 'the next renewal'}. ${selectedClass.name} then begins as fee-exempt automatically, with no financial status required.`
                  : effectiveTiming === 'immediate'
                    ? 'Membership rights change immediately. Existing current-year invoices and completed payments remain unchanged; the new annual fee starts at the next renewal.'
                    : `The current membership continues until ${renewalDate ? dateLabel(renewalDate) : 'the next renewal'}, when the new class and annual fee begin.`}
              </p>
            </div>
          )}

          <label className="block text-sm font-bold text-slate-800">
            Reason
            <textarea
              rows={3}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={adminMode ? 'Reason or authority for this change' : 'Why would you like to change membership?'}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
            />
            <span className={`mt-1 block text-xs font-normal ${reason.trim().length > 0 && reason.trim().length < 5 ? 'text-red-700' : 'text-slate-500'}`}>
              Minimum 5 characters. This is retained in the membership history.
            </span>
          </label>

          {!adminMode && (
            <p className="text-xs leading-5 text-slate-500">
              An administrator must approve this request before it takes effect.
            </p>
          )}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !toMembershipClassCode || reason.trim().length < 5}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {adminMode ? (effectiveTiming === 'immediate' ? 'Apply change' : 'Schedule change') : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
};
