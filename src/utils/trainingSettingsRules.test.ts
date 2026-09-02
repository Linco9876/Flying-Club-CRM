import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canStaffEditTrainingRecord,
  canStaffReassignTrainingRecord,
  getTrainingSettingsValidationError,
  shouldAdvanceToNextLesson,
} from './trainingSettingsRules.ts';
import type { TrainingSyllabusSettingsData } from '../hooks/useTrainingSettings';

const validTrainingSettings = {
  endorsementTypes: ['Flight Radio'],
  licenceTypes: ['RPC'],
  medicalTypes: [{
    id: 'raaus-declaration',
    name: 'RAAus Medical Declaration',
    validityMode: 'until_age',
    validUntilAge: 75,
    isActive: true,
  }],
} as TrainingSyllabusSettingsData;

test('next-lesson rules produce distinct, predictable recommendations', () => {
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', true, false), true);
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', false, false), false);
  assert.equal(shouldAdvanceToNextLesson('advance_on_pass', false, true), true);
  assert.equal(shouldAdvanceToNextLesson('always_advance', false, false), true);
  assert.equal(shouldAdvanceToNextLesson('manual', true, true), false);
});

test('only linked submitted records can be reassigned by their instructor or CFI recovery roles', () => {
  assert.equal(canStaffReassignTrainingRecord({
    isAdminOrCfi: false,
    isRecordInstructor: true,
    recordStatus: 'submitted',
    hasFlightLog: true,
  }), true);
  assert.equal(canStaffReassignTrainingRecord({
    isAdminOrCfi: true,
    isRecordInstructor: false,
    recordStatus: 'locked',
    hasFlightLog: true,
  }), true);
  assert.equal(canStaffReassignTrainingRecord({
    isAdminOrCfi: false,
    isRecordInstructor: false,
    recordStatus: 'submitted',
    hasFlightLog: true,
  }), false);
  assert.equal(canStaffReassignTrainingRecord({
    isAdminOrCfi: true,
    isRecordInstructor: false,
    recordStatus: 'draft',
    hasFlightLog: false,
  }), false);
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
  assert.match(getTrainingSettingsValidationError({
    ...validTrainingSettings,
    medicalTypes: [{
      ...validTrainingSettings.medicalTypes[0],
      validUntilAge: 0,
    }],
  }) || '', /age/i);
});
