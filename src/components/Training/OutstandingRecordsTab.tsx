import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ClipboardList, CheckCircle, XCircle, ChevronRight, Plane, Clock, BookOpen, AlertCircle, ChevronDown, ChevronUp, Sparkles, RotateCcw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useOutstandingRecords, OutstandingFlightLog } from '../../hooks/useOutstandingRecords';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { LessonAssessmentCriterion, LessonGradingSystem, SyllabusMatrixStandard } from '../../types';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { cleanupInstructorComment } from '../../utils/commentCleanup';
import {
  matrixStandardLabel,
  matrixStandardMeetsRequirement,
  matrixStandardShortLabel,
  formatSyllabusMatrixText,
  normaliseSyllabusLessonKey,
  useSyllabusMatrix,
} from '../../hooks/useSyllabusMatrix';

type Step = 'action' | 'course' | 'lesson' | 'form';

const TRAINING_RECORD_DRAFT_PREFIX = 'bfc_training_record_draft_v1';
const TRAINING_RECORD_QUEUE_KEY = 'bfc_training_record_submit_queue_v1';

interface RecordFormState {
  courseId: string;
  lessonId: string;
  formalBriefing: boolean;
  briefingComments: string;
  flightComments: string;
  criteriaGrades: Record<string, string>;
  matrixGrades: Record<string, string>;
  isFlightReview: boolean;
  flightReviewType: string;
  flightReviewResult: 'pass' | 'fail' | 'not_assessed';
  flightReviewNotes: string;
}

interface QueuedTrainingRecordSubmit {
  id: string;
  queuedAt: string;
  instructorId: string;
  instructorName?: string;
  studentName?: string;
  courseTitle?: string;
  lessonTitle?: string;
  flightLogId: string;
  recordData: {
    studentId: string;
    flightLogId: string;
    bookingId?: string;
    courseId: string;
    lessonId: string;
    date: string;
    aircraftId: string;
    aircraftType: string;
    registration: string;
    instructorId: string;
    dualTimeMin: number;
    soloTimeMin: number;
    comments: string;
    briefingComments: string;
    formalBriefing: boolean;
    criteriaGrades: Record<string, string>;
    lessonCodes: string[];
    nextLesson: string;
    status: 'submitted' | 'locked';
    studentAck: boolean;
    studentComments: string;
    attachments: unknown[];
    isFlightReview: boolean;
    flightReviewType?: string;
    flightReviewResult?: 'pass' | 'fail' | 'not_assessed';
    flightReviewNotes?: string;
  };
  matrixAssessments: Array<{
    matrixRowId: string;
    achievedStandard?: SyllabusMatrixStandard;
  }>;
  shouldMarkRecorded: boolean;
  shouldNotifyStudent: boolean;
  requiresAck: boolean;
}

function emptyForm(): RecordFormState {
  return {
    courseId: '',
    lessonId: '',
    formalBriefing: false,
    briefingComments: '',
    flightComments: '',
    criteriaGrades: {},
    matrixGrades: {},
    isFlightReview: false,
    flightReviewType: 'Flight Review',
    flightReviewResult: 'not_assessed',
    flightReviewNotes: '',
  };
}

const getDraftKey = (userId?: string, flightLogId?: string) =>
  userId && flightLogId ? `${TRAINING_RECORD_DRAFT_PREFIX}:${userId}:${flightLogId}` : '';

const readQueuedSubmits = (): QueuedTrainingRecordSubmit[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TRAINING_RECORD_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeQueuedSubmits = (queue: QueuedTrainingRecordSubmit[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TRAINING_RECORD_QUEUE_KEY, JSON.stringify(queue));
};

const isNetworkLikeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return !navigator.onLine || /failed to fetch|network|timeout|abort|load failed|fetch/i.test(message);
};

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

function gradeRank(grade?: string, system: LessonGradingSystem = 'NC/S/C/-') {
  if (!grade) return 0;
  if (system === 'Pass or Fail') return grade === 'Pass' ? 1 : 0;
  const numeric = Number(grade);
  if (system === 'Out of 100') return Number.isNaN(numeric) ? 0 : numeric;
  const index = ORDERED_GRADES.indexOf(grade);
  return index === -1 ? 0 : index;
}

function isGradeAtLeast(grade: string | undefined, passMark: string | undefined, system: LessonGradingSystem = 'NC/S/C/-') {
  if (!passMark || passMark === '-') return true;
  if (!grade) return false;
  return gradeRank(grade, system) >= gradeRank(passMark, system);
}

const matrixDerivedCriterionGrade = (passed: boolean, system: LessonGradingSystem) => {
  if (system === 'Pass or Fail') return passed ? 'Pass' : 'Fail';
  if (system === 'Out of 100') return passed ? '100' : '0';
  return passed ? 'C' : 'NC';
};

function bestGrade(current: string | undefined, next: string | undefined, system: LessonGradingSystem = 'NC/S/C/-') {
  return gradeRank(next, system) > gradeRank(current, system) ? next : current;
}

