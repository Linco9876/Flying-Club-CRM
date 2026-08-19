import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStaffEditTrainingRecord,
  getTrainingSettingsValidationError,
  shouldAdvanceToNextLesson,
} from './trainingSettingsRules.ts';
import type { TrainingSyllabusSettingsData } from '../hooks/useTrainingSettings';

const validTrainingSettings = {
  endorsementTypes: ['Flight Radio'],
  licenceTypes: ['RPC'],
} as TrainingSyllabusSettingsData;

test('next-lesson rules produce distinct, predictable recommendations', () => {
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', true, false), true);
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', false, false), false);
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', false, true), true);
  assert.equal(shouldAdvanceToNextLesson('always_advance', false, false), true);
  assert.equal(shouldAdvanceToNextLesson('manual', true, true), false);
});

test('submitted-record editing applies to the record instructor while admins retain recovery access', () => {
  assert.equal(canStaffEditTrainingRecord({
    isAdmin: false,
    isRecordInstructor: true,
    recordStatus: 'draft',
    allowSubmittedRecordEditing: false,
  }), true);
  assert.equal(canStaffEditTrainingRecord({
    isAdmin: false,
    isRecordInstructor: true,
    recordStatus: 'submitted',
    allowSubmittedRecordEditing: false,
  }), false);
  assert.equal(canStaffEditTrainingRecord({
    isAdmin: false,
    isRecordInstructor: true,
    recordStatus: 'submitted',
    allowSubmittedRecordEditing: true,
  }), true);
  assert.equal(canStaffEditTrainingRecord({
    isAdmin: true,
    isRecordInstructor: false,
    recordStatus: 'locked',
    allowSubmittedRecordEditing: false,
  }), true);
});

test('training settings retain useful, unique licence and endorsement choices', () => {
  assert.equal(getTrainingSettingsValidationError(validTrainingSettings), null);
  assert.match(getTrainingSettingsValidationError({
    ...validTrainingSettings,
    licenceTypes: [],
  }) || '', /licence/i);
  assert.match(getTrainingSettingsValidationError({
    ...validTrainingSettings,
    endorsementTypes: ['Flight Radio', ' flight radio '],
  }) || '', /unique/i);
});
