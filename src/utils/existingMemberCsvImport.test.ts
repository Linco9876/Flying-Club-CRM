import assert from 'node:assert/strict';
import test from 'node:test';
import { getExistingMemberCsvTemplate, validateExistingMemberCsv } from './existingMemberCsvImport.ts';

const users = [
  { id: 'user-1', email: 'member@example.com', name: 'Example Member', portalAccessScope: 'full' as const, dateOfBirth: new Date('1990-01-01') },
  { id: 'user-2', email: 'another@example.com', name: 'Another Member', portalAccessScope: 'full' as const, dateOfBirth: new Date('2012-01-01') },
];
const membershipClasses = [
  { code: 'full' as const, name: 'Full member', isActive: true, isFeeExempt: false },
  { code: 'life' as const, name: 'Life member', isActive: true, isFeeExempt: true },
];

test('existing-member template is Excel-safe and documents every required value', () => {
  const template = getExistingMemberCsvTemplate();
  assert.ok(template.startsWith('\uFEFFemail,membership_class,commenced_at,fee_disposition,waiver_reason'));
  assert.match(template, /member@example\.com,full,2020-07-01,paid/);
});

test('valid CSV matches portal users and classes without inviting anyone', () => {
  const result = validateExistingMemberCsv({
    contents: 'email,membership_class,commenced_at,fee_disposition,waiver_reason\nMEMBER@example.com,Full member,1/7/2020,already paid,',
    users,
    membershipClasses,
    existingMembershipUserIds: [],
    now: new Date('2026-08-10T12:00:00+10:00'),
  });

  assert.deepEqual(result.fileErrors, []);
  assert.equal(result.invalidRows.length, 0);
  assert.deepEqual(result.validRows[0], {
    sourceRow: 2,
    email: 'member@example.com',
    userId: 'user-1',
    userName: 'Example Member',
    membershipClassCode: 'full',
    membershipClassName: 'Full member',
    commencedAt: '2020-07-01',
    feeDisposition: 'paid',
    feeDispositionLabel: 'Paid',
    reason: '',
    errors: [],
  });
});

test('CSV rejects duplicate rows, existing register members, future dates and unknown classes', () => {
  const result = validateExistingMemberCsv({
    contents: [
      'email,membership_class,commenced_at,fee_disposition',
      'member@example.com,missing,2027-01-01,paid',
      'member@example.com,full,2020-01-01,paid',
    ].join('\n'),
    users,
    membershipClasses,
    existingMembershipUserIds: ['user-1'],
    now: new Date('2026-08-10T12:00:00+10:00'),
  });

  assert.equal(result.invalidRows.length, 2);
  assert.match(result.invalidRows[0].errors.join(' '), /more than once/i);
  assert.match(result.invalidRows[0].errors.join(' '), /already in the club membership register/i);
  assert.match(result.invalidRows[0].errors.join(' '), /active class/i);
  assert.match(result.invalidRows[0].errors.join(' '), /future/i);
});

test('CSV requires financial status only for membership classes that charge a fee', () => {
  const missingHeader = validateExistingMemberCsv({
    contents: 'email,membership_class,commenced_at\nunknown@example.com,full,2020-01-01',
    users,
    membershipClasses,
    existingMembershipUserIds: [],
  });
  assert.deepEqual(missingHeader.fileErrors, []);
  assert.match(missingHeader.invalidRows[0].errors.join(' '), /financial status/i);

  const lifeMember = validateExistingMemberCsv({
    contents: 'email,membership_class,commenced_at\nmember@example.com,life,2020-01-01',
    users,
    membershipClasses,
    existingMembershipUserIds: [],
  });
  assert.equal(lifeMember.invalidRows.length, 0);
  assert.equal(lifeMember.validRows[0].feeDisposition, 'paid');
  assert.equal(lifeMember.validRows[0].feeDispositionLabel, 'Fee exempt (membership class)');
});

test('CSV rejects Junior membership for an adult and accepts an eligible minor', () => {
  const classesWithJunior = [
    ...membershipClasses,
    { code: 'junior', name: 'Junior', isActive: true, isFeeExempt: false },
  ];
  const result = validateExistingMemberCsv({
    contents: [
      'email,membership_class,commenced_at,fee_disposition',
      'member@example.com,junior,2020-01-01,paid',
      'another@example.com,junior,2026-07-01,paid',
    ].join('\n'),
    users,
    membershipClasses: classesWithJunior,
    existingMembershipUserIds: [],
    now: new Date('2026-08-16T12:00:00+10:00'),
  });

  assert.match(result.rows[0].errors.join(' '), /under 18/i);
  assert.equal(result.rows[1].errors.length, 0);
});
