import assert from 'node:assert/strict';
import test from 'node:test';
import { pilotFilePrimaryTab, shouldUseTrainingSubtab } from './studentProfileTabNavigation.ts';

test('Pilot File deep links retain documents and logbook while training remains the default', () => {
  assert.equal(pilotFilePrimaryTab('documents'), 'documents');
  assert.equal(pilotFilePrimaryTab('logbook'), 'logbook');
  for (const tab of [null, 'training', 'reviews', 'exams', 'courses', 'unknown']) {
    assert.equal(pilotFilePrimaryTab(tab), 'training');
  }
});

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
