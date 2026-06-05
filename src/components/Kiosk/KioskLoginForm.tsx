import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Plane } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useOrganisationSettings } from '../../hooks/useSettings';

interface KioskLoginFormProps {
  sessionKey: string;
}

export const KioskLoginForm: React.FC<KioskLoginFormProps> = ({ sessionKey }) => {
  const { login, isLoading } = useAuth();
  const { settings } = useOrganisationSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const businessName = settings?.club_name?.trim() || 'Bendigo Flying Club';

  const handleNormalLogin = () => {
    localStorage.removeItem(sessionKey);
    window.location.assign('/');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      toast.error('Enter the kiosk email and password');
      return;
    }

    const result = await login(normalizedEmail, password);
    if (!result.success) {
      toast.error(result.error || 'Unable to open kiosk mode');
      return;
    }

    localStorage.setItem(sessionKey, 'true');
  };

  return (
    <div className="kiosk-login-surface min-h-screen bg-white lg:grid lg:grid-cols-2">
      <div className="relative hidden min-h-screen overflow-hidden lg:flex">
        <img
          src="/auth-aircraft-sunset.png"
          alt="Aircraft wing at sunset"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/35 via-black/10 to-black/50" />
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

      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-10 sm:px-6 lg:bg-white lg:px-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Plane className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-gray-900">{businessName}</h1>
            <p className="mt-2 text-gray-600">Calendar Kiosk</p>
          </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-extrabold text-slate-950">Welcome back!</h2>
            <p className="mt-2 text-sm text-gray-500">Open the club calendar kiosk</p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="kiosk-email" className="mb-2 block text-sm font-medium text-gray-700">
                Kiosk Email
              </label>
              <input
                id="kiosk-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Type your email"
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="kiosk-password" className="mb-2 block text-sm font-medium text-gray-700">
                Kiosk Password
              </label>
              <div className="relative">
                <input
                  id="kiosk-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-3 pr-11 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Type your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition-colors hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            {isLoading ? 'Opening kiosk...' : 'Open Calendar Kiosk'}
          </button>

          <button
            type="button"
            onClick={handleNormalLogin}
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
