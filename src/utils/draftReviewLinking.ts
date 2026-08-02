export interface ReviewDraftLinkage {
  flightLogId?: string;
  sourceTrainingRecordId?: string;
}

export interface ReviewDraftTrainingRecordSeed {
  studentId: string;
  courseId: string;
  date: Date;
  aircraftId: string;
  aircraftType: string;
  registration: string;
  instructorId: string;
  dualTimeMin: number;
  soloTimeMin: number;
  comments: string;
  briefingComments: string;
  formalBriefing: boolean;
  criteriaGrades: Record<string, string>;
  lessonCodes: string[];
  status: 'draft';
  studentAck: false;
  studentComments: string;
  attachments: string[];
  isFlightReview: true;
  flightReviewType: string;
  flightReviewResult: 'not_assessed';
}

export const createReviewDraftTrainingRecord = ({
  studentId,
  instructorId,
  templateId,
  templateTitle,
  startedAt,
  aircraftId,
  aircraftType,
  registration,
}: {
  studentId: string;
  instructorId: string;
  templateId: string;
  templateTitle: string;
  startedAt: string;
  aircraftId?: string;
  aircraftType?: string;
  registration?: string;
}): ReviewDraftTrainingRecordSeed => ({
  studentId,
  courseId: templateId,
  date: new Date(startedAt),
  aircraftId: aircraftId || '',
  aircraftType: aircraftType || '',
  registration: registration || '',
  instructorId,
  dualTimeMin: 0,
  soloTimeMin: 0,
  comments: '',
  briefingComments: '',
  formalBriefing: false,
  criteriaGrades: {},
  lessonCodes: [],
  status: 'draft',
  studentAck: false,
  studentComments: '',
  attachments: [],
  isFlightReview: true,
  flightReviewType: templateTitle,
  flightReviewResult: 'not_assessed',
});

export const createReviewDraftLinkage = ({
  isDraftSession,
  activeFlightLogId,
  draftTrainingRecordId,
}: {
  isDraftSession: boolean;
  activeFlightLogId?: string;
  draftTrainingRecordId?: string;
}): ReviewDraftLinkage => ({
  ...(isDraftSession
    ? {}
    : activeFlightLogId
      ? { flightLogId: activeFlightLogId }
      : {}),
  ...(draftTrainingRecordId
    ? { sourceTrainingRecordId: draftTrainingRecordId }
    : {}),
});

export const reviewMatchesDraftOrFlight = (
  review: ReviewDraftLinkage,
  context: { activeFlightLogId?: string; draftTrainingRecordId?: string },
) => Boolean(
  (context.activeFlightLogId && review.flightLogId === context.activeFlightLogId)
  || (
    context.draftTrainingRecordId
    && review.sourceTrainingRecordId === context.draftTrainingRecordId
  )
);
