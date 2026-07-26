import React from 'react';
import { Check, Copy, Loader2, LockKeyhole, Maximize2, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type TotpEnrollment = {
  id: string;
  totp: { qr_code: string; secret: string; uri: string };
};

type ScanFriendlyQr = {
  dataUrl: string;
  largeDataUrl: string;
  pixelSize: number;
  largePixelSize: number;
};

const TOTP_QR_MARGIN_MODULES = 4;
const TOTP_QR_ERROR_CORRECTION = 'Q';

const buildScanFriendlyQr = async (secret: string, accountLabel: string): Promise<ScanFriendlyQr> => {
  const issuer = 'BFC';
  const account = (accountLabel.trim().toLowerCase().split('@')[0] || 'portal-account').slice(0, 20);
  const uri = `otpauth://totp/${issuer}:${encodeURIComponent(account)}?secret=${encodeURIComponent(secret)}&issuer=${issuer}`;
  const qrCodeModule = await import('qrcode');
  const qrCode = qrCodeModule.default ?? qrCodeModule;
  const qr = qrCode.create(uri, { errorCorrectionLevel: TOTP_QR_ERROR_CORRECTION });
  const moduleCount = qr.modules.size;
  const totalModules = moduleCount + (TOTP_QR_MARGIN_MODULES * 2);
  const integerSizeWithin = (maxWidth: number, preferredModulePixels: number) => {
    const modulePixels = Math.max(4, Math.min(preferredModulePixels, Math.floor(maxWidth / totalModules)));
    return totalModules * modulePixels;
  };
  const pixelSize = integerSizeWithin(424, 8);
  const largePixelSize = integerSizeWithin(636, 12);
  const render = (width: number) => qrCode.toDataURL(uri, {
    errorCorrectionLevel: TOTP_QR_ERROR_CORRECTION,
    margin: TOTP_QR_MARGIN_MODULES,
    width,
    type: 'image/png',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
  const [dataUrl, largeDataUrl] = await Promise.all([render(pixelSize), render(largePixelSize)]);

  return { dataUrl, largeDataUrl, pixelSize, largePixelSize };
};

const codeInputClass = 'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.3em] text-gray-950 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white';

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
  const { user } = useAuth();
  const [enrollment, setEnrollment] = React.useState<TotpEnrollment>();
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showLargeQr, setShowLargeQr] = React.useState(false);
  const [secretCopied, setSecretCopied] = React.useState(false);
  const [scanFriendlyQr, setScanFriendlyQr] = React.useState<ScanFriendlyQr>();
  const [qrError, setQrError] = React.useState(false);

  React.useEffect(() => {
    if (!enrollment) {
      setScanFriendlyQr(undefined);
      setQrError(false);
      return undefined;
    }

    let active = true;
    setScanFriendlyQr(undefined);
    setQrError(false);
    void buildScanFriendlyQr(enrollment.totp.secret, user?.email || 'portal-account')
      .then((qr) => {
        if (active) setScanFriendlyQr(qr);
      })
      .catch((error) => {
        console.error('Could not generate scan-friendly authenticator QR code:', error);
        if (active) setQrError(true);
      });

    return () => {
      active = false;
    };
  }, [enrollment, user?.email]);

  React.useEffect(() => {
    if (!showLargeQr) return undefined;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowLargeQr(false);
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [showLargeQr]);

  const begin = async () => {
    setBusy(true);
    try {
      const result = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'BFC Portal',
      });
      if (result.error) throw result.error;
      setEnrollment(result.data as TotpEnrollment);
      setSecretCopied(false);
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
      setShowLargeQr(false);
      onVerified?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That code could not be verified');
    } finally {
      setBusy(false);
    }
  };

  const copySetupKey = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.totp.secret);
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2500);
    } catch {
      toast.error('Could not copy the setup key. Press and hold the key to copy it manually.');
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
      <div className="space-y-4">
        <div
          className="mx-auto flex min-h-48 w-fit max-w-full items-center justify-center rounded-xl border border-gray-200 bg-white p-2 shadow-sm"
          aria-busy={!scanFriendlyQr && !qrError}
        >
          {scanFriendlyQr ? (
            <img
              src={scanFriendlyQr.dataUrl}
              alt="Authenticator QR code"
              width={scanFriendlyQr.pixelSize}
              height={scanFriendlyQr.pixelSize}
              className="block h-auto max-w-full"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : qrError ? (
            <p className="max-w-xs p-6 text-center text-sm text-red-700">
              The QR code could not be prepared. Use the setup key below.
            </p>
          ) : (
            <div className="flex items-center gap-2 p-8 text-sm text-gray-600" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Preparing an easy-scan QR code…
            </div>
          )}
        </div>
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowLargeQr(true)}
            disabled={!scanFriendlyQr}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/60"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            Open larger QR code
          </button>
        </div>
        <div className="text-sm leading-6 text-gray-600 dark:text-gray-300">
          <p>Scan this code with 1Password, Bitwarden, Google Authenticator, Microsoft Authenticator or another TOTP app.</p>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            This version uses larger, crisp squares and a shorter BFC account label for reliable screen scanning. Hold your phone about 20–30 cm from the monitor.
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer font-medium text-blue-700 dark:text-blue-300">Can’t scan it? Use a setup key</summary>
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-gray-100 p-2 dark:bg-gray-800">
              <code className="min-w-0 flex-1 break-all px-1 py-1 font-mono text-sm font-semibold tracking-wider text-gray-900 dark:text-gray-100">
                {enrollment.totp.secret}
              </code>
              <button
                type="button"
                onClick={() => void copySetupKey()}
                className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-700"
                aria-label="Copy authenticator setup key"
              >
                {secretCopied ? <Check className="h-4 w-4 text-green-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {secretCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
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
      {showLargeQr && scanFriendlyQr && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 p-3 sm:p-6"
          role="presentation"
          onMouseDown={() => setShowLargeQr(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="large-mfa-qr-title"
            className="max-h-[96vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <h2 id="large-mfa-qr-title" className="text-lg font-bold text-gray-950">Scan authenticator code</h2>
                <p className="mt-1 text-sm text-gray-600">This larger view is optimised for scanning from a monitor.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowLargeQr(false)}
                autoFocus
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Close enlarged QR code"
              >
                <X className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
            <div className="mx-auto w-fit max-w-full bg-white p-5">
              <img
                src={scanFriendlyQr.largeDataUrl}
                alt="Enlarged authenticator QR code"
                width={scanFriendlyQr.largePixelSize}
                height={scanFriendlyQr.largePixelSize}
                className="block h-auto max-w-full"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
            <p className="mt-3 text-center text-sm text-gray-600">Press Escape, tap outside the panel, or use the close button when finished.</p>
          </section>
        </div>
      )}
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
