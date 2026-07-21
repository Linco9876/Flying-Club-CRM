import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Clock3,
  FileCheck2,
  Heart,
  Landmark,
  Loader2,
  RefreshCw,
  Repeat2,
  Settings2,
  ShieldCheck,
  UserCheck,
  Users,
  Vote,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isFinanciallyCleared, membershipStatusLabel, rolloutModeDescription, useMembership } from '../../hooks/useMembership';
import { useUsers } from '../../hooks/useUsers';
import { MembershipApplication, MembershipFinancialPeriod, MembershipPaymentMethod, MembershipRolloutMode } from '../../types';
import { MembershipDocumentLinks } from './MembershipDocumentLinks';

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

const MembershipApplicationForm = ({ onSubmit, busy, classes }: {
  onSubmit: (input: {
    membershipClassCode: string;
    residentialAddress: string;
    serviceAddress: string;
    dateOfBirth?: string;
    guardianName?: string;
    guardianConsent: boolean;
  }) => Promise<unknown>;
  busy: boolean;
  classes: Array<{ code: string; name: string; annualFee: number }>;
}) => {
  const { user } = useAuth();
  const [sameAddress, setSameAddress] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [form, setForm] = useState({
    membershipClassCode: 'full',
    residentialAddress: user?.address || '',
    serviceAddress: user?.address || '',
    dateOfBirth: user?.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : '',
    guardianName: '',
    guardianConsent: false,
  });
  const isJunior = form.dateOfBirth ? new Date(form.dateOfBirth) > new Date(new Date().setFullYear(new Date().getFullYear() - 18)) : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accepted) return;
    if (form.membershipClassCode === 'junior' && !isJunior) return;
    await onSubmit({ ...form, serviceAddress: sameAddress ? form.residentialAddress : form.serviceAddress });
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-slate-950">Apply for BFC membership</h2>
        <p className="mt-1 text-sm text-slate-600">Membership commences when approved by the committee, or 30 days after a complete application is submitted.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">Membership class
          <select value={form.membershipClassCode} onChange={event => setForm(current => ({ ...current, membershipClassCode: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">
            {classes.map(item => <option key={item.code} value={item.code}>{item.name} — {moneyLabel(item.annualFee)}/year</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">Date of birth
          <input type="date" value={form.dateOfBirth} onChange={event => setForm(current => ({ ...current, dateOfBirth: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
          {form.membershipClassCode === 'junior' && !isJunior && <span className="mt-1 block text-xs font-normal text-red-700">Junior membership requires an applicant under 18.</span>}
        </label>
        <label className="text-sm font-semibold text-slate-700 md:col-span-2">Residential address
          <textarea required rows={2} value={form.residentialAddress} onChange={event => setForm(current => ({ ...current, residentialAddress: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" checked={sameAddress} onChange={event => setSameAddress(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Use this address for formal notices
        </label>
        {!sameAddress && <label className="text-sm font-semibold text-slate-700 md:col-span-2">Address for service
          <textarea required rows={2} value={form.serviceAddress} onChange={event => setForm(current => ({ ...current, serviceAddress: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" />
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
        <input type="checkbox" required checked={accepted} onChange={event => setAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>I support the purposes of Bendigo Flying Club and agree to the Constitution, member guarantee, By-laws, Code of Conduct and Members Manual. I understand these acknowledgements will be retained with my application.<MembershipDocumentLinks /></span>
      </label>
      <button disabled={busy || !accepted || (form.membershipClassCode === 'junior' && !isJunior)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />} Submit application
      </button>
    </form>
  );
};

const MembershipPaymentPreferencesCard = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const preference = membershipApi.ownPaymentPreference;
  const [paymentMethod, setPaymentMethod] = useState<MembershipPaymentMethod>(preference?.paymentMethod || 'becs');
  const [autoRenew, setAutoRenew] = useState(preference?.autoRenew || false);
  const [scholarshipEnabled, setScholarshipEnabled] = useState(preference?.scholarshipContributionEnabled || false);
  const [scholarshipAmount, setScholarshipAmount] = useState(String(preference?.scholarshipContributionAmount || 5));
  const [authorityAccepted, setAuthorityAccepted] = useState(false);

  React.useEffect(() => {
    if (!preference) return;
    setPaymentMethod(preference.paymentMethod);
    setAutoRenew(preference.autoRenew);
    setScholarshipEnabled(preference.scholarshipContributionEnabled);
    setScholarshipAmount(String(preference.scholarshipContributionAmount || 5));
  }, [preference]);

  const methods: Array<{ id: MembershipPaymentMethod; title: string; description: string; icon: typeof Landmark; recommended?: boolean }> = [
    { id: 'becs', title: 'BECS Direct Debit', description: 'Secure payment from an Australian bank account.', icon: Landmark, recommended: true },
    { id: 'invoice', title: 'Xero invoice', description: 'Receive an invoice and choose when to pay it.', icon: Banknote },
    { id: 'card', title: 'Card', description: 'Use a securely stored card. The club absorbs card fees.', icon: CreditCard },
  ];
  const needsAuthority = paymentMethod !== 'invoice';
  const parsedScholarshipAmount = Number(scholarshipAmount);
  const saveDisabled = membershipApi.busyAction === 'payment-preference'
    || (scholarshipEnabled && (!Number.isFinite(parsedScholarshipAmount) || parsedScholarshipAmount < 0.01))
    || (needsAuthority && !authorityAccepted);

  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start gap-3">
      <CircleDollarSign className="mt-0.5 h-5 w-5 text-blue-700" />
      <div><h2 className="font-bold text-slate-950">Payment preference</h2><p className="mt-1 text-sm text-slate-600">Nothing is charged until membership commences. Xero remains the payment record.</p></div>
    </div>
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      {methods.map(method => { const Icon = method.icon; const selected = paymentMethod === method.id; return <button key={method.id} type="button" onClick={() => { setPaymentMethod(method.id); setAuthorityAccepted(false); }} className={`relative rounded-xl border p-4 text-left transition ${selected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}>
        {method.recommended && <span className="absolute right-3 top-3 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Preferred</span>}
        <Icon className={`h-5 w-5 ${selected ? 'text-blue-700' : 'text-slate-500'}`} /><span className="mt-3 block font-bold text-slate-950">{method.title}</span><span className="mt-1 block text-xs leading-5 text-slate-600">{method.description}</span>
      </button>; })}
    </div>
    <label className={`mt-4 flex items-start gap-3 rounded-xl border p-4 ${paymentMethod === 'invoice' ? 'border-slate-200 bg-slate-50' : 'border-blue-200 bg-blue-50'}`}>
      <input type="checkbox" checked={autoRenew} disabled={paymentMethod === 'invoice'} onChange={event => setAutoRenew(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
      <span><span className="flex items-center gap-2 font-bold text-slate-900"><Repeat2 className="h-4 w-4" /> Automatically pay annual renewals</span><span className="mt-1 block text-sm text-slate-600">We will notify you before each annual debit. You can turn this off at any time. Manual Xero invoices cannot be auto-debited.</span></span>
    </label>
    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={scholarshipEnabled} onChange={event => setScholarshipEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-violet-300" />
        <span><span className="flex items-center gap-2 font-bold text-violet-950"><Heart className="h-4 w-4" /> Add a scholarship contribution</span><span className="mt-1 block text-sm text-violet-800">Optional and unchecked by default. It is listed separately from your membership fee in Xero.</span></span>
      </label>
      {scholarshipEnabled && <label className="mt-3 block max-w-xs text-sm font-semibold text-violet-950">Contribution amount
        <div className="mt-1 flex rounded-lg border border-violet-300 bg-white focus-within:ring-2 focus-within:ring-violet-200"><span className="px-3 py-2.5 text-slate-500">$</span><input type="number" min="0.01" step="0.01" inputMode="decimal" value={scholarshipAmount} onChange={event => setScholarshipAmount(event.target.value)} className="min-w-0 flex-1 rounded-r-lg border-0 px-2 py-2.5 outline-none" /></div>
      </label>}
    </div>
    {needsAuthority && <label className="mt-4 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={authorityAccepted} onChange={event => setAuthorityAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" /><span>I authorise the initial membership payment using this method. {autoRenew ? 'I also authorise future annual renewal payments after advance notice.' : 'I am not authorising future annual renewal payments.'}</span></label>}
    {preference && <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Current: <span className="font-bold text-slate-800">{preference.paymentMethodDisplay || membershipStatusLabel(preference.paymentMethod)}</span>{preference.authorityStatus === 'ready' && <span className="ml-2 text-emerald-700">Ready</span>}{preference.lastCollectionError && <span className="mt-1 block text-red-700">{preference.lastCollectionError}</span>}</div>}
    <button disabled={saveDisabled} onClick={() => void membershipApi.savePaymentPreference({ paymentMethod, autoRenew: paymentMethod === 'invoice' ? false : autoRenew, scholarshipContributionEnabled: scholarshipEnabled, scholarshipContributionAmount: parsedScholarshipAmount, authorityAccepted: needsAuthority ? authorityAccepted : false })} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
      {membershipApi.busyAction === 'payment-preference' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Save payment preference
    </button>
  </section>;
};

const MembershipCancellation = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!membershipApi.ownApplication && !membershipApi.ownMembership) return null;
  if (membershipApi.ownApplication?.status === 'withdrawn' || membershipApi.ownMembership?.legalStatus === 'resigned') return null;
  return <div className="rounded-2xl border border-slate-200 bg-white p-5">
    {!open ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-900">Cancel membership</h3><p className="mt-1 text-sm text-slate-600">Unpaid Xero membership invoices will be voided. Paid invoices remain as accounting records.</p></div><button onClick={() => setOpen(true)} className="self-start rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50">{membershipApi.ownMembership ? 'Cancel membership' : 'Withdraw application'}</button></div> : <div><h3 className="font-bold text-red-900">Confirm cancellation</h3><p className="mt-1 text-sm text-slate-600">This stops automatic renewal and cancels any unpaid membership invoice.</p><textarea autoFocus rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Reason for cancellation (minimum 10 characters)" className="mt-3 w-full rounded-lg border border-red-200 px-3 py-2" /><div className="mt-3 flex justify-end gap-2"><button onClick={() => { setOpen(false); setReason(''); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Keep membership</button><button disabled={reason.trim().length < 10 || membershipApi.busyAction === 'membership-cancel'} onClick={async () => { await membershipApi.cancelMembership(reason); setOpen(false); }} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{membershipApi.busyAction === 'membership-cancel' && <Loader2 className="h-4 w-4 animate-spin" />} Confirm cancellation</button></div></div>}
  </div>;
};

const MyMembership = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { ownApplication, ownMembership, ownPeriods, classes, busyAction, submitApplication, refreshOwnXeroInvoices } = membershipApi;
  const currentPeriod = ownPeriods[0];
  if (!ownApplication && !ownMembership) {
    return <MembershipApplicationForm classes={classes.filter(item => item.code !== 'life')} busy={busyAction === 'application:submit'} onSubmit={submitApplication} />;
  }

  return <div className="space-y-5">
    {ownMembership ? <>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><UserCheck className="h-5 w-5 text-blue-700" /><StatusPill value={ownMembership.legalStatus} /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">BFC membership</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{ownMembership.membershipClassName}</p>
          <p className="mt-1 text-sm text-slate-600">Commenced {dateLabel(ownMembership.commencedAt)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><CircleDollarSign className="h-5 w-5 text-blue-700" /><StatusPill value={currentPeriod?.feeDisposition} /></div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Financial clearance</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{currentPeriod ? moneyLabel(currentPeriod.amountDue) : 'Awaiting fee record'}</p>
          <p className="mt-1 text-sm text-slate-600">{currentPeriod ? `Due ${dateLabel(currentPeriod.dueDate)}` : 'Contact the club'}</p>
          {currentPeriod && currentPeriod.scholarshipContributionAmount > 0 && <p className="mt-2 text-xs text-violet-700">Includes {moneyLabel(currentPeriod.scholarshipContributionAmount)} scholarship contribution</p>}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><Vote className="h-5 w-5 text-blue-700" />{ownMembership.hasVotingRights ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-slate-400" />}</div>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Voting entitlement</p>
          <p className="mt-1 text-xl font-extrabold text-slate-950">{ownMembership.hasVotingRights ? 'Voting member' : 'Non-voting member'}</p>
          <p className="mt-1 text-sm text-slate-600">Only Full membership carries voting rights.</p>
        </div>
      </div>
      {currentPeriod && !isFinanciallyCleared(currentPeriod.feeDisposition) && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><h3 className="font-bold">Aircraft self-booking is unavailable</h3><p className="mt-1 text-sm">Your legal membership continues until {dateLabel(currentPeriod.graceExpiresAt)}, but the fee must be paid or waived before you can book an aircraft yourself.</p></div></div>
        {currentPeriod.xeroInvoiceId && <button disabled={busyAction === 'xero:own'} onClick={() => void refreshOwnXeroInvoices()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-bold hover:bg-amber-100"><RefreshCw className={`h-4 w-4 ${busyAction === 'xero:own' ? 'animate-spin' : ''}`} /> Refresh Xero payment</button>}
      </div>}
      {currentPeriod?.waiverReason && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><span className="font-bold">Fee waiver:</span> {currentPeriod.waiverReason}</div>}
      {ownMembership.legalStatus === 'current' && <MembershipPaymentPreferencesCard membershipApi={membershipApi} />}
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

const ApplicationsAdmin = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const pending = membershipApi.applications.filter(item => item.status === 'pending');
  const [rejecting, setRejecting] = useState<MembershipApplication | null>(null);
  const [reason, setReason] = useState('');
  return <div className="space-y-4">
    {pending.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600"><BadgeCheck className="mx-auto mb-3 h-8 w-8 text-emerald-600" />No applications are waiting for a decision.</div> : pending.map(application => {
      const daysLeft = Math.max(0, Math.ceil((new Date(application.automaticCommencementAt).getTime() - Date.now()) / 86400000));
      return <article key={application.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-bold text-slate-950">{application.userName || 'Applicant'}</h3><StatusPill value={application.status} /></div><p className="mt-1 text-sm text-slate-600">{application.userEmail} · {application.membershipClassName}</p><p className="mt-3 text-sm text-slate-700">Submitted {dateLabel(application.submittedAt)} · automatic commencement in {daysLeft} day{daysLeft === 1 ? '' : 's'}</p><p className="mt-1 text-sm text-slate-600">{application.residentialAddress}</p></div>
          <div className="flex gap-2"><button disabled={membershipApi.busyAction === `application:${application.id}`} onClick={() => void membershipApi.decideApplication(application.id, 'approve')} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800"><CheckCircle2 className="h-4 w-4" /> Approve</button><button onClick={() => { setRejecting(application); setReason(''); }} className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-50"><XCircle className="h-4 w-4" /> Reject</button></div>
        </div>
      </article>;
    })}
    {rejecting && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-950">Reject {rejecting.userName}'s application</h3><p className="mt-1 text-sm text-slate-600">The reason is retained in the audit history.</p><textarea autoFocus value={reason} onChange={event => setReason(event.target.value)} rows={4} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Reason for rejection" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setRejecting(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={!reason.trim()} onClick={async () => { await membershipApi.decideApplication(rejecting.id, 'reject', reason); setRejecting(null); }} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Reject application</button></div></div></div>}
  </div>;
};

const RegisterAdmin = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const { users } = useUsers();
  const [query, setQuery] = useState('');
  const [waiverPeriod, setWaiverPeriod] = useState<MembershipFinancialPeriod | null>(null);
  const [waiverReason, setWaiverReason] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState({ userId: '', membershipClassCode: 'full', commencedAt: new Date().toISOString().slice(0, 10), feeDisposition: 'paid' as 'paid' | 'invoice_required' | 'waived', reason: '' });
  const periodByMembership = useMemo(() => {
    const latest = new Map<string, MembershipFinancialPeriod>();
    membershipApi.periods.forEach(period => {
      if (!latest.has(period.membershipId)) latest.set(period.membershipId, period);
    });
    return latest;
  }, [membershipApi.periods]);
  const filtered = membershipApi.memberships.filter(item => `${item.userName} ${item.userEmail} ${item.membershipClassName}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search membership register" className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2.5" /><div className="flex flex-wrap gap-2"><button onClick={() => setShowImport(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-800"><UserCheck className="h-4 w-4" /> Add existing member</button><button disabled={membershipApi.busyAction === 'xero:issue-renewals'} onClick={() => { if (window.confirm('Create and email the next batch of up to 100 outstanding membership invoices from Xero? Xero will use its default invoice email template.')) void membershipApi.issueMembershipRenewals(); }} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 px-3 py-2.5 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><CircleDollarSign className="h-4 w-4" /> Issue &amp; email renewal batch</button><button disabled={membershipApi.busyAction === 'xero:all'} onClick={() => void membershipApi.refreshAllXeroInvoices()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 px-3 py-2.5 text-sm font-bold text-blue-800 hover:bg-blue-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${membershipApi.busyAction === 'xero:all' ? 'animate-spin' : ''}`} /> Refresh Xero payments</button></div></div>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Class</th><th className="px-4 py-3">Legal status</th><th className="px-4 py-3">Fee status</th><th className="px-4 py-3">Invoice / due</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(membership => {
      const period = periodByMembership.get(membership.id);
      return <tr key={membership.id}><td className="px-4 py-3"><p className="font-bold text-slate-900">{membership.userName}</p><p className="text-xs text-slate-500">{membership.userEmail}</p></td><td className="px-4 py-3"><p>{membership.membershipClassName}</p>{membership.hasVotingRights && <p className="text-xs font-semibold text-blue-700">Voting</p>}</td><td className="px-4 py-3"><StatusPill value={membership.legalStatus} /></td><td className="px-4 py-3"><StatusPill value={period?.feeDisposition} />{period?.waiverReason && <p className="mt-1 max-w-xs text-xs text-slate-500">{period.waiverReason}</p>}</td><td className="px-4 py-3"><p>{period?.xeroInvoiceNumber || (period ? moneyLabel(period.amountDue) : 'No period')}</p><p className="text-xs text-slate-500">{period ? `Due ${dateLabel(period.dueDate)}` : ''}</p></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{period && !['waived', 'fee_exempt'].includes(period.feeDisposition) && <button disabled={membershipApi.busyAction === `xero:${period.id}`} onClick={() => void membershipApi.createOrRefreshXeroInvoice(period.id)} className="rounded-lg border border-blue-300 px-2.5 py-1.5 text-xs font-bold text-blue-800 hover:bg-blue-50">{period.xeroInvoiceId ? 'Refresh' : 'Issue invoice'}</button>}{period && !isFinanciallyCleared(period.feeDisposition) && <button onClick={() => { setWaiverPeriod(period); setWaiverReason(''); }} className="rounded-lg border border-emerald-300 px-2.5 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50">Waive fee</button>}</div></td></tr>;
    })}</tbody></table></div>
    {waiverPeriod && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-950">Authorise a membership fee waiver</h3><p className="mt-1 text-sm text-slate-600">The waiver applies only to this financial year and does not create a fake Xero payment.</p><textarea autoFocus rows={4} value={waiverReason} onChange={event => setWaiverReason(event.target.value)} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Committee authority and reason (minimum 10 characters)" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setWaiverPeriod(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={waiverReason.trim().length < 10} onClick={async () => { await membershipApi.setFeeDisposition(waiverPeriod.id, 'waived', waiverReason); setWaiverPeriod(null); }} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Authorise waiver</button></div></div></div>}
    {showImport && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"><h3 className="text-lg font-bold text-slate-950">Add an existing club member</h3><p className="mt-1 text-sm text-slate-600">Use this to establish the opening register without asking an existing member to reapply.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Portal user<select value={importForm.userId} onChange={event => setImportForm(current => ({ ...current, userId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"><option value="">Select a person</option>{users.filter(item => !membershipApi.memberships.some(membership => membership.userId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} — {item.email}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Membership class<select value={importForm.membershipClassCode} onChange={event => setImportForm(current => ({ ...current, membershipClassCode: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">{membershipApi.classes.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label><label className="text-sm font-semibold text-slate-700">Original commencement<input type="date" value={importForm.commencedAt} onChange={event => setImportForm(current => ({ ...current, commencedAt: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="text-sm font-semibold text-slate-700 sm:col-span-2">Current financial status<select value={importForm.feeDisposition} onChange={event => setImportForm(current => ({ ...current, feeDisposition: event.target.value as typeof importForm.feeDisposition }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal"><option value="paid">Already paid</option><option value="invoice_required">Invoice required</option><option value="waived">Fee waived</option></select></label>{importForm.feeDisposition === 'waived' && <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Waiver reason<textarea rows={3} value={importForm.reason} onChange={event => setImportForm(current => ({ ...current, reason: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>}</div><div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowImport(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">Cancel</button><button disabled={!importForm.userId || membershipApi.busyAction === 'membership:import' || (importForm.feeDisposition === 'waived' && importForm.reason.trim().length < 10)} onClick={async () => { await membershipApi.importLegacyMembership(importForm); setShowImport(false); }} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Add to register</button></div></div></div>}
  </div>;
};

const MembershipSettingsPanel = ({ membershipApi }: { membershipApi: ReturnType<typeof useMembership> }) => {
  const [draft, setDraft] = useState(membershipApi.settings);
  React.useEffect(() => setDraft(membershipApi.settings), [membershipApi.settings]);
  return <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="text-lg font-bold text-slate-950">Membership enforcement</h2><p className="mt-1 text-sm text-slate-600">Use warning mode while existing records and Xero links are checked, then enable enforcement.</p></div><div className="space-y-3">{(['information_only', 'staff_warning', 'enforced'] as MembershipRolloutMode[]).map(mode => <label key={mode} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${draft.rolloutMode === mode ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}><input type="radio" name="rollout" checked={draft.rolloutMode === mode} onChange={() => setDraft(current => ({ ...current, rolloutMode: mode }))} className="mt-1" /><span><span className="block font-bold text-slate-900">{membershipStatusLabel(mode)}</span><span className="mt-1 block text-sm text-slate-600">{rolloutModeDescription[mode]}</span></span></label>)}</div><div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold text-slate-700">Automatic commencement<input type="number" min={1} max={90} value={draft.automaticCommencementDays} onChange={event => setDraft(current => ({ ...current, automaticCommencementDays: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs font-normal text-slate-500">days after application</span></label><label className="text-sm font-semibold text-slate-700">Non-payment grace<input type="number" min={1} max={180} value={draft.nonPaymentGraceDays} onChange={event => setDraft(current => ({ ...current, nonPaymentGraceDays: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs font-normal text-slate-500">days after fee due</span></label><label className="text-sm font-semibold text-slate-700">Xero stale after<input type="number" min={1} max={168} value={draft.xeroStatusStaleHours} onChange={event => setDraft(current => ({ ...current, xeroStatusStaleHours: Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /><span className="mt-1 block text-xs font-normal text-slate-500">hours</span></label></div><div className="grid gap-4 md:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">Xero membership item code<input value={draft.xeroMembershipItemCode || ''} onChange={event => setDraft(current => ({ ...current, xeroMembershipItemCode: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" placeholder="e.g. BFC-MEMBERSHIP" /><span className="mt-1 block text-xs font-normal text-slate-500">Use the accountant-approved membership item.</span></label><label className="block text-sm font-semibold text-slate-700">Xero scholarship item code<input value={draft.xeroScholarshipItemCode || ''} onChange={event => setDraft(current => ({ ...current, xeroScholarshipItemCode: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5" placeholder="e.g. BFC-SCHOLARSHIP" /><span className="mt-1 block text-xs font-normal text-slate-500">Required only when a member opts into a scholarship contribution.</span></label></div><button disabled={membershipApi.busyAction === 'settings'} onClick={() => void membershipApi.updateSettings(draft)} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50"><Settings2 className="h-4 w-4" /> Save settings</button></section>
    <aside className="space-y-4"><div className="rounded-2xl border border-blue-200 bg-blue-50 p-5"><ShieldCheck className="h-6 w-6 text-blue-700" /><h3 className="mt-3 font-bold text-blue-950">Booking safeguards</h3><ul className="mt-2 space-y-2 text-sm text-blue-900"><li>Guests remain exempt from BFC membership.</li><li>Staff overrides are recorded per booking.</li><li>Safety, duty, grounding and supervision controls remain independent.</li><li>Paid, waived and fee-exempt members are financially cleared.</li></ul></div><button disabled={membershipApi.busyAction === 'lifecycle'} onClick={() => void membershipApi.runLifecycle()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"><CalendarClock className="h-4 w-4" /> Run lifecycle now</button></aside>
  </div>;
};

export const MembershipDashboard: React.FC = () => {
  const membershipApi = useMembership();
  const [tab, setTab] = useState<'mine' | 'applications' | 'register' | 'settings'>('mine');
  if (membershipApi.loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-700" /></div>;
  if (membershipApi.error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><AlertTriangle className="mb-2 h-5 w-5" />{membershipApi.error}</div>;
  const pendingCount = membershipApi.applications.filter(item => item.status === 'pending').length;
  const tabs = [{ id: 'mine' as const, label: 'My membership', icon: BadgeCheck }, ...(membershipApi.isAdmin ? [{ id: 'applications' as const, label: `Applications${pendingCount ? ` (${pendingCount})` : ''}`, icon: FileCheck2 }, { id: 'register' as const, label: 'Membership register', icon: Users }, { id: 'settings' as const, label: 'Settings', icon: Settings2 }] : [])];
  return <div className="space-y-6 p-3 sm:p-6"><header><p className="text-sm font-bold uppercase tracking-[0.18em] text-blue-700">Bendigo Flying Club</p><h1 className="mt-1 text-2xl font-extrabold text-slate-950 sm:text-3xl">Club membership</h1><p className="mt-2 max-w-3xl text-sm text-slate-600">BFC membership, approvals and financial clearance. RAAus membership remains a separate aviation-compliance record.</p></header><nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${tab === item.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>{tab === 'mine' && <MyMembership membershipApi={membershipApi} />}{tab === 'applications' && membershipApi.isAdmin && <ApplicationsAdmin membershipApi={membershipApi} />}{tab === 'register' && membershipApi.isAdmin && <RegisterAdmin membershipApi={membershipApi} />}{tab === 'settings' && membershipApi.isAdmin && <MembershipSettingsPanel membershipApi={membershipApi} />}</div>;
};

export default MembershipDashboard;
