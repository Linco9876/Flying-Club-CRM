import assert from 'node:assert/strict';
import test from 'node:test';
import {
  membershipDocumentsAreReady,
  organisationDocumentCode,
  organisationDocumentFileError,
} from './membershipDocumentRules.ts';

test('membership documents are ready only when every current file can be opened', () => {
  assert.equal(membershipDocumentsAreReady([{ viewUrl: '/constitution.pdf' }], false, null), true);
  assert.equal(membershipDocumentsAreReady([{ viewUrl: null }], false, null), false);
  assert.equal(membershipDocumentsAreReady([{ viewUrl: '/constitution.pdf' }], true, null), false);
  assert.equal(membershipDocumentsAreReady([{ viewUrl: '/constitution.pdf' }], false, 'failed'), false);
});

test('an empty required-document set is valid once loading finishes', () => {
  assert.equal(membershipDocumentsAreReady([], false, null), true);
});

test('organisation document codes are stable and database-safe', () => {
  assert.equal(organisationDocumentCode('  Members’ By-laws 2026 '), 'members_by_laws_2026');
  assert.equal(organisationDocumentCode('CODE---OF___CONDUCT'), 'code_of_conduct');
});

test('organisation document upload rules accept PDF and Word files', () => {
  assert.equal(organisationDocumentFileError({ size: 1_024, type: 'application/pdf' }), null);
  assert.equal(organisationDocumentFileError({
    size: 2_048,
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }), null);
  assert.match(organisationDocumentFileError({ size: 1_024, type: 'image/png' }) || '', /PDF or Word/);
  assert.match(organisationDocumentFileError({ size: 16 * 1024 * 1024, type: 'application/pdf' }) || '', /15 MB/);
});
