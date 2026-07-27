export type DutyBreakWindow = {
  start: Date | string;
  end: Date | string;
};

export type DutyBreakPolicy = {
  enabled: boolean;
  requiredAfterMinutes: number;
  minimumBreakMinutes: number;
};

export type DutyBreakRequirement = {
  required: boolean;
  satisfied: boolean;
  needsConfirmation: boolean;
  dutyMinutes: number;
};

const asMilliseconds = (value: Date | string) => (
  value instanceof Date ? value.getTime() : new Date(value).getTime()
);

export const evaluateDutyBreakRequirement = ({
  dutyStart,
  dutyEnd,
  breaks = [],
  activeBreakStart,
  policy,
}: {
  dutyStart: Date | string;
  dutyEnd: Date | string;
  breaks?: DutyBreakWindow[];
  activeBreakStart?: Date | string;
  policy: DutyBreakPolicy;
}): DutyBreakRequirement => {
  const startMs = asMilliseconds(dutyStart);
  const endMs = asMilliseconds(dutyEnd);
  const dutyMinutes = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.max(0, Math.floor((endMs - startMs) / 60_000))
    : 0;
  const requiredAfterMinutes = Math.max(0, policy.requiredAfterMinutes);
  const minimumBreakMinutes = Math.max(1, policy.minimumBreakMinutes);
  const required = policy.enabled && dutyMinutes > requiredAfterMinutes;

  const isQualifyingWindow = (windowStart: Date | string, windowEnd: Date | string) => {
    const windowStartMs = asMilliseconds(windowStart);
    const windowEndMs = asMilliseconds(windowEnd);
    return Number.isFinite(windowStartMs)
      && Number.isFinite(windowEndMs)
      && windowStartMs >= startMs
      && windowEndMs <= endMs
      && windowEndMs - windowStartMs >= minimumBreakMinutes * 60_000;
  };

  const satisfied = !required
    || breaks.some(item => isQualifyingWindow(item.start, item.end))
    || Boolean(activeBreakStart && isQualifyingWindow(activeBreakStart, dutyEnd));

  return {
    required,
    satisfied,
    needsConfirmation: required && !satisfied,
    dutyMinutes,
  };
};
