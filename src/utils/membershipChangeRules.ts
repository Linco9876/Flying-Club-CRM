export type MembershipChangeTiming = 'immediate' | 'next_renewal';

const parseDateOnly = (value?: string | Date | null) => {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    };
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
};

export const localDateString = (value = new Date()) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isUnder18On = (
  dateOfBirth?: string | Date | null,
  asOf: string | Date = new Date(),
) => {
  const birth = parseDateOnly(dateOfBirth);
  const comparison = parseDateOnly(asOf);
  if (!birth || !comparison) return false;

  let age = comparison.year - birth.year;
  if (
    comparison.month < birth.month
    || (comparison.month === birth.month && comparison.day < birth.day)
  ) {
    age -= 1;
  }
  return age >= 0 && age < 18;
};

export const dayAfter = (date: string) => {
  const parsed = parseDateOnly(date);
  if (!parsed) return '';
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

export const nextMembershipRenewalDate = (
  currentFinancialYearEnd?: string | null,
  financialYearStartMonth = 7,
  financialYearStartDay = 1,
  today = localDateString(),
) => {
  if (currentFinancialYearEnd) return dayAfter(currentFinancialYearEnd);
  const parsedToday = parseDateOnly(today);
  if (!parsedToday) return '';
  const thisYearStart = `${parsedToday.year}-${String(financialYearStartMonth).padStart(2, '0')}-${String(financialYearStartDay).padStart(2, '0')}`;
  const nextYear = today < thisYearStart ? parsedToday.year : parsedToday.year + 1;
  return `${nextYear}-${String(financialYearStartMonth).padStart(2, '0')}-${String(financialYearStartDay).padStart(2, '0')}`;
};

export const membershipClassRequiresFinancialStatus = (
  membershipClass?: { code?: string | null; isFeeExempt?: boolean | null } | null,
) => membershipClass?.code?.trim().toLowerCase() !== 'life' && !membershipClass?.isFeeExempt;

export const membershipClassEligibility = (
  classCode: string,
  dateOfBirth?: string | Date | null,
  effectiveOn: string | Date = new Date(),
) => {
  const normalisedClassCode = classCode.trim().toLowerCase();
  if (normalisedClassCode === 'full' && isUnder18On(dateOfBirth, effectiveOn)) {
    return { eligible: false, reason: 'Full membership is not available while the member is under 18.' };
  }
  if (normalisedClassCode !== 'junior') {
    return { eligible: true, reason: null as string | null };
  }
  if (!dateOfBirth) {
    return { eligible: false, reason: 'A date of birth is required for Junior membership.' };
  }
  if (!isUnder18On(dateOfBirth, effectiveOn)) {
    return { eligible: false, reason: 'Junior membership is only available while the member is under 18.' };
  }
  return { eligible: true, reason: null as string | null };
};
