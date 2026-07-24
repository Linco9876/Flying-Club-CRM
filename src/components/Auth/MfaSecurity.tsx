import React from 'react';
import { Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type TotpEnrollment = {
  id: string;
  totp: { qr_code: string; secret: string; uri: string };
};

const codeInputClass = 'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.3em] text-gray-950 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

const verifyFactor = async (factorId: string, code: string) => {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verified = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.replace(/\s/g, ''),
  });
  if (verified.error) throw verified.error;
};

export const MfaSetup: React.FC<{ onVerified?: () => void; compact?: boolean }> = ({ onVerified, compact = false }) => {
  const [enrollment, setEnrollment] = React.useState<TotpEnrollment>();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const begin = async () => {
    setBusy(true);
    try {
      const result = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'BFC Portal',
      });
      if (result.error) throw result.error;
      setEnrollment(result.data as TotpEnrollment);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start authenticator setup');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!enrollment || !/^\d{6}$/.test(code.replace(/\s/g, ''))) {
      toast.error('Enter the six-digit code from your authenticator app');
      return;
    }
    setBusy(true);
    try {
      await verifyFactor(enrollment.id, code);
      toast.success('Authenticator protection is now active');
      setEnrollment(undefined);
      setCode('');
      onVerified?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That code could not be verified');
    } finally {
      setBusy(false);
    }
  };

  if (!enrollment) {
    return (
      <button
        type="button"
        onClick={() => void begin()}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        Set up authenticator
      </button>
    );
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
        <img src={enrollment.totp.qr_code} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-xl border border-gray-200 bg-white p-2" />
        <div className="text-sm leading-6 text-gray-600">
          <p>Scan this code with 1Password, Bitwarden, Google Authenticator, Microsoft Authenticator or another TOTP app.</p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-blue-700">Can’t scan it?</summary>
            <code className="mt-2 block break-all rounded bg-gray-100 p-2 text-xs text-gray-800">{enrollment.totp.secret}</code>
          </details>
        </div>
      </div>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-gray-700">Six-digit code</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void confirm();
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          className={codeInputClass}
          aria-label="Six-digit authenticator code"
        />
      </label>
      <button type="button" onClick={() => void confirm()} disabled={busy || code.length !== 6} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
        {busy ? 'Verifying…' : 'Verify and finish'}
      </button>
    </div>
  );
};

export const MfaGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const [state, setState] = React.useState<'checking' | 'enrol' | 'challenge' | 'ready'>('checking');
  const [factorId, setFactorId] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const requiresMfa = roles.some((role) => ['admin', 'senior_instructor', 'instructor'].includes(role));

  const assess = React.useCallback(async () => {
    if (!requiresMfa) {
      setState('ready');
      return;
    }
    const [assurance, factors] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (assurance.error) throw assurance.error;
    if (factors.error) throw factors.error;
    if (assurance.data.currentLevel === 'aal2') {
      setState('ready');
      return;
    }
    const verified = factors.data.totp.find((factor) => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setState('challenge');
    } else {
      setState('enrol');
    }
  }, [requiresMfa]);

  React.useEffect(() => {
    void assess().catch((error) => {
      console.error('MFA assessment failed:', error);
      setState(requiresMfa ? 'enrol' : 'ready');
    });
  }, [assess, requiresMfa]);

  if (state === 'ready') return <>{children}</>;
  if (state === 'checking') {
    return <div className="grid min-h-screen place-items-center bg-slate-950 text-white"><Loader2 className="h-8 w-8 animate-spin" aria-label="Checking account security" /></div>;
  }

  const submitChallenge = async () => {
    if (!/^\d{6}$/.test(code)) return;
    setBusy(true);
    try {
      await verifyFactor(factorId, code);
      setState('ready');
    } catch {
      toast.error('That code was not accepted. Wait for a new code and try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl sm:p-8" aria-labelledby="mfa-title">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><LockKeyhole className="h-6 w-6" /></div>
        <h1 id="mfa-title" className="text-2xl font-bold text-gray-950">{state === 'enrol' ? 'Protect your staff account' : 'Enter your authenticator code'}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          {state === 'enrol'
            ? 'Staff accounts can change bookings and member records, so a one-time authenticator setup is required. You will normally only be asked again on a new browser or device.'
            : 'This extra check protects club and member information. Your verified session remains signed in on this device.'}
        </p>
        <div className="mt-6">
          {state === 'enrol' ? (
            <MfaSetup onVerified={() => setState('ready')} />
          ) : (
            <div className="space-y-4">
              <input
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitChallenge();
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                className={codeInputClass}
                aria-label="Six-digit authenticator code"
              />
              <button type="button" onClick={() => void submitChallenge()} disabled={busy || code.length !== 6} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </div>
          )}
        </div>
        <button type="button" onClick={() => void logout()} className="mt-5 w-full text-center text-sm font-medium text-gray-500 hover:text-gray-800">Sign out</button>
      </section>
    </main>
  );
};

export const MfaSettings: React.FC = () => {
  const [verifiedFactor, setVerifiedFactor] = React.useState<{ id: string; friendly_name?: string }>();
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await supabase.auth.mfa.listFactors();
    if (result.error) toast.error(result.error.message);
    setVerifiedFactor(result.data?.totp.find((factor) => factor.status === 'verified'));
    setLoading(false);
  }, []);

  React.useEffect(() => { void load(); }, [load]);
  if (loading) return <p className="text-sm text-gray-500">Checking authenticator status…</p>;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className={`mt-0.5 h-5 w-5 ${verifiedFactor ? 'text-green-600' : 'text-gray-400'}`} />
        <div className="flex-1">
          <h4 className="font-semibold text-gray-950">Authenticator protection</h4>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            {verifiedFactor
              ? 'Active. You will normally be prompted only on a new browser or device.'
              : 'Add a six-digit authenticator check. It is required for staff and optional for members.'}
          </p>
          <div className="mt-4">
            {verifiedFactor ? (
              <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">Protected</span>
            ) : (
              <MfaSetup compact onVerified={() => void load()} />
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">If you lose your authenticator, contact a club administrator to reset the factor after an identity check.</p>
        </div>
      </div>
    </div>
  );
};
