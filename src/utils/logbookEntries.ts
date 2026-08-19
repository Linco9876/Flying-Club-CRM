export interface LogbookRoleHoursInput {
  student_id?: string | null;
  instructor_id?: string | null;
  flight_duration?: number | null;
  dual_time?: number | null;
  solo_time?: number | null;
}

export interface LogbookRoleHours {
  dualHours: number;
  picHours: number;
}

const positiveNumber = (value: unknown) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export const getLogbookFlightHours = (entry: LogbookRoleHoursInput) => {
  const duration = positiveNumber(entry.flight_duration);
  if (duration > 0) return duration;
  return positiveNumber(entry.dual_time) + positiveNumber(entry.solo_time);
};

/**
 * Allocates the same flight differently for each person's logbook.
 * The instructor is PIC whenever an instructor is recorded; the student logs
 * the flight as dual. On an uninstructed flight, the student logs PIC.
 */
export const calculateLogbookRoleHours = (
  entry: LogbookRoleHoursInput,
  logbookOwnerId: string,
): LogbookRoleHours => {
  const flightHours = getLogbookFlightHours(entry);
  const recordedDual = positiveNumber(entry.dual_time);
  const recordedSolo = positiveNumber(entry.solo_time);
  const hasRecordedAllocation = recordedDual + recordedSolo > 0;

  if (entry.instructor_id && entry.instructor_id === logbookOwnerId) {
    return {
      dualHours: 0,
      picHours: hasRecordedAllocation ? recordedDual : flightHours,
    };
  }

  if (entry.student_id === logbookOwnerId) {
    if (entry.instructor_id) {
      return {
        dualHours: hasRecordedAllocation ? recordedDual : flightHours,
        picHours: hasRecordedAllocation ? recordedSolo : 0,
      };
    }
    return {
      dualHours: 0,
      picHours: hasRecordedAllocation ? recordedSolo : flightHours,
    };
  }

  return { dualHours: 0, picHours: 0 };
};

export const toLogbookDateKey = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export interface LogbookLessonDestinationInput {
  studentId?: string | null;
  courseId?: string | null;
  lessonId?: string | null;
  trainingRecordId?: string | null;
}

export const buildLogbookLessonDestination = ({
  studentId,
  courseId,
  lessonId,
  trainingRecordId,
}: LogbookLessonDestinationInput) => {
  if (!studentId || !trainingRecordId) return null;
  const params = new URLSearchParams({
    tab: 'training',
    subtab: 'training',
    recordId: trainingRecordId,
  });
  if (courseId) params.set('courseId', courseId);
  if (lessonId) params.set('lessonId', lessonId);
  return `/students/${encodeURIComponent(studentId)}?${params.toString()}`;
};
