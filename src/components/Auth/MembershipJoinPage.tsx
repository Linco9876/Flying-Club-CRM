import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CreditCard, Landmark, Loader2, Lock, Mail, Plane, ReceiptText, ShieldCheck, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { MembershipDocumentLinks } from '../Membership/MembershipDocumentLinks';
import { TurnstileWidget } from './TurnstileWidget';
import { AddressAutocomplete } from '../common/AddressAutocomplete';
import { useMembershipDocuments } from '../../hooks/useMembershipDocuments';
import { membershipDocumentsAreReady } from '../../utils/membershipDocumentRules';
import { PRIVACY_NOTICE_VERSION } from '../../utils/privacyNotice';
import { useAuth } from '../../context/AuthContext';
import { useFinancialProviders } from '../../context/financialProviderState';
import {
  buildPortalSignupMetadata,
  getPortalSignupSteps,
  type PortalSignupIntent,
} from '../../utils/portalSignup';

type PaymentMethod = 'becs' | 'invoice' | 'card';
const turnstileEnabled = Boolean(import.meta.env.VITE_TURNSTILE_SITE_KEY);

interface PublicMembershipClass {
  code: string;
  name: string;
  description: string;
  annualFee: number;
  hasVotingRights: boolean;
  canSelfBookAircraft: boolean;
}

const fallbackClasses: PublicMembershipClass[] = [
  { code: 'full', name: 'Full', description: 'Voting membership', annualFee: 150, hasVotingRights: true, canSelfBookAircraft: true },
  { code: 'junior', name: 'Junior', description: 'For applicants under 18', annualFee: 75, hasVotingRights: false, canSelfBookAircraft: true },
  { code: 'affiliate', name: 'Affiliate', description: 'Non-voting affiliate membership', annualFee: 45, hasVotingRights: false, canSelfBookAircraft: true },
];

