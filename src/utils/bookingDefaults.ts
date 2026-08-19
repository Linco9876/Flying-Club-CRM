const parseClockMinutes = (value?: string | null) => {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const formatClockMinutes = (value: number) => {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, Math.round(value)));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
};

export const bookingDefaultTimes = ({
  bookingDayStart,
  bookingDayEnd,
  slotLengthMinutes,
  preferredStart = '09:00',
}: {
  bookingDayStart?: string | null;
  bookingDayEnd?: string | null;
  slotLengthMinutes?: number | null;
  preferredStart?: string;
}) => {
  const dayStart = parseClockMinutes(bookingDayStart) ?? 6 * 60;
  const dayEnd = parseClockMinutes(bookingDayEnd) ?? 22 * 60;
  const requestedStart = parseClockMinutes(preferredStart) ?? 9 * 60;
  const duration = [15, 30, 60, 90].includes(Number(slotLengthMinutes))
    ? Number(slotLengthMinutes)
    : 30;
  const validDayEnd = dayEnd > dayStart ? dayEnd : Math.min(23 * 60 + 59, dayStart + duration);
  const latestStart = Math.max(dayStart, validDayEnd - Math.min(duration, 15));
  const start = Math.min(Math.max(requestedStart, dayStart), latestStart);
  const end = Math.min(start + duration, validDayEnd);

  return {
    startTime: formatClockMinutes(start),
    endTime: formatClockMinutes(end),
  };
};
