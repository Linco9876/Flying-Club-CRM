import type { MembershipClass, User } from '../types';
import { csvCell, parseCsv, withUtf8CsvBom } from './studentRecordImport.ts';
import {
  membershipClassEligibility,
  membershipClassRequiresFinancialStatus,
} from './membershipChangeRules.ts';

export type ExistingMemberImportFeeDisposition = 'paid' | 'invoice_required' | 'waived';

export interface ExistingMemberCsvImportRow {
  sourceRow: number;
  email: string;
  userId?: string;
  userName?: string;
  membershipClassCode: string;
  membershipClassName?: string;
  commencedAt: string;
  feeDisposition: ExistingMemberImportFeeDisposition;
  feeDispositionLabel: string;
  reason: string;
  errors: string[];
}

export interface ExistingMemberCsvValidationResult {
  rows: ExistingMemberCsvImportRow[];
  fileErrors: string[];
  validRows: ExistingMemberCsvImportRow[];
  invalidRows: ExistingMemberCsvImportRow[];
}

const HEADER_ALIASES = {
  email: ['email', 'email_address'],
  membershipClass: ['membership_class', 'membership_class_code', 'class'],
  commencedAt: ['commenced_at', 'original_commencement', 'commencement_date'],
  feeDisposition: ['fee_disposition', 'financial_status', 'fee_status'],
  reason: ['waiver_reason', 'reason'],
} as const;

const normaliseLookup = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const valueFor = (values: Record<string, string>, aliases: readonly string[]) => {
  const header = aliases.find(alias => Object.prototype.hasOwnProperty.call(values, alias));
  return header ? values[header].trim() : '';
};

const hasHeader = (headers: string[], aliases: readonly string[]) =>
  aliases.some(alias => headers.includes(alias));