export const MembershipJoinPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading, refreshUser } = useAuth();
  const {
    capabilities: financialProviders,
    loading: financialProvidersLoading,
  } = useFinancialProviders();
  const prefilledUserId = useRef<string | null>(null);
  const [step, setStep] = useState(0);
  const [signupIntent, setSignupIntent] = useState<PortalSignupIntent>('portal');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState<'confirm-email' | 'account-created' | 'membership-submitted' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [sameAddress, setSameAddress] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [authorityAccepted, setAuthorityAccepted] = useState(false);
  const [scholarshipEnabled, setScholarshipEnabled] = useState(false);
  const [scholarshipAmount, setScholarshipAmount] = useState(5);
  const [membershipClasses, setMembershipClasses] = useState<PublicMembershipClass[]>(fallbackClasses);
  const [scholarshipSettings, setScholarshipSettings] = useState({
    available: true,
    defaultAmount: 5,
    minimumAmount: 0.01,
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('becs');
  const [autoRenew, setAutoRenew] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [form, setForm] = useState({
    membershipClass: 'full', name: '', email: '', phone: '', password: '', confirmPassword: '',
    dateOfBirth: '', residentialAddress: '', serviceAddress: '', guardianName: '',
  });
  const {
    documents: membershipDocuments,
    loading: membershipDocumentsLoading,
    error: membershipDocumentsError,
  } = useMembershipDocuments({ currentOnly: true, acknowledgementOnly: true });
  const membershipDocumentsReady = membershipDocumentsAreReady(
    membershipDocuments,
    membershipDocumentsLoading,
    membershipDocumentsError,
  );
  const wantsMembership = Boolean(user) || signupIntent === 'membership';
  const steps = useMemo(
    () => getPortalSignupSteps(wantsMembership ? 'membership' : 'portal'),
    [wantsMembership],
  );
  const finalStep = steps.length - 1;
  const availablePaymentMethods = useMemo(() => {
    const methods: PaymentMethod[] = [];
    if (financialProviders.stripe.paymentsAvailable) methods.push('becs', 'card');
    if (financialProviders.xero.postingAvailable) methods.splice(1, 0, 'invoice');
    return methods;
  }, [
    financialProviders.stripe.paymentsAvailable,
    financialProviders.xero.postingAvailable,
  ]);

  useEffect(() => {
    if (user) setSignupIntent('membership');
  }, [user]);

  useEffect(() => {
    if (availablePaymentMethods.length > 0 && !availablePaymentMethods.includes(paymentMethod)) {
      setPaymentMethod(availablePaymentMethods[0]);
      setAutoRenew(false);
      setAuthorityAccepted(false);
    }
  }, [availablePaymentMethods, paymentMethod]);

  useEffect(() => {
    let cancelled = false;
    const loadMembershipConfiguration = async () => {
      const { data, error } = await supabase.rpc('get_public_membership_configuration');
      if (cancelled) return;
      if (error) {
        console.error('Failed to load public membership configuration:', error);
        return;
      }
      const configuration = data as {
        classes?: PublicMembershipClass[];
        scholarship?: { available?: boolean; defaultAmount?: number; minimumAmount?: number };
      } | null;
      const nextClasses = Array.isArray(configuration?.classes)
        ? configuration.classes.map(item => ({
            ...item,
            annualFee: Number(item.annualFee || 0),
          }))
        : [];
      if (nextClasses.length > 0) {
        setMembershipClasses(nextClasses);
        setForm(current => nextClasses.some(item => item.code === current.membershipClass)
          ? current
          : { ...current, membershipClass: nextClasses[0].code });
      }
      const defaultAmount = Math.max(0.01, Number(configuration?.scholarship?.defaultAmount ?? 5));
      const minimumAmount = Math.max(0.01, Number(configuration?.scholarship?.minimumAmount ?? 0.01));
      setScholarshipSettings({
        available: configuration?.scholarship?.available !== false,
        defaultAmount,
        minimumAmount,
      });
      setScholarshipEnabled(current => configuration?.scholarship?.available === false ? false : current);
      setScholarshipAmount(defaultAmount);
    };
    void loadMembershipConfiguration();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user || prefilledUserId.current === user.id) return;
    setForm(current => ({
      ...current,
      name: user.name || '',
      email: user.email || '',
      phone: user.mobilePhone || user.phone || '',
      password: '',
      confirmPassword: '',
      dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().slice(0, 10) : '',
      residentialAddress: user.address || '',
      serviceAddress: user.address || '',
    }));
    setSameAddress(true);
    prefilledUserId.current = user.id;
  }, [user]);

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
      setSignupIntent('membership');
      setComplete('membership-submitted');
      toast.success('Payment method securely saved');
    } else if (outcome === 'cancelled') {
      setSignupIntent('membership');
      setStep(3);
      toast('Payment setup was cancelled. No money was transferred.', { icon: 'ℹ️' });
    }
  }, []);

  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));

  const validateStep = () => {
    if (step === 0 && wantsMembership) {
      if (!form.dateOfBirth) {
        toast.error('Enter your date of birth so the club can confirm the correct membership class');
        return false;
      }
      if (form.membershipClass === 'junior' && !isUnder18) {
        toast.error('Junior membership requires a date of birth showing the applicant is under 18');
        return false;
      }
    }
    if (step === 1) {
      if (!form.name.trim() || !form.email.trim()) {
        toast.error('Complete the required contact and account details');
        return false;
      }
      if (wantsMembership && (!form.residentialAddress.trim() || (!sameAddress && !form.serviceAddress.trim()))) {
        toast.error('Complete the required membership contact details');
        return false;
      }
      if (!user && form.password.length < 12) {
        toast.error('Password must be at least 12 characters');
        return false;
      }
      if (!user && form.password !== form.confirmPassword) {
        toast.error('Passwords do not match');
        return false;
      }
      if (wantsMembership && isUnder18 && (!form.guardianName.trim() || !guardianConsent)) {
        toast.error('A guardian name and consent are required for applicants under 18');
        return false;
      }
    }
    if (step === 2 && !privacyAccepted) {
      toast.error('Please accept the portal privacy notice');
      return false;
    }
    if (step === 2 && wantsMembership && (!accepted || !membershipDocumentsReady)) {
      toast.error('Please accept the membership agreements');
      return false;
    }
    return true;
  };

  const startPaymentSetup = async () => {
    if (!financialProviders.financeEnabled) return false;
    const { data, error } = await supabase.functions.invoke('membership-payment-setup', {
      body: {
        action: 'save', paymentMethod, autoRenew: paymentMethod === 'invoice' ? false : autoRenew,
        scholarshipContributionEnabled: scholarshipEnabled,
        scholarshipContributionAmount: scholarshipEnabled ? scholarshipAmount : scholarshipSettings.defaultAmount,
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
    if (
      wantsMembership &&
      scholarshipEnabled &&
      (!Number.isFinite(scholarshipAmount) || scholarshipAmount < scholarshipSettings.minimumAmount)
    ) {
      toast.error(`Enter a scholarship contribution of at least $${scholarshipSettings.minimumAmount.toFixed(2)}`);
      return;
    }
    if (
      wantsMembership &&
      financialProviders.stripe.paymentsAvailable &&
      paymentMethod !== 'invoice' &&
      !authorityAccepted
    ) {
      toast.error('Accept the payment authority before continuing');
      return;
    }
    if (!user && turnstileEnabled && !captchaToken) {
      toast.error('Complete the quick security check before submitting');
      return;
    }
    setBusy(true);
    try {
      if (user) {
        const { error: applicationError } = await supabase.rpc('submit_membership_application', {
          p_membership_class_code: form.membershipClass,
          p_residential_address: form.residentialAddress.trim(),
          p_service_address: sameAddress ? form.residentialAddress.trim() : form.serviceAddress.trim(),
          p_date_of_birth: form.dateOfBirth || null,
          p_guardian_name: form.guardianName.trim() || null,
          p_guardian_consent: guardianConsent,
          p_supports_club_purposes: true,
          p_agrees_to_constitution: true,
          p_agrees_to_member_guarantee: true,
          p_agrees_to_code_of_conduct: true,
          p_agrees_to_members_manual: true,
          p_privacy_notice_accepted: true,
          p_privacy_notice_version: PRIVACY_NOTICE_VERSION,
          p_acknowledged_document_ids: membershipDocuments.map(document => document.id),
          p_applicant_name: form.name.trim(),
          p_phone: form.phone.trim(),
          p_update_profile: true,
        });
        if (applicationError) throw applicationError;
        try {
          await refreshUser();
        } catch (refreshError) {
          console.warn('Membership application saved, but the refreshed profile could not be loaded:', refreshError);
        }
        const redirected = await startPaymentSetup();
        if (!redirected) setComplete('membership-submitted');
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          captchaToken: captchaToken || undefined,
          data: buildPortalSignupMetadata({
            intent: wantsMembership ? 'membership' : 'portal',
            name: form.name,
            phone: form.phone,
            privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
            membership: wantsMembership ? {
              membershipClass: form.membershipClass,
              dateOfBirth: form.dateOfBirth,
              residentialAddress: form.residentialAddress,
              serviceAddress: sameAddress ? form.residentialAddress : form.serviceAddress,
              guardianName: form.guardianName,
              guardianConsent,
              paymentMethod: financialProviders.financeEnabled ? paymentMethod : null,
              autoRenew: financialProviders.stripe.paymentsAvailable && paymentMethod !== 'invoice' && autoRenew,
              scholarshipEnabled,
              scholarshipAmount: scholarshipEnabled ? scholarshipAmount : scholarshipSettings.defaultAmount,
              documentIds: membershipDocuments.map(document => document.id),
            } : undefined,
          }),
          emailRedirectTo: wantsMembership
            ? `${window.location.origin}/membership?continue=payment`
            : `${window.location.origin}/`,
        },
      });
      if (error) throw error;
      if (!data.session) {
        setComplete('confirm-email');
        return;
      }
      if (!wantsMembership) {
        setComplete('account-created');
        return;
      }
      const redirected = await startPaymentSetup();
      if (!redirected) setComplete('membership-submitted');
    } catch (error) {
      console.error('Membership signup failed:', error);
      toast.error(error instanceof Error ? error.message : 'Membership signup could not be completed');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex items-center gap-3 text-sm font-semibold"><Loader2 className="h-5 w-5 animate-spin" /> Loading your account…</div>
      </main>
    );
  }

  if (complete) {
    const membershipCompleted = complete === 'membership-submitted';
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-900">
        <section className="mx-auto max-w-xl rounded-3xl bg-white p-7 shadow-2xl sm:p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"><Check className="h-7 w-7 text-emerald-700" /></div>
          <h1 className="mt-5 text-center text-2xl font-bold">
            {complete === 'confirm-email'
              ? 'Check your email'
              : membershipCompleted
                ? 'Application submitted'
                : 'Portal account created'}
          </h1>
          <p className="mt-3 text-center text-sm leading-6 text-slate-600">
            {complete === 'confirm-email'
              ? wantsMembership
                ? financialProviders.financeEnabled
                  ? 'Use the confirmation link we sent you to activate your portal account, then sign in to finish your membership payment setup.'
                  : 'Use the confirmation link we sent you to activate your portal account. Payment setup is currently unavailable while the club reconnects its financial services.'
                : 'Use the confirmation link we sent you to activate your portal account, then sign in.'
              : membershipCompleted
                ? 'Your portal account is ready. Membership commences when approved by the committee, or 30 days after your complete application was submitted.'
                : 'Your account is ready. You have not applied for club membership and no membership payment will be taken.'}
          </p>
          <div className="mt-6 rounded-2xl bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            {wantsMembership
              ? 'You can use the portal to manage your profile and follow your application. Where your membership includes aircraft self-booking, it becomes available after the membership fee is paid or waived.'
              : 'You can manage your profile and use the portal features available to your account. You can apply for club membership later from the Membership tab.'}
          </div>
          <button type="button" onClick={() => navigate(membershipCompleted ? '/membership' : '/')} className="mt-6 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-950">
            {complete === 'confirm-email' ? 'Return to sign in' : 'Open the portal'}
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
          <h1 className="mt-2 text-3xl font-bold">{user ? 'Apply for club membership' : 'Create your portal account'}</h1>
          <p className="mt-2 text-sm text-blue-100">
            {user ? `Applying as ${user.name}` : 'Membership is optional and can be added now or later.'}
          </p>
        </div>

        <section className="rounded-3xl bg-white p-5 shadow-2xl sm:p-8">
          <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Signup progress">
            {steps.map((label, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined} className={`border-t-4 pt-2 text-center text-[11px] font-semibold sm:text-xs ${index <= step ? 'border-blue-700 text-blue-800' : 'border-slate-300 text-slate-600'}`}>
                <span className="hidden sm:inline">{index + 1}. </span>{label}
              </li>
            ))}
          </ol>

          <div className="mt-7 min-h-[390px]">
            {step === 0 && <div>
              {!user && <>
                <h2 className="text-xl font-bold">How would you like to start?</h2>
                <p className="mt-1 text-sm text-slate-600">Both choices create the same secure portal account. Club membership is optional.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={signupIntent === 'portal'}
                    onClick={() => setSignupIntent('portal')}
                    className={`rounded-2xl border-2 p-5 text-left transition ${signupIntent === 'portal' ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}
                  >
                    <UserPlus className="h-6 w-6 text-blue-700" />
                    <span className="mt-3 block font-bold">Portal account only</span>
                    <span className="mt-1 block text-sm leading-5 text-slate-600">Create an account without applying or paying for club membership.</span>
                    <span className="mt-3 block text-xs font-semibold text-blue-800">You can add membership later</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={signupIntent === 'membership'}
                    onClick={() => setSignupIntent('membership')}
                    className={`rounded-2xl border-2 p-5 text-left transition ${signupIntent === 'membership' ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}
                  >
                    <CreditCard className="h-6 w-6 text-blue-700" />
                    <span className="mt-3 block font-bold">Account and club membership</span>
                    <span className="mt-1 block text-sm leading-5 text-slate-600">Apply for membership and choose how you would like to pay.</span>
                    <span className="mt-3 block text-xs font-semibold text-blue-800">Membership approval rules still apply</span>
                  </button>
                </div>
              </>}
              {wantsMembership ? <>
                <h2 className={`${user ? '' : 'mt-7'} text-xl font-bold`}>Choose your membership</h2>
                <p className="mt-1 text-sm text-slate-600">Fees are annual, include GST and the first year is prorated to 30 June when membership commences.</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {membershipClasses.map(item => <button key={item.code} type="button" onClick={() => update('membershipClass', item.code)} className={`rounded-2xl border-2 p-4 text-left transition ${form.membershipClass === item.code ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-blue-300'}`}>
                    <span className="block font-bold">{item.name}</span><span className="mt-1 block text-2xl font-bold">${item.annualFee}<span className="text-xs font-normal text-slate-600">/year</span></span><span className="mt-2 block text-xs text-slate-600">{item.description}</span><span className="mt-2 block text-[11px] font-semibold text-blue-800">{[item.hasVotingRights ? 'Voting rights' : 'Non-voting', item.canSelfBookAircraft ? 'Aircraft self-booking included' : 'No aircraft self-booking'].join(' · ')}</span>
                  </button>)}
                </div>
                <label className="mt-5 block text-sm font-medium">Date of birth <span className="text-red-600">*</span>
                  <input required type="date" autoComplete="bday" value={form.dateOfBirth} onChange={e => update('dateOfBirth', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" />
                </label>
                <p className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Life membership is awarded by the club and is not available through online signup. RAAus membership is separate from club membership.</p>
              </> : (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
                  No membership application, invoice or automatic payment will be created. Aircraft self-booking remains subject to the club’s membership rules.
                </div>
              )}
            </div>}

            {step === 1 && <div>
              <h2 className="text-xl font-bold">Tell us about you</h2>
              {user && <div className="mt-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-900"><Check className="mt-0.5 h-4 w-4 shrink-0" /><span>Your portal details are prefilled. Changes to your name, phone, date of birth or residential address will be saved to your profile when you submit this application.</span></div>}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium sm:col-span-2">Full name *<input autoComplete="name" value={form.name} onChange={e => update('name', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="text-sm font-medium">Email *<span className="relative mt-1 block"><input type="email" autoComplete="email" value={form.email} readOnly={Boolean(user)} onChange={e => !user && update('email', e.target.value)} className={`w-full rounded-xl border border-slate-300 px-3 py-3 ${user ? 'bg-slate-100 pr-10 text-slate-600' : ''}`} />{user && <Lock aria-label="Login email cannot be changed here" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />}</span>{user && <span className="mt-1 block text-xs font-normal text-slate-500">This is your verified login email and cannot be changed here.</span>}</label>
                <label className="text-sm font-medium">Phone<input type="tel" autoComplete="tel" value={form.phone} onChange={e => update('phone', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                {!user && <><label className="text-sm font-medium">Password *<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} value={form.password} onChange={e => update('password', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters.</span></label>
                <label className="text-sm font-medium">Confirm password *<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)} /> Show password</label></>}
                {wantsMembership && <>
                  <label className="text-sm font-medium sm:col-span-2">Residential address *
                    <AddressAutocomplete required value={form.residentialAddress} onChange={value => update('residentialAddress', value)} className="mt-1" />
                  </label>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)} /> Use this address for formal notices</label>
                  {!sameAddress && <label className="text-sm font-medium sm:col-span-2">Address for formal notices *
                    <AddressAutocomplete required value={form.serviceAddress} onChange={value => update('serviceAddress', value)} className="mt-1" placeholder="Start typing your address for formal notices" autoComplete="street-address" />
                  </label>}
                  {isUnder18 && <><label className="text-sm font-medium">Parent or guardian name *<input value={form.guardianName} onChange={e => update('guardianName', e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3" /></label><label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={guardianConsent} onChange={e => setGuardianConsent(e.target.checked)} /> Guardian consent provided</label></>}
                </>}
              </div>
            </div>}

            {step === 2 && <div>
              <ShieldCheck className="h-9 w-9 text-blue-600" />
              <h2 className="mt-3 text-xl font-bold">{wantsMembership ? 'Membership agreements' : 'Portal privacy'}</h2>
              {wantsMembership && <>
                <p className="mt-2 text-sm leading-6 text-slate-600">Please read the club documents. Your acknowledgement is stored with the application.</p>
                <div className="mt-4 rounded-2xl border border-slate-200 p-4"><MembershipDocumentLinks documents={membershipDocuments} loading={membershipDocumentsLoading} error={membershipDocumentsError} /></div>
                <label className="mt-5 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"><input type="checkbox" disabled={!membershipDocumentsReady} checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 h-4 w-4 disabled:opacity-50" /><span>I support the purposes of Bendigo Flying Club, accept the member guarantee, and confirm I have read and agree to each current membership document listed above. The document versions and my acknowledgement will be retained with my application.</span></label>
              </>}
              {!wantsMembership && <p className="mt-2 text-sm leading-6 text-slate-600">Review how the club protects and uses the information in your portal account.</p>}
              <label className="mt-3 flex items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm leading-6 text-slate-800"><input type="checkbox" checked={privacyAccepted} onChange={e => setPrivacyAccepted(e.target.checked)} className="mt-1 h-4 w-4" /><span>I have read the <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-blue-700 underline">portal privacy notice</a> and understand how my information is used for membership, bookings, safety, training, accounting and portal security.</span></label>
              <p className="mt-4 text-xs leading-5 text-slate-600">
                {wantsMembership
                  ? 'Membership commences when approved at a committee meeting, or automatically 30 days after a complete application is submitted. Your portal account can be used as soon as it is activated.'
                  : 'This creates a portal account only. It does not create a membership application or payment obligation.'}
              </p>
              {!wantsMembership && !user && <div className="mt-4"><TurnstileWidget onToken={setCaptchaToken} /></div>}
            </div>}

            {step === 3 && wantsMembership && <div>
              <h2 className="text-xl font-bold">{financialProviders.financeEnabled ? 'Choose how to pay' : 'Payment setup unavailable'}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {financialProviders.xero.postingAvailable
                  ? 'No money is taken today. Your prorated invoice is created when membership commences.'
                  : financialProviders.stripe.paymentsAvailable
                    ? 'No money is taken today. Your saved payment authority is used when membership commences.'
                    : 'Stripe and Xero are disconnected. You can still submit your application; no invoice or debit will be created until an administrator reconnects a financial service or waives the fee.'}
              </p>
              {financialProvidersLoading ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking available payment methods…
                </div>
              ) : availablePaymentMethods.length > 0 && <div className="mt-4 grid gap-3">
                {([
                  ['becs', Landmark, 'Bank account (BECS)', 'Preferred · secure automatic payment'],
                  ['invoice', ReceiptText, 'Invoice each year', 'Pay manually from the Xero invoice'],
                  ['card', CreditCard, 'Card', 'Secure automatic card payment'],
                ] as const)
                  .filter(([value]) => availablePaymentMethods.includes(value))
                  .map(([value, Icon, title, description]) => <button key={value} type="button" onClick={() => { setPaymentMethod(value); if (value === 'invoice') setAutoRenew(false); }} className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left ${paymentMethod === value ? 'border-blue-600 bg-blue-50' : 'border-slate-200'}`}><Icon className="h-5 w-5 text-blue-700" /><span><span className="block text-sm font-bold">{title}</span><span className="block text-xs text-slate-600">{description}</span></span></button>)}
              </div>}
              {financialProviders.stripe.paymentsAvailable && paymentMethod !== 'invoice' && <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={autoRenew} onChange={e => setAutoRenew(e.target.checked)} className="mt-1" /><span><strong>Renew automatically each year</strong><span className="mt-1 block text-xs leading-5 text-slate-600">Payment is attempted on 1 July. If it fails, you have 60 days to pay before membership ceases. Aircraft self-booking is unavailable while unpaid.</span></span></label>
                <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={authorityAccepted} onChange={e => setAuthorityAccepted(e.target.checked)} className="mt-1" /><span>I authorise the club to securely save this payment method with Stripe and collect the initial membership invoice{autoRenew ? ' and future annual renewals after advance notice' : ''}. No payment is taken during setup.</span></label>
              </div>}
              {financialProviders.xero.postingAvailable && paymentMethod === 'invoice' && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">A renewal invoice is raised before membership can cease. If it remains unpaid, available verified Xero prepaid credit may be applied first.</p>}
              {scholarshipSettings.available && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <label className="flex items-center gap-3 text-sm font-semibold text-emerald-950"><input type="checkbox" checked={scholarshipEnabled} onChange={e => setScholarshipEnabled(e.target.checked)} /> Add an optional scholarship contribution</label>
                {scholarshipEnabled && <label className="mt-3 block text-xs text-emerald-900">Annual contribution amount<input type="number" min={scholarshipSettings.minimumAmount} step="0.01" value={scholarshipAmount} onChange={e => setScholarshipAmount(Number(e.target.value))} className="mt-1 w-36 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm" /><span className="ml-2">Minimum ${scholarshipSettings.minimumAmount.toFixed(2)}</span></label>}
              </div>}
              {!user && <div className="mt-4"><TurnstileWidget onToken={setCaptchaToken} /></div>}
            </div>}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
            <button type="button" onClick={() => step === 0 ? navigate(user ? '/membership' : '/') : setStep(step - 1)} className="inline-flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" />{step === 0 ? (user ? 'Back to portal' : 'Sign in') : 'Back'}</button>
            {step < finalStep ? <button type="button" onClick={() => validateStep() && setStep(step + 1)} className="inline-flex items-center gap-1 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-950">Continue<ChevronRight className="h-4 w-4" /></button>
              : <button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">{busy ? (user ? 'Submitting application…' : 'Creating account…') : <><Mail className="h-4 w-4" /> {wantsMembership ? 'Submit application' : 'Create portal account'}</>}</button>}
          </div>
        </section>
      </div>
    </main>
  );
};
