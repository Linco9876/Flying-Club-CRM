import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSelectOptionsByPrefix } from './searchableSelect.ts';

const options = [
  { value: 'alan', label: 'Alan Kroiter' },
  { value: 'robin', label: 'Robin Fosbender' },
  { value: 'roger', label: 'Roger Smith' },
  { value: 'lincoln', label: 'Lincoln Cottingham' },
];

test('searchable dropdowns filter from the start of the option as each character is typed', () => {
  assert.deepEqual(
    filterSelectOptionsByPrefix(options, 'R').map(option => option.label),
    ['Robin Fosbender', 'Roger Smith'],
  );
  assert.deepEqual(
    filterSelectOptionsByPrefix(options, 'Ro').map(option => option.label),
    ['Robin Fosbender', 'Roger Smith'],
  );
  assert.deepEqual(
    filterSelectOptionsByPrefix(options, 'Rob').map(option => option.label),
    ['Robin Fosbender'],
  );
});

test('prefix matching is case and accent insensitive without becoming a contains search', () => {
  const accented = [{ value: 'e', label: 'Échuca' }, { value: 'b', label: 'Bendigo' }];
  assert.deepEqual(filterSelectOptionsByPrefix(accented, 'e').map(option => option.label), ['Échuca']);
  assert.deepEqual(filterSelectOptionsByPrefix(options, 'in').map(option => option.label), []);
});
