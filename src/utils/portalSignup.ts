export type PortalSignupIntent = 'portal' | 'membership';

export const getPortalSignupSteps = (intent: PortalSignupIntent) => (
  intent === 'membership'
    ? ['Start', 'Your details', 'Agreements', 'Payment']
    : ['Start', 'Your details', 'Privacy']
);

interface PortalSignupMetadataInput {
  intent: PortalSignupIntent;
  name: string;
  phone: string;
  privacyNoticeVersion: string;
  membership?: {
    membershipClass: string;
    dateOfBirth: string;
    residentialAddress: string;
    serviceAddress: string;
    guardianName: string;
    guardianConsent: boolean;
    paymentMethod: 'becs' | 'invoice' | 'card' | null;
    autoRenew: boolean;
    scholarshipEnabled: boolean;
    scholarshipAmount: number;
    documentIds: string[];
  };
}

export const buildPortalSignupMetadata = ({
  intent,
  name,
  phone,
  privacyNoticeVersion,
  membership,
}: PortalSignupMetadataInput) => {
  const privacyAcceptedAt = new Date().toISOString();
  const common = {
    name: name.trim(),
    phone: phone.trim() || null,
    role: 'student',
    portal_signup_intent: intent,
    membership_application: intent === 'membership',
    privacy_notice_accepted: true,
    privacy_notice_version: privacyNoticeVersion,
    privacy_notice_accepted_at: privacyAcceptedAt,
  };

  if (intent === 'portal') return common;
  if (!membership) throw new Error('Membership details are required for a membership application.');

  return {
    ...common,
    membership_class: membership.membershipClass,
    date_of_birth: membership.dateOfBirth || null,
    residential_address: membership.residentialAddress.trim(),
    service_address: membership.serviceAddress.trim(),
    supports_club_purposes: true,
    agrees_to_constitution: true,
    agrees_to_member_guarantee: true,
    agrees_to_code_of_conduct: true,
    agrees_to_members_manual: true,
    guardian_name: membership.guardianName.trim() || null,
    guardian_consent: membership.guardianConsent,
    membership_payment_method: membership.paymentMethod,
    membership_auto_renew: membership.paymentMethod !== 'invoice' && membership.autoRenew,
    membership_scholarship_enabled: membership.scholarshipEnabled,
    membership_scholarship_amount: membership.scholarshipAmount,
    membership_document_ids: membership.documentIds,
  };
};
