import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Plane, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { DEFAULT_ENDORSEMENT_TYPES } from '../../utils/pilotStatus';
import { fetchPilotStatusEndorsementTypes, reconcilePilotStatusForUser } from '../../utils/pilotStatus';

interface SignUpFormProps {
  onBackToLogin: () => void;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({ onBackToLogin }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: ''
  });
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

          const pilotStatusEndorsementTypes = await fetchPilotStatusEndorsementTypes();
          await reconcilePilotStatusForUser({
            userId: authData.user.id,
            endorsements: endorsements.map((endorsement) => ({
              type: endorsement.type,
              dateObtained: new Date(endorsement.dateObtained),
              expiryDate: endorsement.expiryDate ? new Date(endorsement.expiryDate) : undefined,
              isActive: endorsement.isActive,
            })),
            pilotStatusEndorsementTypes,
            currentRole: 'student',
            currentRoles: ['student'],
          });
        }

        if (authData.session) {
          toast.success('Account created successfully! Redirecting...');
        } else {
          toast.success('Account created! Please check your email to confirm your account before signing in.');
          onBackToLogin();
        }
      }
    } catch (error: any) {
      console.error('Sign up error:', error);
      toast.error(error.message || 'Failed to create account');
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
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-3 shadow-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your full name"
              />
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
                  Add any endorsements you already hold. If one matches a Pilot-status endorsement configured by the club, your account will be created as a pilot automatically.
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
