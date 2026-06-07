import React from 'react';
import { CheckCircle, FileSignature, Loader2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface SigningRequest {
  valid: boolean;
  error?: string;
  recipientType: 'student' | 'guardian';
  courseTitle: string;
  studentName: string;
  memberNumber?: string;
  studentDeclarationTitle: string;
  studentDeclarationText: string;
  guardianDeclarationTitle: string;
  guardianDeclarationText: string;
  declarationVersion: number;
  expiresAt: string;
  studentSigned: boolean;
  guardianSigned: boolean;
  guardianRequired: boolean;
  recipientEmail?: string;
  recipientPhone?: string;
}

const formatDeclarationText = (value: string) =>
  String(value || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

export const DeclarationSigningPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [request, setRequest] = React.useState<SigningRequest | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [signed, setSigned] = React.useState(false);
  const [signatureName, setSignatureName] = React.useState('');
  const [memberNumber, setMemberNumber] = React.useState('');
  const [relationship, setRelationship] = React.useState('');
  const [guardianEmail, setGuardianEmail] = React.useState('');
  const [guardianPhone, setGuardianPhone] = React.useState('');
  const [intentConfirmed, setIntentConfirmed] = React.useState(false);

  React.useEffect(() => {
    const loadRequest = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_declaration_signing_request', { p_token: token });
        if (error) throw error;
        const nextRequest = data as SigningRequest;
        setRequest(nextRequest);
        if (nextRequest?.valid) {
          setSignatureName(nextRequest.recipientType === 'student' ? nextRequest.studentName || '' : '');
          setMemberNumber(nextRequest.memberNumber || '');
          setGuardianEmail(nextRequest.recipientEmail || '');
          setGuardianPhone(nextRequest.recipientPhone || '');
        }
      } catch (error) {
        console.error('Failed to load declaration signing request:', error);
        setRequest({ valid: false, error: 'This signing link could not be loaded.' } as SigningRequest);
      } finally {
        setLoading(false);
      }
    };

    void loadRequest();
  }, [token]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!request?.valid) return;

    if (!signatureName.trim()) {
      toast.error('Type the full signature name');
      return;
    }

    if (request.recipientType === 'guardian' && !relationship.trim()) {
      toast.error('Add the parent/guardian relationship');
      return;
    }

    if (!intentConfirmed) {
      toast.error('Confirm the electronic signature declaration');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('sign_course_declaration_with_token', {
        p_token: token,
        p_signature_name: signatureName,
        p_member_number: request.recipientType === 'student' ? memberNumber : null,
        p_guardian_relationship: request.recipientType === 'guardian' ? relationship : null,
        p_guardian_email: request.recipientType === 'guardian' ? guardianEmail : null,
        p_guardian_phone: request.recipientType === 'guardian' ? guardianPhone : null,
        p_user_agent: navigator.userAgent,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to sign declaration');

      setSigned(true);
      toast.success('Declaration signed');
    } catch (error) {
      console.error('Failed to sign declaration:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to sign declaration');
    } finally {
      setSubmitting(false);
    }
  };

  const declarationTitle = request?.recipientType === 'guardian'
    ? request.guardianDeclarationTitle
    : request?.studentDeclarationTitle;
  const declarationText = request?.recipientType === 'guardian'
    ? request.guardianDeclarationText
    : request?.studentDeclarationText;

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-slate-950 px-5 py-5 text-white sm:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600">
              <FileSignature className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-100">Bendigo Flying Club</p>
              <h1 className="text-xl font-bold sm:text-2xl">Course Declaration Signing</h1>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-[20rem] items-center justify-center p-8">
            <div className="text-center text-slate-600">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-blue-600" />
              Loading signing link...
            </div>
          </div>
        ) : signed ? (
          <div className="p-7 text-center">
            <CheckCircle className="mx-auto mb-4 h-14 w-14 text-green-600" />
            <h2 className="text-2xl font-bold text-slate-950">Declaration signed</h2>
            <p className="mt-2 text-slate-600">
              Thank you. This one-time link has been used and the CRM record has been updated.
            </p>
          </div>
        ) : !request?.valid ? (
          <div className="p-7 text-center">
            <ShieldAlert className="mx-auto mb-4 h-14 w-14 text-red-600" />
            <h2 className="text-2xl font-bold text-slate-950">Signing link unavailable</h2>
            <p className="mt-2 text-slate-600">{request?.error || 'This link is invalid or expired.'}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 p-5 sm:p-7">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
                {request.recipientType === 'guardian' ? 'Parent/guardian declaration' : 'Student declaration'}
              </p>
              <h2 className="mt-1 text-2xl font-bold text-slate-950">{declarationTitle}</h2>
              <p className="mt-2 text-sm text-slate-600">
                Course: <span className="font-semibold">{request.courseTitle}</span>
                <span className="mx-2">|</span>
                Student: <span className="font-semibold">{request.studentName}</span>
              </p>
            </div>

            <div className="max-h-[24rem] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-800">
              {formatDeclarationText(declarationText || '').map((paragraph, index) => (
                <p key={index} className="mb-4 last:mb-0">{paragraph}</p>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  {request.recipientType === 'guardian' ? 'Parent/guardian full name' : 'Student full name'}
                </span>
                <input
                  value={signatureName}
                  onChange={(event) => setSignatureName(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  placeholder="Type full legal name"
                />
              </label>

              {request.recipientType === 'student' ? (
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">RAAus member number</span>
                  <input
                    value={memberNumber}
                    onChange={(event) => setMemberNumber(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Optional"
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Relationship</span>
                  <input
                    value={relationship}
                    onChange={(event) => setRelationship(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    placeholder="Parent, legal guardian, carer"
                  />
                </label>
              )}

              {request.recipientType === 'guardian' && (
                <>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Email</span>
                    <input
                      value={guardianEmail}
                      onChange={(event) => setGuardianEmail(event.target.value)}
                      type="email"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder="Optional"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-slate-700">Phone</span>
                    <input
                      value={guardianPhone}
                      onChange={(event) => setGuardianPhone(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                      placeholder="Optional"
                    />
                  </label>
                </>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={intentConfirmed}
                onChange={(event) => setIntentConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                I have read and understood this declaration. I intend my typed name above to be my electronic signature, and I consent to Bendigo Flying Club storing this signed declaration for course records.
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              Sign declaration
            </button>

            <p className="text-center text-xs text-slate-500">
              This link expires {new Date(request.expiresAt).toLocaleString('en-AU')} and can only be used once.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
