import React from 'react';
import { ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import type { User } from '../../types';
import { useGuestBookingConversion } from '../../hooks/useGuestBookingConversion';
import { isValidGuestPromotionEmail } from '../../utils/casualContacts';
import { SearchableSelect } from '../common/SearchableSelect';

export interface GuestPromotionSource {
  bookingId?: string;
  casualContactId?: string;
  name: string;
  email: string;
  phone?: string;
}

interface GuestPromotionModalProps {
  source: GuestPromotionSource;
  users: User[];
  reinstateArchivedProfiles?: boolean;
  onClose: () => void;
  onComplete: (memberId: string) => void | Promise<void>;
}

type PromotionMode = 'existing' | 'create';

export const GuestPromotionModal: React.FC<GuestPromotionModalProps> = ({
  source,
  users,
  reinstateArchivedProfiles = false,
  onClose,
  onComplete,
}) => {
  const { convertGuestBookingToMember } = useGuestBookingConversion();
  const availableUsers = React.useMemo(() => users.filter(user =>
    user.portalAccessScope !== 'guest_placeholder'
    && (reinstateArchivedProfiles || user.isActive !== false)
  ), [reinstateArchivedProfiles, users]);
  const sourceEmail = source.email.trim().toLowerCase();
  const exactEmailMatch = React.useMemo(() => sourceEmail
    ? availableUsers.find(user => user.email.trim().toLowerCase() === sourceEmail)
    : undefined, [availableUsers, sourceEmail]);
  const [mode, setMode] = React.useState<PromotionMode>(exactEmailMatch ? 'existing' : 'create');
  const [targetUserId, setTargetUserId] = React.useState(exactEmailMatch?.id || '');
  const [profileSearch, setProfileSearch] = React.useState(exactEmailMatch?.name || '');
  const [showMatches, setShowMatches] = React.useState(false);
  const [role, setRole] = React.useState<'student' | 'pilot'>('student');
  const [linkAll, setLinkAll] = React.useState(true);
  const [sendInvitation, setSendInvitation] = React.useState(false);
  const [email, setEmail] = React.useState(sourceEmail);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const filteredUsers = React.useMemo(() => {
    const query = profileSearch.trim().toLocaleLowerCase();
    if (!query) return availableUsers.slice(0, 8);
    return availableUsers.filter(user =>
      user.name.toLocaleLowerCase().startsWith(query)
      || user.email.toLocaleLowerCase().startsWith(query)
    ).slice(0, 8);
  }, [availableUsers, profileSearch]);
  const selectedUser = availableUsers.find(user => user.id === targetUserId);

  React.useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isSubmitting, onClose]);

  const submit = async () => {
    const normalisedEmail = email.trim().toLowerCase();
    if (!isValidGuestPromotionEmail(normalisedEmail)) {
      setError('Enter a valid email address before upgrading this visitor.');
      return;
    }
    if (mode === 'existing' && !targetUserId) {
      setError('Select the portal profile that should own this history.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const result = await convertGuestBookingToMember({
        bookingId: source.bookingId,
        casualContactId: source.casualContactId,
        email: normalisedEmail,
        targetUserId: mode === 'existing' ? targetUserId : undefined,
        role,
        linkAll,
        sendInvitation: mode === 'create' && sendInvitation,
        reactivateProfile: reinstateArchivedProfiles,
      });
      await onComplete(result.memberId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The visitor history could not be transferred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0" aria-label="Close promotion" onClick={() => !isSubmitting && onClose()} />
      <section className="relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="guest-promotion-title">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Casual contact</p>
            <h2 id="guest-promotion-title" className="mt-1 text-lg font-bold text-slate-950">Create or attach an official profile</h2>
            <p className="mt-1 text-sm text-slate-600">{source.name} · {sourceEmail || 'No email recorded'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
            <div className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <p>The original booking contact details stay preserved. Flights, lesson records, formal reviews, documents, charges, vouchers and notifications move to the official profile.</p>
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="guest-promotion-email" className="mb-1 block text-sm font-semibold text-slate-800">
              Email address <span className="text-rose-600">*</span>
            </label>
            <input
              id="guest-promotion-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              placeholder="name@example.com"
            />
            <p className="mt-1 text-xs text-slate-600">Required for the portal login identity. Adding it here does not alter the original booking snapshot.</p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`rounded-xl border p-4 text-left transition ${mode === 'existing' ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <Users className="h-5 w-5 text-blue-700" />
              <span className="mt-2 block text-sm font-bold text-slate-950">Attach existing profile</span>
              <span className="mt-1 block text-xs text-slate-600">Use when this person already exists in the portal.</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('create')}
              className={`rounded-xl border p-4 text-left transition ${mode === 'create' ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <UserPlus className="h-5 w-5 text-blue-700" />
              <span className="mt-2 block text-sm font-bold text-slate-950">Create portal profile</span>
              <span className="mt-1 block text-xs text-slate-600">No invitation is sent unless you explicitly choose it.</span>
            </button>
          </div>

          {mode === 'existing' ? (
            <div className="relative mt-4">
              <label className="mb-1 block text-sm font-semibold text-slate-800">Portal profile</label>
              <input
                value={profileSearch}
                onChange={(event) => {
                  setProfileSearch(event.target.value);
                  setTargetUserId('');
                  setShowMatches(true);
                }}
                onFocus={() => setShowMatches(true)}
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Start typing a name or email"
                autoComplete="off"
              />
              {showMatches && !targetUserId && (
                <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {filteredUsers.length ? filteredUsers.map(candidate => (
                    <button
                      type="button"
                      key={candidate.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setTargetUserId(candidate.id);
                        setProfileSearch(candidate.name);
                        if (!email.trim()) setEmail(candidate.email);
                        setShowMatches(false);
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-blue-50"
                    >
                      <span className="block text-sm font-semibold text-slate-900">{candidate.name}</span>
                      <span className="block text-xs text-slate-500">{candidate.email}</span>
                    </button>
                  )) : <p className="px-3 py-2 text-sm text-slate-500">No profile starts with that search.</p>}
                </div>
              )}
              {selectedUser && selectedUser.email.toLowerCase() !== email.trim().toLowerCase() && (
                <p className="mt-2 text-xs font-medium text-amber-700">The selected profile uses a different email. Confirm the identity before transferring records.</p>
              )}
              {selectedUser?.isActive === false && reinstateArchivedProfiles && (
                <p className="mt-2 text-xs font-medium text-blue-700">This archived profile will be restored when the visitor history is attached.</p>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4 rounded-xl border border-slate-200 p-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-800">Initial portal role</label>
                <SearchableSelect value={role} onChange={(event) => setRole(event.target.value as 'student' | 'pilot')} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                  <option value="student">Student</option>
                  <option value="pilot">Pilot</option>
                </SearchableSelect>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3">
                <input type="checkbox" checked={sendInvitation} onChange={(event) => setSendInvitation(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Mail className="h-4 w-4" /> Send account setup email now</span>
                  <span className="mt-1 block text-xs text-slate-600">Leave off to create the CRM profile silently. If they later create an account with this email, they verify it and choose a password.</span>
                </span>
              </label>
            </div>
          )}

          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
            <input type="checkbox" checked={linkAll} onChange={(event) => setLinkAll(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600" />
            <span>
              <span className="block text-sm font-semibold text-slate-900">Transfer all visits for this casual contact</span>
              <span className="mt-1 block text-xs text-slate-600">Recommended. Turn this off only when the selected booking was saved against the wrong person.</span>
            </span>
          </label>

          {error && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">{error}</p>}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void submit()} disabled={isSubmitting || !email.trim() || (mode === 'existing' && !targetUserId)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {isSubmitting ? 'Transferring history...' : 'Confirm and transfer'}
            {!isSubmitting && <ArrowRight className="h-4 w-4" />}
          </button>
        </footer>
      </section>
    </div>
  );
};
