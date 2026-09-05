import { SearchableSelect } from '../common/SearchableSelect';
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Download,
  Clock3,
  FileCheck2,
  FileSpreadsheet,
  Heart,
  HelpCircle,
  History,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Repeat2,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Vote,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { isFinanciallyCleared, membershipStatusLabel, rolloutModeDescription, useMembership } from '../../hooks/useMembership';
import { useUsers } from '../../hooks/useUsers';
import { MembershipApplication, MembershipChangeRequest, MembershipClass, MembershipFinancialPeriod, MembershipPaymentMethod, MembershipProrationMethod, MembershipRolloutMode } from '../../types';
import { MembershipDocumentLinks } from './MembershipDocumentLinks';
import { AddressAutocomplete } from '../common/AddressAutocomplete';
import { useMembershipDocuments } from '../../hooks/useMembershipDocuments';
import { StudentFileLink } from '../Students/StudentFileLink';
import { membershipDocumentsAreReady } from '../../utils/membershipDocumentRules';
import {
  membershipProductCodeIsValid,
  membershipProductsAreValid,
  positiveIntegerList,
  scholarshipSettingsAreValid,
} from '../../utils/membershipSettings';
import { membershipSettingHelp, type MembershipSettingHelpKey } from '../../utils/membershipSettingHelp';
import { useFinancialProviders } from '../../context/financialProviderState';
import { FinancialProviderStatus } from '../Billing/FinancialProviderStatus';
import { ExistingMemberCsvImportModal } from './ExistingMemberCsvImportModal';
import { MembershipChangeModal } from './MembershipChangeModal';
import { MembershipAdminControlModal } from './MembershipAdminControlModal';
import { MembershipAuditTrailModal } from './MembershipAuditTrailModal';
import {
  isUnder18On,
  localDateString,
  membershipClassEligibility,
  membershipClassRequiresFinancialStatus,
} from '../../utils/membershipChangeRules';
import {
  buildMembershipDashboardSummary,
  currentMembershipPeriodMap,
  membershipMatchesDashboardFocus,
  type MembershipRegisterFocus,
} from '../../utils/membershipDashboard';

type MembershipTab = 'dashboard' | 'mine' | 'applications' | 'register' | 'settings';

type MembershipSettingHelpHandler = (
  setting: MembershipSettingHelpKey,
  trigger?: HTMLButtonElement,
) => void;

const dateLabel = (value?: string | null) => value
  ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
  : 'Not recorded';

const moneyLabel = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);

const statusTone = (value?: string | null) => {
  if (['current', 'paid', 'waived', 'fee_exempt', 'approved', 'auto_commenced'].includes(value || '')) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (['pending', 'invoice_required', 'invoiced', 'overdue'].includes(value || '')) return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-red-200 bg-red-50 text-red-800';
};

const StatusPill = ({ value }: { value?: string | null }) => (
  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(value)}`}>
    {membershipStatusLabel(value)}
  </span>
);

const MembershipSettingHelpButton = ({
  setting,
  active,
  onOpen,
}: {
  setting: MembershipSettingHelpKey;
  active: boolean;
  onOpen: MembershipSettingHelpHandler;
}) => {
  const help = membershipSettingHelp[setting];
  return (
    <button
      type="button"
      onClick={event => onOpen(setting, event.currentTarget)}
      aria-label={`Help: ${help.title}`}
      aria-expanded={active}
      aria-controls={active ? 'membership-setting-help-panel' : undefined}
      title={`Explain ${help.title}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:text-slate-400 dark:hover:bg-blue-950/60 dark:hover:text-blue-200 dark:focus:ring-offset-slate-900"
    >
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
    </button>
  );
};

