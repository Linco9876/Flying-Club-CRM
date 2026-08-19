import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLogbookLessonDestination,
  calculateLogbookRoleHours,
  toLogbookDateKey,
} from './logbookEntries.ts';

test('an instructed flight is PIC for the instructor and dual for the student', () => {
  const flight = {
    student_id: 'student-1',
    instructor_id: 'instructor-1',
    flight_duration: 1.3,
    dual_time: 1.3,
    solo_time: 0,
  };

  assert.deepEqual(calculateLogbookRoleHours(flight, 'instructor-1'), {
    dualHours: 0,
    picHours: 1.3,
  });
  assert.deepEqual(calculateLogbookRoleHours(flight, 'student-1'), {
    dualHours: 1.3,
    picHours: 0,
  });
});

test('an uninstructed flight is PIC for the student', () => {
  assert.deepEqual(calculateLogbookRoleHours({
    student_id: 'student-1',
    flight_duration: 0,
    dual_time: 0,
    solo_time: 1.1,
  }, 'student-1'), {
    dualHours: 0,
    picHours: 1.1,
  });
});

test('a mixed training flight splits the student dual and PIC time without crediting the instructor for the solo portion', () => {
  const flight = {
    student_id: 'student-1',
    instructor_id: 'instructor-1',
    flight_duration: 1.2,
    dual_time: 0.8,
    solo_time: 0.4,
  };

  assert.deepEqual(calculateLogbookRoleHours(flight, 'student-1'), {
    dualHours: 0.8,
    picHours: 0.4,
  });
  assert.deepEqual(calculateLogbookRoleHours(flight, 'instructor-1'), {
    dualHours: 0,
    picHours: 0.8,
  });
});

test('lesson links carry the course, lesson and exact record destination', () => {
  assert.equal(
    buildLogbookLessonDestination({
      studentId: 'student-1',
      courseId: 'course-1',
      lessonId: 'lesson-1',
      trainingRecordId: 'record-1',
    }),
    '/students/student-1?tab=training&subtab=training&recordId=record-1&courseId=course-1&lessonId=lesson-1',
  );
  assert.equal(buildLogbookLessonDestination({ studentId: 'student-1' }), null);
});

test('calendar date links use the viewer local date', () => {
  const date = new Date(2026, 7, 7, 15, 30, 0);
  assert.equal(toLogbookDateKey(date.toISOString()), '2026-08-07');
});
