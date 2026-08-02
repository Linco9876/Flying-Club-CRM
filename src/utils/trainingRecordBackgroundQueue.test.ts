import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { enqueueTrainingRecordJob } from './trainingRecordBackgroundQueue.ts';

interface TestJob {
  id: string;
  flightLogId: string;
  version: number;
}

test('a newer submission replaces an older job for the same flight', () => {
  const existing: TestJob[] = [
    { id: 'flight-1:course-a:lesson-a', flightLogId: 'flight-1', version: 1 },
    { id: 'flight-2:course-a:lesson-a', flightLogId: 'flight-2', version: 1 },
  ];
  const replacement = { id: 'flight-1:course-b:lesson-b', flightLogId: 'flight-1', version: 2 };

  assert.deepEqual(enqueueTrainingRecordJob(existing, replacement), [existing[1], replacement]);
});

test('re-enqueuing the same submission remains idempotent', () => {
  const first = { id: 'flight-1:course-a:lesson-a', flightLogId: 'flight-1', version: 1 };
  const retry = { ...first, version: 2 };

  assert.deepEqual(enqueueTrainingRecordJob([first], retry), [retry]);
});

test('submitting from outstanding records closes before background processing finishes', () => {
  const source = readFileSync('src/components/Training/OutstandingRecordsTab.tsx', 'utf8');
  const handler = source.slice(source.indexOf('async function handleSubmit()'), source.indexOf('async function handleSaveDraftRecord()'));

  assert.match(handler, /queueSubmit\(submitJob\);\s+closePanel\(\);/);
  assert.match(handler, /void syncPendingSubmits\(\);/);
  assert.doesNotMatch(handler, /await submitQueuedJob/);
});

test('record hooks detach email, enrolment and refresh follow-ups from the core write', () => {
  const source = readFileSync('src/hooks/useTrainingRecords.ts', 'utf8');

  assert.match(source, /void \(async \(\) => \{/);
  assert.match(source, /continueTrainingRecordFollowUps\(\{/);
  assert.doesNotMatch(source, /await sendTrainingRecordAcknowledgementEmail/);
});

test('editing a record closes before notifications and profile refreshes finish', () => {
  const source = readFileSync('src/components/Students/StudentProfilePage.tsx', 'utf8');
  const handler = source.slice(
    source.indexOf('const handleSaveTrainingRecordEdit = async () =>'),
    source.indexOf('// Apply filters to training records'),
  );

  assert.match(handler, /setEditingTrainingRecord\(null\);[\s\S]*const backgroundTasks/);
  assert.match(handler, /void Promise\.allSettled\(backgroundTasks\)/);
  assert.doesNotMatch(handler, /await refetchStudents/);
});
