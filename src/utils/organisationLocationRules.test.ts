import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getOrganisationLocationValidationError,
  hasMultipleOrganisationLocations,
} from './organisationLocationRules.ts';

const primary = {
  name: 'Bendigo Airport',
  latitude: -36.7391667,
  longitude: 144.3297222,
  isPrimary: true,
  isActive: true,
};

test('a single primary business location is valid and keeps location controls hidden', () => {
  assert.equal(getOrganisationLocationValidationError([primary]), null);
  assert.equal(hasMultipleOrganisationLocations(1), false);
});

test('multiple active locations enable location controls', () => {
  assert.equal(hasMultipleOrganisationLocations(2), true);
});

test('requires exactly one active primary location', () => {
  assert.equal(
    getOrganisationLocationValidationError([
      { ...primary, isPrimary: false },
      { ...primary, name: 'Shepparton Airport', longitude: 145.393, isPrimary: false },
    ]),
    'Choose one active primary business location'
  );
});

test('rejects duplicate active location names regardless of case', () => {
  assert.equal(
    getOrganisationLocationValidationError([
      primary,
      { ...primary, name: 'bendigo airport', isPrimary: false },
    ]),
    'Each active business location needs a unique name'
  );
});

test('rejects invalid duty clock coordinates', () => {
  assert.equal(
    getOrganisationLocationValidationError([{ ...primary, latitude: 91 }]),
    'Bendigo Airport: enter a valid latitude'
  );
});
