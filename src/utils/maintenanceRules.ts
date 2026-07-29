export type MaintenanceAlertLevel = 'overdue' | 'urgent' | 'upcoming' | 'ok';

const DAY_MS = 24 * 60 * 60 * 1000;

export const parseLocalDate = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

export const formatLocalDateInput = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const addCalendarMonths = (dateValue: string, months: number): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !Number.isInteger(months)) {
    return '';
  }
  const source = parseLocalDate(dateValue);
  const targetMonth = source.getMonth() + months;
  const target = new Date(source.getFullYear(), targetMonth, 1, 12, 0, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12, 0, 0, 0).getDate();
  target.setDate(Math.min(source.getDate(), lastDay));
  return formatLocalDateInput(target);
};

export const calculateHoursRemaining = (
  nextDueHours?: number,
  currentHours?: number
): number | null => {
  if (
    nextDueHours === undefined ||
    currentHours === undefined ||
    !Number.isFinite(nextDueHours) ||
    !Number.isFinite(currentHours)
  ) {
    return null;
  }

  return nextDueHours - currentHours;
};

export const calculateDaysRemaining = (
  nextDueDate?: Date,
  now = new Date()
): number | null => {
  if (!nextDueDate || Number.isNaN(nextDueDate.getTime())) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const due = new Date(
    nextDueDate.getFullYear(),
    nextDueDate.getMonth(),
    nextDueDate.getDate(),
    12,
    0,
    0,
    0
  );

  return Math.round((due.getTime() - today.getTime()) / DAY_MS);
};

export const getMaintenanceAlertLevel = ({
  hoursRemaining,
  daysRemaining,
  urgentHours,
  upcomingHours,
  urgentDays,
  upcomingDays
}: {
  hoursRemaining: number | null;
  daysRemaining: number | null;
  urgentHours: number;
  upcomingHours: number;
  urgentDays: number;
  upcomingDays: number;
}): MaintenanceAlertLevel => {
  if (
    (hoursRemaining !== null && hoursRemaining < 0) ||
    (daysRemaining !== null && daysRemaining < 0)
  ) {
    return 'overdue';
  }

  if (
    (hoursRemaining !== null && hoursRemaining <= urgentHours) ||
    (daysRemaining !== null && daysRemaining <= urgentDays)
  ) {
    return 'urgent';
  }

  if (
    (hoursRemaining !== null && hoursRemaining <= upcomingHours) ||
    (daysRemaining !== null && daysRemaining <= upcomingDays)
  ) {
    return 'upcoming';
  }

  return 'ok';
};

export const validateMaintenanceThresholds = ({
  urgentHours,
  upcomingHours,
  urgentDays,
  upcomingDays
}: {
  urgentHours: number;
  upcomingHours: number;
  urgentDays: number;
  upcomingDays: number;
}): string | null => {
  const values = [urgentHours, upcomingHours, urgentDays, upcomingDays];
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    return 'Maintenance thresholds must be zero or greater.';
  }

  if (upcomingHours < urgentHours || upcomingDays < urgentDays) {
    return 'Upcoming maintenance thresholds must be greater than or equal to urgent thresholds.';
  }

  return null;
};
