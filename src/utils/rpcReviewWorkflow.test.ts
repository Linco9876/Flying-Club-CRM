import assert from 'node:assert/strict';
import test from 'node:test';
import { prefillRpcDetails, rpcRetestWithinWindow } from './rpcReviewWorkflow.ts';

test('prefill fills blanks while preserving saved zero, identifiers and manually entered values', () => {
  assert.deepEqual(prefillRpcDetails({ hours: '0', member: '067533', expiry: '', notes: 'Original assessment' }, {
    hours: 20, member: 'other', expiry: '2027-07-08', notes: 'Replacement', invented: 'field',
  }), { hours: '0', member: '067533', expiry: '2027-07-08', notes: 'Original assessment' });
});
test('retest includes day 30 but excludes day 31 and dates before the original flight', () => {
  assert.equal(rpcRetestWithinWindow('2026-09-11', '2026-10-11'), true);
  assert.equal(rpcRetestWithinWindow('2026-09-11', '2026-10-12'), false);
  assert.equal(rpcRetestWithinWindow('2026-09-11', '2026-09-10'), false);
  assert.equal(rpcRetestWithinWindow('invalid', '2026-09-11'), false);
});
test('the original unsuccessful date determines the window across multiple attempts', () => {
  assert.equal(rpcRetestWithinWindow('2026-09-11', '2026-10-20'), false);
  assert.equal(rpcRetestWithinWindow('2026-10-01', '2026-10-20'), true);
});