export const OutstandingRecordsTab: React.FC = () => {
  const { user } = useAuth();
  const { settings: trainingSettings } = useTrainingSettings();
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
  const [commentCleanupLoading, setCommentCleanupLoading] = useState(false);
  const [commentCleanupOriginal, setCommentCleanupOriginal] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingSubmits, setPendingSubmits] = useState<QueuedTrainingRecordSubmit[]>(() => readQueuedSubmits());
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [proceedWithCarryForward, setProceedWithCarryForward] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === form.courseId) ?? null,
    [courses, form.courseId]
  );

  const selectedLesson = useMemo(
    () => selectedCourse?.lessons.find(l => l.id === form.lessonId) ?? null,
    [selectedCourse, form.lessonId]
  );

  const selectedLessonIsFlightTest = Boolean(selectedLesson?.isFlightTest);

  const {
    requirementsByLesson,
    requirements: matrixRequirements,
    rowsById,
    bestAssessmentByRow,
    loading: matrixLoading,
    saveAssessments: saveMatrixAssessments,
  } = useSyllabusMatrix(form.courseId || undefined, activeLog?.student_id);

  // Criteria come from the course level, pass marks from the lesson
  const activeCriteria: LessonAssessmentCriterion[] = selectedCourse?.assessmentCriteria ?? [];

  const lessonOrderByKey = useMemo(() => {
    const order = new Map<string, number>();
    selectedCourse?.lessons.forEach((lesson, index) => {
      [
        lesson.id,
        lesson.sequenceCode,
        lesson.name,
        lesson.sequenceTitle,
        normaliseSyllabusLessonKey(lesson.name),
        normaliseSyllabusLessonKey(lesson.sequenceTitle),
      ]
        .filter(Boolean)
        .forEach(key => order.set(key, index));
    });
    return order;
  }, [selectedCourse]);

  const selectedLessonIndex = useMemo(
    () => selectedCourse?.lessons.findIndex(l => l.id === form.lessonId) ?? -1,
    [selectedCourse, form.lessonId]
  );

  const lessonMatrixRequirements = useMemo(() => {
    if (!selectedLesson) return [];
    const lessonKeys = [
      selectedLesson.id,
      selectedLesson.sequenceCode,
      selectedLesson.name,
      selectedLesson.sequenceTitle,
      normaliseSyllabusLessonKey(selectedLesson.name),
      normaliseSyllabusLessonKey(selectedLesson.sequenceTitle),
    ].filter(Boolean);

    const combined = lessonKeys.flatMap(key => requirementsByLesson.get(key) ?? []);
    return Array.from(new Map(combined.map((requirement) => [requirement.id, requirement])).values())
      .sort((a, b) => {
        const rowA = rowsById.get(a.matrixRowId);
        const rowB = rowsById.get(b.matrixRowId);
        return (rowA?.sortOrder ?? 0) - (rowB?.sortOrder ?? 0);
      });
  }, [requirementsByLesson, rowsById, selectedLesson]);

  const carriedForwardMatrixRequirements = useMemo(() => {
    if (!selectedLesson || selectedLessonIndex <= 0) return [];
    const currentRequirementIds = new Set(lessonMatrixRequirements.map(requirement => requirement.id));

    return matrixRequirements
      .filter(requirement => {
        if (currentRequirementIds.has(requirement.id)) return false;
        const requirementOrder = lessonOrderByKey.get(requirement.lessonId || '')
          ?? lessonOrderByKey.get(requirement.lessonSequenceCode || '')
          ?? lessonOrderByKey.get(requirement.lessonColumnTitle || '')
          ?? lessonOrderByKey.get(normaliseSyllabusLessonKey(requirement.lessonColumnTitle));
        if (requirementOrder === undefined || requirementOrder >= selectedLessonIndex) return false;

        const best = bestAssessmentByRow.get(requirement.matrixRowId);
        return Boolean(best?.achievedStandard) && !matrixStandardMeetsRequirement(best?.achievedStandard, requirement.requiredStandard);
      })
      .sort((a, b) => {
        const orderA = lessonOrderByKey.get(a.lessonId || '')
          ?? lessonOrderByKey.get(a.lessonSequenceCode || '')
          ?? lessonOrderByKey.get(a.lessonColumnTitle || '')
          ?? 0;
        const orderB = lessonOrderByKey.get(b.lessonId || '')
          ?? lessonOrderByKey.get(b.lessonSequenceCode || '')
          ?? lessonOrderByKey.get(b.lessonColumnTitle || '')
          ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        const rowA = rowsById.get(a.matrixRowId);
        const rowB = rowsById.get(b.matrixRowId);
        return (rowA?.sortOrder ?? 0) - (rowB?.sortOrder ?? 0);
      });
  }, [
    bestAssessmentByRow,
    lessonMatrixRequirements,
    lessonOrderByKey,
    matrixRequirements,
    rowsById,
    selectedLesson,
    selectedLessonIndex,
  ]);

  const activeMatrixRequirements = useMemo(() => {
    return Array.from(
      new Map([...lessonMatrixRequirements, ...carriedForwardMatrixRequirements].map(requirement => [requirement.id, requirement])).values()
    );
  }, [carriedForwardMatrixRequirements, lessonMatrixRequirements]);

  const carriedForwardRequirementIds = useMemo(
    () => new Set(carriedForwardMatrixRequirements.map(requirement => requirement.id)),
    [carriedForwardMatrixRequirements]
  );

  const hasMatrixAssessment = activeMatrixRequirements.length > 0;

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
          const criterion = selectedCourse.assessmentCriteria.find(item => item.id === criterionId);
          acc[criterionId] = bestGrade(acc[criterionId], grade, criterion?.gradingSystem) ?? '-';
        });
        return acc;
      }, {});
  }, [activeLog, selectedCourse, trainingRecords]);

  const lessonPassed = useMemo(() => {
    if (!selectedLesson) return false;

    if (hasMatrixAssessment) {
      return activeMatrixRequirements.every(requirement => {
        const rawGrade = form.matrixGrades[requirement.matrixRowId];
        const achieved = rawGrade ? Number(rawGrade) as SyllabusMatrixStandard : undefined;
        return matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
      });
    }

    if (activeCriteria.length === 0) return false;

    return activeCriteria.every(criterion => {
      const passMark = selectedLesson.passMarks?.[criterion.id] ?? '-';
      const grade = form.criteriaGrades[criterion.id] ?? '-';
      return isGradeAtLeast(grade, passMark, criterion.gradingSystem);
    });
  }, [activeCriteria, activeMatrixRequirements, form.criteriaGrades, form.matrixGrades, hasMatrixAssessment, selectedLesson]);

  const canProceedWithCarryForward = Boolean(
    hasMatrixAssessment &&
    !lessonPassed &&
    nextLessonAfterSelected
  );

  const lessonWillProceed = lessonPassed || (canProceedWithCarryForward && proceedWithCarryForward);

  const matrixCriterionOutcomes = useMemo(() => {
    if (!hasMatrixAssessment || activeCriteria.length === 0) return [];

    return activeCriteria
      .map((criterion) => {
        const linkedRequirements = activeMatrixRequirements.filter(
          requirement => requirement.assessmentCriterionId === criterion.id
        );
        if (linkedRequirements.length === 0) return null;

        const failedRequirements = linkedRequirements.filter(requirement => {
          const rawGrade = form.matrixGrades[requirement.matrixRowId];
          const achieved = rawGrade ? Number(rawGrade) as SyllabusMatrixStandard : undefined;
          return !matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
        });
        const passed = failedRequirements.length === 0;

        return {
          criterion,
          linkedRequirements,
          failedRequirements,
          passed,
          grade: matrixDerivedCriterionGrade(passed, criterion.gradingSystem),
        };
      })
      .filter(Boolean) as Array<{
        criterion: LessonAssessmentCriterion;
        linkedRequirements: typeof activeMatrixRequirements;
        failedRequirements: typeof activeMatrixRequirements;
        passed: boolean;
        grade: string;
      }>;
  }, [activeCriteria, activeMatrixRequirements, form.matrixGrades, hasMatrixAssessment]);

  const matrixDerivedCriteriaGrades = useMemo(() => {
    return matrixCriterionOutcomes.reduce<Record<string, string>>((acc, outcome) => {
      acc[outcome.criterion.id] = outcome.grade;
      return acc;
    }, {});
  }, [matrixCriterionOutcomes]);

  const nextLessonForRecord = lessonWillProceed
    ? (nextLessonAfterSelected?.name || nextLessonAfterSelected?.sequenceTitle || 'Course complete')
    : selectedLesson
      ? (selectedLesson.name || selectedLesson.sequenceTitle || 'Repeat current lesson')
      : '';

  const selectedCourseRequiresAck = Boolean(
    trainingSettings.forceStudentAcknowledgementForAllCourses ||
    selectedCourse?.requiresStudentAcknowledgement
  );

  const queueSubmit = useCallback((job: QueuedTrainingRecordSubmit) => {
    setPendingSubmits(current => {
      const withoutDuplicate = current.filter(item => item.id !== job.id && item.flightLogId !== job.flightLogId);
      const next = [...withoutDuplicate, job];
      writeQueuedSubmits(next);
      return next;
    });
  }, []);

  const clearDraft = useCallback((flightLogId?: string) => {
    const key = getDraftKey(user?.id, flightLogId);
    if (key && typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
    }
    setDraftSavedAt(null);
  }, [user?.id]);

  const submitQueuedJob = useCallback(async (job: QueuedTrainingRecordSubmit) => {
    const recordDate = new Date(job.recordData.date);
    let trainingRecordId: string | undefined;

    const { data: existingRecord, error: existingError } = await supabase
      .from('training_records')
      .select('id')
      .eq('flight_log_id', job.recordData.flightLogId)
      .eq('course_id', job.recordData.courseId)
      .eq('lesson_id', job.recordData.lessonId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingRecord?.id) {
      trainingRecordId = existingRecord.id;
    } else {
      const createdRecord = await addTrainingRecord({
        ...job.recordData,
        date: recordDate,
      });
      trainingRecordId = createdRecord?.id;
    }

    if (trainingRecordId && job.matrixAssessments.length > 0) {
      await saveMatrixAssessments({
        studentId: job.recordData.studentId,
        courseId: job.recordData.courseId,
        lessonId: job.recordData.lessonId,
        trainingRecordId,
        instructorId: job.recordData.instructorId,
        assessments: job.matrixAssessments,
      });
    }

    if (job.shouldMarkRecorded) {
      await markRecorded(job.flightLogId);
    }

    if (job.shouldNotifyStudent) {
      await supabase.from('notifications').insert({
        user_id: job.recordData.studentId,
        type: 'training_record',
        title: 'Lesson record requires your sign-off',
        message: `${job.instructorName || 'Your instructor'} has submitted a training record for your flight on ${format(recordDate, 'd MMM yyyy')}. Please review and acknowledge it.`,
        is_read: false,
        metadata: { student_id: job.recordData.studentId },
      });
    }
  }, [addTrainingRecord, markRecorded, saveMatrixAssessments]);

  const syncPendingSubmits = useCallback(async () => {
    const queue = readQueuedSubmits();
    if (queue.length === 0 || syncingOfflineQueue || !navigator.onLine) return;

    setSyncingOfflineQueue(true);
    try {
      const remaining: QueuedTrainingRecordSubmit[] = [];
      let syncedCount = 0;

      for (let index = 0; index < queue.length; index += 1) {
        const job = queue[index];
        try {
          await submitQueuedJob(job);
          clearDraft(job.flightLogId);
          syncedCount += 1;
        } catch (error) {
          remaining.push(...queue.slice(index));
          if (!isNetworkLikeError(error)) {
            console.error('Queued training record failed:', error);
          }
          break;
        }
      }

      writeQueuedSubmits(remaining);
      setPendingSubmits(remaining);

      if (syncedCount > 0) {
        toast.success(`${syncedCount} queued training record${syncedCount === 1 ? '' : 's'} synced`);
        void refetch();
      }
    } finally {
      setSyncingOfflineQueue(false);
    }
  }, [clearDraft, refetch, submitQueuedJob, syncingOfflineQueue]);

  function openLog(log: OutstandingFlightLog) {
    setActiveLog(log);
    const draftKey = getDraftKey(user?.id, log.id);
    const savedDraft = draftKey && typeof window !== 'undefined'
      ? window.localStorage.getItem(draftKey)
      : null;

    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft) as { form?: RecordFormState; step?: Step; savedAt?: string };
        setForm(parsed.form || { ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
        setStep(parsed.step || (parsed.form?.lessonId ? 'form' : parsed.form?.courseId ? 'lesson' : 'course'));
        setProceedWithCarryForward(Boolean((parsed as { proceedWithCarryForward?: boolean }).proceedWithCarryForward));
        setDraftSavedAt(parsed.savedAt ? new Date(parsed.savedAt) : null);
        toast.success('Recovered saved training record draft');
      } catch {
        setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
        setStep('course');
        setProceedWithCarryForward(false);
      }
    } else {
      setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
      setStep('course');
      setProceedWithCarryForward(false);
      setDraftSavedAt(null);
    }
    setCommentCleanupOriginal(null);
  }

  function closePanel() {
    setActiveLog(null);
    setStep('action');
    setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
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
    setForm(f => ({ ...f, courseId, lessonId: '', criteriaGrades: {}, matrixGrades: {} }));
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
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
        const criterion = course.assessmentCriteria.find(item => item.id === criterionId);
        acc[criterionId] = bestGrade(acc[criterionId], grade, criterion?.gradingSystem) ?? '-';
      });
      return acc;
    }, {});

    // Pre-populate with the student's highest grade achieved to date, or "-" if never assessed.
    const defaults: Record<string, string> = {};
    if (course && lesson) {
      for (const crit of course.assessmentCriteria) {
        defaults[crit.id] = trainingSettings.prefillHighestGrades ? (highestByCriterion[crit.id] ?? '-') : '-';
      }
    }
    setForm(f => ({
      ...f,
      lessonId,
      criteriaGrades: defaults,
      matrixGrades: {},
      isFlightReview: Boolean(lesson?.isFlightTest),
      flightReviewType: lesson?.isFlightTest ? 'Flight Test' : 'Flight Review',
      flightReviewResult: 'not_assessed',
      flightReviewNotes: '',
    }));
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
    setStep('form');
  }

  async function handleCleanupFlightComments() {
    if (!form.flightComments.trim()) {
      toast.error('Write flight comments before using AI cleanup');
      return;
    }
    setCommentCleanupLoading(true);
    try {
      const rewritten = await cleanupInstructorComment(form.flightComments, {
        studentName: activeLog?.student_name,
        lessonName: selectedLesson?.name || selectedLesson?.sequenceTitle,
        courseName: selectedCourse?.title,
        aircraft: activeLog?.aircraft_registration,
        date: activeLog?.start_time ? format(new Date(activeLog.start_time), 'yyyy-MM-dd') : undefined,
      });
      setCommentCleanupOriginal(form.flightComments);
      setForm(current => ({ ...current, flightComments: rewritten }));
      toast.success('Flight comments cleaned up');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI comment cleanup failed');
    } finally {
      setCommentCleanupLoading(false);
    }
  }

  function handleRevertFlightComments() {
    if (commentCleanupOriginal === null) return;
    setForm(current => ({ ...current, flightComments: commentCleanupOriginal }));
    setCommentCleanupOriginal(null);
  }

  useEffect(() => {
    if (!selectedLesson || activeMatrixRequirements.length === 0) return;
    setForm(current => {
      if (current.lessonId !== selectedLesson.id) return current;
      const defaults: Record<string, string> = {};
      activeMatrixRequirements.forEach(requirement => {
        const best = bestAssessmentByRow.get(requirement.matrixRowId);
        defaults[requirement.matrixRowId] = best?.achievedStandard ? String(best.achievedStandard) : '';
      });

      const hasSameKeys = Object.keys(defaults).length === Object.keys(current.matrixGrades).length
        && Object.keys(defaults).every(key => current.matrixGrades[key] !== undefined);
      if (hasSameKeys) return current;
      return { ...current, matrixGrades: defaults };
    });
  }, [activeMatrixRequirements, bestAssessmentByRow, selectedLesson]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => {
      setIsOnline(true);
      void syncPendingSubmits();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPendingSubmits]);

  useEffect(() => {
    if (isOnline && pendingSubmits.length > 0) {
      void syncPendingSubmits();
    }
  }, [isOnline, pendingSubmits.length, syncPendingSubmits]);

  useEffect(() => {
    if (!activeLog || !user || step === 'action' || typeof window === 'undefined') return;
    const key = getDraftKey(user.id, activeLog.id);
    if (!key) return;

    const timeout = window.setTimeout(() => {
      const savedAt = new Date();
      window.localStorage.setItem(key, JSON.stringify({
        form,
        step,
        proceedWithCarryForward,
        savedAt: savedAt.toISOString(),
      }));
      setDraftSavedAt(savedAt);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [activeLog, form, proceedWithCarryForward, step, user]);

  const buildSubmitJob = (): QueuedTrainingRecordSubmit | null => {
    if (!activeLog || !user || !selectedLesson) return null;

    const aircraft = aircraftList.find(a => a.id === activeLog.aircraft_id);
    const isCourseDefinedFlightTest = Boolean(selectedLesson.isFlightTest);
    const criteriaGrades = hasMatrixAssessment
      ? { ...form.criteriaGrades, ...matrixDerivedCriteriaGrades }
      : form.criteriaGrades;

    return {
      id: `${activeLog.id}:${form.courseId}:${form.lessonId}`,
      queuedAt: new Date().toISOString(),
      instructorId: user.id,
      instructorName: user.name,
      studentName: activeLog.student_name,
      courseTitle: selectedCourse?.title,
      lessonTitle: selectedLesson.name || selectedLesson.sequenceTitle,
      flightLogId: activeLog.id,
      recordData: {
        studentId: activeLog.student_id,
        flightLogId: activeLog.id,
        bookingId: activeLog.booking_id,
        courseId: form.courseId,
        lessonId: form.lessonId,
        date: new Date(activeLog.start_time).toISOString(),
        aircraftId: activeLog.aircraft_id,
        aircraftType: aircraft?.type ?? 'single-engine',
        registration: aircraft?.registration ?? activeLog.aircraft_registration ?? '',
        instructorId: user.id,
        dualTimeMin: Math.round((activeLog.dual_time ?? 0) * 60),
        soloTimeMin: Math.round((activeLog.solo_time ?? 0) * 60),
        comments: form.flightComments,
        briefingComments: form.briefingComments,
        formalBriefing: form.formalBriefing,
        criteriaGrades,
        lessonCodes: selectedLesson.sequenceCode ? [selectedLesson.sequenceCode] : [],
        nextLesson: nextLessonForRecord,
        status: selectedCourseRequiresAck ? 'submitted' : 'locked',
        studentAck: false,
        studentComments: '',
        attachments: [],
        isFlightReview: isCourseDefinedFlightTest,
        flightReviewType: isCourseDefinedFlightTest ? (form.flightReviewType || 'Flight Test') : undefined,
        flightReviewResult: isCourseDefinedFlightTest ? form.flightReviewResult : undefined,
        flightReviewNotes: isCourseDefinedFlightTest ? form.flightReviewNotes : undefined,
      },
      matrixAssessments: hasMatrixAssessment
        ? activeMatrixRequirements.map(requirement => ({
            matrixRowId: requirement.matrixRowId,
            achievedStandard: form.matrixGrades[requirement.matrixRowId]
              ? Number(form.matrixGrades[requirement.matrixRowId]) as SyllabusMatrixStandard
              : undefined,
          }))
        : [],
      shouldMarkRecorded: trainingSettings.autoMarkFlightLogRecorded,
      shouldNotifyStudent: selectedCourseRequiresAck && trainingSettings.autoNotifyStudentOnSubmit,
      requiresAck: selectedCourseRequiresAck,
    };
  };

  async function handleSubmit() {
    if (!activeLog || !user) return;
    if (!form.courseId || !form.lessonId) {
      toast.error('Please select a course and lesson');
      return;
    }
    if (trainingSettings.requireFlightComments && !form.flightComments.trim()) {
      toast.error('Flight comments are required');
      return;
    }
    if (trainingSettings.requireBriefingCommentsWhenFormal && form.formalBriefing && !form.briefingComments.trim()) {
      toast.error('Briefing comments are required when a formal briefing is selected');
      return;
    }

    const student = users.find(u => u.id === activeLog.student_id);
    const submitJob = buildSubmitJob();
    if (!submitJob) {
      toast.error('Could not prepare this training record');
      return;
    }

    setSubmitting(true);
    try {
      if (!navigator.onLine) {
        queueSubmit(submitJob);
        toast.success('Training record saved on this device. It will sync when signal returns.');
        closePanel();
        return;
      }

      await submitQueuedJob(submitJob);
      clearDraft(activeLog.id);

      toast.success(selectedCourseRequiresAck
        ? `Training record submitted - ${student?.name ?? 'student'} has been notified`
        : 'Training record submitted and locked');
      closePanel();
    } catch (error) {
      if (isNetworkLikeError(error)) {
        queueSubmit(submitJob);
        toast.success('Signal dropped. Training record saved on this device and will sync automatically.');
        closePanel();
      } else {
        toast.error('Failed to submit training record');
      }
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
    <div className="flex h-full min-w-0 flex-col gap-4 p-3 sm:p-6 lg:flex-row lg:gap-6">
      {/* Left: list of outstanding flights */}
      <div className={`flex min-w-0 flex-col gap-4 ${activeLog ? 'lg:w-[30%] lg:min-w-[18rem]' : 'w-full max-w-2xl mx-auto'}`}>
        <div className="hidden items-start justify-between gap-3 sm:flex">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Outstanding Records</h2>
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
                className={`bg-white rounded-xl border transition-all duration-200 dark:bg-[#171a21] ${
                  isActive
                    ? 'border-blue-400 shadow-md ring-1 ring-blue-200 dark:ring-blue-400/30'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm dark:border-[#2c2f36] dark:hover:border-[#4b5563]'
                }`}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                        <AlertCircle className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 text-sm truncate dark:text-gray-100">
                          {log.student_name ?? 'Unknown Student'}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {format(flightDate, 'EEE d MMM yyyy')} &middot; {format(flightDate, 'h:mm a')}
                        </p>
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                            <Plane className="h-3 w-3" />
                            {log.aircraft_registration ?? '–'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
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
                    <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 dark:border-[#2c2f36] sm:flex-row sm:gap-3">
                      <button
                        onClick={() => handleDismiss(log)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors dark:border-[#363b45] dark:text-gray-100 dark:hover:bg-[#262b33]"
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
        <div className="min-w-0 lg:w-[70%]">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col dark:border-[#2c2f36] dark:bg-[#171a21]">
            {/* Panel header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-4 dark:border-[#2c2f36] dark:bg-[#11141a] sm:px-6">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Training Record</h3>
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
            <div className="border-b border-gray-100 bg-white px-4 py-3 dark:border-[#2c2f36] dark:bg-[#171a21] sm:px-6">
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {(['course', 'lesson', 'form'] as Step[]).map((s, i) => {
                  const labels: Record<Step, string> = { action: '', course: 'Select Course', lesson: 'Select Lesson', form: 'Fill Details' };
                  const idx: Record<Step, number> = { action: 0, course: 0, lesson: 1, form: 2 };
                  const currentIdx: Record<Step, number> = { action: -1, course: 0, lesson: 1, form: 2 };
                  const done = currentIdx[step] > idx[s];
                  const active = step === s;
                  return (
                    <React.Fragment key={s}>
                      {i > 0 && <div className={`hidden h-px min-w-8 flex-1 sm:block ${done ? 'bg-blue-400' : 'bg-gray-200 dark:bg-[#363b45]'}`} />}
                      <div className={`flex items-center gap-1 px-2 py-1 rounded-full font-medium transition-colors ${
                        active ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200' : done ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-400'
                      }`}>
                        {done && <CheckCircle className="h-3 w-3" />}
                        {labels[s]}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-400/20 dark:bg-blue-950/30 dark:text-blue-100 lg:hidden">
                <p className="font-semibold">{activeLog.student_name ?? 'Unknown Student'}</p>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-200">
                  {format(new Date(activeLog.start_time), 'EEE d MMM yyyy')} &middot; {format(new Date(activeLog.start_time), 'h:mm a')} &middot; {activeLog.aircraft_registration ?? '-'}
                </p>
              </div>
              {/* Step: action — shouldn't normally render, just in case */}
              {step === 'action' && (
                <div className="flex flex-col gap-4">
                  <button
                    onClick={() => setStep('course')}
                    className="w-full flex items-center justify-between gap-3 px-4 py-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
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
                          className="w-full flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left group sm:gap-4 sm:p-4"
                        >
                          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-blue-200 transition-colors">
                            <BookOpen className="h-4 w-4 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 text-sm break-words">{course.title}</p>
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
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left group sm:gap-4 sm:p-4"
                      >
                        <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm break-words">{lesson.name || lesson.sequenceTitle || `Lesson ${idx + 1}`}</p>
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

                  <div className={`rounded-xl border px-3 py-2 text-xs ${
                    isOnline
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {isOnline ? 'Online - autosaving locally as backup' : 'Offline - keep writing, submit will queue'}
                      </span>
                      {draftSavedAt && (
                        <span>Draft saved {format(draftSavedAt, 'HH:mm')}</span>
                      )}
                    </div>
                    {pendingSubmits.length > 0 && (
                      <p className="mt-1">
                        {pendingSubmits.length} training record{pendingSubmits.length === 1 ? '' : 's'} waiting to sync.
                        {syncingOfflineQueue ? ' Syncing now...' : ' They will submit automatically when signal returns.'}
                      </p>
                    )}
                  </div>

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
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Flight Comments</label>
                      <div className="flex items-center gap-2">
                        {commentCleanupOriginal !== null && (
                          <button
                            type="button"
                            onClick={handleRevertFlightComments}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-[#363b45] dark:text-gray-200 dark:hover:bg-[#262b33]"
                            title="Revert to your original comments"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Revert
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleCleanupFlightComments}
                          disabled={commentCleanupLoading || !form.flightComments.trim()}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/40 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60"
                          title="Clean up comments with AI"
                          aria-label="Clean up flight comments with AI"
                        >
                          {commentCleanupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={form.flightComments}
                      onChange={e => {
                        setForm(f => ({ ...f, flightComments: e.target.value }));
                        if (commentCleanupOriginal !== null) setCommentCleanupOriginal(null);
                      }}
                      placeholder="Record observations, progress, and any areas requiring further attention..."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none dark:border-[#363b45] dark:bg-[#0f172a] dark:text-gray-100 dark:placeholder:text-gray-500"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Use the sparkle button to clean up wording while keeping the instructor's meaning.
                    </p>
                  </div>

                  {/* CASA Matrix Assessment */}
                  {hasMatrixAssessment && (
                    <div>
                      <label className="mb-3 block text-sm font-semibold text-gray-800 dark:text-gray-100">Lesson Matrix Assessment</label>
                      <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-400/30 dark:bg-blue-950/25 dark:text-blue-100">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">Lesson-specific matrix rows</p>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-[#111827] dark:text-blue-200 dark:ring-blue-400/20">
                            {activeMatrixRequirements.length} items
                          </span>
                        </div>
                        {carriedForwardMatrixRequirements.length > 0 && (
                          <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-400/20">
                            {carriedForwardMatrixRequirements.length} carried-forward item{carriedForwardMatrixRequirements.length === 1 ? '' : 's'} from earlier lessons.
                          </p>
                        )}
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          {[
                            { standard: 3, label: 'Training' },
                            { standard: 2, label: 'Solo' },
                            { standard: 1, label: 'Qual.' },
                          ].map(({ standard, label }) => (
                            <span key={standard} className="rounded-lg bg-white px-2 py-1.5 text-center ring-1 ring-blue-100 dark:bg-[#111827] dark:ring-blue-400/20">
                              <span className="block text-sm font-bold">{standard}</span>
                              <span className="block truncate text-[10px] font-medium opacity-80">{label}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {matrixLoading ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-[#2c2f36] dark:bg-[#111827] dark:text-gray-300">
                          Loading matrix requirements...
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {activeMatrixRequirements.map(requirement => {
                            const row = rowsById.get(requirement.matrixRowId);
                            const current = form.matrixGrades[requirement.matrixRowId] ?? '';
                            const achieved = current ? Number(current) as SyllabusMatrixStandard : undefined;
                            const best = bestAssessmentByRow.get(requirement.matrixRowId);
                            const passed = matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
                            const isCarriedForward = carriedForwardRequirementIds.has(requirement.id);
                            const statusClass = passed
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200';

                            return (
                              <div key={requirement.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-[#2c2f36] dark:bg-[#0f172a] sm:p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        {row?.elementCode || row?.unitCode || row?.code || 'Matrix item'}
                                      </p>
                                      {isCarriedForward && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                          Carry-forward
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-sm font-semibold leading-5 text-gray-900 dark:text-gray-100 sm:text-base sm:leading-6">{formatSyllabusMatrixText(row?.description) || 'Matrix row'}</p>
                                    {isCarriedForward && (
                                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                                        From {requirement.lessonColumnTitle || requirement.lessonSequenceCode || 'an earlier lesson'}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}>
                                      {passed ? 'Pass' : 'Below pass'}
                                    </span>
                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-[#202938] dark:text-gray-200">
                                      Req {requirement.requiredStandard}
                                    </span>
                                  </div>
                                </div>
                                {best?.achievedStandard && (
                                  <div className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                                    Best to date: {matrixStandardShortLabel(best.achievedStandard)}
                                  </div>
                                )}
                                <div className="mt-3 grid grid-cols-4 gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setForm(f => ({
                                      ...f,
                                      matrixGrades: { ...f.matrixGrades, [requirement.matrixRowId]: '' }
                                    }))}
                                    className={`min-h-12 rounded-xl border-2 px-2 py-2 text-sm font-bold transition sm:min-h-10 sm:px-3 sm:py-1.5 ${
                                      current === ''
                                        ? 'border-gray-400 bg-gray-200 text-gray-800 dark:bg-[#2c2f36] dark:text-gray-100'
                                        : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-300'
                                    }`}
                                  >
                                    -
                                  </button>
                                  {[3, 2, 1].map(standard => (
                                    <button
                                      key={standard}
                                      type="button"
                                      onClick={() => setForm(f => ({
                                        ...f,
                                        matrixGrades: { ...f.matrixGrades, [requirement.matrixRowId]: String(standard) }
                                      }))}
                                      className={`min-h-12 rounded-xl border-2 px-2 py-2 text-sm font-bold transition sm:min-h-10 sm:px-3 sm:py-1.5 ${
                                        current === String(standard)
                                          ? standard === 1
                                            ? 'border-emerald-500 bg-emerald-100 text-emerald-800'
                                            : standard === 2
                                            ? 'border-blue-500 bg-blue-100 text-blue-800'
                                            : 'border-amber-500 bg-amber-100 text-amber-800'
                                          : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 dark:border-[#363b45] dark:bg-[#111827] dark:text-gray-300'
                                      }`}
                                    >
                                      {standard}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Assessment Criteria */}
                  {hasMatrixAssessment && matrixCriterionOutcomes.length > 0 && (
                    <div>
                      <label className="mb-3 block text-sm font-semibold text-gray-800 dark:text-gray-100">Matrix-linked competency outcomes</label>
                      <div className="space-y-3">
                        {matrixCriterionOutcomes.map((outcome) => (
                          <div
                            key={outcome.criterion.id}
                            className={`rounded-xl border p-3 sm:p-4 ${
                              outcome.passed
                                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-950/20'
                                : 'border-red-200 bg-red-50 dark:border-red-400/30 dark:bg-red-950/20'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{outcome.criterion.name}</p>
                                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                  {outcome.linkedRequirements.length} linked matrix item{outcome.linkedRequirements.length === 1 ? '' : 's'}.
                                </p>
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                outcome.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {outcome.grade} - {outcome.passed ? 'Pass' : 'Below pass'}
                              </span>
                            </div>
                            {outcome.failedRequirements.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {outcome.failedRequirements.slice(0, 4).map((requirement) => {
                                  const row = rowsById.get(requirement.matrixRowId);
                                  const achieved = form.matrixGrades[requirement.matrixRowId] || '-';
                                  return (
                                    <p key={requirement.id} className="rounded-lg bg-white/70 px-2 py-1.5 text-xs text-red-800 dark:bg-[#111827]/70 dark:text-red-200">
                                      {row?.elementCode || row?.unitCode || row?.code || 'Matrix item'}: achieved {achieved}, required {requirement.requiredStandard}
                                      {row?.description ? ` - ${formatSyllabusMatrixText(row.description)}` : ''}
                                    </p>
                                  );
                                })}
                                {outcome.failedRequirements.length > 4 && (
                                  <p className="text-xs text-red-700 dark:text-red-200">
                                    Plus {outcome.failedRequirements.length - 4} more linked item{outcome.failedRequirements.length - 4 === 1 ? '' : 's'} below pass.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {canProceedWithCarryForward && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/25 dark:text-amber-100 sm:p-4">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={proceedWithCarryForward}
                          onChange={event => setProceedWithCarryForward(event.target.checked)}
                          className="mt-1 h-4 w-4 rounded border-amber-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                          <span className="block font-semibold">Proceed to the next lesson and carry forward below-standard matrix items</span>
                          <span className="mt-1 block text-xs leading-5 text-amber-800 dark:text-amber-200">
                            The lesson record will show the next lesson as {nextLessonAfterSelected?.name || nextLessonAfterSelected?.sequenceTitle}. Any matrix item not meeting its required standard will appear again in later RPL records until it is marked competent.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {!hasMatrixAssessment && activeCriteria.length > 0 && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-800 mb-3 dark:text-gray-100">Competency Assessment</label>
                      <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-[#2c2f36] dark:bg-[#0f172a] dark:text-gray-300 sm:grid-cols-4">
                        <div className="rounded-lg bg-white px-2 py-2 dark:bg-[#171a21]"><span className="font-semibold text-gray-800 dark:text-gray-100">-</span> Not assessed</div>
                        <div className="rounded-lg bg-white px-2 py-2 dark:bg-[#171a21]"><span className="font-semibold text-red-700 dark:text-red-300">NC</span> Not competent</div>
                        <div className="rounded-lg bg-white px-2 py-2 dark:bg-[#171a21]"><span className="font-semibold text-amber-700 dark:text-amber-300">S</span> Solo Ready</div>
                        <div className="rounded-lg bg-white px-2 py-2 dark:bg-[#171a21]"><span className="font-semibold text-emerald-700 dark:text-emerald-300">C</span> Pilot Ready</div>
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
                            <div key={criterion.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-[#2c2f36] dark:bg-[#111827] sm:p-4">
                              <div className="mb-3 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{criterion.name}</p>
                                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                    hasPassedCriterion ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-200'
                                  }`}>
                                    {hasPassedCriterion ? 'Pass' : 'Below pass'}
                                  </span>
                                </div>
                                <div className="grid gap-2 text-xs sm:grid-cols-2">
                                  {trainingSettings.showPassMarkGuidance && passMarkForLesson && (
                                    <div className="rounded-lg bg-white px-3 py-2 text-gray-600 ring-1 ring-gray-200 dark:bg-[#171a21] dark:text-gray-300 dark:ring-[#363b45]">
                                      <span className="font-semibold text-gray-800 dark:text-gray-100">Pass mark:</span> {passMarkForLesson}
                                      {GRADE_LABELS[passMarkForLesson] ? ` (${GRADE_LABELS[passMarkForLesson]})` : ''}
                                    </div>
                                  )}
                                  {trainingSettings.showBestGradeGuidance && (
                                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-950/30 dark:text-blue-200 dark:ring-blue-400/20">
                                      <span className="font-semibold">Best to date:</span> {highestGrade}
                                      {GRADE_LABELS[highestGrade] ? ` (${GRADE_LABELS[highestGrade]})` : ''}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {gradeOptions ? (
                                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                                  {gradeOptions.map(grade => (
                                    <button
                                      key={grade}
                                      onClick={() => setForm(f => ({
                                        ...f,
                                        criteriaGrades: { ...f.criteriaGrades, [criterion.id]: grade }
                                      }))}
                                      className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-2 px-2 py-2 text-sm font-semibold leading-tight transition-all sm:min-h-10 sm:flex-none sm:flex-row sm:px-4 sm:py-1.5 ${
                                        currentGrade === grade
                                          ? grade === 'C' || grade === 'Pass'
                                            ? 'border-emerald-500 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-100'
                                            : grade === 'S'
                                            ? 'border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-100'
                                            : grade === 'NC' || grade === 'Fail'
                                            ? 'border-red-400 bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-100'
                                            : 'border-gray-400 bg-gray-200 text-gray-700 dark:bg-[#2c2f36] dark:text-gray-100'
                                          : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 dark:border-[#363b45] dark:bg-[#171a21] dark:text-gray-300 dark:hover:border-[#4b5563]'
                                      }`}
                                    >
                                      {grade}
                                      {GRADE_LABELS[grade] && (
                                        <span className="mt-0.5 text-center text-[10px] font-medium opacity-80 sm:ml-1 sm:mt-0 sm:text-xs">
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
                    lessonPassed
                      ? 'border-emerald-200 bg-emerald-50'
                      : lessonWillProceed
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-amber-200 bg-amber-50'
                  }`}>
                    <p className={`font-semibold ${
                      lessonPassed
                        ? 'text-emerald-800'
                        : lessonWillProceed
                          ? 'text-blue-800'
                          : 'text-amber-800'
                    }`}>
                      {lessonPassed ? 'Lesson pass achieved' : lessonWillProceed ? 'Lesson proceeding with carry-forward items' : 'Lesson not passed yet'}
                    </p>
                    <p className={`mt-1 text-xs ${
                      lessonPassed
                        ? 'text-emerald-700'
                        : lessonWillProceed
                          ? 'text-blue-700'
                          : 'text-amber-700'
                    }`}>
                      Next lesson on record: {nextLessonForRecord || 'Not set'}
                    </p>
                  </div>

                  {selectedLessonIsFlightTest && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                      <div>
                        <p className="text-sm font-semibold text-orange-950">Course-defined flight test outcome</p>
                        <p className="mt-1 text-xs text-orange-800">
                          This lesson is marked as a flight test in the course setup.
                        </p>
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="block text-xs font-medium text-orange-800 mb-1">Test type</span>
                          <input
                            value={form.flightReviewType}
                            onChange={event => setForm(f => ({ ...f, flightReviewType: event.target.value }))}
                            placeholder="Flight Test, RPC Test"
                            className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          />
                        </label>
                        <label className="block">
                          <span className="block text-xs font-medium text-orange-800 mb-1">Result</span>
                          <select
                            value={form.flightReviewResult}
                            onChange={event => setForm(f => ({ ...f, flightReviewResult: event.target.value as RecordFormState['flightReviewResult'] }))}
                            className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          >
                            <option value="not_assessed">Not assessed</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Fail</option>
                          </select>
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="block text-xs font-medium text-orange-800 mb-1">Review notes</span>
                          <textarea
                            rows={3}
                            value={form.flightReviewNotes}
                            onChange={event => setForm(f => ({ ...f, flightReviewNotes: event.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                          />
                        </label>
                        {form.flightReviewResult === 'pass' && (
                          <p className="text-xs text-orange-800 sm:col-span-2">
                            On submit, the student's flight review date will be updated. Pilot status is granted through configured endorsements.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="pt-2 border-t border-gray-100">
                    <button
                      onClick={handleSubmit}
                      disabled={submitting || (trainingSettings.requireFlightComments && !form.flightComments.trim())}
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
                      {selectedCourseRequiresAck
                        ? 'The student will be asked to acknowledge this record.'
                        : 'This course does not require acknowledgement; the record will lock on submit.'}
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
