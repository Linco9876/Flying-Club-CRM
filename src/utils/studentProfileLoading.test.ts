import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getStudentProfileLoadPlan } from './studentProfileLoading.ts';

test('loads only the background data needed by the Overview', () => {
  assert.deepEqual(getStudentProfileLoadPlan('profile', 'records'), {
    userDirectory: true,
    safetyReports: false,
    examResults: false,
    invoices: false,
  });
});

test('loads expensive datasets only on their relevant tabs', () => {
  assert.deepEqual(getStudentProfileLoadPlan('safety', 'records'), {
    userDirectory: false,
    safetyReports: true,
    examResults: false,
    invoices: false,
  });
  assert.deepEqual(getStudentProfileLoadPlan('billing', 'records'), {
    userDirectory: false,
    safetyReports: false,
    examResults: false,
    invoices: true,
  });
  assert.equal(getStudentProfileLoadPlan('training', 'exams').examResults, true);
  assert.equal(getStudentProfileLoadPlan('courses', 'records').examResults, true);
  assert.equal(getStudentProfileLoadPlan('training', 'courses').examResults, true);
  assert.equal(getStudentProfileLoadPlan('training', 'records').examResults, false);
});

test('student profile source preserves the fast targeted and progressive loading contract', () => {
  const profileSource = readFileSync(
    new URL('../components/Students/StudentProfilePage.tsx', import.meta.url),
    'utf8',
  );
  const studentsHookSource = readFileSync(
    new URL('../hooks/useStudents.ts', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const listSource = readFileSync(
    new URL('../components/Students/StudentList.tsx', import.meta.url),
    'utf8',
  );
  const skeletonSource = readFileSync(
    new URL('../components/Students/StudentProfileSkeleton.tsx', import.meta.url),
    'utf8',
  );

  assert.match(profileSource, /scopeStudentId:\s*studentId/);
  assert.match(profileSource, /participateInPageLoad:\s*false/);
  assert.match(profileSource, /overviewRecordsLoading/);
  assert.doesNotMatch(
    profileSource,
    /if \(!studentId \|\| !\['profile', 'training', 'courses'\]\.includes\(activeTab\)\)/,
  );

  for (const scopedColumn of [
    "usersQuery = usersQuery.eq('id', scopeStudentId)",
    "studentsQuery = studentsQuery.eq('id', scopeStudentId)",
    "endorsementsQuery = endorsementsQuery.eq('student_id', scopeStudentId)",
    "licencesQuery = licencesQuery.eq('student_id', scopeStudentId)",
    "rolesQuery = rolesQuery.eq('user_id', scopeStudentId)",
  ]) {
    assert.ok(studentsHookSource.includes(scopedColumn), `missing scoped query: ${scopedColumn}`);
  }

  assert.match(appSource, /<StudentProfileSkeleton/);
  assert.match(appSource, /<Suspense[\s\S]*?fallback=\{\([\s\S]*?<StudentProfileSkeleton/);
  assert.match(listSource, /prefetchStudentProfile/);
  assert.match(listSource, /onPointerEnter=\{prefetchStudentProfile\}/);
  assert.match(listSource, /onFocusCapture=\{prefetchStudentProfile\}/);
  assert.match(skeletonSource, /role="status"/);
  assert.match(skeletonSource, /aria-busy="true"/);
  assert.match(skeletonSource, /motion-reduce:animate-none/);
});

test('completed courses are collapsed by default but remain accessible on demand', () => {
  const profileSource = readFileSync(
    new URL('../components/Students/StudentProfilePage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(profileSource, /expandedCompletedCourseIds[^\n]+new Set\(\)/);
  assert.match(profileSource, /const completedCourseExpanded = !isComplete \|\| expandedCompletedCourseIds\.has\(course\.id\)/);
  assert.match(profileSource, /aria-expanded=\{completedCourseExpanded\}/);
  assert.match(profileSource, /completedCourseExpanded \? 'Collapse' : 'View details'/);
  assert.match(profileSource, /\{completedCourseExpanded && \(/);
});
