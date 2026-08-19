import assert from 'node:assert/strict';
import test from 'node:test';
import { getAuthErrorMessage } from './authErrorMessage.ts';

test('password reset errors never expose empty serialized objects', () => {
  assert.equal(getAuthErrorMessage(new Error('{}'), 'Reset service unavailable'), 'Reset service unavailable');
  assert.equal(getAuthErrorMessage({}, 'Reset service unavailable'), 'Reset service unavailable');
  assert.equal(getAuthErrorMessage('{ }', 'Reset service unavailable'), 'Reset service unavailable');
  assert.equal(getAuthErrorMessage('[ ]', 'Reset service unavailable'), 'Reset service unavailable');
});

test('password reset errors retain useful direct and nested messages', () => {
  assert.equal(getAuthErrorMessage(new Error('Reset link expired'), 'Fallback'), 'Reset link expired');
  assert.equal(getAuthErrorMessage({ error: { message: 'Email provider unavailable' } }, 'Fallback'), 'Email provider unavailable');
});
