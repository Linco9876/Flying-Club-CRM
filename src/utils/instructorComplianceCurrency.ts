export type InstructorComplianceLevel = 'instructor' | 'senior_instructor';
export type InstructorComplianceCheckType = 'sp_check' | 'renewal';
export type InstructorComplianceOutcome = 'satisfactory' | 'unsatisfactory';
export type InstructorCurrencyStatus =
  | 'no_record'
  | 'overdue'
  | 'due_soon'
  | 'current'
  | 'remedial';

export interface InstructorCurrencyResult {
  nextSpCheckDue: string;
  nextRenewalDue?: string;
  bfrResetDate?: string;
}

const parseDateOnly = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('Expected a date in YYYY-MM-DD format');
  const [, year, month, day] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
};

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (value: string, days: number) => {
  const date = parseDateOnly(value);
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day));
  result.setUTCDate(result.getUTCDate() + days);
  return formatDateOnly(result);
};

const addMonthsClamped = (value: string, months: number) => {
  const date = parseDateOnly(value);
  const targetMonthIndex = date.month - 1 + months;
  const targetYear = date.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return formatDateOnly(
    new Date(Date.UTC(targetYear, targetMonth, Math.min(date.day, lastDay))),
  );
};

export const getInstructorCurrencyAfterCheck = (
  checkDate: string,
  level: InstructorComplianceLevel,
  checkType: InstructorComplianceCheckType,
  outcome: InstructorComplianceOutcome,
): InstructorCurrencyResult => {
  if (outcome === 'unsatisfactory') {
    return { nextSpCheckDue: checkDate };
  }

  return {
    nextSpCheckDue:
      level === 'senior_instructor'
        ? addMonthsClamped(checkDate, 12)
        : addDays(checkDate, 90),
    nextRenewalDue:
      checkType === 'renewal' ? addMonthsClamped(checkDate, 24) : undefined,
    bfrResetDate: checkType === 'renewal' ? checkDate : undefined,
  };
};

export const getInstructorOperationalStatus = (
  spStatus: InstructorCurrencyStatus,
  renewalStatus: InstructorCurrencyStatus,
): InstructorCurrencyStatus => {
  if (spStatus === 'remedial' || renewalStatus === 'remedial') return 'remedial';
  if (spStatus === 'overdue' || renewalStatus === 'overdue') return 'overdue';
  if (spStatus === 'no_record' || renewalStatus === 'no_record') return 'no_record';
  if (spStatus === 'due_soon' || renewalStatus === 'due_soon') return 'due_soon';
  return 'current';
};
