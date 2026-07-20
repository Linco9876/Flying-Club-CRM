import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plane, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_ENDORSEMENT_TYPES } from '../../utils/pilotStatus';
import { MembershipDocumentLinks } from '../Membership/MembershipDocumentLinks';

interface SignUpFormProps {
  onBackToLogin: () => void;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({ onBackToLogin }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    dateOfBirth: '',
    residentialAddress: '',
    serviceAddress: '',
    membershipClass: 'full',
    guardianName: ''
  });
  const [sameServiceAddress, setSameServiceAddress] = useState(true);
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [membershipDeclarationsAccepted, setMembershipDeclarationsAccepted] = useState(false);
  const [endorsements, setEndorsements] = useState<Array<{
    id: string;
    type: string;
    dateObtained: string;
    expiryDate: string;
    isActive: boolean;
  }>>([]);
  const [endorsementDraft, setEndorsementDraft] = useState({
    type: '',
    dateObtained: '',
    expiryDate: '',
    isActive: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const addEndorsement = () => {
    if (!endorsementDraft.type.trim()) {
      toast.error('Select or enter an endorsement');
      return;
    }
    if (!endorsementDraft.dateObtained) {
      toast.error('Select the endorsement obtained date');
      return;
    }

    const nextType = endorsementDraft.type.trim();
    const duplicate = endorsements.some((endorsement) =>
      endorsement.type.trim().toLowerCase() === nextType.toLowerCase() &&
      endorsement.dateObtained === endorsementDraft.dateObtained
    );

    if (duplicate) {
      toast.error('That endorsement is already listed');
      return;
    }

    setEndorsements((current) => [
      ...current,
      {
        id: `signup-endorsement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: nextType,
        dateObtained: endorsementDraft.dateObtained,
        expiryDate: endorsementDraft.expiryDate,
        isActive: endorsementDraft.isActive,
      },
    ]);
    setEndorsementDraft({
      type: '',
      dateObtained: '',
      expiryDate: '',
      isActive: true,
    });
  };

  const removeEndorsement = (id: string) => {
    setEndorsements((current) => current.filter((endorsement) => endorsement.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (!formData.residentialAddress.trim()) {
      toast.error('Residential address is required for the BFC membership register');
      return;
    }

    if (!membershipDeclarationsAccepted) {
      toast.error('Accept the BFC membership declarations before continuing');
      return;
    }

    const isUnder18 = formData.dateOfBirth
      ? new Date(formData.dateOfBirth) > new Date(new Date().setFullYear(new Date().getFullYear() - 18))
      : false;
    if (formData.membershipClass === 'junior' && !isUnder18) {
      toast.error('Junior membership is for applicants under 18 and requires a date of birth');
      return;
    }
    if (isUnder18 && (!formData.guardianName.trim() || !guardianConsent)) {
      toast.error('A parent or guardian name and consent are required for applicants under 18');
      return;
    }

    setIsLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            name: formData.name,
            phone: formData.phone || null,
            role: 'student',
            membership_application: true,
            membership_class: formData.membershipClass,
            date_of_birth: formData.dateOfBirth || null,
            residential_address: formData.residentialAddress.trim(),
            service_address: sameServiceAddress ? formData.residentialAddress.trim() : formData.serviceAddress.trim(),
            supports_club_purposes: membershipDeclarationsAccepted,
            agrees_to_constitution: membershipDeclarationsAccepted,
            agrees_to_member_guarantee: membershipDeclarationsAccepted,
            agrees_to_code_of_conduct: membershipDeclarationsAccepted,
            agrees_to_members_manual: membershipDeclarationsAccepted,
            guardian_name: formData.guardianName.trim() || null,
            guardian_consent: guardianConsent,
            endorsements: endorsements.map((endorsement) => ({
              type: endorsement.type,
              dateObtained: endorsement.dateObtained,
              expiryDate: endorsement.expiryDate || null,
              isActive: endorsement.isActive,
            })),
          },
          emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`
        }
      });

      if (authError) throw authError;

      if (authData.user) {
        if (authData.session && endorsements.length > 0) {
          const { data: existingEndorsements } = await supabase
            .from('endorsements')
            .select('type, date_obtained')
            .eq('student_id', authData.user.id);

          const existingKeys = new Set(
            (existingEndorsements || []).map((endorsement) =>
              `${String(endorsement.type || '').trim().toLowerCase()}::${String(endorsement.date_obtained || '')}`
            )
          );

          const endorsementsToInsert = endorsements
            .filter((endorsement) => !existingKeys.has(`${endorsement.type.trim().toLowerCase()}::${endorsement.dateObtained}`))
            .map((endorsement) => ({
              student_id: authData.user!.id,
              type: endorsement.type.trim(),
              date_obtained: endorsement.dateObtained,
              expiry_date: endorsement.expiryDate || null,
              instructor_id: null,
              is_active: endorsement.isActive,
            }));

          if (endorsementsToInsert.length > 0) {
            const { error: endorsementsError } = await supabase
              .from('endorsements')
              .insert(endorsementsToInsert);

            if (endorsementsError) throw endorsementsError;
          }

        }

        if (authData.session) {
          toast.success('Account created successfully! Redirecting...');
        } else {
          toast.success('Account created! Please check your email to confirm your account before signing in.');
          onBackToLogin();
        }
      }
    } catch (error: unknown) {
      console.error('Sign up error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

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
            Start your flying club portal account
          </p>
        </div>
      </div>

      <div className="relative flex min-h-screen items-center justify-center bg-transparent px-4 py-10 sm:px-6 lg:-ml-px lg:px-10">
        <div className="relative z-20 w-full max-w-lg">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
              <Plane className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-3xl font-extrabold text-white drop-shadow">Bendigo Flying Club</h2>
            <p className="mt-2 text-white/90 drop-shadow">Create Account</p>
          </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-extrabold text-slate-950">Create account</h2>
            <p className="mt-2 text-sm text-gray-500">Join Bendigo Flying Club today</p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your full name"
              />
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-bold text-blue-950">BFC membership application</h3>
              <p className="mt-1 text-xs text-blue-800">This creates a portal account and submits your Bendigo Flying Club membership application. RAAus membership is separate.</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">Membership class
                  <select value={formData.membershipClass} onChange={event => setFormData({ ...formData, membershipClass: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-3">
                    <option value="full">Full — $150/year (voting)</option>
                    <option value="junior">Junior — $75/year</option>
                    <option value="affiliate">Affiliate — $45/year</option>
                  </select>
                </label>
                <label className="block text-sm font-medium text-gray-700">Date of birth
                  <input type="date" value={formData.dateOfBirth} onChange={event => setFormData({ ...formData, dateOfBirth: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-3" />
                </label>
                <label className="block text-sm font-medium text-gray-700 sm:col-span-2">Residential address
                  <textarea required rows={2} value={formData.residentialAddress} onChange={event => setFormData({ ...formData, residentialAddress: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-3" />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2"><input type="checkbox" checked={sameServiceAddress} onChange={event => setSameServiceAddress(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />Use my residential address for formal notices</label>
                {!sameServiceAddress && <label className="block text-sm font-medium text-gray-700 sm:col-span-2">Address for service
                  <textarea required rows={2} value={formData.serviceAddress} onChange={event => setFormData({ ...formData, serviceAddress: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-3" />
                </label>}
                {formData.dateOfBirth && new Date(formData.dateOfBirth) > new Date(new Date().setFullYear(new Date().getFullYear() - 18)) && <>
                  <label className="block text-sm font-medium text-gray-700">Parent or guardian name
                    <input required value={formData.guardianName} onChange={event => setFormData({ ...formData, guardianName: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-3" />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-3 text-sm text-gray-700"><input type="checkbox" required checked={guardianConsent} onChange={event => setGuardianConsent(event.target.checked)} className="h-4 w-4 rounded border-gray-300" />Parent or guardian consent provided</label>
                </>}
              </div>
              <label className="mt-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-white p-3 text-sm text-gray-700"><input type="checkbox" required checked={membershipDeclarationsAccepted} onChange={event => setMembershipDeclarationsAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300" /><span>I support the purposes of Bendigo Flying Club and agree to the Constitution, member guarantee, By-laws, Code of Conduct and Members Manual. These acknowledgements will be retained with my application.<MembershipDocumentLinks /></span></label>
              <p className="mt-3 text-xs text-blue-800">Membership commences when approved by the committee, or 30 days after this complete application is submitted. Aircraft self-booking requires the membership fee to be paid or waived.</p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your email"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number (Optional)
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+61 400 000 000"
              />
            </div>

            <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Existing endorsements (optional)</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Add any endorsements you already hold. These record additional privileges only; staff must verify and add a pilot licence before the account becomes a Pilot.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Endorsement</span>
                  <input
                    list="signup-endorsement-types"
                    value={endorsementDraft.type}
                    onChange={(e) => setEndorsementDraft({ ...endorsementDraft, type: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Select or enter endorsement"
                  />
                  <datalist id="signup-endorsement-types">
                    {DEFAULT_ENDORSEMENT_TYPES.map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Obtained</span>
                  <input
                    type="date"
                    value={endorsementDraft.dateObtained}
                    onChange={(e) => setEndorsementDraft({ ...endorsementDraft, dateObtained: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">Expiry</span>
                  <input
                    type="date"
                    value={endorsementDraft.expiryDate}
                    onChange={(e) => setEndorsementDraft({ ...endorsementDraft, expiryDate: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={endorsementDraft.isActive}
                    onChange={(e) => setEndorsementDraft({ ...endorsementDraft, isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Endorsement is active
                </label>
                <button
                  type="button"
                  onClick={addEndorsement}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" />
                  Add endorsement
                </button>
              </div>

              {endorsements.length > 0 && (
                <div className="mt-4 space-y-2">
                  {endorsements.map((endorsement) => (
                    <div key={endorsement.id} className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{endorsement.type}</p>
                        <p className="text-xs text-gray-500">
                          Obtained {endorsement.dateObtained || 'N/A'}
                          {endorsement.expiryDate ? ` | Expires ${endorsement.expiryDate}` : ''}
                          {endorsement.isActive ? ' | Active' : ' | Inactive'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEndorsement(endorsement.id)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-3 pr-10 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Create a password (min 6 characters)"
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
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Confirm your password"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full justify-center rounded-xl border border-transparent bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition-colors hover:bg-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={onBackToLogin}
              className="text-sm text-blue-600 hover:text-blue-500 font-medium"
            >
              Already have an account? Sign in
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};
