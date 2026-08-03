import assert from 'node:assert/strict';
import test from 'node:test';

import { isMissingStorageObjectError } from './backup-crm.mjs';

test('recognises stale Supabase storage listings without hiding unrelated failures', () => {
  assert.equal(isMissingStorageObjectError({ status: 400, body: '{"code":"NoSuchKey"}' }), true);
  assert.equal(isMissingStorageObjectError({ status: 404, body: '{"statusCode":"404"}' }), true);
  assert.equal(isMissingStorageObjectError({ status: 500, body: '{"code":"NoSuchKey"}' }), false);
  assert.equal(isMissingStorageObjectError({ status: 400, body: '{"code":"InvalidRequest"}' }), false);
});
