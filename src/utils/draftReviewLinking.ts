export interface ReviewDraftLinkage {
  flightLogId?: string;
  sourceTrainingRecordId?: string;
}

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
