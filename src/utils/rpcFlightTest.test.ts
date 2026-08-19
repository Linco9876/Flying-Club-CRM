import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRpcLogbookEntryExample,
  normaliseRpcEndorsements,
  rpcEndorsementOptions,
} from './rpcFlightTest.ts';

test('normalises legacy endorsement text and multi-select arrays', () => {
  assert.deepEqual(
    normaliseRpcEndorsements('Flight Radio, Human Factors; flight radio\nCross Country'),
    ['Flight Radio', 'Human Factors', 'Cross Country'],
  );
  assert.deepEqual(
    normaliseRpcEndorsements(['Tailwheel', '', ' tailwheel ', 'Formation']),
    ['Tailwheel', 'Formation'],
  );
});

test('keeps standard, configured and already-selected endorsement choices', () => {
  const options = rpcEndorsementOptions(['Club Aerotow'], ['Legacy Endorsement']);
  assert.ok(options.includes('Human Factors'));
  assert.ok(options.includes('Club Aerotow'));
  assert.ok(options.includes('Legacy Endorsement'));
});

test('builds a ready-to-copy RPC logbook example with useful placeholders', () => {
  const entry = buildRpcLogbookEntryExample({
    reviewDate: '2026-08-13',
    aircraftType: 'Tecnam P92 Eaglet',
    registration: '24-4852',
    flightMinutes: 72,
    endorsements: ['Human Factors', 'Flight Radio'],
    reviewerName: 'Lincoln Cottingham',
    outcome: 'pending',
  });

  assert.match(entry, /\[PASS \/ FURTHER TRAINING REQUIRED\]/);
  assert.match(entry, /24-4852 - Tecnam P92 Eaglet/);
  assert.match(entry, /Flight time: 1\.2 hr/);
  assert.match(entry, /Human Factors, Flight Radio/);
  assert.match(entry, /\[RAAus member number\]/);
});
