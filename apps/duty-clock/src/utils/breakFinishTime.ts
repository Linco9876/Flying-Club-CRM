const FUTURE_TOLERANCE_MS = 5 * 60_000;

export const validateBreakFinishTime = ({
  breakStartedAt,
  breakFinishedAt,
  now = new Date(),
}: {
  breakStartedAt: Date | string;
  breakFinishedAt: Date;
  now?: Date;
}) => {
  const startedAt = new Date(breakStartedAt);
  if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(breakFinishedAt.getTime())) {
    return 'Enter a valid break finish time.';
  }
  if (breakFinishedAt.getTime() <= startedAt.getTime()) {
    return 'The break finish must be after the break started.';
  }
  if (breakFinishedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return 'The break finish cannot be in the future.';
  }
  return null;
};

export const isSameLocalDate = (left: Date | string, right: Date | string) => {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  return leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate();
};
