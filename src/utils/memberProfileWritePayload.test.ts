import assert from 'node:assert/strict';
import test from 'node:test';
import type { Student } from '../types';
import { buildMemberProfileWritePayloads } from './memberProfileWritePayload.ts';

const baseStudent = (): Omit<Student, 'id'> => ({
  email: 'david@example.com',
  name: 'David Weaver',
  role: 'pilot',
  endorsements: [],
  licences: [],
});

test('cleared emergency contact fields are persisted as null in both profile tables', () => {
  const payloads = buildMemberProfileWritePayloads({
    ...baseStudent(),
    emergencyContact: { name: '  ', phone: '', relationship: '' },
  });

  for (const payload of [payloads.user, payloads.studentProfile]) {
    assert.equal(payload.emergency_contact_name, null);
    assert.equal(payload.emergency_contact_phone, null);
    assert.equal(payload.emergency_contact_relationship, null);
  }
});

test('other cleared editable profile fields are sent as null instead of being omitted', () => {
  const { user, studentProfile } = buildMemberProfileWritePayloads(baseStudent());

  assert.equal(user.mobile_phone, null);
  assert.equal(user.address, null);
  assert.equal(user.date_of_birth, null);
  assert.equal(user.preferred_aircraft_id, null);
  assert.equal(studentProfile.medical_type, null);
  assert.equal(studentProfile.medical_expiry, null);
  assert.equal(studentProfile.last_raaus_bfr_date, null);
  assert.equal(studentProfile.occupation, null);
  assert(!Object.hasOwn(user, 'avatar_url'));
  assert(!Object.hasOwn(user, 'cover_url'));
});

test('profile values are trimmed and dates use database-safe calendar dates', () => {
  const { user, studentProfile } = buildMemberProfileWritePayloads({
    ...baseStudent(),
    name: '  David Weaver  ',
    mobilePhone: ' 0400 000 000 ',
    emergencyContact: {
      name: ' Contact Name ',
      phone: ' 03 0000 0000 ',
      relationship: ' Friend ',
    },
    dateOfBirth: new Date('1980-05-12T00:00:00.000Z'),
  });

  assert.equal(user.name, 'David Weaver');
  assert.equal(user.mobile_phone, '0400 000 000');
  assert.equal(user.emergency_contact_name, 'Contact Name');
  assert.equal(studentProfile.emergency_contact_relationship, 'Friend');
  assert.equal(studentProfile.date_of_birth, '1980-05-12');
});