const MembershipSettingField = ({
  inputId,
  label,
  setting,
  activeHelp,
  onHelp,
  children,
  hint,
  className = '',
}: {
  inputId: string;
  label: string;
  setting: MembershipSettingHelpKey;
  activeHelp: MembershipSettingHelpKey | null;
  onHelp: MembershipSettingHelpHandler;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <div className="flex min-h-7 items-center gap-1">
      <label htmlFor={inputId} className="text-sm font-semibold text-slate-700">{label}</label>
      <MembershipSettingHelpButton setting={setting} active={activeHelp === setting} onOpen={onHelp} />
    </div>
    {children}
    {hint}
  </div>
);

const MembershipToggleSetting = ({
  inputId,
  title,
  description,
  setting,
  activeHelp,
  onHelp,
  checked,
  onChange,
  className = 'border-slate-200',
  descriptionClassName = 'text-xs text-slate-500',
}: {
  inputId: string;
  title: string;
  description: string;
  setting: MembershipSettingHelpKey;
  activeHelp: MembershipSettingHelpKey | null;
  onHelp: MembershipSettingHelpHandler;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  descriptionClassName?: string;
}) => (
  <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm text-slate-700 ${className}`}>
    <input
      id={inputId}
      type="checkbox"
      checked={checked}
      onChange={event => onChange(event.target.checked)}
      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
    />
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={inputId} className="font-bold text-slate-800">{title}</label>
        <MembershipSettingHelpButton setting={setting} active={activeHelp === setting} onOpen={onHelp} />
      </div>
      <p className={`mt-1 leading-5 ${descriptionClassName}`}>{description}</p>
    </div>
  </div>
);

const MembershipSettingHelpPanel = ({
  setting,
  onClose,
}: {
  setting: MembershipSettingHelpKey;
  onClose: () => void;
}) => {
  const help = membershipSettingHelp[setting];

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <aside
      id="membership-setting-help-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="membership-setting-help-title"
      className="app-mobile-toast fixed inset-x-4 bottom-4 z-[110] rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl sm:left-auto sm:w-96"
    >
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="membership-setting-help-title" className="font-bold text-slate-950">{help.title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{help.description}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          aria-label="Close setting help"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <XCircle className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-400">Press Escape to close</p>
    </aside>
  );
};

const MembershipBillingStatus = ({ period }: { period?: MembershipFinancialPeriod }) => {
  const status = period?.billingSyncStatus;
  if (!period || !status || status === 'succeeded') return null;
  const isProblem = status === 'failed' || status === 'needs_review';
  const isQueued = status === 'queued';
  const retryLabel = period.billingSyncNextAttemptAt
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(period.billingSyncNextAttemptAt))
    : null;

  return <div className={`rounded-2xl border p-5 ${isProblem ? 'border-red-300 bg-red-50 text-red-950' : isQueued ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-blue-300 bg-blue-50 text-blue-950'}`}>
    <div className="flex gap-3">
      {isProblem ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> : <RefreshCw className={`mt-0.5 h-5 w-5 shrink-0 ${status === 'processing' ? 'animate-spin' : ''}`} />}
      <div>
        <h3 className="font-bold">{isProblem ? 'Membership billing needs attention' : isQueued ? 'Membership billing will retry automatically' : 'Membership payment is processing'}</h3>
        <p className="mt-1 text-sm">
          {isProblem
            ? 'Your membership remains current. The club could not complete the invoice or payment and staff have been notified.'
            : isQueued
              ? `The last billing attempt did not complete.${retryLabel ? ` The next retry is scheduled for ${retryLabel}.` : ''}`
              : 'Your invoice or automatic payment has been submitted and is awaiting confirmation.'}
        </p>
        {period.billingSyncAttempts > 0 && <p className="mt-2 text-xs opacity-80">Billing attempt {period.billingSyncAttempts}</p>}
      </div>
    </div>
  </div>;
};

const MembershipApplicationForm = ({ onSubmit, busy, classes }: {
  onSubmit: (input: {
    membershipClassCode: string;
    residentialAddress: string;
    serviceAddress: string;
    dateOfBirth?: string;
    guardianName?: string;
    guardianConsent: boolean;
    privacyNoticeAccepted: boolean;
    acknowledgedDocumentIds: string[];
  }) => Promise<unknown>;
  busy: boolean;
  classes: Array<{ code: string; name: string; annualFee: number }>;
}) => {
  const { user } = useAuth();
  const [sameAddress, setSameAddress] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const {
    documents: membershipDocuments,
    loading: membershipDocumentsLoading,
    error: membershipDocumentsError,
  } = useMembershipDocuments({ currentOnly: true, acknowledgementOnly: true });
  const [form, setForm] = useState({
    membershipClassCode: 'full',
    residentialAddress: user?.address || '',
    serviceAddress: user?.address || '',
    dateOfBirth: user?.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : '',
    guardianName: '',
    guardianConsent: false,
  });
  const isJunior = isUnder18On(form.dateOfBirth);
  const membershipDocumentsReady = membershipDocumentsAreReady(
    membershipDocuments,
    membershipDocumentsLoading,
    membershipDocumentsError,
  );

  React.useEffect(() => {
    if (form.membershipClassCode !== 'junior' || isJunior) return;
    setForm(current => ({ ...current, membershipClassCode: 'full' }));
  }, [form.membershipClassCode, isJunior]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accepted || !privacyAccepted || !membershipDocumentsReady) return;
    if (form.membershipClassCode === 'junior' && !isJunior) return;
    await onSubmit({
      ...form,
      serviceAddress: sameAddress ? form.residentialAddress : form.serviceAddress,
      privacyNoticeAccepted: privacyAccepted,
      acknowledgedDocumentIds: membershipDocuments.map(document => document.id),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-950">Apply for BFC membership</h2>
        <p className="mt-1 text-sm text-slate-600">Membership commences when approved by the committee, or 30 days after a complete application is submitted.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Membership class
          <SearchableSelect value={form.membershipClassCode} onChange={event => setForm(current => ({ ...current, membershipClassCode: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">
            {classes
              .filter(item => item.code !== 'junior' || isJunior)
              .map(item => <option key={item.code} value={item.code}>{item.name} — {moneyLabel(item.annualFee)}/year</option>)}
          </SearchableSelect>
          {!isJunior && <span className="mt-1 block text-xs font-normal text-slate-500">Junior becomes available only when the recorded date of birth shows the applicant is under 18.</span>}
        </label>
        <label className="text-sm font-semibold text-slate-700">Date of birth
          <input type="date" value={form.dateOfBirth} onChange={event => setForm(current => ({ ...current, dateOfBirth: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
          {form.membershipClassCode === 'junior' && !isJunior && <span className="mt-1 block text-xs font-normal text-red-700">Junior membership requires an applicant under 18.</span>}
        </label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">Residential address
          <AddressAutocomplete required value={form.residentialAddress} onChange={residentialAddress => setForm(current => ({ ...current, residentialAddress }))} className="mt-1" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" checked={sameAddress} onChange={event => setSameAddress(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Use this address for formal notices
        </label>
        {!sameAddress && <label className="text-sm font-semibold text-slate-700 md:col-span-2">Address for service
          <AddressAutocomplete required value={form.serviceAddress} onChange={serviceAddress => setForm(current => ({ ...current, serviceAddress }))} className="mt-1" placeholder="Start typing your address for formal notices" autoComplete="street-address" />
        </label>}
        {isJunior && <div className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 md:col-span-2 md:grid-cols-2">
          <label className="text-sm font-semibold text-amber-950">Parent or guardian name
            <input required value={form.guardianName} onChange={event => setForm(current => ({ ...current, guardianName: event.target.value }))} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 font-normal" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-amber-950">
            <input type="checkbox" required checked={form.guardianConsent} onChange={event => setForm(current => ({ ...current, guardianConsent: event.target.checked }))} className="h-4 w-4 rounded border-amber-300" />
            Guardian consent has been provided
          </label>
        </div>}
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <input type="checkbox" required disabled={!membershipDocumentsReady} checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 disabled:opacity-50" />
        <span>I support the purposes of Bendigo Flying Club, accept the member guarantee, and confirm I have read and agree to each current membership document listed below. I understand the document versions and my acknowledgement will be retained with my application.<MembershipDocumentLinks documents={membershipDocuments} loading={membershipDocumentsLoading} error={membershipDocumentsError} /></span>
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <input type="checkbox" required checked={privacyAccepted} onChange={event => setPrivacyAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>
          I have read the <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">portal privacy notice</a> and understand how my information is used for membership, bookings, safety, training, accounting and portal security.
        </span>
      </label>
      <button disabled={busy || !accepted || !privacyAccepted || !membershipDocumentsReady || (form.membershipClassCode === 'junior' && !isJunior)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Submit application
      </button>
    </form>
  );
};

const MembershipPaymentPreferencesCard = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const preference = membershipApi.ownPaymentPreference;
  const [paymentMethod, setPaymentMethod] = useState<MembershipPaymentMethod>(preference?.paymentMethod || 'becs');
  const [autoRenew, setAutoRenew] = useState(preference?.autoRenew || false);
  const [scholarshipEnabled, setScholarshipEnabled] = useState(preference?.scholarshipContributionEnabled || false);
  const [scholarshipAmount, setScholarshipAmount] = useState(String(
    preference?.scholarshipContributionAmount || membershipApi.settings.scholarshipDefaultAmount,
  ));
  const [authorityAccepted, setAuthorityAccepted] = useState(false);
  const [replacePaymentMethod, setReplacePaymentMethod] = useState(false);

  React.useEffect(() => {
    if (!preference) return;
    setPaymentMethod(preference.paymentMethod);
    setAutoRenew(preference.autoRenew);
    setScholarshipEnabled(
      membershipApi.settings.scholarshipContributionAvailable
      && preference.scholarshipContributionEnabled
    );
    setScholarshipAmount(String(
      preference.scholarshipContributionAmount || membershipApi.settings.scholarshipDefaultAmount,
    ));
    setReplacePaymentMethod(false);
  }, [membershipApi.settings.scholarshipContributionAvailable, membershipApi.settings.scholarshipDefaultAmount, preference]);

  const methods = useMemo(() => ([
    { id: 'becs', title: 'BECS Direct Debit', description: 'Securely save an Australian bank account. Setup does not transfer any money.', icon: Landmark, recommended: true },
    { id: 'invoice', title: 'Xero invoice', description: 'Receive an invoice and choose when to pay it.', icon: Banknote },
    { id: 'card', title: 'Card', description: 'Use a securely stored card. The club absorbs card fees.', icon: CreditCard },
  ] satisfies Array<{ id: MembershipPaymentMethod; title: string; description: string; icon: typeof Landmark; recommended?: boolean }>).filter(method =>
    method.id === 'invoice'
      ? financialProviders.xero.postingAvailable
      : financialProviders.stripe.paymentsAvailable
  ), [
    financialProviders.stripe.paymentsAvailable,
    financialProviders.xero.postingAvailable,
  ]);
  React.useEffect(() => {
    if (methods.length > 0 && !methods.some(method => method.id === paymentMethod)) {
      setPaymentMethod(methods[0].id);
      setAutoRenew(false);
      setAuthorityAccepted(false);
    }
  }, [methods, paymentMethod]);
  const needsAuthority = paymentMethod !== 'invoice';
  const parsedScholarshipAmount = Number(scholarshipAmount);
  const preferenceIsReady = preference?.paymentMethod === 'invoice'
    ? preference.authorityStatus === 'not_required'
    : preference?.authorityStatus === 'ready' && /ending\s+\d{4}$/i.test(preference.paymentMethodDisplay || '');
  const opensSecureSetup = needsAuthority && (replacePaymentMethod || !(preference?.paymentMethod === paymentMethod && preferenceIsReady));
  const saveDisabled = membershipApi.busyAction === 'payment-preference'
    || (scholarshipEnabled && (
      !Number.isFinite(parsedScholarshipAmount)
      || parsedScholarshipAmount < membershipApi.settings.scholarshipMinimumAmount
    ))
    || (needsAuthority && !authorityAccepted);

  if (!financialProviders.financeEnabled) {
    return <FinancialProviderStatus />;
  }
  if (methods.length === 0) {
    return <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
      <FinancialProviderStatus compact />
      <div>
        <h2 className="font-bold">Payment setup is not available</h2>
        <p className="mt-1 text-sm">
          Xero is connected in a contained, read-only mode and Stripe payments are unavailable.
          Your membership record remains available, but no invoice or automatic debit can be created.
        </p>
      </div>
    </section>;
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start gap-3">
      <CircleDollarSign className="mt-0.5 h-5 w-5 text-blue-700" />
      <div><h2 className="font-bold text-slate-950">Payment preference</h2><p className="mt-1 text-sm text-slate-600">The setup screen only saves your payment method. Nothing is charged or transferred until membership commences. {financialProviders.xero.postingAvailable ? 'Xero records the invoice and payment.' : 'Stripe records the payment while Xero posting is unavailable.'}</p></div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {methods.map(method => { const Icon = method.icon; const selected = paymentMethod === method.id; return <button key={method.id} type="button" onClick={() => { setPaymentMethod(method.id); setAuthorityAccepted(false); setReplacePaymentMethod(false); }} className={`relative rounded-xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}>
        {method.recommended && <span className="absolute right-3 top-3 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Preferred</span>}
        <Icon className={`h-5 w-5 ${selected ? 'text-blue-700' : 'text-slate-500'}`} /><span className="mt-3 block font-bold text-slate-950">{method.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{method.description}</span>
      </button>; })}
    </div>
    <label className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${paymentMethod === 'invoice' ? 'border-slate-200 bg-slate-50' : 'border-blue-200 bg-blue-50'}`}>
      <input type="checkbox" checked={autoRenew} disabled={paymentMethod === 'invoice'} onChange={event => setAutoRenew(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
      <span><span className="flex items-center gap-2 font-bold text-slate-900"><Repeat2 className="h-4 w-4" /> Automatically pay annual renewals</span><span className="mt-1 block text-sm text-slate-600">We will notify you before each annual debit. You can turn this off at any time. Manual Xero invoices cannot be auto-debited.</span></span>
    </label>
    {membershipApi.settings.scholarshipContributionAvailable && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={scholarshipEnabled} onChange={event => setScholarshipEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-violet-300" />
        <span><span className="flex items-center gap-2 font-bold text-violet-950"><Heart className="h-4 w-4" /> Add a scholarship contribution</span><span className="mt-1 block text-sm text-violet-800">Optional and unchecked by default. It is listed separately from your membership fee in Xero.</span></span>
      </label>
      {scholarshipEnabled && <label className="mt-3 block max-w-xs text-sm font-semibold text-violet-950">Contribution amount
        <div className="mt-1 flex rounded-lg border border-violet-300 bg-white focus-within:ring-2 focus-within:ring-violet-200"><span className="px-3 py-2.5 text-slate-500">$</span><input type="number" min={membershipApi.settings.scholarshipMinimumAmount} step="0.01" inputMode="decimal" value={scholarshipAmount} onChange={event => setScholarshipAmount(event.target.value)} className="min-w-0 flex-1 rounded-r-lg border-0 px-2 py-2.5 outline-none" /></div>
        <span className="mt-1 block text-xs font-normal text-violet-700">Minimum {moneyLabel(membershipApi.settings.scholarshipMinimumAmount)}</span>
      </label>}
    </div>}
    {needsAuthority && <label className="mt-4 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={authorityAccepted} onChange={event => setAuthorityAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" /><span>I authorise the initial membership payment using this method. {autoRenew ? 'I also authorise future annual renewal payments after advance notice.' : 'I am not authorising future annual renewal payments.'}</span></label>}
    {preference && <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Current: <span className="font-bold text-slate-800">{preference.paymentMethodDisplay || membershipStatusLabel(preference.paymentMethod)}</span>{preferenceIsReady ? <span className="ml-2 text-emerald-700">Ready</span> : preference.authorityStatus === 'ready' ? <span className="ml-2 font-semibold text-amber-700">Setup incomplete - save again</span> : <span className="ml-2 capitalize text-amber-700">{membershipStatusLabel(preference.authorityStatus)}</span>}{preferenceIsReady && preference.paymentMethod !== 'invoice' && <button type="button" onClick={() => { setReplacePaymentMethod(true); setAuthorityAccepted(false); }} className="ml-3 font-semibold text-blue-700 underline underline-offset-2">Use a different {preference.paymentMethod === 'card' ? 'card' : 'bank account'}</button>}{preference.lastCollectionError && <span className="mt-1 block text-red-700">{preference.lastCollectionError}</span>}</div>}
    <button disabled={saveDisabled} onClick={() => void membershipApi.savePaymentPreference({ paymentMethod, autoRenew: paymentMethod === 'invoice' ? false : autoRenew, scholarshipContributionEnabled: membershipApi.settings.scholarshipContributionAvailable && scholarshipEnabled, scholarshipContributionAmount: parsedScholarshipAmount, authorityAccepted: needsAuthority ? authorityAccepted : false, forceSetup: replacePaymentMethod })} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
      {membershipApi.busyAction === 'payment-preference' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {opensSecureSetup ? `Continue to secure ${paymentMethod === 'card' ? 'card' : 'bank'} setup` : 'Save payment preference'}
    </button>
  </section>;
};

const MembershipCancellation = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!membershipApi.ownApplication && !membershipApi.ownMembership) return null;
  if (membershipApi.ownApplication?.status === 'withdrawn' || membershipApi.ownMembership?.legalStatus === 'resigned') return null;
  return <div className="rounded-2xl border border-slate-200 bg-white p-5">
    {!open ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-900">Cancel membership</h3><p className="mt-1 text-sm text-slate-600">{financialProviders.xero.accountingAvailable ? 'Unpaid Xero membership invoices will be voided. Paid invoices remain as accounting records.' : 'Automatic Stripe collection will stop. Completed payments remain as permanent records.'}</p></div><button onClick={() => setOpen(true)} className="self-start rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50">{membershipApi.ownMembership ? 'Cancel membership' : 'Withdraw application'}</button></div> : <div><h3 className="font-bold text-red-900">Confirm cancellation</h3><p className="mt-1 text-sm text-slate-600">This stops automatic renewal{financialProviders.xero.accountingAvailable ? ' and cancels any unpaid membership invoice' : ''}.</p><textarea autoFocus rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason for cancellation (minimum 10 characters)" className="mt-3 w-full rounded-lg border border-red-200 px-3 py-2" /><div className="mt-3 flex justify-end gap-2"><button onClick={() => { setOpen(false); setReason(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Keep membership</button><button disabled={reason.trim().length < 10 || membershipApi.busyAction === 'membership-cancel'} onClick={async () => { await membershipApi.cancelMembership(reason); setOpen(false); }} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{membershipApi.busyAction === 'membership-cancel' && <Loader2 className="h-4 w-4 animate-spin" />} Confirm cancellation</button></div></div>}
  </div>;
};

const OwnMembershipChangeCard = ({
  membershipApi,
  currentPeriod,
}: {
  membershipApi: ReturnType<typeof useMembership>;
  currentPeriod?: MembershipFinancialPeriod;
}) => {
  const [open, setOpen] = useState(false);
  const { ownMembership, ownChangeRequest } = membershipApi;
  if (!ownMembership || ownMembership.legalStatus !== 'current') return null;

  if (ownChangeRequest) {
    const waitingForReview = ownChangeRequest.status === 'needs_review';
    return (
      <div className={`rounded-2xl border p-5 ${waitingForReview ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-bold text-slate-950">Membership change</h3>
              <StatusPill value={ownChangeRequest.status} />
            </div>
            <p className="mt-2 text-sm text-slate-700">
              {ownChangeRequest.fromMembershipClassName} → {ownChangeRequest.toMembershipClassName}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {ownChangeRequest.requestedEffectiveTiming === 'immediate'
                ? 'Requested immediately'
                : `Scheduled for ${dateLabel(ownChangeRequest.effectiveOn)}`}
              {' · '}{ownChangeRequest.requestReason}
            </p>
            {waitingForReview && (
              <p className="mt-2 text-sm font-semibold text-red-800">
                An administrator must resolve a prepared invoice or payment before this change can be applied.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={membershipApi.busyAction === `membership-change:${ownChangeRequest.id}`}
            onClick={() => void membershipApi.cancelMembershipChange(ownChangeRequest.id)}
            className="self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel request
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-bold text-slate-950">Need a different membership?</h3>
          <p className="mt-1 text-sm text-slate-600">Request an immediate change or schedule it for your next renewal.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex self-start items-center gap-2 rounded-lg border border-blue-300 px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50"
        >
          <Repeat2 className="h-4 w-4" /> Change membership
        </button>
      </div>
      {open && (
        <MembershipChangeModal
          membership={ownMembership}
          classes={membershipApi.classes}
          currentFinancialYearEnd={currentPeriod?.financialYearEnd}
          financialYearStartMonth={membershipApi.settings.financialYearStartMonth}
          financialYearStartDay={membershipApi.settings.financialYearStartDay}
          busy={membershipApi.busyAction === 'membership-change:request'}
          onClose={() => setOpen(false)}
          onSubmit={async input => {
            await membershipApi.requestMembershipChange(input);
            setOpen(false);
          }}
        />
      )}
    </>
  );
};

const MyMembership = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const { ownApplication, ownMembership, ownPeriods, classes, busyAction, submitApplication, refreshOwnXeroInvoices } = membershipApi;
  const xeroLinked = financialProviders.xero.accountingAvailable && Boolean(ownMembership?.xeroLinked);
  const today = new Date().toISOString().slice(0, 10);
  const currentPeriod = ownPeriods.find(period =>
    period.financialYearStart <= today && period.financialYearEnd >= today
  ) || ownPeriods[0];
  const upcomingPeriod = ownPeriods.find(period => period.financialYearStart > today);
  if (!ownApplication && !ownMembership) {
    return <MembershipApplicationForm classes={classes.filter(item => item.code !== 'life' && item.isActive)} busy={busyAction === 'application:submit'} onSubmit={submitApplication} />;
  }

  return <div className="space-y-5">
    {ownMembership ? <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><UserCheck className="h-5 w-5 text-blue-700" /><StatusPill value={ownMembership.legalStatus} /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">BFC membership</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{ownMembership.membershipClassName}</p>
          <p className="mt-1 text-sm text-slate-600">Commenced {dateLabel(ownMembership.commencedAt)}</p>
          <p className={`mt-2 text-xs font-semibold ${ownMembership.canSelfBookAircraft ? 'text-emerald-700' : 'text-amber-700'}`}>{ownMembership.canSelfBookAircraft ? 'Includes aircraft self-booking when financially cleared' : 'Does not include aircraft self-booking'}</p>
        </div>
        {xeroLinked ? <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><CircleDollarSign className="h-5 w-5 text-blue-700" /><StatusPill value={currentPeriod?.feeDisposition} /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Financial clearance</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{currentPeriod ? moneyLabel(currentPeriod.amountDue) : 'Awaiting fee record'}</p>
          <p className="mt-1 text-sm text-slate-600">{currentPeriod ? `Due ${dateLabel(currentPeriod.dueDate)}` : 'Contact the club'}</p>
          {currentPeriod && currentPeriod.scholarshipContributionAmount > 0 && <p className="mt-2 text-xs text-violet-700">Includes {moneyLabel(currentPeriod.scholarshipContributionAmount)} scholarship contribution</p>}
        </div> : financialProviders.stripe.paymentsAvailable ? <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm text-blue-950">
          <div className="flex items-center justify-between"><CircleDollarSign className="h-5 w-5 text-blue-700" /><StatusPill value={currentPeriod?.feeDisposition} /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-blue-700">Membership payment</p>
          <p className="mt-1 text-lg font-extrabold">{currentPeriod ? membershipStatusLabel(currentPeriod.feeDisposition) : 'Awaiting fee record'}</p>
          <p className="mt-1 text-sm">Stripe payments remain available. Xero balances and invoices are hidden while Xero is disconnected.</p>
        </div> : <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm text-amber-950">
          <div className="flex items-center justify-between"><CircleDollarSign className="h-5 w-5 text-amber-700" /><AlertTriangle className="h-5 w-5 text-amber-700" /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-amber-700">Financial services</p>
          <p className="mt-1 text-lg font-extrabold">Payments unavailable</p>
          <p className="mt-1 text-sm">Stripe and Xero are disconnected, so financial information and payment controls are disabled.</p>
        </div>}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><Vote className="h-5 w-5 text-blue-700" />{ownMembership.hasVotingRights ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-slate-400" />}</div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Voting entitlement</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{ownMembership.hasVotingRights ? 'Voting member' : 'Non-voting member'}</p>
          <p className="mt-1 text-sm text-slate-600">Voting rights are determined by the membership product configured by the club.</p>
        </div>
      </div>
      {financialProviders.financeEnabled && <MembershipBillingStatus period={currentPeriod} />}
      {xeroLinked && upcomingPeriod && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950"><div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="font-bold">Next renewal prepared</h3><p className="mt-1 text-sm">{moneyLabel(upcomingPeriod.amountDue)} is due {dateLabel(upcomingPeriod.dueDate)}. This future invoice does not affect your current-year booking access.</p></div></div></div>}
      {financialProviders.financeEnabled && currentPeriod && !isFinanciallyCleared(currentPeriod.feeDisposition) && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="font-bold">Aircraft self-booking is unavailable</h3><p className="mt-1 text-sm">Your legal membership continues until {dateLabel(currentPeriod.graceExpiresAt)}, but the fee must be paid or waived before you can book an aircraft yourself.</p></div></div>
        {financialProviders.xero.accountingAvailable && currentPeriod.xeroInvoiceId && <button disabled={busyAction === 'xero:own'} onClick={() => void refreshOwnXeroInvoices()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-bold hover:bg-amber-100"><RefreshCw className={`h-4 w-4 ${busyAction === 'xero:own' ? 'animate-spin' : ''}`} /> Refresh Xero payment</button>}
      </div>}
      {ownMembership.canSelfBookAircraft === false && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="font-bold">Aircraft self-booking is not included</h3><p className="mt-1 text-sm">Your membership remains current, but this membership product requires an instructor or administrator to create aircraft bookings for you.</p></div></div></div>}
      {currentPeriod?.waiverReason && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><span className="font-bold">Fee waiver:</span> {currentPeriod.waiverReason}</div>}
      {financialProviders.financeEnabled && ownMembership.legalStatus === 'current' && <MembershipPaymentPreferencesCard membershipApi={membershipApi} />}
      <OwnMembershipChangeCard membershipApi={membershipApi} currentPeriod={currentPeriod} />
      <MembershipCancellation membershipApi={membershipApi} />
    </> : <>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-bold text-amber-950">Application pending</h2><p className="mt-1 text-sm text-amber-900">Submitted {dateLabel(ownApplication?.submittedAt)}. If the committee has not decided it earlier, membership is scheduled to commence on {dateLabel(ownApplication?.automaticCommencementAt)}.</p></div></div>
      </div>
      <MembershipPaymentPreferencesCard membershipApi={membershipApi} />
      <MembershipCancellation membershipApi={membershipApi} />
    </>}
  </div>;
};

const MembershipChangeRequestsAdmin = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const requests = membershipApi.changeRequests.filter(item => ['pending', 'needs_review'].includes(item.status));
  const [deciding, setDeciding] = useState<MembershipChangeRequest | null>(null);
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [reason, setReason] = useState('');

  if (requests.length === 0) return null;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-extrabold text-slate-950">Membership change requests</h2>
        <p className="mt-1 text-sm text-slate-600">Review class changes separately from new membership applications.</p>
      </div>
      {requests.map(request => (
        <article key={request.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${request.status === 'needs_review' ? 'border-red-300' : 'border-slate-200'}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-slate-950">
                  <StudentFileLink studentId={request.userId} name={request.userName || 'Member'} />
                </h3>
                <StatusPill value={request.status} />
              </div>
              <p className="mt-2 font-semibold text-slate-800">{request.fromMembershipClassName} → {request.toMembershipClassName}</p>
              <p className="mt-1 text-sm text-slate-600">
                {request.requestedEffectiveTiming === 'immediate' ? 'Requested immediately' : `Requested for ${dateLabel(request.effectiveOn)}`}
                {' · '}{request.requestReason}
              </p>
              {request.status === 'needs_review' && (
                <p className="mt-2 max-w-2xl text-sm font-semibold text-red-700">
                  {request.decisionReason || 'A prepared invoice or payment must be resolved before retrying.'}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setDeciding(request); setDecision('approve'); setReason('Approved membership change'); }}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4" /> {request.status === 'needs_review' ? 'Retry' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => { setDeciding(request); setDecision('reject'); setReason(''); }}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"
              >
                <XCircle className="h-4 w-4" /> Reject
              </button>
            </div>
          </div>
        </article>
      ))}
      {deciding && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-950">
              {decision === 'approve' ? 'Approve' : 'Reject'} membership change
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {deciding.userName}: {deciding.fromMembershipClassName} → {deciding.toMembershipClassName}
            </p>
            <label className="mt-4 block text-sm font-bold text-slate-700">
              Decision reason
              <textarea
                autoFocus
                rows={3}
                value={reason}
                onChange={event => setReason(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                placeholder="Minimum 5 characters"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDeciding(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button>
              <button
                type="button"
                disabled={reason.trim().length < 5 || membershipApi.busyAction === `membership-change:${deciding.id}`}
                onClick={async () => {
                  await membershipApi.decideMembershipChange(deciding.id, decision, reason);
                  setDeciding(null);
                }}
                className={`rounded-lg px-3 py-2 text-sm font-bold text-white disabled:opacity-50 ${decision === 'approve' ? 'bg-emerald-700' : 'bg-red-700'}`}
              >
                Confirm {decision}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const ApplicationsAdmin = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const pending = membershipApi.applications.filter(item => item.status === 'pending');
  const [approving, setApproving] = useState<MembershipApplication | null>(null);
  const [rejecting, setRejecting] = useState<MembershipApplication | null>(null);
  const [reason, setReason] = useState('');
  return <div className="space-y-4">
    {pending.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600"><BadgeCheck className="mx-auto mb-3 h-8 w-8 text-emerald-600" />No new membership applications are waiting for a decision.</div> : pending.map(application => {
      const daysLeft = Math.max(0, Math.ceil((new Date(application.automaticCommencementAt).getTime() - Date.now()) / 86400000));
      return <article key={application.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-slate-950"><StudentFileLink studentId={application.userId} name={application.userName || 'Applicant'} /></h3><StatusPill value={application.status} /></div><p className="mt-1 text-sm text-slate-600">{application.userEmail} · {application.membershipClassName}</p><p className="mt-3 text-sm text-slate-700">Submitted {dateLabel(application.submittedAt)} · automatic commencement in {daysLeft} day{daysLeft === 1 ? '' : 's'}</p><p className="mt-1 text-sm text-slate-600">{application.residentialAddress}</p></div>
          <div className="flex gap-2"><button disabled={membershipApi.busyAction === `application:${application.id}`} onClick={() => { setApproving(application); setReason(''); }} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800"><CheckCircle2 className="h-4 w-4" /> Approve</button><button onClick={() => { setRejecting(application); setReason(''); }} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"><XCircle className="h-4 w-4" /> Reject</button></div>
        </div>
      </article>;
    })}
    {approving && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-950">Approve <StudentFileLink studentId={approving.userId} name={approving.userName} />'s application</h3><p className="mt-1 text-sm text-slate-600">Membership commences immediately. Add the committee meeting or delegated-authority reference when one is available.</p><input autoFocus value={reason} onChange={event => setReason(event.target.value)} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="e.g. Committee minutes 28 July 2026 (optional)" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setApproving(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={membershipApi.busyAction === `application:${approving.id}`} onClick={async () => { await membershipApi.decideApplication(approving.id, 'approve', reason); setApproving(null); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Approve and commence</button></div></div></div>}
    {rejecting && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-950">Reject <StudentFileLink studentId={rejecting.userId} name={rejecting.userName} />'s application</h3><p className="mt-1 text-sm text-slate-600">The reason is retained in the audit history.</p><textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} rows={4} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Reason for rejection" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setRejecting(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={!reason.trim()} onClick={async () => { await membershipApi.decideApplication(rejecting.id, 'reject', reason); setRejecting(null); }} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Reject application</button></div></div></div>}
    <MembershipChangeRequestsAdmin membershipApi={membershipApi} />
  </div>;
};

const MembershipMetricCard = ({
  label,
  value,
  detail,
  icon: Icon,
  onClick,
  tone = 'blue',
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  tone?: 'blue' | 'emerald' | 'amber' | 'red';
}) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200',
    amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
    red: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-200',
  };
  const content = (
    <>
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
      <span className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <span className="mt-1 block text-2xl font-extrabold text-slate-950 dark:text-white">{value}</span>
      <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">{detail}</span>
    </>
  );
  const className = 'rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-700 dark:bg-slate-900';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500`}>{content}</button>
  ) : <div className={className}>{content}</div>;
};

const MembershipAdminDashboard = ({
  membershipApi,
  onOpenApplications,
  onOpenRegister,
}: {
  membershipApi: ReturnType<typeof useMembership>;
  onOpenApplications: () => void;
  onOpenRegister: (focus: MembershipRegisterFocus) => void;
}) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const today = localDateString();
  const summary = useMemo(() => buildMembershipDashboardSummary({
    memberships: membershipApi.memberships,
    applications: membershipApi.applications,
    changes: membershipApi.changeRequests,
    periods: membershipApi.periods,
    paymentPreferences: membershipApi.paymentPreferences,
    options: {
      today,
      financeEnabled: financialProviders.financeEnabled,
      xeroAccountingAvailable: financialProviders.xero.accountingAvailable,
      xeroRequiredForBilling: financialProviders.xero.accountingAvailable && !financialProviders.stripe.paymentsAvailable,
    },
  }), [financialProviders, membershipApi.applications, membershipApi.changeRequests, membershipApi.memberships, membershipApi.paymentPreferences, membershipApi.periods, today]);

  const clearancePercentage = summary.currentMembers
    ? Math.round((summary.financiallyCleared / summary.currentMembers) * 100)
    : 0;
  const warnings = [
    summary.graceExpiredAccounts > 0 ? {
      key: 'grace-expired',
      tone: 'red',
      title: `${summary.graceExpiredAccounts} membership${summary.graceExpiredAccounts === 1 ? '' : 's'} past the payment grace period`,
      detail: 'Review these records before the lifecycle process changes legal membership status.',
      action: () => onOpenRegister('outstanding'),
    } : null,
    summary.billingIssues > 0 ? {
      key: 'billing-issues',
      tone: 'red',
      title: `${summary.billingIssues} billing sync issue${summary.billingIssues === 1 ? '' : 's'} need review`,
      detail: 'A payment or accounting update failed or was marked for manual review.',
      action: () => onOpenRegister('billing_issue'),
    } : null,
    summary.applicationsOverdueForCommencement > 0 ? {
      key: 'applications-overdue',
      tone: 'red',
      title: `${summary.applicationsOverdueForCommencement} application${summary.applicationsOverdueForCommencement === 1 ? '' : 's'} reached automatic commencement`,
      detail: 'Approve, reject, or run membership checks to resolve the overdue decision.',
      action: onOpenApplications,
    } : null,
    summary.overdueAccounts > 0 ? {
      key: 'overdue',
      tone: 'amber',
      title: `${summary.overdueAccounts} overdue membership account${summary.overdueAccounts === 1 ? '' : 's'}`,
      detail: `${moneyLabel(summary.outstandingAmount)} remains outstanding across all uncleared current accounts.`,
      action: () => onOpenRegister('outstanding'),
    } : null,
    summary.financiallyOutstanding > 0 && summary.overdueAccounts === 0 ? {
      key: 'not-cleared',
      tone: 'blue',
      title: `${summary.financiallyOutstanding} current member${summary.financiallyOutstanding === 1 ? ' is' : 's are'} not financially cleared`,
      detail: `${moneyLabel(summary.outstandingAmount)} is awaiting payment or financial clearance.`,
      action: () => onOpenRegister('outstanding'),
    } : null,
    summary.failedPaymentAuthorities > 0 ? {
      key: 'payment-authorities',
      tone: 'amber',
      title: `${summary.failedPaymentAuthorities} failed payment authorit${summary.failedPaymentAuthorities === 1 ? 'y' : 'ies'}`,
      detail: 'The member may need to update their saved payment method before renewal can be collected.',
      action: () => onOpenRegister('attention'),
    } : null,
    summary.missingCurrentPeriods > 0 ? {
      key: 'missing-periods',
      tone: 'amber',
      title: `${summary.missingCurrentPeriods} current member${summary.missingCurrentPeriods === 1 ? '' : 's'} without a current fee period`,
      detail: 'Their financial clearance cannot be confirmed until the period is created.',
      action: () => onOpenRegister('attention'),
    } : null,
    summary.agedOutJuniorMembers > 0 ? {
      key: 'aged-out-juniors',
      tone: 'amber',
      title: `${summary.agedOutJuniorMembers} Junior membership${summary.agedOutJuniorMembers === 1 ? '' : 's'} no longer age eligible`,
      detail: 'Change the membership class and record the effective date.',
      action: () => onOpenRegister('aged_out'),
    } : null,
    summary.duplicateCurrentMembers > 0 ? {
      key: 'duplicates',
      tone: 'amber',
      title: `${summary.duplicateCurrentMembers} member${summary.duplicateCurrentMembers === 1 ? ' has' : 's have'} duplicate current records`,
      detail: 'Resolve the duplicate legal status before relying on exports or billing.',
      action: () => onOpenRegister('attention'),
    } : null,
    summary.archivedCurrentProfiles > 0 ? {
      key: 'archived-profiles',
      tone: 'amber',
      title: `${summary.archivedCurrentProfiles} current membership${summary.archivedCurrentProfiles === 1 ? '' : 's'} linked to an archived profile`,
      detail: 'Confirm whether the profile should be restored or the membership should be ceased.',
      action: () => onOpenRegister('attention'),
    } : null,
    financialProviders.xero.accountingAvailable && !financialProviders.stripe.paymentsAvailable && summary.xeroUnlinkedMembers > 0 ? {
      key: 'xero-unlinked',
      tone: 'amber',
      title: `${summary.xeroUnlinkedMembers} current member${summary.xeroUnlinkedMembers === 1 ? '' : 's'} not linked to Xero`,
      detail: 'Xero is the available billing route, so these memberships cannot be billed until their contacts are linked.',
      action: () => onOpenRegister('attention'),
    } : null,
    summary.changesNeedingReview > 0 ? {
      key: 'changes-review',
      tone: 'amber',
      title: `${summary.changesNeedingReview} membership change${summary.changesNeedingReview === 1 ? '' : 's'} need manual review`,
      detail: 'The requested class change could not be applied automatically.',
      action: onOpenApplications,
    } : null,
    summary.pendingApplications > 0 && summary.applicationsOverdueForCommencement === 0 ? {
      key: 'applications-due',
      tone: 'blue',
      title: `${summary.pendingApplications} membership application${summary.pendingApplications === 1 ? '' : 's'} awaiting a decision`,
      detail: summary.applicationsCommencingWithinSevenDays
        ? `${summary.applicationsCommencingWithinSevenDays} will commence automatically within 7 days.`
        : 'Review applications before their automatic commencement date.',
      action: onOpenApplications,
    } : null,
    summary.pendingChanges > 0 ? {
      key: 'changes-pending',
      tone: 'blue',
      title: `${summary.pendingChanges} membership change${summary.pendingChanges === 1 ? '' : 's'} awaiting a decision`,
      detail: 'Review the requested class and effective date.',
      action: onOpenApplications,
    } : null,
    summary.graceExpiringWithinFourteenDays > 0 ? {
      key: 'grace-due',
      tone: 'blue',
      title: `${summary.graceExpiringWithinFourteenDays} payment grace period${summary.graceExpiringWithinFourteenDays === 1 ? '' : 's'} expire within 14 days`,
      detail: 'Follow up outstanding accounts before their grace period ends.',
      action: () => onOpenRegister('outstanding'),
    } : null,
  ].filter(Boolean) as Array<{ key: string; tone: 'red' | 'amber' | 'blue'; title: string; detail: string; action: () => void }>;

  const recentActivity = useMemo(() => [
    ...membershipApi.memberships.map(item => ({ id: `membership-${item.id}`, date: item.commencedAt, title: `${item.userName || 'Member'} commenced ${item.membershipClassName || 'membership'}`, type: 'Membership' })),
    ...membershipApi.applications.map(item => ({ id: `application-${item.id}`, date: item.submittedAt, title: `${item.userName || 'Applicant'} submitted ${item.membershipClassName || 'a membership application'}`, type: 'Application' })),
    ...membershipApi.changeRequests.map(item => ({ id: `change-${item.id}`, date: item.submittedAt, title: `${item.userName || 'Member'} requested ${item.toMembershipClassName || 'a membership change'}`, type: 'Change' })),
  ].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5), [membershipApi.applications, membershipApi.changeRequests, membershipApi.memberships]);

  return <div className="space-y-5">
    <section className="flex flex-col gap-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm dark:border-blue-800 dark:from-blue-950/60 dark:to-slate-900 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-blue-700 dark:text-blue-300" /><h2 className="text-lg font-extrabold text-slate-950 dark:text-white">Membership health</h2></div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">A live operational view of legal memberships, approvals, eligibility and financial readiness.</p>
        <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">As at {dateLabel(today)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={membershipApi.busyAction === 'lifecycle'} onClick={() => void membershipApi.runLifecycle()} title="Process automatic commencements and membership payment-status rules now. No emails are sent." className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-blue-950/60"><CalendarClock className="h-4 w-4" />{membershipApi.busyAction === 'lifecycle' ? 'Processing…' : 'Run membership checks'}</button>
        <button type="button" onClick={() => void membershipApi.refetch()} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800"><RefreshCw className="h-4 w-4" />Refresh</button>
      </div>
    </section>

    <section aria-label="Membership headline statistics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MembershipMetricCard label="Current legal members" value={summary.currentMembers} detail={`${summary.votingMembers} voting · ${summary.newMembersLast30Days} new in 30 days`} icon={Users} onClick={() => onOpenRegister('current')} />
      <MembershipMetricCard label="Financially cleared" value={financialProviders.financeEnabled ? `${summary.financiallyCleared} / ${summary.currentMembers}` : 'Not tracked'} detail={financialProviders.financeEnabled ? `${clearancePercentage}% of current members` : 'Connect Stripe or Xero to track clearance'} icon={CircleDollarSign} tone={financialProviders.financeEnabled && summary.financiallyOutstanding > 0 ? 'amber' : 'emerald'} onClick={() => onOpenRegister(financialProviders.financeEnabled ? 'outstanding' : 'current')} />
      <MembershipMetricCard label="Pending applications" value={summary.pendingApplications} detail={`${summary.pendingChanges + summary.changesNeedingReview} membership changes in progress`} icon={FileCheck2} tone={summary.pendingApplications ? 'amber' : 'emerald'} onClick={onOpenApplications} />
      <MembershipMetricCard label="Members requiring attention" value={summary.membersRequiringAttention} detail={`${summary.totalActionItems} total member and workflow actions`} icon={AlertTriangle} tone={summary.totalActionItems ? 'red' : 'emerald'} onClick={() => onOpenRegister('attention')} />
    </section>

    {!financialProviders.financeEnabled && <FinancialProviderStatus compact />}

    <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4"><div><h2 className="font-extrabold text-slate-950 dark:text-white">Action queue</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Important membership issues, ordered by urgency.</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{warnings.length}</span></div>
        {warnings.length === 0 ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/50"><div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6 text-emerald-700 dark:text-emerald-300" /><div><p className="font-bold text-emerald-900 dark:text-emerald-100">No membership warnings</p><p className="text-sm text-emerald-800 dark:text-emerald-200">Applications, eligibility and current membership records are up to date.</p></div></div></div> : <div className="mt-4 space-y-2">{warnings.map(warning => {
          const tone = warning.tone === 'red' ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40' : warning.tone === 'amber' ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40' : 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40';
          const iconTone = warning.tone === 'red' ? 'text-red-700 dark:text-red-300' : warning.tone === 'amber' ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300';
          return <button key={warning.key} type="button" onClick={warning.action} className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-blue-500 ${tone}`}><AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${iconTone}`} /><span className="min-w-0 flex-1"><span className="block font-bold text-slate-950 dark:text-white">{warning.title}</span><span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-300">{warning.detail}</span></span><ArrowRight className={`mt-1 h-4 w-4 shrink-0 ${iconTone}`} /></button>;
        })}</div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="font-extrabold text-slate-950 dark:text-white">Membership mix</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Current legal members by class.</p>
        <div className="mt-5 space-y-4">{summary.classBreakdown.length ? summary.classBreakdown.map(item => <div key={`${item.code}-${item.name}`}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</span><span className="font-bold text-slate-950 dark:text-white">{item.count} <span className="font-normal text-slate-500 dark:text-slate-400">({item.percentage}%)</span></span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-blue-600" style={{ width: `${item.percentage}%` }} /></div></div>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">No current memberships are recorded.</p>}</div>
        <button type="button" onClick={() => onOpenRegister('current')} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100">View membership register <ArrowRight className="h-4 w-4" /></button>
      </section>
    </div>

    <div className="grid gap-5 lg:grid-cols-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="font-extrabold text-slate-950 dark:text-white">Financial overview</h2>
        {financialProviders.financeEnabled ? <dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Outstanding balance</dt><dd className="font-bold text-slate-950 dark:text-white">{moneyLabel(summary.outstandingAmount)}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Uncleared members</dt><dd className="font-bold text-slate-950 dark:text-white">{summary.financiallyOutstanding}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Overdue</dt><dd className="font-bold text-amber-700 dark:text-amber-300">{summary.overdueAccounts}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Auto-renew enabled</dt><dd className="font-bold text-slate-950 dark:text-white">{summary.autoRenewEnabled}</dd></div></dl> : <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Membership finance is disabled, so no payment status or balance is inferred.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="font-extrabold text-slate-950 dark:text-white">Systems readiness</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Stripe payments</dt><dd className={`font-bold ${financialProviders.stripe.paymentsAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>{financialProviders.stripe.paymentsAvailable ? 'Available' : 'Unavailable'}</dd></div><div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Xero accounting</dt><dd className={`font-bold ${financialProviders.xero.accountingAvailable ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>{financialProviders.xero.accountingAvailable ? 'Connected' : 'Not connected'}</dd></div>{financialProviders.xero.accountingAvailable && <div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Members linked to Xero</dt><dd className="font-bold text-slate-950 dark:text-white">{summary.xeroLinkedMembers} / {summary.currentMembers}</dd></div>}<div className="flex justify-between gap-3"><dt className="text-slate-600 dark:text-slate-300">Lifecycle mode</dt><dd className="font-bold text-slate-950 dark:text-white">{membershipStatusLabel(membershipApi.settings.rolloutMode)}</dd></div></dl>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="font-extrabold text-slate-950 dark:text-white">Recent activity</h2><div className="mt-4 space-y-3">{recentActivity.length ? recentActivity.map(item => <div key={item.id} className="border-l-2 border-blue-200 pl-3 dark:border-blue-800"><p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.title}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.type} · {dateLabel(item.date)}</p></div>) : <p className="text-sm text-slate-600 dark:text-slate-300">No membership activity is recorded yet.</p>}</div>
      </section>
    </div>
  </div>;
};

const JuniorEligibilityBadge = ({ membership }: { membership: ReturnType<typeof useMembership>['memberships'][number] }) => {
  if (membership.membershipClassCode !== 'junior') return null;
  const eligibility = membershipClassEligibility('junior', membership.dateOfBirth, localDateString());
  if (eligibility.eligible) return null;
  return (
    <span className="mt-1 inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700" title={eligibility.reason || undefined}>
      Must change — aged out
    </span>
  );
};

const RegisterAdmin = ({
  membershipApi,
  initialFocus = 'current',
}: {
  membershipApi: ReturnType<typeof useMembership>;
  initialFocus?: MembershipRegisterFocus;
}) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const { users } = useUsers();
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<MembershipRegisterFocus>(initialFocus);
  const [waiverPeriod, setWaiverPeriod] =
    useState<MembershipFinancialPeriod | null>(null);
  const [waiverType, setWaiverType] = useState(
    membershipApi.settings.waiverTypes[0] || "",
  );
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverAuthorityReference, setWaiverAuthorityReference] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [changingMembership, setChangingMembership] = useState<ReturnType<typeof useMembership>['memberships'][number] | null>(null);
  const [managingMembership, setManagingMembership] = useState<ReturnType<typeof useMembership>['memberships'][number] | null>(null);
  const [auditingMembership, setAuditingMembership] = useState<ReturnType<typeof useMembership>['memberships'][number] | null>(null);
  const [importForm, setImportForm] = useState({
    userId: "",
    membershipClassCode: "full",
    commencedAt: new Date().toISOString().slice(0, 10),
    feeDisposition: "paid" as "paid" | "invoice_required" | "waived",
    reason: "",
  });
  const today = localDateString();
  const periodByMembership = useMemo(
    () => currentMembershipPeriodMap(membershipApi.periods, today),
    [membershipApi.periods, today],
  );
  const dashboardSummary = useMemo(() => buildMembershipDashboardSummary({
    memberships: membershipApi.memberships,
    applications: membershipApi.applications,
    changes: membershipApi.changeRequests,
    periods: membershipApi.periods,
    paymentPreferences: membershipApi.paymentPreferences,
    options: {
      today,
      financeEnabled: financialProviders.financeEnabled,
      xeroAccountingAvailable: financialProviders.xero.accountingAvailable,
      xeroRequiredForBilling: financialProviders.xero.accountingAvailable && !financialProviders.stripe.paymentsAvailable,
    },
  }), [financialProviders, membershipApi.applications, membershipApi.changeRequests, membershipApi.memberships, membershipApi.paymentPreferences, membershipApi.periods, today]);
  const filtered = membershipApi.memberships.filter((item) =>
    membershipMatchesDashboardFocus(item, focus, dashboardSummary)
    && `${item.userName} ${item.userEmail} ${item.membershipClassName}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selectedImportUser = users.find(item => item.id === importForm.userId);
  const selectedImportClass = membershipApi.classes.find(item => item.code === importForm.membershipClassCode);
  const importRequiresFinancialStatus = membershipClassRequiresFinancialStatus(selectedImportClass);
  const importJuniorEligible = membershipClassEligibility(
    'junior',
    selectedImportUser?.dateOfBirth,
    localDateString(),
  ).eligible;
  React.useEffect(() => {
    if (importForm.membershipClassCode !== 'junior' || importJuniorEligible) return;
    setImportForm(current => ({ ...current, membershipClassCode: 'full' }));
  }, [importForm.membershipClassCode, importJuniorEligible]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid w-full gap-2 sm:max-w-2xl sm:grid-cols-[minmax(0,1fr)_220px]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search membership records"
            aria-label="Search membership records"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
          />
          <SearchableSelect value={focus} onChange={event => setFocus(event.target.value as MembershipRegisterFocus)} aria-label="Filter membership register" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
            <option value="all">All membership records</option>
            <option value="current">Current members</option>
            <option value="attention">Requires attention</option>
            <option value="outstanding">Financially outstanding</option>
            <option value="billing_issue">Billing sync issues</option>
            <option value="aged_out">Aged-out Junior members</option>
            <option value="ceased">Ceased memberships</option>
          </SearchableSelect>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={membershipApi.busyAction === "register:export"}
            onClick={() => void membershipApi.exportStatutoryRegister()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export register
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-800"
          >
            <UserCheck className="h-4 w-4" /> Add existing member
          </button>
          <button
            onClick={() => setShowCsvImport(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-100"
          >
            <FileSpreadsheet className="h-4 w-4" /> Import existing members CSV
          </button>
          {financialProviders.xero.postingAvailable && (
            <>
              <button
                disabled={membershipApi.busyAction === "xero:issue-renewals"}
                onClick={() => {
                  if (
                    window.confirm(
                      "Prepare renewals and queue the next batch of up to 100 due invoices or authorised automatic collections?",
                    )
                  )
                    void membershipApi.issueMembershipRenewals();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 px-3 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
              >
                <CircleDollarSign className="h-4 w-4" /> Prepare renewals
              </button>
              <button
                disabled={membershipApi.busyAction === "xero:all"}
                onClick={() => void membershipApi.refreshAllXeroInvoices()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 px-3 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${membershipApi.busyAction === "xero:all" ? "animate-spin" : ""}`}
                />{" "}
                Refresh Xero payments
              </button>
            </>
          )}
        </div>
      </div>
      {!financialProviders.financeEnabled && (
        <FinancialProviderStatus compact />
      )}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="mobile-card-table min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Class</th>
              <th className="px-4 py-3">Legal status</th>
              <th className="px-4 py-3">Fee status</th>
              <th className="px-4 py-3">Invoice / due</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((membership) => {
              const period = periodByMembership.get(membership.id);
              if (!financialProviders.financeEnabled) {
                return (
                  <tr key={membership.id}>
                    <td data-label="Member" className="px-4 py-3">
                      <p className="font-bold text-slate-900">
                        <StudentFileLink
                          studentId={membership.userId}
                          name={membership.userName}
                        />
                      </p>
                      <p className="text-xs text-slate-500">
                        {membership.userEmail}
                      </p>
                    </td>
                    <td data-label="Class" className="px-4 py-3">
                      <p>{membership.membershipClassName}</p>
                      {membership.hasVotingRights && (
                        <p className="text-xs font-semibold text-blue-700">
                          Voting
                        </p>
                      )}
                      <JuniorEligibilityBadge membership={membership} />
                    </td>
                    <td data-label="Legal status" className="px-4 py-3">
                      <StatusPill value={membership.legalStatus} />
                    </td>
                    <td data-label="Fee status" className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                        Financial features disabled
                      </span>
                    </td>
                    <td data-label="Invoice / due" className="px-4 py-3 text-xs text-slate-500">
                      Stripe and Xero disconnected
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => setAuditingMembership(membership)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                          <History className="h-3.5 w-3.5" /> History
                        </button>
                        <button type="button" onClick={() => setManagingMembership(membership)} className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-50">
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }
              const xeroSetupRequired =
                financialProviders.xero.accountingAvailable &&
                !membership.xeroLinked &&
                !financialProviders.stripe.paymentsAvailable;
              if (xeroSetupRequired) {
                return (
                  <tr key={membership.id}>
                    <td data-label="Member" className="px-4 py-3">
                      <p className="font-bold text-slate-900">
                        <StudentFileLink
                          studentId={membership.userId}
                          name={membership.userName}
                        />
                      </p>
                      <p className="text-xs text-slate-500">
                        {membership.userEmail}
                      </p>
                    </td>
                    <td data-label="Class" className="px-4 py-3">
                      <p>{membership.membershipClassName}</p>
                      {membership.hasVotingRights && (
                        <p className="text-xs font-semibold text-blue-700">
                          Voting
                        </p>
                      )}
                      <JuniorEligibilityBadge membership={membership} />
                    </td>
                    <td data-label="Legal status" className="px-4 py-3">
                      <StatusPill value={membership.legalStatus} />
                    </td>
                    <td data-label="Fee status" className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                        Xero setup required
                      </span>
                    </td>
                    <td data-label="Invoice / due" className="px-4 py-3 text-xs text-slate-500">
                      Financial information hidden
                    </td>
                    <td data-label="Actions" className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => setAuditingMembership(membership)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                            <History className="h-3.5 w-3.5" /> History
                          </button>
                          <button type="button" onClick={() => setManagingMembership(membership)} className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-50">
                            Manage
                          </button>
                        </div>
                        <span className="text-xs text-slate-500">Link in Xero settings for billing</span>
                      </div>
                    </td>
                  </tr>
                );
              }
              const canUseXero =
                financialProviders.xero.postingAvailable &&
                membership.xeroLinked;
              const canUseStripe = financialProviders.stripe.paymentsAvailable;
              return (
                <tr key={membership.id}>
                  <td data-label="Member" className="px-4 py-3">
                    <p className="font-bold text-slate-900">
                      <StudentFileLink
                        studentId={membership.userId}
                        name={membership.userName}
                      />
                    </p>
                    <p className="text-xs text-slate-500">
                      {membership.userEmail}
                    </p>
                  </td>
                  <td data-label="Class" className="px-4 py-3">
                    <p>{membership.membershipClassName}</p>
                    {membership.hasVotingRights && (
                      <p className="text-xs font-semibold text-blue-700">
                        Voting
                      </p>
                    )}
                    <JuniorEligibilityBadge membership={membership} />
                  </td>
                  <td data-label="Legal status" className="px-4 py-3">
                    <StatusPill value={membership.legalStatus} />
                  </td>
                  <td data-label="Fee status" className="px-4 py-3">
                    <StatusPill value={period?.feeDisposition} />
                    {financialProviders.xero.accountingAvailable &&
                      !membership.xeroLinked &&
                      financialProviders.stripe.paymentsAvailable && (
                        <p className="mt-1 text-xs font-semibold text-amber-700">
                          Xero contact not linked; Stripe remains available
                        </p>
                      )}
                    {period?.billingSyncStatus &&
                      period.billingSyncStatus !== "succeeded" && (
                        <p
                          className={`mt-1 text-xs font-semibold ${["failed", "needs_review"].includes(period.billingSyncStatus) ? "text-red-700" : "text-amber-700"}`}
                        >
                          Billing:{" "}
                          {membershipStatusLabel(period.billingSyncStatus)}
                          {period.billingSyncAttempts
                            ? ` · attempt ${period.billingSyncAttempts}`
                            : ""}
                        </p>
                      )}
                    {period?.billingSyncError && (
                      <p className="mt-1 max-w-xs text-xs text-red-700">
                        {period.billingSyncError}
                      </p>
                    )}
                    {period?.waiverReason && (
                      <p className="mt-1 max-w-xs text-xs text-slate-500">
                        {period.waiverType ? `${period.waiverType}: ` : ""}
                        {period.waiverReason}
                      </p>
                    )}
                  </td>
                  <td data-label="Invoice / due" className="px-4 py-3">
                    <p>
                      {period?.xeroInvoiceNumber ||
                        (period ? moneyLabel(period.amountDue) : "No period")}
                    </p>
                    <p className="text-xs text-slate-500">
                      {period ? `Due ${dateLabel(period.dueDate)}` : ""}
                    </p>
                    {period?.billingSyncNextAttemptAt && (
                      <p className="mt-1 text-xs text-amber-700">
                        Retry {dateLabel(period.billingSyncNextAttemptAt)}
                      </p>
                    )}
                  </td>
                  <td data-label="Actions" className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAuditingMembership(membership)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <History className="h-3.5 w-3.5" /> History
                      </button>
                      <button
                        type="button"
                        onClick={() => setManagingMembership(membership)}
                        className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-50"
                      >
                        Manage
                      </button>
                      {period &&
                        canUseXero &&
                        !["waived", "fee_exempt"].includes(
                          period.feeDisposition,
                        ) && (
                          <button
                            disabled={
                              membershipApi.busyAction === `xero:${period.id}`
                            }
                            onClick={() =>
                              void membershipApi.createOrRefreshXeroInvoice(
                                period.id,
                              )
                            }
                            className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-50"
                          >
                            {["failed", "needs_review"].includes(
                              period.billingSyncStatus || "",
                            )
                              ? "Retry Xero billing"
                              : period.xeroInvoiceId
                                ? "Refresh"
                                : "Issue invoice"}
                          </button>
                        )}
                      {period &&
                        canUseStripe &&
                        !isFinanciallyCleared(period.feeDisposition) && (
                          <button
                            disabled={
                              membershipApi.busyAction ===
                              `stripe:membership:${membership.userId}`
                            }
                            onClick={() =>
                              void membershipApi.collectApprovedMembership(
                                membership.userId,
                              )
                            }
                            className="rounded-lg border border-violet-300 px-2.5 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"
                          >
                            Collect with Stripe
                          </button>
                        )}
                      {period &&
                        !isFinanciallyCleared(period.feeDisposition) && (
                          <button
                            onClick={() => {
                              setWaiverPeriod(period);
                              setWaiverType(
                                membershipApi.settings.waiverTypes[0] || "",
                              );
                              setWaiverReason("");
                              setWaiverAuthorityReference("");
                            }}
                            className="rounded-lg border border-emerald-300 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                          >
                            Waive fee
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No membership records match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      {auditingMembership && (
        <MembershipAuditTrailModal
          membership={auditingMembership}
          applications={membershipApi.applications}
          changes={membershipApi.changeRequests}
          periods={membershipApi.periods}
          onClose={() => setAuditingMembership(null)}
        />
      )}
      {managingMembership && (
        <MembershipAdminControlModal
          membership={managingMembership}
          period={periodByMembership.get(managingMembership.id)}
          classes={membershipApi.classes}
          financeEnabled={financialProviders.financeEnabled}
          busy={membershipApi.busyAction === `membership-status:${managingMembership.id}`}
          onClose={() => setManagingMembership(null)}
          onChangeClass={() => {
            setManagingMembership(null);
            setChangingMembership(managingMembership);
          }}
          onUpdateStatus={async input => {
            await membershipApi.updateMembershipStatus({
              membershipId: managingMembership.id,
              ...input,
            });
            setManagingMembership(null);
          }}
        />
      )}
      {changingMembership && (
        <MembershipChangeModal
          membership={changingMembership}
          classes={membershipApi.classes}
          currentFinancialYearEnd={periodByMembership.get(changingMembership.id)?.financialYearEnd}
          financialYearStartMonth={membershipApi.settings.financialYearStartMonth}
          financialYearStartDay={membershipApi.settings.financialYearStartDay}
          adminMode
          busy={membershipApi.busyAction === `membership-change:${changingMembership.id}`}
          onClose={() => setChangingMembership(null)}
          onSubmit={async input => {
            await membershipApi.changeMembership({ membershipId: changingMembership.id, ...input });
            setChangingMembership(null);
          }}
        />
      )}
      {waiverPeriod && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-950">
              Authorise a membership fee waiver
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              The waiver applies only to this financial year and does not create
              a fake Xero payment.
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Waiver type
              <SearchableSelect
                value={waiverType}
                onChange={(event) => setWaiverType(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
              >
                {membershipApi.settings.waiverTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </SearchableSelect>
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-700">
              Reason
              <textarea
                rows={3}
                value={waiverReason}
                onChange={(event) => setWaiverReason(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                placeholder="Why this annual fee is being waived (minimum 10 characters)"
              />
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-700">
              Authority reference
              {!membershipApi.settings.requireWaiverAuthorityReference && (
                <span className="font-normal"> (optional)</span>
              )}
              <input
                value={waiverAuthorityReference}
                onChange={(event) =>
                  setWaiverAuthorityReference(event.target.value)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                placeholder="e.g. Committee minutes 28 July 2026"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setWaiverPeriod(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={
                  !waiverType ||
                  waiverReason.trim().length < 10 ||
                  (membershipApi.settings.requireWaiverAuthorityReference &&
                    waiverAuthorityReference.trim().length < 3)
                }
                onClick={async () => {
                  await membershipApi.authorizeFeeWaiver(
                    waiverPeriod.id,
                    waiverType,
                    waiverReason,
                    waiverAuthorityReference,
                  );
                  setWaiverPeriod(null);
                }}
                className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Authorise waiver
              </button>
            </div>
          </div>
        </div>
      )}
      {showImport && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-950">
              Add an existing club member
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Use this to establish the opening register without asking an
              existing member to reapply.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                Portal user
                <SearchableSelect
                  value={importForm.userId}
                  onChange={(event) =>
                    setImportForm((current) => ({
                      ...current,
                      userId: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                >
                  <option value="">Select a person</option>
                  {users
                    .filter(
                      (item) =>
                        !membershipApi.memberships.some(
                          (membership) => membership.userId === item.id,
                        ),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {item.email}
                      </option>
                    ))}
                </SearchableSelect>
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Membership class
                <SearchableSelect
                  value={importForm.membershipClassCode}
                  onChange={(event) => {
                    const membershipClassCode = event.target.value;
                    const selectedClass = membershipApi.classes.find(item => item.code === membershipClassCode);
                    setImportForm((current) => ({
                      ...current,
                      membershipClassCode,
                      reason: membershipClassRequiresFinancialStatus(selectedClass) ? current.reason : '',
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                >
                  {membershipApi.classes
                    .filter(item => item.code !== 'junior' || importJuniorEligible)
                    .map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </SearchableSelect>
                {!importJuniorEligible && <span className="mt-1 block text-xs font-normal text-slate-500">Junior is available only for a selected member who is under 18.</span>}
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Original commencement
                <input
                  type="date"
                  value={importForm.commencedAt}
                  onChange={(event) =>
                    setImportForm((current) => ({
                      ...current,
                      commencedAt: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                />
              </label>
              {importRequiresFinancialStatus ? (
                <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                  Current financial status
                  <SearchableSelect
                    value={importForm.feeDisposition}
                    onChange={(event) =>
                      setImportForm((current) => ({
                        ...current,
                        feeDisposition: event.target
                          .value as typeof importForm.feeDisposition,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"
                  >
                    <option value="paid">Already paid</option>
                    <option value="invoice_required">Invoice required</option>
                    <option value="waived">Fee waived</option>
                  </SearchableSelect>
                </label>
              ) : (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 sm:col-span-2">
                  {selectedImportClass?.name || 'This membership'} is fee-exempt. No financial status is required.
                </p>
              )}
              {importRequiresFinancialStatus && importForm.feeDisposition === "waived" && (
                <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                  Waiver reason
                  <textarea
                    rows={3}
                    value={importForm.reason}
                    onChange={(event) =>
                      setImportForm((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                  />
                </label>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowImport(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={
                  !importForm.userId ||
                  membershipApi.busyAction === "membership:import" ||
                  (importRequiresFinancialStatus && importForm.feeDisposition === "waived" &&
                    importForm.reason.trim().length < 10)
                }
                onClick={async () => {
                  await membershipApi.importLegacyMembership({
                    ...importForm,
                    feeDisposition: importRequiresFinancialStatus ? importForm.feeDisposition : 'paid',
                    reason: importRequiresFinancialStatus ? importForm.reason : undefined,
                  });
                  setShowImport(false);
                }}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Add to register
              </button>
            </div>
          </div>
        </div>
      )}
      {showCsvImport && (
        <ExistingMemberCsvImportModal
          users={users}
          membershipClasses={membershipApi.classes}
          memberships={membershipApi.memberships}
          busy={membershipApi.busyAction === 'membership:csv-import'}
          onClose={() => setShowCsvImport(false)}
          onImport={membershipApi.importLegacyMembershipCsv}
        />
      )}
    </div>
  );
};

const MembershipSettingsPanel = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { capabilities: financialProviders } = useFinancialProviders();
  const [draft, setDraft] = useState(membershipApi.settings);
  const [classDrafts, setClassDrafts] = useState<MembershipClass[]>(membershipApi.classes);
  const [xeroAccounts, setXeroAccounts] = useState<Array<{ code: string; name: string; type?: string }>>([]);
  const [xeroAccountsLoading, setXeroAccountsLoading] = useState(true);
  const [activeHelp, setActiveHelp] = useState<MembershipSettingHelpKey | null>(null);
  const helpTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const openHelp = React.useCallback<MembershipSettingHelpHandler>((setting, trigger) => {
    setActiveHelp(current => {
      if (current === setting) return null;
      helpTriggerRef.current = trigger || null;
      return setting;
    });
  }, []);
  const closeHelp = React.useCallback(() => {
    setActiveHelp(null);
    window.requestAnimationFrame(() => helpTriggerRef.current?.focus());
  }, []);
  React.useEffect(() => {
    setDraft(membershipApi.settings);
    setClassDrafts(membershipApi.classes);
  }, [membershipApi.classes, membershipApi.settings]);
  React.useEffect(() => {
    let cancelled = false;
    const loadXeroAccounts = async () => {
      if (!financialProviders.xero.accountingAvailable) {
        setXeroAccounts([]);
        setXeroAccountsLoading(false);
        return;
      }
      setXeroAccountsLoading(true);
      const { data, error } = await supabase.functions.invoke<{
        accounts?: Array<{ code: string; name: string; type?: string; status?: string }>;
      }>('xero-sync', { body: { action: 'list-accounts' } });
      if (!cancelled) {
        if (error) {
          console.warn('Xero account choices are unavailable; manual entry remains enabled:', error);
          setXeroAccounts([]);
        } else {
          setXeroAccounts((data?.accounts || []).filter(account => account.status === 'ACTIVE' && account.code));
        }
        setXeroAccountsLoading(false);
      }
    };
    void loadXeroAccounts();
    return () => { cancelled = true; };
  }, [financialProviders.xero.accountingAvailable]);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal';
  const updateClass = (id: string, updates: Partial<MembershipClass>) => {
    setClassDrafts(current => current.map(item => item.id === id ? { ...item, ...updates } : item));
  };
  const addClass = () => {
    setClassDrafts(current => [...current, {
      id: `new-${crypto.randomUUID()}`,
      code: '',
      name: 'New membership',
      description: '',
      annualFee: 0,
      hasVotingRights: false,
      canSelfBookAircraft: true,
      isFeeExempt: false,
      isActive: true,
      sortOrder: current.length + 1,
      xeroItemCode: null,
      xeroAccountCode: null,
    }]);
  };
  const normalisedCodes = classDrafts.map(item => item.code.trim().toLowerCase());
  const duplicateCodes = new Set(normalisedCodes.filter((code, index) => code && normalisedCodes.indexOf(code) !== index));
  const invalidMembershipProducts = !membershipProductsAreValid(classDrafts);
  const invalidScholarshipSettings = !scholarshipSettingsAreValid({
    defaultAmount: draft.scholarshipDefaultAmount,
    minimumAmount: draft.scholarshipMinimumAmount,
  });
  const saveDisabled = membershipApi.busyAction === 'settings'
    || draft.waiverTypes.length === 0
    || classDrafts.length === 0
    || invalidMembershipProducts
    || invalidScholarshipSettings;
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="space-y-5">
      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><h2 className="text-lg font-bold text-slate-950">Membership products and permissions</h2><p className="mt-1 text-sm text-slate-600">Create membership options and control their GST-inclusive fee, member permissions and Xero revenue mapping. Fee changes apply to newly created financial periods; existing product codes stay fixed so historical records remain reliable.</p></div>
          <button type="button" onClick={addClass} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-800"><Plus className="h-4 w-4" /> Add membership</button>
        </div>
        <div className="space-y-4">
          {classDrafts.map((membershipClass, index) => {
            const isExisting = membershipApi.classes.some(item => item.id === membershipClass.id);
            const code = membershipClass.code.trim().toLowerCase();
            const codeInvalid = !membershipProductCodeIsValid(code) || duplicateCodes.has(code);
            return <article key={membershipClass.id} className={`rounded-xl border p-4 ${membershipClass.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50 opacity-80'}`}>
              <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{isExisting ? 'Existing membership product' : 'New membership product'}</p>{!isExisting && <button type="button" onClick={() => setClassDrafts(current => current.filter(item => item.id !== membershipClass.id))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Remove</button>}</div>
              <div className="grid gap-4 lg:grid-cols-4">
                <MembershipSettingField inputId={`membership-${membershipClass.id}-name`} label="Name" setting="productName" activeHelp={activeHelp} onHelp={openHelp}>
                  <input id={`membership-${membershipClass.id}-name`} value={membershipClass.name} onChange={event => updateClass(membershipClass.id, { name: event.target.value })} className={inputClass} placeholder="Full membership" />
                </MembershipSettingField>
                <MembershipSettingField inputId={`membership-${membershipClass.id}-code`} label="Code" setting="productCode" activeHelp={activeHelp} onHelp={openHelp} hint={<span className={`mt-1 block text-xs ${codeInvalid ? 'text-red-700' : 'text-slate-500'}`}>{isExisting ? 'Fixed after creation' : codeInvalid ? 'Use 2–50 lowercase letters, numbers, hyphens or underscores' : 'Permanent identifier'}</span>}>
                  <input id={`membership-${membershipClass.id}-code`} value={membershipClass.code} disabled={isExisting} onChange={event => updateClass(membershipClass.id, { code: event.target.value.toLowerCase().replace(/\s+/g, '-') })} className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`} placeholder="full" />
                </MembershipSettingField>
                <MembershipSettingField inputId={`membership-${membershipClass.id}-fee`} label="Annual fee (AUD, incl. GST)" setting="annualFee" activeHelp={activeHelp} onHelp={openHelp}>
                  <input id={`membership-${membershipClass.id}-fee`} type="number" min={0} step="0.01" value={membershipClass.annualFee} disabled={membershipClass.isFeeExempt} onChange={event => updateClass(membershipClass.id, { annualFee: Number(event.target.value || 0) })} className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`} />
                </MembershipSettingField>
                <MembershipSettingField inputId={`membership-${membershipClass.id}-order`} label="Display order" setting="displayOrder" activeHelp={activeHelp} onHelp={openHelp}>
                  <input id={`membership-${membershipClass.id}-order`} type="number" min={1} value={membershipClass.sortOrder || index + 1} onChange={event => updateClass(membershipClass.id, { sortOrder: Number(event.target.value || index + 1) })} className={inputClass} />
                </MembershipSettingField>
              </div>
              <MembershipSettingField inputId={`membership-${membershipClass.id}-description`} label="Description" setting="productDescription" activeHelp={activeHelp} onHelp={openHelp} className="mt-4">
                <input id={`membership-${membershipClass.id}-description`} value={membershipClass.description} onChange={event => updateClass(membershipClass.id, { description: event.target.value })} className={inputClass} placeholder="Explain who this membership is for" />
              </MembershipSettingField>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MembershipToggleSetting inputId={`membership-${membershipClass.id}-voting`} title="Voting rights" description="Member is shown as eligible to vote." setting="votingRights" activeHelp={activeHelp} onHelp={openHelp} checked={membershipClass.hasVotingRights} onChange={checked => updateClass(membershipClass.id, { hasVotingRights: checked })} />
                <MembershipToggleSetting inputId={`membership-${membershipClass.id}-self-booking`} title="Aircraft self-booking" description="Still requires financial clearance and all safety rules." setting="selfBooking" activeHelp={activeHelp} onHelp={openHelp} checked={membershipClass.canSelfBookAircraft} onChange={checked => updateClass(membershipClass.id, { canSelfBookAircraft: checked })} />
                <MembershipToggleSetting inputId={`membership-${membershipClass.id}-fee-exempt`} title="Fee exempt" description="No annual membership invoice is required." setting="feeExempt" activeHelp={activeHelp} onHelp={openHelp} checked={membershipClass.isFeeExempt} onChange={checked => updateClass(membershipClass.id, { isFeeExempt: checked, annualFee: checked ? 0 : membershipClass.annualFee })} />
                <MembershipToggleSetting inputId={`membership-${membershipClass.id}-available`} title="Available" description="Can be selected for new applications." setting="productAvailable" activeHelp={activeHelp} onHelp={openHelp} checked={membershipClass.isActive} onChange={checked => updateClass(membershipClass.id, { isActive: checked })} />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <MembershipSettingField inputId={`membership-${membershipClass.id}-xero-item`} label="Xero item code" setting="productXeroItem" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">May be shared across membership products.</span>}>
                  <input id={`membership-${membershipClass.id}-xero-item`} value={membershipClass.xeroItemCode || ''} onChange={event => updateClass(membershipClass.id, { xeroItemCode: event.target.value.toUpperCase() })} className={inputClass} placeholder={`BFC-${code || 'MEMBERSHIP'}`} />
                </MembershipSettingField>
                <MembershipSettingField inputId={`membership-${membershipClass.id}-xero-account`} label="Accounting code" setting="productXeroAccount" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">Xero revenue account; may be the same or different for each product.</span>}>
                  {xeroAccounts.length > 0 ? <SearchableSelect id={`membership-${membershipClass.id}-xero-account`} value={membershipClass.xeroAccountCode || ''} onChange={event => updateClass(membershipClass.id, { xeroAccountCode: event.target.value || null })} className={inputClass}><option value="">Use the default Xero revenue account</option>{membershipClass.xeroAccountCode && !xeroAccounts.some(account => account.code === membershipClass.xeroAccountCode) && <option value={membershipClass.xeroAccountCode}>{membershipClass.xeroAccountCode} — saved code</option>}{xeroAccounts.map(account => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}</SearchableSelect> : <input id={`membership-${membershipClass.id}-xero-account`} value={membershipClass.xeroAccountCode || ''} onChange={event => updateClass(membershipClass.id, { xeroAccountCode: event.target.value.toUpperCase() })} className={inputClass} placeholder={xeroAccountsLoading ? 'Loading Xero accounts…' : 'Example: 200'} />}
                </MembershipSettingField>
              </div>
            </article>;
          })}
        </div>
        {invalidMembershipProducts && <p className="text-sm font-semibold text-red-700">Complete every membership name and valid unique code, and ensure fees are not negative.</p>}
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="text-lg font-bold text-slate-950">Membership year and commencement</h2><p className="mt-1 text-sm text-slate-600">These values affect legal commencement and future fee periods. Confirm governance changes before saving them.</p></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MembershipSettingField inputId="membership-financial-year-month" label="Financial year starts" setting="financialYearStartMonth" activeHelp={activeHelp} onHelp={openHelp}>
            <SearchableSelect id="membership-financial-year-month" value={draft.financialYearStartMonth} onChange={event => setDraft(current => ({ ...current, financialYearStartMonth: Number(event.target.value) }))} className={inputClass}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</SearchableSelect>
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-financial-year-day" label="Start day" setting="financialYearStartDay" activeHelp={activeHelp} onHelp={openHelp}>
            <input id="membership-financial-year-day" type="number" min={1} max={28} value={draft.financialYearStartDay} onChange={event => setDraft(current => ({ ...current, financialYearStartDay: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-auto-commencement" label="Automatic commencement" setting="automaticCommencement" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days after application</span>}>
            <input id="membership-auto-commencement" type="number" min={1} max={90} value={draft.automaticCommencementDays} onChange={event => setDraft(current => ({ ...current, automaticCommencementDays: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-nonpayment-grace" label="Non-payment grace" setting="nonPaymentGrace" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days after the due date</span>}>
            <input id="membership-nonpayment-grace" type="number" min={1} max={180} value={draft.nonPaymentGraceDays} onChange={event => setDraft(current => ({ ...current, nonPaymentGraceDays: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <MembershipSettingField inputId="membership-proration" label="New-member proration" setting="prorationMethod" activeHelp={activeHelp} onHelp={openHelp}>
            <SearchableSelect id="membership-proration" value={draft.prorationMethod} onChange={event => setDraft(current => ({ ...current, prorationMethod: event.target.value as MembershipProrationMethod }))} className={inputClass}><option value="daily">Daily to financial year end</option><option value="monthly">Whole months remaining</option><option value="none">No proration</option></SearchableSelect>
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-minimum-prorated-fee" label="Minimum prorated fee (incl. GST)" setting="minimumProratedFee" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">AUD; use $0 for no minimum</span>}>
            <input id="membership-minimum-prorated-fee" type="number" min={0} step="0.01" value={draft.minimumProratedFee} onChange={event => setDraft(current => ({ ...current, minimumProratedFee: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="text-lg font-bold text-slate-950">Renewals and reminders</h2><p className="mt-1 text-sm text-slate-600">Renewal invoices are prepared in advance. Automatic payment is never attempted before the due date.</p></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MembershipSettingField inputId="membership-renewal-lead" label="Prepare invoices" setting="renewalInvoiceLead" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days before renewal</span>}>
            <input id="membership-renewal-lead" type="number" min={0} max={120} value={draft.renewalInvoiceLeadDays} onChange={event => setDraft(current => ({ ...current, renewalInvoiceLeadDays: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-upcoming-reminders" label="Upcoming reminders" setting="upcomingReminders" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days before due, comma separated</span>}>
            <input id="membership-upcoming-reminders" value={draft.renewalReminderDaysBeforeDue.join(', ')} onChange={event => setDraft(current => ({ ...current, renewalReminderDaysBeforeDue: positiveIntegerList(event.target.value, current.renewalReminderDaysBeforeDue) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-overdue-reminders" label="Overdue reminders" setting="overdueReminders" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days overdue, comma separated</span>}>
            <input id="membership-overdue-reminders" value={draft.overdueReminderDays.join(', ')} onChange={event => setDraft(current => ({ ...current, overdueReminderDays: positiveIntegerList(event.target.value, current.overdueReminderDays) }))} className={inputClass} />
          </MembershipSettingField>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="text-lg font-bold text-slate-950">Billing recovery and Xero</h2><p className="mt-1 text-sm text-slate-600">Technical interruptions retry quickly. A rejected card or bank debit uses the slower day-based schedule.</p></div>
        <div className="grid gap-4 sm:grid-cols-3">
          <MembershipSettingField inputId="membership-technical-retries" label="Technical retry minutes" setting="technicalRetries" activeHelp={activeHelp} onHelp={openHelp}>
            <input id="membership-technical-retries" value={draft.technicalRetryMinutes.join(', ')} onChange={event => setDraft(current => ({ ...current, technicalRetryMinutes: positiveIntegerList(event.target.value, current.technicalRetryMinutes) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-payment-retries" label="Payment retry days" setting="paymentRetries" activeHelp={activeHelp} onHelp={openHelp}>
            <input id="membership-payment-retries" value={draft.paymentRetryDays.join(', ')} onChange={event => setDraft(current => ({ ...current, paymentRetryDays: positiveIntegerList(event.target.value, current.paymentRetryDays) }))} className={inputClass} />
          </MembershipSettingField>
          <MembershipSettingField inputId="membership-xero-stale" label="Xero status stale after" setting="xeroStaleAfter" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">hours; stale data prevents automatic cessation</span>}>
            <input id="membership-xero-stale" type="number" min={1} max={168} value={draft.xeroStatusStaleHours} onChange={event => setDraft(current => ({ ...current, xeroStatusStaleHours: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
        </div>
        <div data-testid="membership-scholarship-settings" className="rounded-xl border border-violet-300 bg-violet-50 p-4 dark:border-violet-700 dark:bg-violet-950">
          <div><h3 className="text-base font-bold text-violet-950 dark:text-violet-100">Scholarship contribution</h3><p className="mt-1 text-sm font-medium leading-6 text-violet-800 dark:text-violet-200">This remains optional and unchecked for members. Configure the suggested amount and its separate Xero mapping.</p></div>
          <MembershipToggleSetting inputId="membership-scholarship-available" title="Offer scholarship contributions" description="Members must actively opt in." setting="scholarshipAvailable" activeHelp={activeHelp} onHelp={openHelp} checked={draft.scholarshipContributionAvailable} onChange={checked => setDraft(current => ({ ...current, scholarshipContributionAvailable: checked }))} className="mt-4 border-violet-300 bg-white dark:border-violet-700 dark:bg-slate-950" descriptionClassName="text-sm text-slate-700 dark:text-slate-300" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MembershipSettingField inputId="membership-scholarship-suggested" label="Suggested amount" setting="scholarshipSuggested" activeHelp={activeHelp} onHelp={openHelp}>
              <input id="membership-scholarship-suggested" type="number" min={0.01} step="0.01" value={draft.scholarshipDefaultAmount} onChange={event => setDraft(current => ({ ...current, scholarshipDefaultAmount: Number(event.target.value || 0) }))} className={inputClass} />
            </MembershipSettingField>
            <MembershipSettingField inputId="membership-scholarship-minimum" label="Minimum amount" setting="scholarshipMinimum" activeHelp={activeHelp} onHelp={openHelp}>
              <input id="membership-scholarship-minimum" type="number" min={0.01} step="0.01" value={draft.scholarshipMinimumAmount} onChange={event => setDraft(current => ({ ...current, scholarshipMinimumAmount: Number(event.target.value || 0) }))} className={inputClass} />
            </MembershipSettingField>
            <MembershipSettingField inputId="membership-scholarship-item" label="Xero item code" setting="scholarshipXeroItem" activeHelp={activeHelp} onHelp={openHelp}>
              <input id="membership-scholarship-item" value={draft.xeroScholarshipItemCode || ''} onChange={event => setDraft(current => ({ ...current, xeroScholarshipItemCode: event.target.value.toUpperCase() }))} className={inputClass} placeholder="BFC-SCHOLARSHIP" />
            </MembershipSettingField>
            <MembershipSettingField inputId="membership-scholarship-account" label="Accounting code" setting="scholarshipXeroAccount" activeHelp={activeHelp} onHelp={openHelp}>
              {xeroAccounts.length > 0 ? <SearchableSelect id="membership-scholarship-account" value={draft.xeroScholarshipAccountCode || ''} onChange={event => setDraft(current => ({ ...current, xeroScholarshipAccountCode: event.target.value || null }))} className={inputClass}><option value="">Use the default Xero revenue account</option>{draft.xeroScholarshipAccountCode && !xeroAccounts.some(account => account.code === draft.xeroScholarshipAccountCode) && <option value={draft.xeroScholarshipAccountCode}>{draft.xeroScholarshipAccountCode} — saved code</option>}{xeroAccounts.map(account => <option key={account.code} value={account.code}>{account.code} — {account.name}</option>)}</SearchableSelect> : <input id="membership-scholarship-account" value={draft.xeroScholarshipAccountCode || ''} onChange={event => setDraft(current => ({ ...current, xeroScholarshipAccountCode: event.target.value.toUpperCase() }))} className={inputClass} placeholder={xeroAccountsLoading ? 'Loading Xero accounts…' : 'Example: 210'} />}
            </MembershipSettingField>
          </div>
          {invalidScholarshipSettings && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">The suggested contribution must be at least the minimum, and the minimum must be at least $0.01.</p>}
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="text-lg font-bold text-slate-950">Waivers and register privacy</h2><p className="mt-1 text-sm text-slate-600">Complimentary memberships remain annual, authorised decisions—not fake payments.</p></div>
        <MembershipSettingField inputId="membership-waiver-types" label="Approved waiver types" setting="waiverTypes" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">One type per line</span>}>
          <textarea id="membership-waiver-types" rows={4} value={draft.waiverTypes.join('\n')} onChange={event => setDraft(current => ({ ...current, waiverTypes: event.target.value.split('\n').map(value => value.trim()).filter(Boolean).slice(0, 20) }))} className={inputClass} />
        </MembershipSettingField>
        <div className="grid gap-4 sm:grid-cols-2">
          <MembershipToggleSetting inputId="membership-waiver-authority" title="Require waiver authority reference" description="Records the committee minute or delegated approval." setting="waiverAuthority" activeHelp={activeHelp} onHelp={openHelp} checked={draft.requireWaiverAuthorityReference} onChange={checked => setDraft(current => ({ ...current, requireWaiverAuthorityReference: checked }))} className="border-slate-200 p-4" />
          <MembershipSettingField inputId="membership-register-cleanup" label="Register cleanup target" setting="registerCleanup" activeHelp={activeHelp} onHelp={openHelp} hint={<span className="mt-1 block text-xs text-slate-500">days; exported ceased records are privacy-minimised immediately</span>}>
            <input id="membership-register-cleanup" type="number" min={1} max={90} value={draft.statutoryRegisterCleanupDays} onChange={event => setDraft(current => ({ ...current, statutoryRegisterCleanupDays: Number(event.target.value) }))} className={inputClass} />
          </MembershipSettingField>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><div className="flex items-center gap-1"><h2 className="text-lg font-bold text-slate-950">Booking enforcement</h2><MembershipSettingHelpButton setting="rolloutMode" active={activeHelp === 'rolloutMode'} onOpen={openHelp} /></div><p className="mt-1 text-sm text-slate-600">Use warning mode while the member register and Xero links are checked, then enable enforcement.</p></div>
        <div className="space-y-3">{(['information_only', 'staff_warning', 'enforced'] as MembershipRolloutMode[]).map(mode => <label key={mode} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${draft.rolloutMode === mode ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}><input type="radio" name="rollout" checked={draft.rolloutMode === mode} onChange={() => setDraft(current => ({ ...current, rolloutMode: mode }))} className="mt-1" /><span><span className="block font-bold text-slate-900">{membershipStatusLabel(mode)}</span><span className="mt-1 block text-sm text-slate-600">{rolloutModeDescription[mode]}</span></span></label>)}</div>
        <MembershipToggleSetting inputId="membership-staff-override-reason" title="Require a staff override reason" description="Recommended whenever staff proceed for an unpaid member or non-member." setting="staffOverrideReason" activeHelp={activeHelp} onHelp={openHelp} checked={draft.requireStaffOverrideReason} onChange={checked => setDraft(current => ({ ...current, requireStaffOverrideReason: checked }))} className="border-slate-200 p-4" />
      </section>

      <button disabled={saveDisabled} onClick={() => void membershipApi.updateSettings(draft, classDrafts)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Settings2 className="h-4 w-4" /> Save membership settings</button>
    </div>
    <aside className="space-y-4">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><ShieldCheck className="h-6 w-6 text-blue-700" /><h3 className="mt-3 font-bold text-blue-950">Safeguards kept in place</h3><ul className="mt-2 space-y-2 text-sm text-blue-900"><li>Guests remain exempt from BFC membership.</li><li>Automatic payment waits until the due date.</li><li>Technical and payment retries remain idempotent.</li><li>Staff overrides are recorded per booking.</li><li>Safety, duty, grounding and supervision controls stay independent.</li></ul></div>
      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-950"><h3 className="font-bold">Current recommended defaults</h3><p className="mt-2">1 July year start · daily proration · invoices 30 days early · 60-day grace · Xero stale after 12 hours · payment retries after 3 and 7 days.</p></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          disabled={membershipApi.busyAction === 'lifecycle'}
          onClick={() => void membershipApi.runLifecycle()}
          aria-describedby="membership-process-updates-description"
          title="Run the automatic membership checks now. This may commence eligible applications, update fee statuses, or cease memberships after the payment grace period. It does not send email."
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <CalendarClock className="h-4 w-4" />
          {membershipApi.busyAction === 'lifecycle' ? 'Processing membership updates…' : 'Process membership updates'}
        </button>
        <p id="membership-process-updates-description" className="mt-2 text-xs leading-5 text-slate-600">
          Runs the automatic membership checks immediately. It can commence eligible applications, update payment statuses, and cease overdue memberships after the grace period. No emails are sent.
        </p>
      </div>
    </aside>
    {activeHelp && <MembershipSettingHelpPanel setting={activeHelp} onClose={closeHelp} />}
  </div>;
};

export const MembershipDashboard: React.FC = () => {
  const membershipApi = useMembership();
  const [tab, setTab] = useState<MembershipTab>(() => membershipApi.isAdmin ? 'dashboard' : 'mine');
  const [registerFocus, setRegisterFocus] = useState<MembershipRegisterFocus>('current');
  if (membershipApi.loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-700" /></div>;
  if (membershipApi.error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><AlertTriangle className="mb-2 h-5 w-5" />{membershipApi.error}</div>;
  const pendingCount = membershipApi.applications.filter(item => item.status === 'pending').length
    + membershipApi.changeRequests.filter(item => ['pending', 'needs_review'].includes(item.status)).length;
  const tabs = membershipApi.isAdmin
    ? [
      { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart3 },
      { id: 'register' as const, label: 'Membership register', icon: Users },
      { id: 'applications' as const, label: `Applications${pendingCount ? ` (${pendingCount})` : ''}`, icon: FileCheck2 },
      { id: 'mine' as const, label: 'My membership', icon: BadgeCheck },
      { id: 'settings' as const, label: 'Settings', icon: Settings2 },
    ]
    : [{ id: 'mine' as const, label: 'My membership', icon: BadgeCheck }];
  const openRegister = (focus: MembershipRegisterFocus) => {
    setRegisterFocus(focus);
    setTab('register');
  };
  return <div className="space-y-6 p-3 sm:p-6"><header><p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">Bendigo Flying Club</p><h1 className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-white sm:text-3xl">Club membership</h1><p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">BFC membership, approvals and financial clearance. RAAus membership remains a separate aviation-compliance record.</p></header><nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 dark:border-slate-700">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => { if (item.id === 'register' && tab !== 'register') setRegisterFocus('current'); setTab(item.id); }} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${tab === item.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>{tab === 'dashboard' && membershipApi.isAdmin && <MembershipAdminDashboard membershipApi={membershipApi} onOpenApplications={() => setTab('applications')} onOpenRegister={openRegister} />}{tab === 'mine' && <MyMembership membershipApi={membershipApi} />}{tab === 'applications' && membershipApi.isAdmin && <ApplicationsAdmin membershipApi={membershipApi} />}{tab === 'register' && membershipApi.isAdmin && <RegisterAdmin membershipApi={membershipApi} initialFocus={registerFocus} />}{tab === 'settings' && membershipApi.isAdmin && <MembershipSettingsPanel membershipApi={membershipApi} />}</div>;
};

export default MembershipDashboard;
