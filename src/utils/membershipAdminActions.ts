import type { MembershipLegalStatus } from '../types';

export interface MembershipLegalStatusOption {
  value: MembershipLegalStatus;
  label: string;
  description: string;
  destructive?: boolean;
}

export const membershipLegalStatusOptions: MembershipLegalStatusOption[] = [
  {
    value: 'current',
    label: 'Current member',
    description: 'Restore membership rights and prepare the current membership year if required.',
  },
  {
    value: 'resigned',
    label: 'Resigned',
    description: 'Record that the member voluntarily ended their membership.',
    destructive: true,
  },
  {
    value: 'ceased_non_payment',
    label: 'Ceased for non-payment',
    description: 'End membership because the membership fee remains unpaid.',
    destructive: true,
  },
  {
    value: 'expelled',
    label: 'Expelled',
    description: 'Record a formal expulsion. Use only with the appropriate authority.',
    destructive: true,
  },
  {
    value: 'deceased',
    label: 'Deceased',
    description: 'Close the membership record because the member is deceased.',
    destructive: true,
  },
];

export const availableMembershipStatusChanges = (current: MembershipLegalStatus) =>
  membershipLegalStatusOptions.filter(option => option.value !== current);

export const membershipStatusChangeNeedsClass = (
  current: MembershipLegalStatus,
  next: MembershipLegalStatus,
) => current !== 'current' && next === 'current';

export const membershipStatusActionLabel = (next: MembershipLegalStatus) =>
  next === 'current' ? 'Restore membership' : 'End membership';

export const membershipStatusReasonIsValid = (reason: string) => reason.trim().length >= 10;
