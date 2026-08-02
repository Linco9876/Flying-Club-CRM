import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferLicenceIssuingAuthority,
  isConfiguredCredentialOption,
} from './credentialDropdowns.ts';

test('credential dropdown values must come from the organisation configuration', () => {
  const options = ['RAAus Pilot Certificate', 'CASA Private Pilot Licence (PPL)'];
  assert.equal(isConfiguredCredentialOption('RAAus Pilot Certificate', options), true);
  assert.equal(isConfiguredCredentialOption('  casa private pilot licence (ppl) ', options), true);
  assert.equal(isConfiguredCredentialOption('Made-up licence', options), false);
});

test('known Australian licence types prefill their issuing authority', () => {
  assert.equal(inferLicenceIssuingAuthority('CASA Commercial Pilot Licence (CPL)'), 'CASA');
  assert.equal(inferLicenceIssuingAuthority('RAAus Pilot Certificate'), 'RAAus');
  assert.equal(inferLicenceIssuingAuthority('Foreign PPL'), '');
});
