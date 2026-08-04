import React, { useMemo, useState } from 'react';
import { ArrowRight, MailCheck, Plane, ShieldCheck } from 'lucide-react';
import { publicSupabaseUrl } from '../../lib/supabase';
import {
  getInvitationActionLink,
  getPasswordSetupMode,
  markPasswordSetupStarted,
} from '../../utils/invitationSetup';

export const AcceptInvitationPage: React.FC = () => {
  const [isContinuing, setIsContinuing] = useState(false);
  const actionLink = useMemo(
    () => getInvitationActionLink(window.location.hash, publicSupabaseUrl),
    [],
  );
  const setupMode = useMemo(() => getPasswordSetupMode(window.location.hash), []);
  const isPasswordReset = setupMode === 'password-reset';
  const isAccountClaim = setupMode === 'account-claim';

  const continueSetup = () => {
    if (!actionLink) return;
    setIsContinuing(true);
    markPasswordSetupStarted();
    window.history.replaceState(null, '', '/accept-invitation');
    window.location.assign(actionLink);
  };

  return (
    <div className="auth-light-surface flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-100 px-4 py-12">
      <main className="w-full max-w-lg overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-2xl shadow-blue-950/10">
        <div className="bg-gradient-to-br from-blue-700 to-indigo-700 px-7 py-8 text-white sm:px-10">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
            <Plane className="h-8 w-8" aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-100">
            Bendigo Flying Club
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {isPasswordReset
              ? 'Reset your portal password'
              : isAccountClaim
                ? 'Verify your portal account'
                : 'Set up your portal account'}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-blue-100">
            {isPasswordReset
              ? 'Choose a new password to restore access to your Bendigo Flying Club portal account.'
              : isAccountClaim
                ? 'The club has already added your details. Verify this email address, then choose your own password.'
                : 'The portal brings your bookings, flying records, documents and club information together.'}
          </p>
        </div>

        <div className="space-y-6 px-7 py-8 sm:px-10">
          {actionLink ? (
            <>
              <div className="flex gap-3 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] p-4 text-[#064e3b]">
                <MailCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    {isPasswordReset ? 'Password reset ready' : isAccountClaim ? 'Email verification ready' : 'Invitation ready'}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-[#065f46]">
                    Press the button below to verify this request and choose your password.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={continueSetup}
                disabled={isContinuing}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-70"
              >
                {isContinuing
                  ? 'Opening secure setup…'
                  : isPasswordReset
                    ? 'Continue password reset'
                    : isAccountClaim
                      ? 'Verify email and set password'
                      : 'Continue account setup'}
                {!isContinuing && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
              </button>

              <div className="flex items-start gap-2 text-xs leading-5 text-gray-500">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <p>
                  This confirmation step prevents email security scanners from using your one-time setup link before you do.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
              <p className="font-semibold">This setup link is incomplete or no longer valid.</p>
              <p className="mt-2 text-sm leading-5 text-amber-800">
                Ask a club administrator to resend the invitation. The newly issued email will contain a fresh link.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
