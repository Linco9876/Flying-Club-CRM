import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { manifest, migration } from './generate-rpc-p92-learning-migration.mjs';

const quizHardeningMigration = readFileSync(
  new URL('../supabase/migrations/20260729233000_harden_learning_quiz_validation.sql', import.meta.url),
  'utf8',
);

test('provides one substantial P92 program for every live RPC course lesson', () => {
  assert.equal(manifest.length, 19);
  assert.equal(new Set(manifest.map(lesson => lesson.code)).size, 19);
  for (const lesson of manifest) {
    assert.ok(lesson.outcomes.length >= 3, `${lesson.code} needs at least three observable outcomes`);
    assert.ok(lesson.p92.length >= 4, `${lesson.code} needs substantial aircraft application`);
    assert.ok(lesson.sequence.length >= 5, `${lesson.code} needs a complete chair-fly sequence`);
    assert.ok(lesson.threats.length >= 3, `${lesson.code} needs threat and error management`);
    assert.ok(lesson.readiness.length >= 3, `${lesson.code} needs readiness gates`);
    assert.ok(lesson.quiz.length >= 4, `${lesson.code} needs a meaningful assessment`);
    assert.equal(new Set(lesson.quiz.map(question => question.correctAnswer)).size, lesson.quiz.length);
  }
});

test('uses authoritative sources without hard-coding aircraft operating figures', () => {
  for (const lesson of manifest) {
    assert.ok(
      [...lesson.sources, ...lesson.commonSources].some(([, url]) => url.includes('aviation.govt.nz')),
      `${lesson.code} needs a CAA source`,
    );
    assert.ok(lesson.commonSources.some(([, url]) => url.includes('raaus.com.au')), `${lesson.code} needs an RAAus source`);
  }
  assert.match(migration, /current aircraft flight manual, cockpit placards\/checklist/i);
  assert.doesNotMatch(migration, /\b(?:VNE|VNO|VS0|VS1)\s*[=:]\s*\d+/i);
});

test('enforces server-side enrolment, ordering and quiz grading', () => {
  assert.match(migration, /create or replace function public\.assert_learning_step_access/);
  assert.match(migration, /create or replace function public\.submit_learning_quiz/);
  assert.match(migration, /raise exception 'Complete the earlier required steps first'/);
  assert.match(migration, /revoke insert, update, delete on public\.learning_step_progress from anon, authenticated/);
  assert.match(migration, /auto_enrol_from_lesson_links/);
  assert.match(quizHardeningMigration, /Answer every required question before submitting/);
  assert.match(quizHardeningMigration, /v_question_type = 'multiple_choice'/);
});
