import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  getDefaultTrainingDeficiencyStage,
  getTrainingDeficiencyGate,
} from './trainingDeficiencyRules.ts';

const lesson = (id: string, name: string, isFlightTest = false) => ({
  id,
  name,
  sequenceTitle: name,
  objective: '',
  isFlightTest,
});

test('course lesson names identify solo and pilot-test deficiency gates', () => {
  assert.equal(getTrainingDeficiencyGate(lesson('solo', 'First Solo')), 'pre_solo');
  assert.equal(getTrainingDeficiencyGate(lesson('pre-solo-check', 'Circuits - Pre-solo assessment')), null);
  assert.equal(getTrainingDeficiencyGate(lesson('area-check', 'Pre-training area solo assessment')), null);
  assert.equal(getTrainingDeficiencyGate(lesson('supervised-solo', 'Circuit Consolidation and Supervised Solo')), 'pre_solo');
  assert.equal(getTrainingDeficiencyGate(lesson('test', 'RPC Flight Test', true)), 'pre_test');
  assert.equal(getTrainingDeficiencyGate(lesson('practice', 'RPC Flight Test Profile Practice')), null);
  assert.equal(getTrainingDeficiencyGate(lesson('circuits', 'Circuit consolidation')), null);
  assert.equal(getTrainingDeficiencyGate({
    ...lesson('pre-solo', 'Circuit introduction'),
    objective: 'Prepare for solo circuits',
  }), null);
});

test('new deficiencies default to the next meaningful course gate', () => {
  const preSolo = lesson('pre-solo', 'Circuit introduction');
  const solo = lesson('solo', 'First Solo');
  const postSolo = lesson('post-solo', 'Advanced circuits');
  const flightTest = lesson('test', 'RPC Flight Test', true);
  const course = { lessons: [preSolo, solo, postSolo, flightTest] };

  assert.equal(getDefaultTrainingDeficiencyStage(course, preSolo), 'pre_solo');
  assert.equal(getDefaultTrainingDeficiencyStage(course, solo), 'pre_test');
  assert.equal(getDefaultTrainingDeficiencyStage(course, postSolo), 'pre_test');
});

test('database migration keeps deficiencies instructor-only and enforces gates', () => {
  const migrationPath = fileURLToPath(new URL(
    '../../supabase/migrations/20260816113000_add_staff_only_training_deficiencies.sql',
    import.meta.url,
  ));
  const migration = readFileSync(migrationPath, 'utf8');

  assert.match(migration, /alter table public\.training_deficiencies enable row level security/i);
  assert.match(migration, /grant select on table public\.training_deficiencies to authenticated/i);
  assert.doesNotMatch(migration, /create policy[^;]+student/i);
  assert.match(migration, /on conflict \(created_by, client_reference\) do update/i);
  assert.match(migration, /create trigger enforce_training_deficiency_gate/i);
  assert.match(migration, /v_gate_stage := 'pre_solo'/i);
  assert.match(migration, /v_gate_stage := 'pre_test'/i);
});

test('outstanding-record workflow is a pop-out and non-CFI users skip the type screen', () => {
  const componentPath = fileURLToPath(new URL(
    '../components/Training/OutstandingRecordsTab.tsx',
    import.meta.url,
  ));
  const component = readFileSync(componentPath, 'utf8');

  assert.match(component, /popupOnly\?: boolean/);
  assert.match(component, /setRecordEntryType\(isCfi \? null : 'lesson'\)/);
  assert.match(component, /renderRecordTypeSelector = \(compact = false\) => !isCfi \|\| compact \? null/);
  assert.match(component, /fixed inset-0 z-\[110\]/);
  assert.match(component, /recommendedLessonBlockingDeficiencies/);
});
