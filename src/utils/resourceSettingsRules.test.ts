import assert from 'node:assert/strict';
import test from 'node:test';
import { getResourceSettingsValidationError, getRoomValidationError } from './resourceSettingsRules.ts';

const fields = [
  { id: 'registration', name: 'Registration', required: true, visible: true, locked: true },
];
const documents = [{ id: 'poh', name: 'POH', required: true }];

test('accepts useful aircraft and room configuration', () => {
  assert.equal(getResourceSettingsValidationError(fields, documents), null);
  assert.equal(getRoomValidationError({
    name: 'Briefing Room',
    location: 'Clubhouse',
    description: '',
    capacity: 6,
    status: 'available',
    isBookable: true,
  }), null);
});

test('rejects hidden required fields and duplicate document names', () => {
  assert.match(getResourceSettingsValidationError(
    [{ ...fields[0], visible: false }],
    documents,
  ) || '', /required.*visible/i);
  assert.match(getResourceSettingsValidationError(fields, [
    ...documents,
    { id: 'poh-copy', name: ' poh ', required: false },
  ]) || '', /unique/i);
});

test('rejects blank room names and invalid capacities', () => {
  const room = {
    name: ' ',
    location: '',
    description: '',
    capacity: 0,
    status: 'available' as const,
    isBookable: true,
  };
  assert.match(getRoomValidationError(room) || '', /name/i);
  assert.match(getRoomValidationError({ ...room, name: 'Room', capacity: 1.5 }) || '', /whole number/i);
});
