import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('student file links are permission-aware, accessible, and interaction-safe', () => {
  const source = readSource('../components/Students/StudentFileLink.tsx');

  assert.match(source, /can\(user,\s*'view-students'\)/);
  assert.match(source, /to=\{`\/students\/\$\{encodeURIComponent\(studentId!\)\}`\}/);
  assert.match(source, /aria-label=\{`Open \$\{displayName\}'s student file`\}/);
  assert.match(source, /data-student-file-link=\{studentId\}/);
  assert.match(source, /onClick=\{event => event\.stopPropagation\(\)\}/);
  assert.match(source, /onPointerDown=\{event => event\.stopPropagation\(\)\}/);
});

test('student names link to files throughout operational workflows', () => {
  const requiredSurfaces = [
    '../components/Aircraft/AircraftFlightLogs.tsx',
    '../components/Aircraft/AircraftProfilePage.tsx',
    '../components/Billing/AccountHistoryModal.tsx',
    '../components/Billing/PilotAccountsTab.tsx',
    '../components/Billing/TransactionsTab.tsx',
    '../components/Bookings/BookingForm.tsx',
    '../components/Bookings/GroundSessionLogModal.tsx',
    '../components/Calendar/Calendar.tsx',
    '../components/Dashboard/Dashboard.tsx',
    '../components/Membership/MembershipDashboard.tsx',
    '../components/Reports/ReportsOverviewTab.tsx',
    '../components/Safety/PilotCurrencyTab.tsx',
    '../components/Settings/AuditDataSettings.tsx',
    '../components/Settings/RolesPermissionsSettings.tsx',
    '../components/Training/FlightReviewWorkspace.tsx',
    '../components/Training/InstructorComplianceRecordForm.tsx',
    '../components/Training/OutstandingRecordsTab.tsx',
    '../components/Vouchers/TrialFlightVouchersPage.tsx',
  ];

  for (const relativePath of requiredSurfaces) {
    const source = readSource(relativePath);
    assert.match(source, /StudentFileLink/, `${relativePath} must render student file links`);
  }
});

test('dashboard bookings retain the student id needed by their name link', () => {
  const source = readSource('../hooks/useDashboardStats.ts');

  assert.match(source, /studentId\?: string/);
  assert.match(source, /student:student_id \(id, name\)/);
  assert.match(source, /studentId: b\.student\?\.id/);
});
