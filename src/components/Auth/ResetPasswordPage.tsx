import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plane, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidToken, setIsValidToken] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('Please wait...');
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let recoveryConfirmed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (window.location.pathname !== '/reset-password') {
      window.history.replaceState(null, '', `/reset-password${window.location.search}${window.location.hash}`);
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
    const code = searchParams.get('code') || hashParams.get('code');
    const recoveryType = hashParams.get('type') === 'recovery' || searchParams.get('type') === 'recovery';
    const hasRecoveryLink = recoveryType || Boolean((accessToken && refreshToken) || code);

    const markValid = (email?: string | null) => {
      if (!cancelled) {
        recoveryConfirmed = true;
        if (timeoutId) clearTimeout(timeoutId);
        setIsValidToken(true);
        setRecoveryEmail(email || null);
        setVerificationMessage('Please enter your new password.');
      }
    };

    const prepareRecoverySession = async () => {
      if (!hasRecoveryLink) {
        setVerificationMessage('This reset link is missing recovery details.');
        return false;
      }

      setVerificationMessage('Preparing your password reset session...');

      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) throw error;
        if (data.session) {
          markValid(data.session.user.email);
          return true;
        }
      }

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) throw error;
        if (data.session) {
          markValid(data.session.user.email);
          return true;
        }
      }

      return false;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        markValid(session.user.email);
      }
    });

    prepareRecoverySession().then((prepared) => {
      if (prepared || cancelled) return;
      setVerificationMessage('Waiting for the reset link session...');
    }).catch((error) => {
      console.error('Password recovery session error:', error);
      if (!cancelled) {
        toast.error(error.message || 'Invalid or expired reset link');
        navigate('/', { replace: true });
      }
    });

    timeoutId = setTimeout(async () => {
      if (cancelled || recoveryConfirmed) return;
      toast.error('Invalid or expired reset link');
      navigate('/', { replace: true });
    }, 8000);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    if (!isValidToken) return;
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', '/reset-password');
    }
  }, [isValidToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    try {
      if (recoveryEmail) {
        sessionStorage.setItem('lastPasswordResetEmail', recoveryEmail);
      }

      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      toast.success('Password updated successfully! Redirecting to login...');

      await supabase.auth.signOut();

      setTimeout(() => {
        navigate('/', { replace: true });
      }, 1200);
    } catch (error: any) {
      console.error('Password update error:', error);
      const message = error.message || 'Failed to update password';

      if (message.toLowerCase().includes('same as the old')) {
        toast.success('That password is already current for this account. Redirecting to login...');
        await supabase.auth.signOut();
        setTimeout(() => {
          navigate('/', { replace: true });
        }, 1200);
        return;
      }

      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isValidToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
              <Plane className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Verifying Reset Link</h2>
            <p className="text-gray-600">{verificationMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-16 w-16 bg-blue-600 rounded-full flex items-center justify-center mb-4">
            <Plane className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Set New Password</h2>
          <p className="text-gray-600">
            {recoveryEmail ? `Enter a new password for ${recoveryEmail}` : 'Enter your new password below'}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-xl p-8">
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-3 pr-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter new password (min 6 characters)"
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

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-3 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Confirm your new password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
