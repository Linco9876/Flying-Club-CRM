import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MEDICAL_TYPES,
  evaluateMedicalCurrency,
  resolveMedicalRequirement,
} from './medicalRequirements.ts';

test('student medical requirements come only from active applicable courses', () => {
  const underThreshold = resolveMedicalRequirement({
    roles: ['student'],
    dateOfBirth: new Date(2000, 7, 20),
    activeCourses: [{
      title: 'Age-based course',
      medicalRequirementMode: 'age_threshold',
      medicalRequirementAge: 30,
    }],
    at: new Date(2026, 7, 19),
  });
  assert.equal(underThreshold.required, false);

  const requiredCourse = resolveMedicalRequirement({
    roles: ['student'],
    dateOfBirth: new Date(2000, 7, 20),
    activeCourses: [{
      title: 'RPC course',
      medicalRequirementMode: 'required',
      medicalRequirementAge: null,
    }],
  });
  assert.deepEqual(requiredCourse, {
    required: true,
    reason: 'course',
    courseTitle: 'RPC course',
  });
});

test('pilots and instructors must select the medical they operate under', () => {
  assert.equal(resolveMedicalRequirement({
    roles: ['pilot'],
    activeCourses: [],
  }).required, true);
  assert.equal(resolveMedicalRequirement({
    roles: ['instructor'],
    activeCourses: [],
  }).reason, 'operating_role');
});

test('RAAus medical declaration remains current until the configured age', () => {
  const before75 = evaluateMedicalCurrency({
    required: true,
    medicalType: 'RAAus Medical Declaration',
    dateOfBirth: new Date(1952, 0, 15),
    definitions: DEFAULT_MEDICAL_TYPES,
    at: new Date(2026, 7, 19),
  });
  assert.equal(before75.state, 'current');
  assert.equal(before75.effectiveExpiry?.getFullYear(), 2027);

  const after75 = evaluateMedicalCurrency({
    required: true,
    medicalType: 'RAAus Medical Declaration',
    dateOfBirth: new Date(1950, 0, 15),
    definitions: DEFAULT_MEDICAL_TYPES,
    at: new Date(2026, 7, 19),
  });
  assert.equal(after75.state, 'expired');
});

test('expiry-date medicals require a member-entered expiry', () => {
  assert.equal(evaluateMedicalCurrency({
    required: true,
    medicalType: 'CASA Class 2',
    definitions: DEFAULT_MEDICAL_TYPES,
  }).state, 'missing_expiry');

  assert.equal(evaluateMedicalCurrency({
    required: false,
    medicalType: 'CASA Class 2',
    medicalExpiry: new Date(2020, 0, 1),
    definitions: DEFAULT_MEDICAL_TYPES,
  }).state, 'not_required');
});