const normaliseDate = (value: string) => {
  const cleaned = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(cleaned);
  const australianMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cleaned);
  const match = isoMatch || australianMatch;
  if (!match) return null;

  const year = Number(match[isoMatch ? 1 : 3]);
  const month = Number(match[2]);
  const day = Number(match[isoMatch ? 3 : 1]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const normaliseFeeDisposition = (value: string): ExistingMemberImportFeeDisposition | null => {
  const cleaned = normaliseLookup(value);
  if (['paid', 'already paid', 'paid already'].includes(cleaned)) return 'paid';
  if (['invoice', 'invoice required', 'requires invoice', 'to invoice'].includes(cleaned)) return 'invoice_required';
  if (['waived', 'fee waived', 'waiver'].includes(cleaned)) return 'waived';
  return null;
};

const todayIso = (now: Date) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getExistingMemberCsvTemplate = () => withUtf8CsvBom([
  ['email', 'membership_class', 'commenced_at', 'fee_disposition', 'waiver_reason'].map(csvCell).join(','),
  ['member@example.com', 'full', '2020-07-01', 'paid', ''].map(csvCell).join(','),
].join('\r\n'));

export const validateExistingMemberCsv = ({
  contents,
  users,
  membershipClasses,
  existingMembershipUserIds,
  now = new Date(),
}: {
  contents: string;
  users: Pick<User, 'id' | 'email' | 'name' | 'portalAccessScope' | 'dateOfBirth'>[];
  membershipClasses: Pick<MembershipClass, 'code' | 'name' | 'isActive' | 'isFeeExempt'>[];
  existingMembershipUserIds: Iterable<string>;
  now?: Date;
}): ExistingMemberCsvValidationResult => {
  const parsed = parseCsv(contents);
  const fileErrors = [...parsed.errors];
  const requiredHeaders = [
    ['email', HEADER_ALIASES.email],
    ['membership_class', HEADER_ALIASES.membershipClass],
    ['commenced_at', HEADER_ALIASES.commencedAt],
  ] as const;
  requiredHeaders.forEach(([label, aliases]) => {
    if (!hasHeader(parsed.headers, aliases)) fileErrors.push(`Missing required ${label} column.`);
  });

  if (fileErrors.length > 0) {
    return { rows: [], fileErrors: Array.from(new Set(fileErrors)), validRows: [], invalidRows: [] };
  }

  const usersByEmail = new Map<string, typeof users>();
  users.forEach((user) => {
    const email = user.email.trim().toLowerCase();
    usersByEmail.set(email, [...(usersByEmail.get(email) || []), user]);
  });
  const existingIds = new Set(existingMembershipUserIds);
  const emailCounts = new Map<string, number>();
  parsed.rows.forEach((row) => {
    const email = valueFor(row.values, HEADER_ALIASES.email).toLowerCase();
    if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  });
  const activeClasses = membershipClasses.filter(membershipClass => membershipClass.isActive);
  const currentDate = todayIso(now);

  const rows = parsed.rows.map((source): ExistingMemberCsvImportRow => {
    const errors: string[] = [];
    const email = valueFor(source.values, HEADER_ALIASES.email).toLowerCase();
    const rawClass = valueFor(source.values, HEADER_ALIASES.membershipClass);
    const rawDate = valueFor(source.values, HEADER_ALIASES.commencedAt);
    const rawFeeDisposition = valueFor(source.values, HEADER_ALIASES.feeDisposition);
    const reason = valueFor(source.values, HEADER_ALIASES.reason);

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Enter a valid email address.');
    }
    if ((emailCounts.get(email) || 0) > 1) errors.push('This email appears more than once in the CSV.');

    const matchingUsers = usersByEmail.get(email) || [];
    const user = matchingUsers.length === 1 ? matchingUsers[0] : undefined;
    if (email && matchingUsers.length === 0) errors.push('No existing portal user has this email. Add the user without inviting them first.');
    if (matchingUsers.length > 1) errors.push('More than one portal user has this email. Resolve the duplicate accounts first.');
    if (user?.portalAccessScope && user.portalAccessScope !== 'full') errors.push('This account is not a full portal member.');
    if (user && existingIds.has(user.id)) errors.push('This person is already in the club membership register.');

    const classLookup = normaliseLookup(rawClass);
    const matchingClasses = activeClasses.filter((membershipClass) =>
      normaliseLookup(String(membershipClass.code)) === classLookup ||
      normaliseLookup(membershipClass.name) === classLookup
    );
    const membershipClass = matchingClasses.length === 1 ? matchingClasses[0] : undefined;
    if (!rawClass) errors.push('Membership class is required.');
    else if (matchingClasses.length === 0) errors.push('Membership class does not match an active class.');
    else if (matchingClasses.length > 1) errors.push('Membership class is ambiguous; use its unique code.');
    if (
      membershipClass?.code === 'junior'
      && !membershipClassEligibility('junior', user?.dateOfBirth, currentDate).eligible
    ) {
      errors.push('Junior membership requires the matched portal user to be under 18 with a recorded date of birth.');
    }

    const commencedAt = normaliseDate(rawDate);
    if (!commencedAt) errors.push('Commencement must be a valid YYYY-MM-DD or DD/MM/YYYY date.');
    else if (commencedAt > currentDate) errors.push('Commencement cannot be in the future.');

    const requiresFinancialStatus = membershipClassRequiresFinancialStatus(membershipClass);
    const feeDisposition = normaliseFeeDisposition(rawFeeDisposition);
    if (requiresFinancialStatus && !feeDisposition) {
      errors.push('Financial status must be paid, invoice required, or waived for this membership class.');
    }
    if (requiresFinancialStatus && feeDisposition === 'waived' && reason.trim().length < 10) {
      errors.push('A waiver reason of at least 10 characters is required.');
    }

    return {
      sourceRow: source.sourceRow,
      email,
      userId: user?.id,
      userName: user?.name,
      membershipClassCode: membershipClass ? String(membershipClass.code) : rawClass,
      membershipClassName: membershipClass?.name,
      commencedAt: commencedAt || rawDate,
      feeDisposition: requiresFinancialStatus ? feeDisposition || 'paid' : 'paid',
      feeDispositionLabel: !requiresFinancialStatus
        ? 'Fee exempt (membership class)'
        : feeDisposition === 'invoice_required'
          ? 'Invoice required'
          : feeDisposition === 'waived'
            ? 'Waived'
            : 'Paid',
      reason,
      errors: Array.from(new Set(errors)),
    };
  });

  return {
    rows,
    fileErrors: [],
    validRows: rows.filter(row => row.errors.length === 0),
    invalidRows: rows.filter(row => row.errors.length > 0),
  };
};
