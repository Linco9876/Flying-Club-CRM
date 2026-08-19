export interface DraftStudentBookingCandidate {
  studentId?: string | null;
  startTime: string | Date;
  endTime: string | Date;
  status?: string | null;
  deletedAt?: string | Date | null;
}

export interface DraftStudentRecommendation {
  studentId: string;
  source: 'current' | 'next';
}

const unavailableStatuses = new Set(['cancelled', 'canceled', 'deleted', 'no-show', 'no_show']);

const timestamp = (value: string | Date) => {
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
};

export const getDraftStudentRecommendation = (
  bookings: DraftStudentBookingCandidate[],
  eligibleStudentIds: Iterable<string>,
  now: Date = new Date(),
): DraftStudentRecommendation | null => {
  const eligible = new Set(eligibleStudentIds);
  const nowTime = now.getTime();

  const candidates = bookings.flatMap(booking => {
    const studentId = String(booking.studentId ?? '').trim();
    const startTime = timestamp(booking.startTime);
    const endTime = timestamp(booking.endTime);
    const status = String(booking.status ?? '').trim().toLowerCase();

    if (
      !studentId
      || !eligible.has(studentId)
      || booking.deletedAt
      || unavailableStatuses.has(status)
      || startTime === null
      || endTime === null
      || endTime <= nowTime
    ) {
      return [];
    }

    return [{ studentId, startTime, endTime }];
  });

  const current = candidates
    .filter(booking => booking.startTime <= nowTime && booking.endTime > nowTime)
    .sort((left, right) => right.startTime - left.startTime)[0];
  if (current) return { studentId: current.studentId, source: 'current' };

  const next = candidates
    .filter(booking => booking.startTime > nowTime)
    .sort((left, right) => left.startTime - right.startTime)[0];
  return next ? { studentId: next.studentId, source: 'next' } : null;
};
