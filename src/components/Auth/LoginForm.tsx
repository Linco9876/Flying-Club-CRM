import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plane, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { SignUpForm } from './SignUpForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export const LoginForm: React.FC = () => {
  const { login, isLoading } = useAuth();
  const [email, setEmail] = useState(() => sessionStorage.getItem('lastPasswordResetEmail') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      toast.error('Please enter both email and password');
      return;
    }

    try {
      const result = await login(normalizedEmail, password);
      if (!result.success) {
        toast.error(result.error || 'Unable to sign in. Please check your details and try again.');
      } else {
        sessionStorage.removeItem('lastPasswordResetEmail');
        localStorage.removeItem('bfc_kiosk_mode');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('An error occurred during login. Please try again.');
    }
  };

  if (showSignUp) {
    return <SignUpForm onBackToLogin={() => setShowSignUp(false)} />;
  }

  if (showForgotPassword) {
    return <ForgotPasswordForm onBackToLogin={() => setShowForgotPassword(false)} />;
  }

  return (
    <div className="auth-light-surface relative min-h-screen overflow-hidden bg-[#f8fbff] lg:grid lg:grid-cols-2">
      <img
        src="/auth-aircraft-sunset.png"
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
          <h1 className="text-5xl font-extrabold tracking-tight">Bendigo Flying Club</h1>
          <p className="mt-4 max-w-md text-base font-medium text-white/90">
            Members Flight Management System
          </p>
        </div>
      </div>

      <div className="relative flex min-h-screen items-center justify-center bg-transparent px-4 py-4 sm:px-6 sm:py-10 lg:-ml-px lg:px-10">
        <div className="relative z-20 w-full max-w-md lg:max-w-lg">
          <div className="mb-4 text-center sm:mb-8 lg:hidden">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 sm:mb-4 sm:h-16 sm:w-16">
              <Plane className="h-6 w-6 text-white sm:h-8 sm:w-8" />
            </div>
            <h2 className="text-2xl font-extrabold text-white drop-shadow sm:text-3xl">Bendigo Flying Club</h2>
            <p className="mt-1 text-sm text-white/90 drop-shadow sm:mt-2 sm:text-base">Members Flight Management System</p>
          </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xl sm:p-8">
          <div className="mb-5 text-center sm:mb-8">
            <h2 className="text-2xl font-extrabold text-slate-950 sm:text-3xl">Welcome back!</h2>
            <p className="mt-2 text-sm text-gray-500">Go ahead and log in below</p>
          </div>

          {email && sessionStorage.getItem('lastPasswordResetEmail') === email && (
            <div className="mb-5 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Use the new password for <span className="font-semibold">{email}</span>.
            </div>
          )}

          <form className="space-y-4 sm:space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2.5 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-3"
                placeholder="Type your email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2.5 pr-10 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:py-3"
                  placeholder="Type your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-sm text-blue-600 hover:text-blue-500 font-medium"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full justify-center rounded-xl border border-transparent bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition-colors hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:py-3"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-4 text-center sm:mt-6">
            <button
              onClick={() => setShowSignUp(true)}
              className="text-sm text-blue-600 hover:text-blue-500 font-medium"
            >
              Don't have an account? Sign up
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
