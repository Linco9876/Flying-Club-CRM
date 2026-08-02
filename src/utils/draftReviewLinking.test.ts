import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReviewDraftLinkage,
  reviewMatchesDraftOrFlight,
} from './draftReviewLinking.ts';

test('saved draft reviews link to the training draft without using a synthetic flight-log id', () => {
  assert.deepEqual(createReviewDraftLinkage({
    isDraftSession: true,
    activeFlightLogId: 'draft-record:abc',
    draftTrainingRecordId: 'training-record-id',
  }), {
    sourceTrainingRecordId: 'training-record-id',
  });
});

test('the same review is found while editing the draft and after loading it against a flight', () => {
  const review = {
    sourceTrainingRecordId: 'training-record-id',
    flightLogId: 'flight-log-id',
  };
  assert.equal(reviewMatchesDraftOrFlight(review, {
    draftTrainingRecordId: 'training-record-id',
  }), true);
  assert.equal(reviewMatchesDraftOrFlight(review, {
    activeFlightLogId: 'flight-log-id',
  }), true);
});

test('unrelated draft and flight records do not reuse an existing review', () => {
  assert.equal(reviewMatchesDraftOrFlight(
    { sourceTrainingRecordId: 'review-draft', flightLogId: 'review-flight' },
    { draftTrainingRecordId: 'other-draft', activeFlightLogId: 'other-flight' },
  ), false);
});
