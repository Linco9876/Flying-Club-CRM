export type MemberBillingState = 'linked' | 'setup-required' | 'temporarily-unavailable';

export const getMemberBillingState = ({
  xeroConnected,
  memberLinked,
}: {
  xeroConnected: boolean | null;
  memberLinked: boolean;
}): MemberBillingState => {
  if (xeroConnected !== true) return 'temporarily-unavailable';
  return memberLinked ? 'linked' : 'setup-required';
};

export const canExposeMemberFinancialInformation = (state: MemberBillingState) =>
  state === 'linked';
