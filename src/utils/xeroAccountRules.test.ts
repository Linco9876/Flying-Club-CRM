import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasSelectedActiveXeroBankAccount,
  isActiveXeroBankAccount,
} from './xeroAccountRules.ts';

const accounts = [
  { code: '605', name: 'Operating Account', type: 'BANK', status: 'ACTIVE' },
  { code: 'TOPUPRCPT', name: 'Member Top-up Receipts', type: 'CURRENT', status: 'ACTIVE' },
  { code: '606', name: 'Closed Bank', type: 'BANK', status: 'ARCHIVED' },
];

test('only an active Xero BANK account is eligible for member top-up receipts', () => {
  assert.equal(isActiveXeroBankAccount(accounts[0]), true);
  assert.equal(isActiveXeroBankAccount(accounts[1]), false);
  assert.equal(isActiveXeroBankAccount(accounts[2]), false);
});

test('the selected top-up receipt account must exist in the live bank account list', () => {
  assert.equal(hasSelectedActiveXeroBankAccount(accounts, '605'), true);
  assert.equal(hasSelectedActiveXeroBankAccount(accounts, 'TOPUPRCPT'), false);
  assert.equal(hasSelectedActiveXeroBankAccount(accounts, '999'), false);
  assert.equal(hasSelectedActiveXeroBankAccount(accounts, ''), false);
});
