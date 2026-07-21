import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CreditCard, Landmark, Mail, Plane, ReceiptText, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { MembershipDocumentLinks } from '../Membership/MembershipDocumentLinks';

type PaymentMethod = 'becs' | 'invoice' | 'card';

const classes = [
  { code: 'full', name: 'Full', fee: 150, note: 'Voting membership' },
  { code: 'junior', name: 'Junior', fee: 75, note: 'For applicants under 18' },
  { code: 'affiliate', name: 'Affiliate', fee: 45, note: 'Non-voting membership' },
];

const steps = ['Membership', 'Your details', 'Agreements', 'Payment'];

export const MembershipJoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<'confirm-email' | 'submitted' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [sameAddress, setSameAddress] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [authorityAccepted, setAuthorityAccepted] = useState(false);
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const [scholarshipAmount, setScholarshipAmount] = useState(5);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('becs');
  const [autoRenew, setAutoRenew] = useState(false);
  const [form, setForm] = useState({
    membershipClass: 'full', name: '', email: '', phone: '', password: '', confirmPassword: '',
    dateOfBirth: '', residentialAddress: '', serviceAddress: '', guardianName: '',
  });

  const isUnder18 = useMemo(() => {
    if (!form.dateOfBirth) return false;
    const birthday = new Date(`${form.dateOfBirth}T00:00:00`);
    const threshold = new Date();
    threshold.setFullYear(threshold.getFullYear() - 18);
    return birthday > threshold;
  }, [form.dateOfBirth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment_setup');
    if (outcome === 'success') {
      setComplete('submitted');
      toast.success('Payment method securely saved');
    } else if (outcome === 'cancelled') {
      setStep(3);
      toast('Payment setup was cancelled. No money was transferred.', { icon: 'ℹ️' });
    }
  }, []);

  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));

  const validateStep = () => {
    if (step === 0) {
      if (form.membershipClass === 'junior' && !isUnder18) {
        toast.error('Junior membership requires a date of birth showing the applicant is under 18');
        return false;
      }
    }
    if (step === 1) {
      if (!form.name.trim() || !form.email.trim() || !form.password || !form.residentialAddress.trim()) {
        toast.error('Complete the required contact and account details');
        return false;
      }
      if (form.password.length < 6) {
        toast.error('Password must be at least 6 characters');
        return false;
      }
      if (form.password !== form.confirmPassword) {
        toast.error('Passwords do not match');
        return false;
      }
      if (isUnder18 && (!form.guardianName.trim() || !guardianConsent)) {
        toast.error('A guardian name and consent are required for applicants under 18');
        return false;
      }
    }
    if (step === 2 && !accepted) {
      toast.error('Please accept the membership agreements');
      return false;
    }
    return true;
  };

  const startPaymentSetup = async () => {
    const { data, error } = await supabase.functions.invoke('membership-payment-setup', {
      body: {
        action: 'save', paymentMethod, autoRenew: paymentMethod === 'invoice' ? false : autoRenew,
        scholarshipContributionEnabled: scholarshipEnabled,
        scholarshipContributionAmount: scholarshipEnabled ? scholarshipAmount : 5,
        authorityAccepted: paymentMethod === 'invoice' ? false : authorityAccepted,
        successUrl: `${window.location.origin}/join?payment_setup=success`,
        cancelUrl: `${window.location.origin}/join?payment_setup=cancelled`,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return true;
    }
    return false;
  };

  const submit = async () => {
    if (!validateStep()) return;
    if (scholarshipEnabled && (!Number.isFinite(scholarshipAmount) || scholarshipAmount < 0.01)) {
      toast.error('Enter a scholarship contribution of at least $0.01');
      return;
    }
    if (paymentMethod !== 'invoice' && !authorityAccepted) {
      toast.error('Accept the payment authority before continuing');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            name: form.name.trim(), phone: form.phone.trim() || null, role: 'student', membership_application: true,
            membership_class: form.membershipClass, date_of_birth: form.dateOfBirth || null,
            residential_address: form.residentialAddress.trim(),
            service_address: sameAddress ? form.residentialAddress.trim() : form.serviceAddress.trim(),
            supports_club_purposes: true, agrees_to_constitution: true, agrees_to_member_guarantee: true,
            agrees_to_code_of_conduct: true, agrees_to_members_manual: true,
            guardian_name: form.guardianName.trim() || null, guardian_consent: guardianConsent,
            membership_payment_method: paymentMethod,
            membership_auto_renew: paymentMethod !== 'invoice' && autoRenew,
            membership_scholarship_enabled: scholarshipEnabled,
            membership_scholarship_amount: scholarshipEnabled ? scholarshipAmount : 5,
          },
          emailRedirectTo: `${window.location.origin}/membership?continue=payment`,
        },
      });
      if (error) throw error;
      if (!data.session) {
        setComplete('confirm-email');
        return;
      }
      const redirected = await startPaymentSetup();
      if (!redirected) setComplete('submitted');
    } catch (error) {
      console.error('Membership signup failed:', error);
      toast.error(error instanceof Error ? error.message : 'Membership signup could not be completed');
    } finally {
      setBusy(false);
    }
  };

  if (complete) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-900">
        <section className="mx-auto max-w-xl rounded-3xl bg-white p-7 shadow-2xl sm:p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"><Check className="h-7 w-7 text-emerald-700" /></div>
          <h1 className="mt-5 text-center text-2xl font-bold">{complete === 'confirm-email' ? 'Check your email' : 'Application submitted'}</h1>
          <p className="mt-3 text-center text-sm leading-6 text-slate-600">
            {complete === 'confirm-email'
              ? 'Use the confirmation link we sent you to activate your portal account, then sign in to finish your payment setup.'
              : 'Your portal account is ready. Membership commences when approved by the committee, or 30 days after your complete application was submitted.'}
          </p>
          <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            You can use the portal now to manage your profile and follow your application. Aircraft self-booking becomes available only after your membership fee is paid or waived.
          </div>
          <button type="button" onClick={() => navigate(complete === 'submitted' ? '/membership' : '/')} className="mt-6 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-950">
            {complete === 'submitted' ? 'Open the member portal' : 'Return to sign in'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 px-4 py-7 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center text-white">
          <Plane className="mx-auto h-9 w-9" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.25em] text-sky-200">Bendigo Flying Club</p>
          <h1 className="mt-2 text-3xl font-bold">Join the club</h1>
          <p className="mt-2 text-sm text-blue-100">One simple application. About five minutes.</p>
        </div>

        <section className="rounded-3xl bg-white p-5 shadow-2xl sm:p-8">
          <ol className="grid grid-cols-4 gap-2" aria-label="Membership application progress">
            {steps.map((label, index) => (
              <li key={label} className={`border-t-4 pt-2 text-center text-[11px] font-semibold sm:text-xs ${index <= step ? 'border-blue-600 text-blue-700' : 'border-slate-200 text-slate-400'}`}>
                <span className="hidden sm:inline">{index + 1}. </span>{label}
              </li>
            ))}
          </ol>

          <div className="mt-7 min-h-[390px]">
            {step === 0 && <div>
              <h2 className="text-xl font-bold">Choose your membership</h2>
              <p className="mt-1 text-sm text-slate-600">Fees are annual and the first year is prorated to 30 June when membership commences.</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {classes.map(item => <button key={item.code} type="button" onClick={() => update('membershipClass', item.code)} className={`rounded-2xl border-2 p-4 text-left transition ${form.membershipClass === item.code ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
                  <span className="block font-bold">{item.name}</span><span className="mt-1 block text-2xl font-bold">${item.fee}<span className="text-xs font-normal text-slate-500">/year</span></span><span className="mt-2 block text-xs text-slate-600">{item.note}</span>
                </button>)}
              </div>
              <label className="mt-5 block text-sm font-medium">Date of birth {form.membershipClass === 'junior' && <span className="text-red-600">*</span>}
                <input type="date" value={form.dateOfBirth} onChange={e => update('dateOfBirth', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" />
              </label>
              <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Life membership is awarded by the club and is not available through online signup. RAAus membership is separate from club membership.</p>
            </div>}

            {step === 1 && <div>
              <h2 className="text-xl font-bold">Tell us about you</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium sm:col-span-2">Full name *<input autoComplete="name" value={form.name} onChange={e => update('name', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="text-sm font-medium">Email *<input type="email" autoComplete="email" value={form.email} onChange={e => update('email', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="text-sm font-medium">Phone<input type="tel" autoComplete="tel" value={form.phone} onChange={e => update('phone', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="text-sm font-medium">Password *<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.password} onChange={e => update('password', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="text-sm font-medium">Confirm password *<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show password</label>
                <label className="text-sm font-medium sm:col-span-2">Residential address *<textarea rows={2} value={form.residentialAddress} onChange={e => update('residentialAddress', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)} /> Use this address for formal notices</label>
                {!sameAddress && <label className="text-sm font-medium sm:col-span-2">Address for formal notices *<textarea rows={2} value={form.serviceAddress} onChange={e => update('serviceAddress', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>}
                {isUnder18 && <><label className="text-sm font-medium">Parent or guardian name *<input value={form.guardianName} onChange={e => update('guardianName', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label><label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={guardianConsent} onChange={e => setGuardianConsent(e.target.checked)} /> Guardian consent provided</label></>}
              </div>
            </div>}

            {step === 2 && <div>
              <ShieldCheck className="h-9 w-9 text-blue-600" />
              <h2 className="mt-3 text-xl font-bold">Membership agreements</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Please read the club documents. Your acknowledgement is stored with the application.</p>
              <div className="mt-4 rounded-2xl border border-slate-200 p-4"><MembershipDocumentLinks /></div>
              <label className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4" /><span>I support the purposes of Bendigo Flying Club and agree to the Constitution, member guarantee, By-laws, Code of Conduct and Members Manual.</span></label>
              <p className="mt-4 text-xs leading-5 text-slate-600">Membership commences when approved at a committee meeting, or automatically 30 days after a complete application is submitted. Your portal account can be used as soon as it is activated.</p>
            </div>}

            {step === 3 && <div>
              <h2 className="text-xl font-bold">Choose how to pay</h2>
              <p className="mt-1 text-sm text-slate-600">No money is taken today. Your prorated invoice is created when membership commences.</p>
              <div className="mt-4 grid gap-3">
                {([
                  ['becs', Landmark, 'Bank account (BECS)', 'Preferred · secure automatic payment'],
                  ['invoice', ReceiptText, 'Invoice each year', 'Pay manually from the Xero invoice'],
                  ['card', CreditCard, 'Card', 'Secure automatic card payment'],
                ] as const).map(([value, Icon, title, description]) => <button key={value} type="button" onClick={() => { setPaymentMethod(value); if (value === 'invoice') setAutoRenew(false); }} className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left ${paymentMethod === value ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}><Icon className="h-5 w-5 text-blue-700" /><span><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-slate-600">{description}</span></span></button>)}
              </div>
              {paymentMethod !== 'invoice' && <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} className="mt-1" /><span><strong>Renew automatically each year</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Payment is attempted on 1 July. If it fails, you have 60 days to pay before membership ceases. Aircraft self-booking is unavailable while unpaid.</span></span></label>
                <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={authorityAccepted} onChange={e => setAuthorityAccepted(e.target.checked)} className="mt-1" /><span>I authorise the club to securely save this payment method with Stripe and collect the initial membership invoice{autoRenew ? ' and future annual renewals after advance notice' : ''}. No payment is taken during setup.</span></label>
              </div>}
              {paymentMethod === 'invoice' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">A renewal invoice is raised before membership can cease. If it remains unpaid, available verified Xero prepaid credit may be applied first.</p>}
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <label className="flex items-center gap-3 text-sm font-semibold text-emerald-950"><input type="checkbox" checked={scholarshipEnabled} onChange={e => setScholarshipEnabled(e.target.checked)} /> Add an optional scholarship contribution</label>
                {scholarshipEnabled && <label className="mt-3 block text-xs text-emerald-900">Annual contribution amount<input type="number" min="0.01" step="0.01" value={scholarshipAmount} onChange={e => setScholarshipAmount(Number(e.target.value))} className="mt-1 w-36 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm" /></label>}
              </div>
            </div>}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <button type="button" onClick={() => step === 0 ? navigate('/') : setStep(step - 1)} className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />{step === 0 ? 'Sign in' : 'Back'}</button>
            {step < 3 ? <button type="button" onClick={() => validateStep() && setStep(step + 1)} className="inline-flex items-center gap-1 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-950">Continue<ChevronRight className="h-4 w-4" /></button>
              : <button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? 'Creating account…' : <><Mail className="h-4 w-4" /> Submit application</>}</button>}
          </div>
        </section>
      </div>
    </main>
  );
};
