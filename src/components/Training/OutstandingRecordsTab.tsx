import React, { useState, useMemo } from 'react';
import { ClipboardList, CheckCircle, XCircle, ChevronRight, Plane, Clock, BookOpen, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useOutstandingRecords, OutstandingFlightLog } from '../../hooks/useOutstandingRecords';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { LessonAssessmentCriterion } from '../../types';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';

type Step = 'action' | 'course' | 'lesson' | 'form';

interface RecordFormState {
  courseId: string;
  lessonId: string;
  formalBriefing: boolean;
  briefingComments: string;
  flightComments: string;
  criteriaGrades: Record<string, string>;
}

function emptyForm(): RecordFormState {
  return {
    courseId: '',
    lessonId: '',
    formalBriefing: false,
    briefingComments: '',
    flightComments: '',
    criteriaGrades: {},
  };
}

const GRADE_OPTIONS: Record<string, string[]> = {
  'NC/S/C/-': ['-', 'NC', 'S', 'C'],
  'Pass or Fail': ['Fail', 'Pass'],
  'Out of 100': [],
};

const GRADE_LABELS: Record<string, string> = {
  '-': 'Not assessed',
  NC: 'Not competent',
  S: 'Solo Ready',
  C: 'Pilot Ready',
  Fail: 'Fail',
  Pass: 'Pass',
};

const ORDERED_GRADES = ['-', 'NC', 'S', 'C'];

function gradeRank(grade?: string) {
  if (!grade) return 0;
  if (grade === 'Fail') return 0;
  if (grade === 'Pass') return 1;
  const numeric = Number(grade);
  if (!Number.isNaN(numeric)) return numeric;
  const index = ORDERED_GRADES.indexOf(grade);
  return index === -1 ? 0 : index;
}

function isGradeAtLeast(grade: string | undefined, passMark: string | undefined) {
  if (!passMark || passMark === '-') return true;
  if (!grade) return false;
  return gradeRank(grade) >= gradeRank(passMark);
}

function bestGrade(current: string | undefined, next: string | undefined) {
  return gradeRank(next) > gradeRank(current) ? next : current;
}

