import type { TrainingRecord } from '../types';

export const getFlightReviewDueDate = (reviewDate?: Date | string | null) => {
  if (!reviewDate) return null;
  const due = new Date(reviewDate);
  if (!Number.isFinite(due.getTime())) return null;
  due.setFullYear(due.getFullYear() + 2);
  return due;
};

export type RegulatoryReviewAuthority = 'raaus' | 'casa' | 'club';

export const applyRegulatoryReviewDate = ({
  authority,
  completedOn,
  resetsFlightReview,
  lastRaausBfrDate,
  lastCasaAfrDate,
}: {
  authority: RegulatoryReviewAuthority;
  completedOn: string;
  resetsFlightReview: boolean;
  lastRaausBfrDate?: string;
  lastCasaAfrDate?: string;
}) => {
  if (!resetsFlightReview || authority === 'club') {
    return { lastRaausBfrDate, lastCasaAfrDate };
  }

  const newest = (current?: string) => !current || completedOn > current ? completedOn : current;
  if (authority === 'casa') {
    return {
      lastRaausBfrDate: newest(lastRaausBfrDate),
      lastCasaAfrDate: newest(lastCasaAfrDate),
    };
  }

  return {
    lastRaausBfrDate: newest(lastRaausBfrDate),
    lastCasaAfrDate,
  };
};

export const getCourseAwardDate = (
  records: Array<Pick<TrainingRecord, 'courseId' | 'status' | 'date'>>,
  courseId: string,
  fallback = new Date(),
) => {
  const recordedTimes = records
    .filter(record => record.courseId === courseId && record.status !== 'draft')
    .map(record => new Date(record.date).getTime())
    .filter(Number.isFinite);

  return recordedTimes.length > 0
    ? new Date(Math.max(...recordedTimes))
    : new Date(fallback);
};
