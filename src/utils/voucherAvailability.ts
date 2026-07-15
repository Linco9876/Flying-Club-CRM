export interface VoucherAvailabilityWindow {
  startDate: string;
  endDate: string;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isAvailabilityWindow = (value: unknown): value is VoucherAvailabilityWindow => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VoucherAvailabilityWindow>;
  return Boolean(
    candidate.startDate &&
    candidate.endDate &&
    DATE_KEY_PATTERN.test(candidate.startDate) &&
    DATE_KEY_PATTERN.test(candidate.endDate) &&
    candidate.startDate <= candidate.endDate
  );
};

export const availabilityMonthKeys = (window: VoucherAvailabilityWindow | null) => {
  if (!window) return [];
  const [startYear, startMonth] = window.startDate.split('-').map(Number);
  const [endYear, endMonth] = window.endDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonth - 1, 1));
  const keys: string[] = [];

  while (cursor <= end) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return keys;
};

export const isDateInAvailabilityWindow = (
  dateKey: string,
  window: VoucherAvailabilityWindow | null
) => Boolean(window && dateKey >= window.startDate && dateKey <= window.endDate);

