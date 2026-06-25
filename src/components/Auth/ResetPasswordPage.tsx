import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plane, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

const PASSWORD_RESET_RETURN_KEY = 'bfc_password_reset_return_to';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidToken, setIsValidToken] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('Please wait...');
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [postResetReturnTo, setPostResetReturnTo] = useState<string | null>(null);

  const syncVerifiedEmailToProfile = async () => {
    const { data, error } = await supabase.functions.invoke('change-user-email', {
      body: { action: 'sync_verified_email' },
    });

    if (error) throw error;
    return data;
  };

  useEffect(() => {
    let cancelled = false;
    let recoveryConfirmed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const originalPathname = window.location.pathname;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const searchParams = new URLSearchParams(window.location.search);
    const voucherCode = searchParams.get('voucherCode') || (hashParams.has('access_token') ? searchParams.get('code') : null);
    if (originalPathname === '/trial-flight-voucher') {
      const returnTo = `/trial-flight-voucher${voucherCode ? `?voucherCode=${encodeURIComponent(voucherCode)}` : ''}`;
      sessionStorage.setItem(PASSWORD_RESET_RETURN_KEY, returnTo);
      setPostResetReturnTo(returnTo);
    }

    if (originalPathname !== '/reset-password') {
      window.history.replaceState(null, '', `/reset-password${window.location.search}${window.location.hash}`);
    }

    const accessToken = hashParams.get('access_token') || searchParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
    const code = searchParams.get('code') || hashParams.get('code');
    const linkType = hashParams.get('type') || searchParams.get('type');
    const passwordSetupType = linkType === 'recovery' || linkType === 'invite';
    const isNonPasswordVerification = Boolean(linkType && !passwordSetupType);
    const hasRecoveryLink = passwordSetupType || Boolean((accessToken && refreshToken) || code);

    const markValid = (email?: string | null) => {
      if (!cancelled) {
        recoveryConfirmed = true;
        if (timeoutId) clearTimeout(timeoutId);
        setIsValidToken(true);
        setRecoveryEmail(email || null);
        setVerificationMessage('Please enter your new password.');
      }
    };

    const markExistingSessionValid = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) {
        markValid(data.session.user.email);
        return true;
      }
      return false;
    };

    const completeNonPasswordVerification = async () => {
      setVerificationMessage('Completing account verification...');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      }

      if (!cancelled) {
        if (linkType?.startsWith('email_change')) {
          await syncVerifiedEmailToProfile();
        }
        if (timeoutId) clearTimeout(timeoutId);
        recoveryConfirmed = true;
        toast.success(linkType?.startsWith('email_change') ? 'Email address verified.' : 'Account verified.');
        window.history.replaceState(null, '', '/');
        navigate('/', { replace: true });
      }
    };

    const prepareRecoverySession = async () => {
      if (isNonPasswordVerification) {
        await completeNonPasswordVerification();
        return true;
      }

      if (!hasRecoveryLink) {
        if (passwordSetupType && await markExistingSessionValid()) return true;
        setVerificationMessage('This reset link is missing recovery details.');
        return false;
      }

      setVerificationMessage('Preparing your password reset session...');

      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (error) {
          if (passwordSetupType && await markExistingSessionValid()) return true;
          throw error;
        }

        if (data.session) {
          markValid(data.session.user.email);
          return true;
        }
      }

      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
          if (passwordSetupType && await markExistingSessionValid()) return true;
          throw error;
        }

        if (data.session) {
          markValid(data.session.user.email);
          return true;
        }
      }

      return passwordSetupType ? markExistingSessionValid() : false;
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (isNonPasswordVerification && event === 'SIGNED_IN' && session) {
        (async () => {
          if (linkType?.startsWith('email_change')) {
            try {
              await syncVerifiedEmailToProfile();
            } catch (error) {
              console.error('Failed to sync verified email to CRM profile:', error);
            }
          }
          if (timeoutId) clearTimeout(timeoutId);
          recoveryConfirmed = true;
          toast.success(linkType?.startsWith('email_change') ? 'Email address verified.' : 'Account verified.');
          navigate('/', { replace: true });
        })();
        return;
      }

      if (event === 'PASSWORD_RECOVERY' && session) {
        markValid(session.user.email);
      }
    });

    prepareRecoverySession().then((prepared) => {
      if (prepared || cancelled) return;
      setVerificationMessage('Waiting for the reset link session...');
    }).catch((error) => {
      console.error('Password recovery session error:', error);
      if (!cancelled && !recoveryConfirmed) {
        const sessionFallback = passwordSetupType ? markExistingSessionValid() : Promise.resolve(false);

        sessionFallback.then((hasSession) => {
          if (!hasSession && !cancelled) {
            toast.error(error.message || 'Invalid or expired reset link');
            navigate('/', { replace: true });
          }
        }).catch(() => {
          if (!cancelled) {
            toast.error(error.message || 'Invalid or expired reset link');
            navigate('/', { replace: true });
          }
        });
      }
    });

    timeoutId = setTimeout(async () => {
      if (cancelled || recoveryConfirmed) return;

      try {
        if (passwordSetupType && await markExistingSessionValid()) return;
      } catch (error) {
        console.error('Password recovery timeout session check failed:', error);
      }

      if (!cancelled && !recoveryConfirmed) {
        toast.error('Invalid or expired reset link');
        navigate('/', { replace: true });
      }
    }, 8000);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [navigate]);

  const getPostResetRedirect = async () => {
    const storedReturnTo = sessionStorage.getItem(PASSWORD_RESET_RETURN_KEY) || postResetReturnTo;
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) return { redirectTo: '/', keepSignedIn: false };

    const { data: profile } = await supabase
      .from('users')
      .select('portal_access_scope')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.portal_access_scope === 'trial_voucher') {
      return {
        redirectTo: storedReturnTo?.startsWith('/trial-flight-voucher') ? storedReturnTo : '/trial-flight-voucher',
        keepSignedIn: true,
      };
    }

    return { redirectTo: '/', keepSignedIn: false };
  };

  const markTrialVoucherPasswordSet = async () => {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) return;

    const { data: completion, error: completionError } = await supabase.functions.invoke('trial-voucher-public', {
      body: { action: 'complete-password-setup' },
    });

    if (!completionError && completion?.passwordSetupComplete) return;
    if (!completionError && completion?.voucherAccount === false) return;

    if (completionError) {
      console.error('Voucher password setup completion function failed:', completionError);
    }

    const { data: profile } = await supabase
      .from('users')
      .select('portal_access_scope')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.portal_access_scope !== 'trial_voucher') return;

    const { error } = await supabase
      .from('users')
      .update({ trial_voucher_password_set_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) {
      console.error('Failed to mark trial voucher password setup complete:', error);
      throw new Error('Password was updated, but the voucher account setup could not be completed. Please contact Bendigo Flying Club.');
    }
  };

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

      await markTrialVoucherPasswordSet();
      const redirect = await getPostResetRedirect();
      toast.success(redirect.keepSignedIn ? 'Password updated. Opening your voucher booking page...' : 'Password updated successfully! Redirecting to login...');

      if (!redirect.keepSignedIn) {
        await supabase.auth.signOut();
      } else {
        sessionStorage.removeItem(PASSWORD_RESET_RETURN_KEY);
      }

      setTimeout(() => {
        navigate(redirect.redirectTo, { replace: true });
      }, 1200);
    } catch (error: any) {
      console.error('Password update error:', error);
      const message = error.message || 'Failed to update password';

      if (message.toLowerCase().includes('same as the old')) {
        await markTrialVoucherPasswordSet();
        const redirect = await getPostResetRedirect();
        toast.success(redirect.keepSignedIn ? 'That password is already current. Opening your voucher booking page...' : 'That password is already current for this account. Redirecting to login...');
        if (!redirect.keepSignedIn) {
          await supabase.auth.signOut();
        } else {
          sessionStorage.removeItem(PASSWORD_RESET_RETURN_KEY);
        }
        setTimeout(() => {
          navigate(redirect.redirectTo, { replace: true });
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
      <div className="auth-light-surface min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
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
    <div className="auth-light-surface min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
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
