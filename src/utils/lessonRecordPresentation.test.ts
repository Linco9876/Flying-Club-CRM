import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TrainingRecord } from '../types';
import {
  buildCompactLessonRecordSummary,
  formatLessonRecordHours,
  shouldUseCompactLessonRecord,
} from './lessonRecordPresentation.ts';

const record = {
  date: new Date('2026-07-29T00:00:00+10:00'),
  registration: '24-4852',
  aircraftType: 'Tecnam P92 Echo Super',
  dualTimeMin: 75,
  soloTimeMin: 20,
  studentAck: true,
} as TrainingRecord;

test('students cannot expand acknowledged lesson records', () => {
  assert.equal(shouldUseCompactLessonRecord(record, {
    detailsExpanded: true,
    requiresAcknowledgement: true,
    viewerCanExpand: false,
  }), true);
});

test('students cannot expand records that did not require acknowledgement', () => {
  assert.equal(shouldUseCompactLessonRecord({ studentAck: false }, {
    detailsExpanded: true,
    requiresAcknowledgement: false,
    viewerCanExpand: false,
  }), true);
});

test('students can read full details while acknowledgement is pending', () => {
  assert.equal(shouldUseCompactLessonRecord({ studentAck: false }, {
    detailsExpanded: false,
    requiresAcknowledgement: true,
    viewerCanExpand: false,
  }), false);
});

test('staff retain the existing expand and minimise behaviour', () => {
  assert.equal(shouldUseCompactLessonRecord(record, {
    detailsExpanded: false,
    requiresAcknowledgement: true,
    viewerCanExpand: true,
  }), true);
  assert.equal(shouldUseCompactLessonRecord(record, {
    detailsExpanded: true,
    requiresAcknowledgement: true,
    viewerCanExpand: true,
  }), false);
  assert.equal(shouldUseCompactLessonRecord({ studentAck: false }, {
    detailsExpanded: false,
    requiresAcknowledgement: false,
    viewerCanExpand: true,
  }), false);
});

test('compact summaries contain only the requested core lesson facts', () => {
  const summary = buildCompactLessonRecordSummary({
    record,
    instructorName: 'Lincoln Cottingham',
    lessonName: 'Effects of controls',
  });

  assert.deepEqual(summary, {
    date: record.date,
    aircraft: '24-4852',
    instructor: 'Lincoln Cottingham',
    lessonName: 'Effects of controls',
    dualHours: '1.3 h',
    soloHours: '0.3 h',
  });
});

test('hours and missing fields have safe, consistent fallbacks', () => {
  assert.equal(formatLessonRecordHours(-10), '0.0 h');
  assert.deepEqual(
    buildCompactLessonRecordSummary({
      record: { ...record, registration: '', aircraftType: '', dualTimeMin: Number.NaN },
    }),
    {
      date: record.date,
      aircraft: 'Not recorded',
      instructor: 'Not recorded',
      lessonName: 'Lesson not recorded',
      dualHours: '0.0 h',
      soloHours: '0.3 h',
    },
  );
});

test('both student lesson-record views use the compact acknowledged summary', () => {
  const currentProfile = readFileSync(
    new URL('../components/Students/StudentProfilePage.tsx', import.meta.url),
    'utf8',
  );
  const legacyProfile = readFileSync(
    new URL('../components/Students/StudentTrainingRecords.tsx', import.meta.url),
    'utf8',
  );

  for (const source of [currentProfile, legacyProfile]) {
    assert.match(source, /shouldUseCompactLessonRecord/);
    assert.match(source, /<AcknowledgedLessonSummary/);
  }
});
