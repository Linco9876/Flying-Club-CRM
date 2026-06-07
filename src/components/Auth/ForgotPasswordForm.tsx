import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plane, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({ onBackToLogin }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setIsLoading(true);

    try {
      const authRedirectOrigin = import.meta.env.VITE_AUTH_REDIRECT_ORIGIN?.trim();
      const redirectOrigin = authRedirectOrigin || window.location.origin;
      const basePath = authRedirectOrigin ? '/' : import.meta.env.BASE_URL;
      const redirectUrl = `${redirectOrigin.replace(/\/$/, '')}${basePath}reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectUrl
      });

      if (error) throw error;

      setEmailSent(true);
      toast.success('Password reset email sent! Check your inbox.');
    } catch (error: any) {
      console.error('Password reset error:', error);
      toast.error(error.message || 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-light-surface min-h-screen bg-white lg:grid lg:grid-cols-2">
      <div className="relative hidden min-h-screen overflow-hidden lg:flex">
        <img
          src="/auth-aircraft-sunset.png"
          alt="Aircraft wing at sunset"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/35 via-black/10 to-black/50" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-48 bg-gradient-to-r from-transparent via-white/25 to-white" />
        <div className="relative z-10 flex w-full flex-col items-center justify-center px-12 text-center text-white">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur">
            <Plane className="h-7 w-7" />
          </div>
          <h1 className="text-5xl font-extrabold tracking-tight">Bendigo Flying Club</h1>
          <p className="mt-4 max-w-md text-base font-medium text-white/90">
            Get back into your flight training portal
          </p>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4 py-10 sm:px-6 lg:bg-white lg:px-10">
        <div className="w-full max-w-lg">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Plane className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-3xl font-extrabold text-gray-900">Bendigo Flying Club</h2>
            <p className="mt-2 text-gray-600">Reset Password</p>
          </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          {emailSent ? (
            <div className="text-center space-y-4">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Check Your Email</h3>
                <p className="text-sm text-gray-600 mb-6">
                  We've sent a password reset link to <span className="font-medium">{email}</span>.
                  Click the link in the email to reset your password.
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Didn't receive the email? Check your spam folder or try again.
                </p>
              </div>
              <button
                onClick={onBackToLogin}
                className="flex w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Sign In
              </button>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="mb-8 text-center">
                <h2 className="text-3xl font-extrabold text-slate-950">Reset password</h2>
                <p className="mt-2 text-sm text-gray-500">Enter your email to receive a reset link</p>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter your email address"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="flex w-full justify-center rounded-xl border border-transparent bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition-colors hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-sm text-blue-600 hover:text-blue-500 font-medium inline-flex items-center"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};
