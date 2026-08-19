export type DutyBreakReminderState = {
  state: 'disabled' | 'scheduled' | 'warning' | 'due' | 'in_progress' | 'satisfied';
  dueAt?: Date;
  minutesUntilDue?: number;
};

type BreakWindow = { start: string | Date; end: string | Date };

const milliseconds = (value: string | Date) => (
  value instanceof Date ? value.getTime() : new Date(value).getTime()
);

export const getDutyBreakReminderState = ({
  now,
  dutyStart,
  policyEnabled,
  requiredAfterMinutes,
  minimumBreakMinutes,
  recordedBreaks,
  activeBreakStart,
}: {
  now: string | Date | number;
  dutyStart: string | Date;
  policyEnabled: boolean;
  requiredAfterMinutes: number;
  minimumBreakMinutes: number;
  recordedBreaks: BreakWindow[];
  activeBreakStart?: string | Date;
}): DutyBreakReminderState => {
  if (!policyEnabled) return { state: 'disabled' };

  const dutyStartMs = milliseconds(dutyStart);
  const nowMs = typeof now === 'number' ? now : milliseconds(now);
  if (!Number.isFinite(dutyStartMs) || !Number.isFinite(nowMs)) return { state: 'disabled' };

  const minimumBreakMs = Math.max(1, minimumBreakMinutes) * 60_000;
  const hasQualifyingBreak = recordedBreaks.some(item => {
    const start = milliseconds(item.start);
    const end = milliseconds(item.end);
    return Number.isFinite(start)
      && Number.isFinite(end)
      && start >= dutyStartMs
      && end > start
      && end - start >= minimumBreakMs;
  });

  if (hasQualifyingBreak) return { state: 'satisfied' };
  if (activeBreakStart) return { state: 'in_progress' };

  const dueAt = new Date(dutyStartMs + Math.max(0, requiredAfterMinutes) * 60_000);
  const minutesUntilDue = Math.ceil((dueAt.getTime() - nowMs) / 60_000);
  if (minutesUntilDue <= 0) return { state: 'due', dueAt, minutesUntilDue: 0 };
  if (minutesUntilDue <= 30) return { state: 'warning', dueAt, minutesUntilDue };
  return { state: 'scheduled', dueAt, minutesUntilDue };
};
