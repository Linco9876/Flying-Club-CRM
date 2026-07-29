import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Plane } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useOrganisationSettings } from '../../hooks/useSettings';
import { supabase } from '../../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';

interface KioskLoginFormProps {
  sessionKey: string;
}

export const KioskLoginForm: React.FC<KioskLoginFormProps> = ({ sessionKey }) => {
  const { user } = useAuth();
  const { settings } = useOrganisationSettings();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const businessName = settings?.club_name?.trim() || 'Bendigo Flying Club';

  const handleNormalLogin = async () => {
    localStorage.removeItem(sessionKey);
    if (!user) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    window.location.assign('/');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedToken = token.trim();

    if (!normalizedToken) {
      toast.error('Enter the kiosk access key');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('kiosk-access', {
        body: { action: 'login', token: normalizedToken },
      });
      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(error, 'Unable to open kiosk mode'));
      }
      if (!data?.tokenHash || !data?.sessionGrant) {
        throw new Error(data?.error || 'The kiosk access key could not create a session.');
      }

      const { error: verificationError } = await supabase.auth.verifyOtp({
        token_hash: String(data.tokenHash),
        type: 'magiclink',
      });
      if (verificationError) throw verificationError;

      localStorage.setItem(sessionKey, String(data.sessionGrant));
      setToken('');
      window.location.replace('/kiosk');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to open kiosk mode');
      setIsLoading(false);
    }
  };

  return (
    <div className="kiosk-login-surface relative min-h-screen overflow-hidden bg-[#f8fbff] lg:grid lg:grid-cols-2">
      <img
        src="/auth-aircraft-sunset.webp"
        alt="Aircraft wing at sunset"
        className="auth-hero-image absolute inset-0 h-full w-full object-cover object-left-center"
      />
      <div className="auth-hero-shade absolute inset-0 bg-gradient-to-br from-black/45 via-black/15 to-black/35" />
      <div className="auth-login-wash pointer-events-none absolute inset-0" />

      <div className="relative hidden min-h-screen lg:flex">
        <div className="relative z-10 flex w-full flex-col items-center justify-center px-12 text-center text-white">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur">
            <Plane className="h-7 w-7" />
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight">{businessName}</h1>
          <p className="mt-4 max-w-md text-base font-medium text-white/90">
            Calendar kiosk for rebooking and flight logging
          </p>
        </div>
      </div>

      <div className="relative flex min-h-screen items-center justify-center bg-transparent px-4 py-10 sm:px-6 lg:-ml-px lg:px-10">
        <div className="relative z-20 w-full max-w-lg">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Plane className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-white drop-shadow">{businessName}</h1>
            <p className="mt-2 text-white/90 drop-shadow">Calendar Kiosk</p>
          </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-extrabold text-slate-950">Welcome back!</h2>
            <p className="mt-2 text-sm text-gray-500">Enter the club kiosk access key</p>
          </div>

          <div>
            <label htmlFor="kiosk-token" className="mb-2 block text-sm font-medium text-gray-700">
              Kiosk access key
            </label>
            <div className="relative">
              <input
                id="kiosk-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-3 pr-11 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="bfc_kiosk_…"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowToken((value) => !value)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-700"
                aria-label={showToken ? 'Hide kiosk key' : 'Show kiosk key'}
              >
                {showToken ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">
              An administrator can copy or rotate this key in Settings → Portal &amp; UX.
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition-colors hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            {isLoading ? 'Checking key...' : 'Open Calendar Kiosk'}
          </button>

          <button
            type="button"
            onClick={() => void handleNormalLogin()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
          >
            <ArrowRight className="h-4 w-4" />
            Use normal login
          </button>
        </form>
        </div>
      </div>
    </div>
  );
};
