import React, { useState } from 'react';
import { X, Mail, User, Phone, UserPlus, Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { UserRole } from '../../types';
import { InviteUserResult } from '../../hooks/useInvitations';

interface InviteUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  allowedRoles?: UserRole[];
  onInvite: (data: {
    email: string;
    name: string;
    phone?: string;
    roles?: UserRole[];
    resend?: boolean;
    sendInvitation?: boolean;
  }) => Promise<InviteUserResult | undefined>;
}

export const InviteUserModal: React.FC<InviteUserModalProps> = ({
  isOpen,
  onClose,
  allowedRoles = ['student', 'pilot', 'instructor', 'admin'],
  onInvite
}) => {
  const defaultRole = allowedRoles.includes('student') ? 'student' : allowedRoles[0] || 'student';
  const isInstructorLimited = allowedRoles.length === 2
    && allowedRoles.includes('student')
    && allowedRoles.includes('pilot');
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    phone: '',
    roles: [defaultRole] as UserRole[]
  });
  const [sendInvitation, setSendInvitation] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteUserResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyLinkDone, setCopyLinkDone] = useState(false);

  const tempPassword = inviteResult?.tempPassword || null;
  const manualLink = inviteResult?.manualLink || null;
  const pendingInviteExists = Boolean(inviteResult?.pendingInviteExists);
  const accountCreatedWithoutInvite = Boolean(inviteResult?.accountCreatedWithoutInvite);
  const hasStudentRoleConflict = formData.roles.includes('student') && formData.roles.length > 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (hasStudentRoleConflict) {
      toast.error('Student cannot be combined with any other role');
      return;
    }
    if (formData.roles.some(role => !allowedRoles.includes(role))) {
      toast.error('You do not have permission to add a user with that role');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await onInvite({ ...formData, sendInvitation });
      if (
        result?.tempPassword ||
        result?.emailSent ||
        result?.manualLink ||
        result?.pendingInviteExists ||
        result?.accountCreatedWithoutInvite
      ) {
        setInviteResult(result);
      }
    } catch (error) {
      console.error('Error inviting user:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData({
      email: '',
      name: '',
      phone: '',
      roles: [defaultRole]
    });
    setSendInvitation(true);
    setInviteResult(null);
    setCopied(false);
    setCopyLinkDone(false);
    onClose();
  };

  const toggleRole = (role: UserRole) => {
    if (!allowedRoles.includes(role)) return;
    if (isInstructorLimited) {
      setFormData(prev => ({ ...prev, roles: [role] }));
      return;
    }
    setFormData(prev => {
      let newRoles = prev.roles.includes(role)
        ? prev.roles.filter(r => r !== role)
        : [...prev.roles, role];

      if (role === 'student' && newRoles.includes('student')) {
        newRoles = ['student'];
      }

      if (role !== 'student' && newRoles.includes(role)) {
        newRoles = newRoles.filter(r => r !== 'student');
      }

      return {
        ...prev,
        roles: newRoles.length > 0 ? newRoles : ['student']
      };
    });
  };

  const copyToClipboard = async () => {
    if (tempPassword) {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      toast.success('Password copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyInviteLink = async () => {
    if (!manualLink) return;
    await navigator.clipboard.writeText(manualLink);
    setCopyLinkDone(true);
    toast.success('Invite setup link copied');
    setTimeout(() => setCopyLinkDone(false), 2000);
  };

  const handleGenerateSetupLink = async () => {
    setIsSubmitting(true);
    try {
      const result = await onInvite({ ...formData, resend: true, sendInvitation: true });
      if (result?.manualLink || result?.emailSent || result?.tempPassword) {
        setInviteResult(result);
      }
    } catch (error) {
      console.error('Error generating invite link:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <UserPlus className="h-5 w-5 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Add Portal User</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {inviteResult ? (
          <div className="p-6">
            <div className={`mb-4 rounded-lg border p-4 ${
              pendingInviteExists
                ? 'border-amber-200 bg-amber-50'
                : 'border-green-200 bg-green-50'
            }`}>
              <p className={`font-medium mb-2 ${pendingInviteExists ? 'text-amber-800' : 'text-green-800'}`}>
                {pendingInviteExists
                  ? 'Pending invite already exists'
                  : accountCreatedWithoutInvite
                    ? 'User added without an invitation'
                  : inviteResult.emailSent
                    ? 'Invitation email sent!'
                    : 'User added successfully!'}
              </p>
              {pendingInviteExists ? (
                <p className="text-sm text-amber-700">
                  This email already has a pending invite. Generate a setup link below if the email did not arrive.
                </p>
              ) : accountCreatedWithoutInvite ? (
                <p className="text-sm text-green-700">
                  No email was sent. When {formData.name} creates an account with this email address, they will verify it and choose their own password.
                </p>
              ) : inviteResult.emailSent ? (
                <p className="text-sm text-green-700">
                  A fresh invitation email has been sent to {formData.name}. They will confirm on a club page before the one-time password setup link is used.
                </p>
              ) : manualLink ? (
                <p className="text-sm text-green-700">
                  A setup link has been generated for {formData.name}. Send this link to them if the invite email did not arrive.
                </p>
              ) : (
                <p className="text-sm text-green-700">
                  An account has been created for {formData.name}. They can log in immediately with the temporary password below.
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <p className="text-gray-900 font-medium">{formData.email}</p>
            </div>

            {accountCreatedWithoutInvite ? (
              <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                Their account is safely reserved. The club does not know or store a usable password for them, and the setup email is only sent after they try to create an account.
              </div>
            ) : manualLink ? (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Invite Setup Link
                </label>
                <div className="flex items-center space-x-2">
                  <div className="min-w-0 flex-1 truncate rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
                    {manualLink}
                  </div>
                  <button
                    onClick={copyInviteLink}
                    className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Copy setup link"
                  >
                    {copyLinkDone ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  This link lets the user set their password. Treat it like a password and send it only to the intended person.
                </p>
              </div>
            ) : tempPassword ? (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Temporary Password
                </label>
                <div className="flex items-center space-x-2">
                  <div className="flex-1 p-3 bg-gray-50 border border-gray-300 rounded-lg font-mono text-sm">
                    {tempPassword}
                  </div>
                  <button
                    onClick={copyToClipboard}
                    className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Share this password securely with the user. They should change it after their first login.
                </p>
              </div>
            ) : (
              <div className="mb-6 space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                {pendingInviteExists ? (
                  <p>Send a fresh setup email and replace the expired link.</p>
                ) : (
                  <p>
                    Ask them to check junk or spam if it does not arrive shortly. The invite email uses the Supabase Auth invite template and sender settings.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleGenerateSetupLink}
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending...' : 'Send fresh setup email'}
                </button>
              </div>
            )}

            <button
              onClick={handleClose}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="text"
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter full name"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="email"
                    id="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter email address"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number (Optional)
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <input
                    type="tel"
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="+61 400 000 000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {isInstructorLimited ? 'Role' : 'Roles (select one or more)'}
                </label>
                <div className="space-y-2">
                  {allowedRoles.map((role) => (
                    <label key={role} className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type={isInstructorLimited ? 'radio' : 'checkbox'}
                        name={isInstructorLimited ? 'new-user-role' : undefined}
                        checked={formData.roles.includes(role)}
                        onChange={() => toggleRole(role)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <span className="text-sm text-gray-700 capitalize">{role}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {isInstructorLimited
                    ? 'Instructors can add Student or Pilot users only. Administrators control staff and administrator access.'
                    : 'Student is a standalone role. Staff and pilot roles can be combined; the highest-ranked selected role controls the login portal.'}
                </p>
                {hasStudentRoleConflict && (
                  <p className="text-xs text-red-600 mt-1">
                    Remove Student or remove the other roles before adding this user.
                  </p>
                )}
              </div>

              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-3">Account setup</legend>
                <div className="space-y-2">
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${sendInvitation ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <input
                      type="radio"
                      name="account-setup"
                      checked={sendInvitation}
                      onChange={() => setSendInvitation(true)}
                      className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">Send invitation now</span>
                      <span className="mt-1 block text-xs leading-5 text-gray-600">Email a secure link so they can set a password immediately.</span>
                    </span>
                  </label>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${!sendInvitation ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <input
                      type="radio"
                      name="account-setup"
                      checked={!sendInvitation}
                      onChange={() => setSendInvitation(false)}
                      className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">Add without inviting</span>
                      <span className="mt-1 block text-xs leading-5 text-gray-600">Send no email now. If they later create an account with this email, they will verify it and choose a password.</span>
                    </span>
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="mt-6 flex space-x-3">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || hasStudentRoleConflict}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Adding...' : sendInvitation ? 'Add and Invite' : 'Add Without Invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
