import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMAL_REVIEW_FINDINGS_LABEL,
  flightReviewErrorMessage,
  isFinalFlightReviewOutcome,
  isSuccessfulFlightReviewOutcome,
  requiresFormalReviewFindings,
} from './flightReviewFindings.ts';

test('uses one clear label for exceptional review findings', () => {
  assert.equal(
    FORMAL_REVIEW_FINDINGS_LABEL,
    'Formal findings or required follow-up',
  );
});

test('further training is final but never a successful currency-renewing outcome', () => {
  assert.equal(isFinalFlightReviewOutcome('further_training_required'), true);
  assert.equal(isSuccessfulFlightReviewOutcome('further_training_required'), false);
  assert.equal(isFinalFlightReviewOutcome('completed'), true);
  assert.equal(isSuccessfulFlightReviewOutcome('completed'), true);
  assert.equal(isFinalFlightReviewOutcome('in_progress'), false);
});

test('surfaces structured database errors instead of hiding their message', () => {
  assert.equal(
    flightReviewErrorMessage(
      { message: 'permission denied for schema private', code: '42501' },
      'Could not update review',
    ),
    'permission denied for schema private',
  );
  assert.equal(flightReviewErrorMessage({}, 'Could not update review'), 'Could not update review');
});

test('normal completed and passed reviews do not require duplicate notes', () => {
  assert.equal(requiresFormalReviewFindings({ reviewStatus: 'completed' }), false);
  assert.equal(requiresFormalReviewFindings({ trainingResult: 'pass' }), false);
});

test('adverse and non-standard outcomes require formal findings', () => {
  assert.equal(requiresFormalReviewFindings({ reviewStatus: 'further_training_required' }), true);
  assert.equal(requiresFormalReviewFindings({ trainingResult: 'fail' }), true);
  assert.equal(requiresFormalReviewFindings({ trainingResult: 'not_assessed' }), true);
  assert.equal(requiresFormalReviewFindings({
    reviewStatus: 'completed',
    checklistResults: ['satisfactory', 'further_training'],
  }), true);
});
