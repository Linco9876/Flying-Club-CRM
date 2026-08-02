import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReviewDraftLinkage,
  createReviewDraftTrainingRecord,
  reviewMatchesDraftOrFlight,
} from './draftReviewLinking.ts';

test('starting a review from a new session creates a persistent formal-review draft', () => {
  const record = createReviewDraftTrainingRecord({
    studentId: 'student-id',
    instructorId: 'instructor-id',
    templateId: 'template-id',
    templateTitle: 'RPC Flight Test',
    startedAt: '2026-08-02T08:30:00.000Z',
    aircraftId: 'aircraft-id',
    aircraftType: 'Tecnam P92 Echo Super',
    registration: '24-1234',
  });

  assert.equal(record.courseId, 'template-id');
  assert.equal(record.isFlightReview, true);
  assert.equal(record.flightReviewType, 'RPC Flight Test');
  assert.equal(record.status, 'draft');
  assert.equal(record.studentAck, false);
  assert.equal(record.date.toISOString(), '2026-08-02T08:30:00.000Z');
});

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
