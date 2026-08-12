export const FORMAL_REVIEW_FINDINGS_LABEL =
  'Formal findings or required follow-up';

export const isSuccessfulFlightReviewOutcome = (status?: string | null) =>
  status === 'completed';

export const isFinalFlightReviewOutcome = (status?: string | null) =>
  status === 'completed' || status === 'further_training_required';

export const requiresFormalReviewFindings = ({
  reviewStatus,
  trainingResult,
  checklistResults = [],
}: {
  reviewStatus?: string | null;
  trainingResult?: string | null;
  checklistResults?: readonly string[];
}) => (
  reviewStatus === 'further_training_required'
  || (Boolean(trainingResult) && trainingResult !== 'pass')
  || checklistResults.some(result => result === 'further_training')
);
