import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseTrainingSubtab } from './studentProfileTabNavigation.ts';

test('staff Exams and Courses are independent profile tabs after Pilot File', () => {
  for (const tabId of ['exams', 'courses']) {
    assert.equal(shouldUseTrainingSubtab({
      tabId,
      activeTab: 'training',
      isOwnStudentPortal: false,
      portalSection: undefined,
    }), false);
  }
});

test('self-service Exams and Courses remain compact Pilot File subtabs', () => {
  for (const tabId of ['exams', 'courses']) {
    assert.equal(shouldUseTrainingSubtab({
      tabId,
      activeTab: 'training',
      isOwnStudentPortal: true,
      portalSection: 'training',
    }), true);
  }
});

test('training records and reviews remain Pilot File subtabs', () => {
  for (const tabId of ['training', 'reviews']) {
    assert.equal(shouldUseTrainingSubtab({
      tabId,
      activeTab: 'training',
      isOwnStudentPortal: false,
      portalSection: undefined,
    }), true);
  }

  assert.equal(shouldUseTrainingSubtab({
    tabId: 'reviews',
    activeTab: 'exams',
    isOwnStudentPortal: false,
    portalSection: undefined,
  }), false);
});
