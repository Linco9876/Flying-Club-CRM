export type ProfileReadinessLevel = 'ready' | 'warning' | 'action';

export interface DatedReadinessStatus {
  level: ProfileReadinessLevel;
  label: string;
  daysRemaining: number | null;
}

export interface AviationLicenceIdentity {
  type?: string | null;
  issuingAuthority?: string | null;
}

const RA_AUS_PATTERN = /\b(?:raa?aus|recreational aviation australia)\b/i;
const SELF_DECLARED_MEDICAL_PATTERN = /\b(?:self[-\s]?declar\w*|medical declaration)\b/i;

export const usesRaausCredentials = ({
  raausId,
  licences,
}: {
  raausId?: string | null;
  licences: AviationLicenceIdentity[];
}) => Boolean(
  raausId?.trim() ||
  licences.some(licence =>
    RA_AUS_PATTERN.test(licence.type || '') ||
    RA_AUS_PATTERN.test(licence.issuingAuthority || '')
  )
);

export const isSelfDeclaredMedical = (medicalType?: string | null) =>
  SELF_DECLARED_MEDICAL_PATTERN.test(medicalType || '');

export const requiresFlightReview = (roles: string[]) =>
  roles.some(role => ['pilot', 'instructor', 'senior_instructor'].includes(role));

export const getMembershipIdentityLabel = ({
  legalStatus,
  membershipClassName,
  hasVotingRights,
}: {
  legalStatus?: string | null;
  membershipClassName?: string | null;
  hasVotingRights: boolean | null;
}) => {
  if (legalStatus === 'current') {
    const votingLabel = hasVotingRights === null
      ? ''
      : ` · ${hasVotingRights ? 'Voting member' : 'Non-voting member'}`;
    return `${membershipClassName || 'Current BFC membership'}${votingLabel}`;
  }
  return membershipClassName || 'BFC membership not established';
};

const startOfLocalDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

export const getDatedReadinessStatus = (
  date: Date | undefined,
  now = new Date(),
  warningDays = 60,
): DatedReadinessStatus => {
  if (!date || Number.isNaN(date.getTime())) {
    return { level: 'warning', label: 'Not recorded', daysRemaining: null };
  }

  const daysRemaining = Math.ceil(
    (startOfLocalDay(date).getTime() - startOfLocalDay(now).getTime()) / 86_400_000
  );

  if (daysRemaining < 0) {
    return { level: 'action', label: 'Expired', daysRemaining };
  }
  if (daysRemaining <= warningDays) {
    return { level: 'warning', label: 'Due soon', daysRemaining };
  }
  return { level: 'ready', label: 'Current', daysRemaining };
};

export const getOverallReadiness = (
  levels: ProfileReadinessLevel[]
): { level: ProfileReadinessLevel; title: string; description: string } => {
  if (levels.includes('action')) {
    return {
      level: 'action',
      title: 'Action required',
      description: 'Resolve the highlighted items before relying on self-booking access.',
    };
  }
  if (levels.includes('warning')) {
    return {
      level: 'warning',
      title: 'Review recommended',
      description: 'Your profile has items worth checking before your next flight.',
    };
  }
  return {
    level: 'ready',
    title: 'Ready for your next booking',
    description: 'No known profile or membership items need attention.',
  };
};