export const OutstandingRecordsTab: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { outstandingLogs, loading, dismissRecord, markRecorded, refetch } = useOutstandingRecords(
    isAdmin ? undefined : user?.id,
    isAdmin
  );
  const { trainingRecords, addTrainingRecord } = useTrainingRecords();
  const { modules: courses } = useTrainingModules();
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();

  const [activeLog, setActiveLog] = useState<OutstandingFlightLog | null>(null);
  const [step, setStep] = useState<Step>('action');
  const [form, setForm] = useState<RecordFormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === form.courseId) ?? null,
    [courses, form.courseId]
  );

  const selectedLesson = useMemo(
    () => selectedCourse?.lessons.find(l => l.id === form.lessonId) ?? null,
    [selectedCourse, form.lessonId]
  );

  // Criteria come from the course level, pass marks from the lesson
  const activeCriteria: LessonAssessmentCriterion[] = selectedCourse?.assessmentCriteria ?? [];

  const selectedLessonIndex = useMemo(
    () => selectedCourse?.lessons.findIndex(l => l.id === form.lessonId) ?? -1,
    [selectedCourse, form.lessonId]
  );

  const nextLessonAfterSelected = useMemo(() => {
    if (!selectedCourse || selectedLessonIndex < 0) return null;
    return selectedCourse.lessons[selectedLessonIndex + 1] ?? null;
  }, [selectedCourse, selectedLessonIndex]);

  const highestGradesToDate = useMemo(() => {
    if (!activeLog || !selectedCourse) return {};

    return trainingRecords
      .filter(record => record.studentId === activeLog.student_id && record.courseId === selectedCourse.id)
      .reduce<Record<string, string>>((acc, record) => {
        Object.entries(record.criteriaGrades ?? {}).forEach(([criterionId, grade]) => {
          acc[criterionId] = bestGrade(acc[criterionId], grade) ?? '-';
        });
        return acc;
      }, {});
  }, [activeLog, selectedCourse, trainingRecords]);

  const lessonPassed = useMemo(() => {
    if (!selectedLesson || activeCriteria.length === 0) return false;

    return activeCriteria.every(criterion => {
      const passMark = selectedLesson.passMarks?.[criterion.id] ?? '-';
      const grade = form.criteriaGrades[criterion.id] ?? '-';
      return isGradeAtLeast(grade, passMark);
    });
  }, [activeCriteria, form.criteriaGrades, selectedLesson]);

  const nextLessonForRecord = lessonPassed
    ? (nextLessonAfterSelected?.name || nextLessonAfterSelected?.sequenceTitle || 'Course complete')
    : selectedLesson
      ? (selectedLesson.name || selectedLesson.sequenceTitle || 'Repeat current lesson')
      : '';

  function openLog(log: OutstandingFlightLog) {
    setActiveLog(log);
    setStep('action');
    setForm(emptyForm());
  }

  function closePanel() {
    setActiveLog(null);
    setStep('action');
    setForm(emptyForm());
  }

  function toggleExpand(id: string) {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDismiss(log: OutstandingFlightLog) {
    try {
      await dismissRecord(log.id);
      if (activeLog?.id === log.id) closePanel();
    } catch {
      // error already toasted
    }
  }

  function handleSelectCourse(courseId: string) {
    setForm(f => ({ ...f, courseId, lessonId: '', criteriaGrades: {} }));
    setStep('lesson');
  }

  function handleSelectLesson(lessonId: string) {
    const course = courses.find(c => c.id === form.courseId);
    const lesson = course?.lessons.find(l => l.id === lessonId);
    const studentPreviousRecords = activeLog && course
      ? trainingRecords.filter(record => record.studentId === activeLog.student_id && record.courseId === course.id)
      : [];

    const highestByCriterion = studentPreviousRecords.reduce<Record<string, string>>((acc, record) => {
      Object.entries(record.criteriaGrades ?? {}).forEach(([criterionId, grade]) => {
        acc[criterionId] = bestGrade(acc[criterionId], grade) ?? '-';
      });
      return acc;
    }, {});

    // Pre-populate with the student's highest grade achieved to date, or "-" if never assessed.
    const defaults: Record<string, string> = {};
    if (course && lesson) {
      for (const crit of course.assessmentCriteria) {
        defaults[crit.id] = highestByCriterion[crit.id] ?? '-';
      }
    }
    setForm(f => ({ ...f, lessonId, criteriaGrades: defaults }));
    setStep('form');
  }

  async function handleSubmit() {
    if (!activeLog || !user) return;
    if (!form.courseId || !form.lessonId) {
      toast.error('Please select a course and lesson');
      return;
    }

    const aircraft = aircraftList.find(a => a.id === activeLog.aircraft_id);
    const student = users.find(u => u.id === activeLog.student_id);

    setSubmitting(true);
    try {
      await addTrainingRecord({
        studentId: activeLog.student_id,
        flightLogId: activeLog.id,
        bookingId: activeLog.booking_id,
        courseId: form.courseId,
        lessonId: form.lessonId,
        date: new Date(activeLog.start_time),
        aircraftId: activeLog.aircraft_id,
        aircraftType: aircraft?.type ?? 'single-engine',
        registration: aircraft?.registration ?? '',
        instructorId: user.id,
        dualTimeMin: Math.round((activeLog.dual_time ?? 0) * 60),
        soloTimeMin: Math.round((activeLog.solo_time ?? 0) * 60),
        comments: form.flightComments,
        briefingComments: form.briefingComments,
        formalBriefing: form.formalBriefing,
        criteriaGrades: form.criteriaGrades,
        lessonCodes: selectedLesson ? [selectedLesson.sequenceCode].filter(Boolean) : [],
        nextLesson: nextLessonForRecord,
        status: 'submitted',
        studentAck: false,
        attachments: [],
      });

      await markRecorded(activeLog.id);

      // Notify the student they have a lesson record to sign off
      await supabase.from('notifications').insert({
        user_id: activeLog.student_id,
        type: 'training_record',
        title: 'Lesson record requires your sign-off',
        message: `${user.name} has submitted a training record for your flight on ${format(new Date(activeLog.start_time), 'd MMM yyyy')}. Please review and acknowledge it.`,
        is_read: false,
        metadata: { student_id: activeLog.student_id },
      });

      toast.success(`Training record submitted — ${student?.name ?? 'student'} has been notified`);
      closePanel();
    } catch {
      // error already toasted
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full gap-6 p-6">
      {/* Left: list of outstanding flights */}
      <div className={`flex flex-col gap-4 ${activeLog ? 'w-1/2' : 'w-full max-w-2xl mx-auto'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Outstanding Records</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {isAdmin ? 'All instructors — flights awaiting a training record' : 'Flights awaiting a training record'}
            </p>
          </div>
          {outstandingLogs.length > 0 && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-sm font-bold border border-amber-200">
              {outstandingLogs.length}
            </span>
          )}
        </div>

        {outstandingLogs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <CheckCircle className="h-14 w-14 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-gray-900 mb-1">All caught up</h3>
            <p className="text-sm text-gray-500">No outstanding training records.</p>
          </div>
        ) : (
          outstandingLogs.map(log => {
            const isActive = activeLog?.id === log.id;
            const expanded = expandedLogs.has(log.id);
            const flightDate = new Date(log.start_time);
            const durationH = ((log.dual_time ?? 0) + (log.solo_time ?? 0)).toFixed(1);

            return (
              <div
                key={log.id}
                className={`bg-white rounded-xl border transition-all duration-200 ${
                  isActive
                    ? 'border-blue-400 shadow-md ring-1 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate">
                          {log.student_name ?? 'Unknown Student'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {format(flightDate, 'EEE d MMM yyyy')} &middot; {format(flightDate, 'h:mm a')}
                        </p>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <Plane className="h-3 w-3" />
                            {log.aircraft_registration ?? '–'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <Clock className="h-3 w-3" />
                            {durationH}h
                          </span>
                          {isAdmin && log.instructor_name && (
                            <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
                              {log.instructor_name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => toggleExpand(log.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 flex gap-3">
                      <button
                        onClick={() => handleDismiss(log)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <XCircle className="h-4 w-4 text-gray-400" />
                        No Record Needed
                      </button>
                      <button
                        onClick={() => openLog(log)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        <BookOpen className="h-4 w-4" />
                        Add Record
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Right: record entry panel */}
      {activeLog && (
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
            {/* Panel header */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Training Record</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {activeLog.student_name} &middot; {format(new Date(activeLog.start_time), 'd MMM yyyy')}
                </p>
              </div>
              <button
                onClick={closePanel}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Step progress */}
            <div className="px-6 py-3 border-b border-gray-100 bg-white">
              <div className="flex items-center gap-1 text-xs">
                {(['course', 'lesson', 'form'] as Step[]).map((s, i) => {
                  const labels: Record<Step, string> = { action: '', course: 'Select Course', lesson: 'Select Lesson', form: 'Fill Details' };
                  const idx: Record<Step, number> = { action: 0, course: 0, lesson: 1, form: 2 };
                  const currentIdx: Record<Step, number> = { action: -1, course: 0, lesson: 1, form: 2 };
                  const done = currentIdx[step] > idx[s];
                  const active = step === s;
                  return (
                    <React.Fragment key={s}>
                      {i > 0 && <div className={`flex-1 h-px ${done ? 'bg-blue-400' : 'bg-gray-200'}`} />}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium transition-colors ${
                        active ? 'bg-blue-100 text-blue-700' : done ? 'text-emerald-600' : 'text-gray-400'
                      }`}>
                        {done && <CheckCircle className="h-3 w-3" />}
                        {labels[s]}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {/* Step: action — shouldn't normally render, just in case */}
              {step === 'action' && (
                <div className="flex flex-col gap-4">
                  <button
                    onClick={() => setStep('course')}
                    className="w-full flex items-center justify-between px-5 py-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="font-semibold text-blue-900 text-sm">Add Record</p>
                        <p className="text-xs text-blue-600 mt-0.5">Link this flight to a course lesson</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-blue-400" />
                  </button>
                </div>
              )}

              {/* Step: course selection */}
              {step === 'course' && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-4">Which course was this flight for?</p>
                  {courses.filter(c => c.status === 'published' || c.lessons.length > 0).length === 0 ? (
                    <div className="text-center py-10 text-gray-400">
                      <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No courses available. Create a course in Syllabus Management first.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {courses.filter(c => c.lessons.length > 0).map(course => (
                        <button
                          key={course.id}
                          onClick={() => handleSelectCourse(course.id)}
                          className="w-full flex items-start gap-4 p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-200 transition-colors">
                            <BookOpen className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 text-sm">{course.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{course.category} &middot; {course.lessons.length} lessons</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-400 mt-1 shrink-0 transition-colors" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Step: lesson selection */}
              {step === 'lesson' && selectedCourse && (
                <div>
                  <button
                    onClick={() => setStep('course')}
                    className="text-xs text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-1"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" /> Back to courses
                  </button>
                  <p className="text-sm font-medium text-gray-700 mb-1">Which lesson was covered?</p>
                  <p className="text-xs text-gray-400 mb-4">{selectedCourse.title}</p>
                  <div className="space-y-2">
                    {selectedCourse.lessons.map((lesson, idx) => (
                      <button
                        key={lesson.id}
                        onClick={() => handleSelectLesson(lesson.id)}
                        className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left group"
                      >
                        <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">{lesson.name || lesson.sequenceTitle || `Lesson ${idx + 1}`}</p>
                          {lesson.objective && <p className="text-xs text-gray-400 mt-0.5 truncate">{lesson.objective}</p>}
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-400 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step: form */}
              {step === 'form' && selectedCourse && selectedLesson && (
                <div className="space-y-6">
                  <button
                    onClick={() => setStep('lesson')}
                    className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <ChevronRight className="h-3 w-3 rotate-180" /> Back to lessons
                  </button>

                  {/* Selected context */}
                  <div className="bg-blue-50 rounded-lg px-4 py-3 border border-blue-100 text-sm">
                    <p className="text-blue-800 font-medium">{selectedCourse.title}</p>
                    <p className="text-blue-600 text-xs mt-0.5">{selectedLesson.name || selectedLesson.sequenceTitle}</p>
                  </div>

                  {/* Formal Briefing */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-3">Formal Briefing</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setForm(f => ({ ...f, formalBriefing: true }))}
                        className={`flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                          form.formalBriefing
                            ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setForm(f => ({ ...f, formalBriefing: false, briefingComments: '' }))}
                        className={`flex-1 py-2.5 px-4 rounded-lg border-2 text-sm font-medium transition-all ${
                          !form.formalBriefing
                            ? 'border-gray-400 bg-gray-50 text-gray-800'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        No
                      </button>
                    </div>

                    {form.formalBriefing && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Briefing Comments</label>
                        <textarea
                          rows={3}
                          value={form.briefingComments}
                          onChange={e => setForm(f => ({ ...f, briefingComments: e.target.value }))}
                          placeholder="Describe what was covered in the briefing..."
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        />
                      </div>
                    )}
                  </div>

                  {/* Flight Comments */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-2">Flight Comments</label>
                    <textarea
                      rows={4}
                      value={form.flightComments}
                      onChange={e => setForm(f => ({ ...f, flightComments: e.target.value }))}
                      placeholder="Record observations, progress, and any areas requiring further attention..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>

                  {/* Assessment Criteria */}
                  {activeCriteria.length > 0 && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-800 mb-3">Competency Assessment</label>
                      <div className="mb-3 grid gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 sm:grid-cols-2">
                        <div><span className="font-semibold text-gray-800">-</span> = Not assessed</div>
                        <div><span className="font-semibold text-red-700">NC</span> = Not competent</div>
                        <div><span className="font-semibold text-amber-700">S</span> = Solo Ready</div>
                        <div><span className="font-semibold text-emerald-700">C</span> = Pilot Ready</div>
                      </div>
                      <div className="space-y-3">
                        {activeCriteria.map(criterion => {
                          const passMarkForLesson = selectedLesson.passMarks?.[criterion.id];
                          const gradeOptions = criterion.gradingSystem === 'Out of 100'
                            ? null
                            : GRADE_OPTIONS[criterion.gradingSystem] ?? GRADE_OPTIONS['NC/S/C/-'];
                          const currentGrade = form.criteriaGrades[criterion.id] ?? '-';
                          const highestGrade = highestGradesToDate[criterion.id] ?? '-';
                          const hasPassedCriterion = isGradeAtLeast(currentGrade, passMarkForLesson ?? '-');

                          return (
                            <div key={criterion.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                <p className="text-sm font-medium text-gray-800">{criterion.name}</p>
                                <div className="flex flex-wrap justify-end gap-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    hasPassedCriterion ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                  }`}>
                                    {hasPassedCriterion ? 'Pass' : 'Below pass'}
                                  </span>
                                  {passMarkForLesson && (
                                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                                      Pass mark: {passMarkForLesson} {GRADE_LABELS[passMarkForLesson] ? `(${GRADE_LABELS[passMarkForLesson]})` : ''}
                                    </span>
                                  )}
                                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                                    Best to date: {highestGrade} {GRADE_LABELS[highestGrade] ? `(${GRADE_LABELS[highestGrade]})` : ''}
                                  </span>
                                </div>
                              </div>

                              {gradeOptions ? (
                                <div className="flex gap-2 flex-wrap">
                                  {gradeOptions.map(grade => (
                                    <button
                                      key={grade}
                                      onClick={() => setForm(f => ({
                                        ...f,
                                        criteriaGrades: { ...f.criteriaGrades, [criterion.id]: grade }
                                      }))}
                                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold border-2 transition-all ${
                                        currentGrade === grade
                                          ? grade === 'C' || grade === 'Pass'
                                            ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                                            : grade === 'S'
                                            ? 'border-amber-400 bg-amber-100 text-amber-800'
                                            : grade === 'NC' || grade === 'Fail'
                                            ? 'border-red-400 bg-red-100 text-red-800'
                                            : 'border-gray-400 bg-gray-200 text-gray-700'
                                          : 'border-gray-200 text-gray-500 hover:border-gray-300 bg-white'
                                      }`}
                                    >
                                      {grade}
                                      {GRADE_LABELS[grade] && (
                                        <span className="ml-1 text-xs font-medium opacity-80">
                                          {GRADE_LABELS[grade]}
                                        </span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={currentGrade === '-' ? '' : currentGrade}
                                  onChange={e => setForm(f => ({
                                    ...f,
                                    criteriaGrades: { ...f.criteriaGrades, [criterion.id]: e.target.value || '-' }
                                  }))}
                                  placeholder="0–100"
                                  className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className={`rounded-lg border px-4 py-3 text-sm ${
                    lessonPassed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
                  }`}>
                    <p className={`font-semibold ${lessonPassed ? 'text-emerald-800' : 'text-amber-800'}`}>
                      {lessonPassed ? 'Lesson pass achieved' : 'Lesson not passed yet'}
                    </p>
                    <p className={`mt-1 text-xs ${lessonPassed ? 'text-emerald-700' : 'text-amber-700'}`}>
                      Next lesson on record: {nextLessonForRecord || 'Not set'}
                    </p>
                  </div>

                  {/* Submit */}
                  <div className="pt-2 border-t border-gray-100">
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || !form.flightComments.trim()}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {submitting ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <ClipboardList className="h-4 w-4" />
                          Submit Training Record
                        </>
                      )}
                    </button>
                    <p className="text-xs text-gray-400 text-center mt-2">
                      The student will be asked to acknowledge this record.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
