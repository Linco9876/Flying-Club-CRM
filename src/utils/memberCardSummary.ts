export interface MemberDirectoryMembershipSummary {
  userId: string;
  legalStatus: string | null;
  membershipClassName: string | null;
  membershipClassCode: string | null;
  applicationStatus: string | null;
  applicationClassName: string | null;
}

export interface MemberCardMembershipPresentation {
  label: string;
  detail: string;
  tone: 'current' | 'pending' | 'former' | 'portal-only' | 'unavailable';
}

const humanise = (value: string) => value
  .replace(/_/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase());

export const memberCardMembershipPresentation = (
  summary: MemberDirectoryMembershipSummary | undefined,
  loading = false,
  unavailable = false,
): MemberCardMembershipPresentation => {
  if (loading) {
    return { label: 'Loading', detail: 'Checking club membership', tone: 'unavailable' };
  }

  if (unavailable) {
    return { label: 'Unavailable', detail: 'Membership status could not be loaded', tone: 'unavailable' };
  }

  if (summary?.legalStatus === 'current') {
    return {
      label: 'Current',
      detail: summary.membershipClassName || 'Club membership',
      tone: 'current',
    };
  }

  if (summary?.legalStatus) {
    return {
      label: humanise(summary.legalStatus),
      detail: summary.membershipClassName || 'Former club membership',
      tone: 'former',
    };
  }

  if (summary?.applicationStatus === 'pending') {
    return {
      label: 'Application pending',
      detail: summary.applicationClassName || 'Club membership',
      tone: 'pending',
    };
  }

  return {
    label: 'Portal only',
    detail: 'No club membership recorded',
    tone: 'portal-only',
  };
};

export interface MemberCardAttentionInput {
  email?: string | null;
  phone?: string | null;
  hasFlyingRecords: boolean;
  raausId?: string | null;
  medicalExpiry?: Date;
  raausMembershipExpiry?: Date;
  now?: Date;
}

export const memberCardAttentionItems = ({
  email,
  phone,
  hasFlyingRecords,
  raausId,
  medicalExpiry,
  raausMembershipExpiry,
  now = new Date(),
}: MemberCardAttentionInput): string[] => {
  const items: string[] = [];
  const dateLabel = (date: Date) => new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const reviewBy = new Date(today);
  reviewBy.setDate(reviewBy.getDate() + 60);

  if (!email?.trim()) items.push('Email not recorded');
  if (!phone?.trim()) items.push('Phone not recorded');
  if (!hasFlyingRecords) return items;

  if (!raausId?.trim()) items.push('RAAus number not recorded');

  if (!medicalExpiry) {
    items.push('Medical expiry not recorded');
  } else if (medicalExpiry < today) {
    items.push(`Medical expired ${dateLabel(medicalExpiry)}`);
  } else if (medicalExpiry <= reviewBy) {
    items.push(`Medical due ${dateLabel(medicalExpiry)}`);
  }

  if (!raausMembershipExpiry) {
    items.push('RAAus membership expiry not recorded');
  } else if (raausMembershipExpiry < today) {
    items.push(`RAAus membership expired ${dateLabel(raausMembershipExpiry)}`);
  } else if (raausMembershipExpiry <= reviewBy) {
    items.push(`RAAus membership due ${dateLabel(raausMembershipExpiry)}`);
  }

  return items;
};
