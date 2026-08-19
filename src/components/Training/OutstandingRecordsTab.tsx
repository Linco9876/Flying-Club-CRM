import { SearchableSelect } from '../common/SearchableSelect';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ClipboardList, CheckCircle, XCircle, ChevronRight, Plane, Clock, BookOpen, AlertCircle, ChevronDown, ChevronUp, Sparkles, RotateCcw, Loader2, Save, Link as LinkIcon, Trash2, Undo2, Award, ShieldCheck, Target, ArrowRight, Plus, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
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
import { cleanupInstructorComment, type CommentCleanupMode } from '../../utils/commentCleanup';
import { buildTrainingCommentContext } from '../../utils/commentCleanupContext';
import { usePageLoadState } from '../../context/PageLoadContext';
import {
  matrixStandardMeetsRequirement,
  matrixStandardShortLabel,
  formatSyllabusMatrixText,
  normaliseSyllabusLessonKey,
  useSyllabusMatrix,
} from '../../hooks/useSyllabusMatrix';
import { getConsecutivePassReadiness, getDefaultTrainingDeficiencyStage, getTrainingDeficiencyGate, getTwoOccasionReadiness } from '../../utils/trainingReadiness';
import { hasRole } from '../../utils/rbac';
import { InstructorComplianceRecordForm } from './InstructorComplianceRecordForm';
import { useStudentCourseEnrolments } from '../../hooks/useStudentCourseEnrolments';
import { useFlightReviews } from '../../hooks/useFlightReviews';
import { FlightReviewRecordEditor } from './FlightReviewWorkspace';
import { StudentFileLink } from '../Students/StudentFileLink';
import { userCanConductReview } from '../../utils/reviewerRoleRules';
import {
  FORMAL_REVIEW_FINDINGS_LABEL,
  requiresFormalReviewFindings,
} from '../../utils/flightReviewFindings';
import {
  createReviewDraftLinkage,
  createReviewDraftTrainingRecord,
  reviewMatchesDraftOrFlight,
} from '../../utils/draftReviewLinking';
import { enqueueTrainingRecordJob } from '../../utils/trainingRecordBackgroundQueue';
import { shouldAdvanceToNextLesson } from '../../utils/trainingSettingsRules';
import {
  applyTrainingDeficiencyChanges,
  NewTrainingDeficiency,
  TrainingDeficiencyStage,
  useTrainingDeficiencies,
} from '../../hooks/useTrainingDeficiencies';
import { getDraftStudentRecommendation } from '../../utils/draftStudentRecommendation';

type Step = 'action' | 'course' | 'lesson' | 'form';
type RecordEntryType = 'lesson' | 'review_test' | 'instructor_review';

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
  newDeficiencies: NewTrainingDeficiency[];
  resolvedDeficiencyIds: string[];
  deficiencyResolutionNote: string;
}

interface QueuedTrainingRecordSubmit {
  id: string;
  queuedAt: string;
  existingTrainingRecordId?: string;
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
    attachments: string[];
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
  deficiencyChanges?: {
    newDeficiencies: NewTrainingDeficiency[];
    resolvedDeficiencyIds: string[];
    resolutionNote?: string;
  };
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
    newDeficiencies: [],
    resolvedDeficiencyIds: [],
    deficiencyResolutionNote: '',
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

interface OutstandingRecordsTabProps {
  popupOnly?: boolean;
  requestedFlightLogId?: string;
  onPopupClose?: () => void;
}

export const OutstandingRecordsTab: React.FC<OutstandingRecordsTabProps> = ({
  popupOnly = false,
  requestedFlightLogId,
  onPopupClose,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { settings: trainingSettings, loading: trainingSettingsLoading } = useTrainingSettings();
  const isAdmin = hasRole(user, 'admin');
  const isCfi = hasRole(user, 'cfi');
  const canViewAllInstructorRecords = isAdmin || isCfi;
  const { outstandingLogs, dismissedLogs, loading, dismissRecord, restoreRecord, markRecorded, refetch } = useOutstandingRecords(
    canViewAllInstructorRecords ? undefined : user?.id,
    canViewAllInstructorRecords
  );
  const { trainingRecords, loading: trainingRecordsLoading, addTrainingRecord, updateTrainingRecord, deleteDraftTrainingRecord } = useTrainingRecords();
  const { modules: allCourses, loading: coursesLoading } = useTrainingModules();
  const courses = useMemo(
    () => allCourses.filter(course => (course.coursePurpose ?? 'training') === 'training'),
    [allCourses]
  );
  const { aircraft: aircraftList, loading: aircraftLoading } = useAircraft();
  const { users, loading: usersLoading } = useUsers();

  const [activeLog, setActiveLog] = useState<OutstandingFlightLog | null>(null);
  const [activeDraftRecord, setActiveDraftRecord] = useState<typeof trainingRecords[number] | null>(null);
  const [draftSession, setDraftSession] = useState<{
    id: string;
    studentId: string;
    studentName?: string;
    aircraftId?: string;
    aircraftRegistration?: string;
    startedAt: string;
  } | null>(null);
  const [draftStudentId, setDraftStudentId] = useState('');
  const [draftStudentPrefillStatus, setDraftStudentPrefillStatus] = useState<'idle' | 'loading' | 'current' | 'next' | 'none' | 'unavailable'>('idle');
  const draftStudentPrefillRequestRef = useRef(0);
  const draftStudentChangedRef = useRef(false);
  const [step, setStep] = useState<Step>('action');
  const [form, setForm] = useState<RecordFormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [commentCleanupLoading, setCommentCleanupLoading] = useState<CommentCleanupMode | null>(null);
  const [commentCleanupOriginal, setCommentCleanupOriginal] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingSubmits, setPendingSubmits] = useState<QueuedTrainingRecordSubmit[]>(() => readQueuedSubmits());
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);
  const syncingOfflineQueueRef = useRef(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [proceedWithCarryForward, setProceedWithCarryForward] = useState(false);
  const [queueView, setQueueView] = useState<'mine' | 'others' | 'dismissed'>('mine');
  const [showDraftComposer, setShowDraftComposer] = useState(false);
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [recordEntryType, setRecordEntryType] = useState<RecordEntryType | null>(null);
  const [activeReviewRecordId, setActiveReviewRecordId] = useState<string | null>(null);
  const [startingReview, setStartingReview] = useState(false);
  const [deficiencyDraft, setDeficiencyDraft] = useState('');
  const [deficiencyStage, setDeficiencyStage] = useState<TrainingDeficiencyStage>('pre_test');
  const [popupRequestHandled, setPopupRequestHandled] = useState(false);
  const [popupRequestMissing, setPopupRequestMissing] = useState(false);
  const requestedDraftStudentId = searchParams.get('draftStudentId') || '';

  const activeStudentId = activeLog?.student_id;
  const {
    openByCourse: openDeficienciesByCourse,
    loading: deficienciesLoading,
    error: deficienciesError,
    refetch: refetchDeficiencies,
  } = useTrainingDeficiencies(activeStudentId);
  const isDraftSession = Boolean(draftSession && activeLog?.id === draftSession.id);
  const { enrolments: activeStudentEnrolments, loading: enrolmentsLoading } = useStudentCourseEnrolments(activeStudentId);
  const flightReviews = useFlightReviews({
    enabled: Boolean(activeStudentId && activeLog),
    candidateId: activeStudentId,
    includeRecords: true,
  });

  const selectedCourse = useMemo(
    () => courses.find(c => c.id === form.courseId) ?? null,
    [courses, form.courseId]
  );

  const selectedLesson = useMemo(
    () => selectedCourse?.lessons.find(l => l.id === form.lessonId) ?? null,
    [selectedCourse, form.lessonId]
  );

  useEffect(() => {
    if (coursesLoading || recordEntryType !== 'lesson') return;

    if ((step === 'lesson' || step === 'form') && form.courseId && !selectedCourse) {
      setForm(current => ({ ...current, courseId: '', lessonId: '' }));
      setStep('course');
      return;
    }

    if (step === 'form' && form.lessonId && !selectedLesson) {
      setForm(current => ({ ...current, lessonId: '' }));
      setStep('lesson');
    }
  }, [coursesLoading, form.courseId, form.lessonId, recordEntryType, selectedCourse, selectedLesson, step]);

  const selectedLessonIsFlightTest = Boolean(selectedLesson?.isFlightTest);

  const {
    requirementsByLesson,
    requirements: matrixRequirements,
    rowsById,
    bestAssessmentByRow,
    loading: matrixLoading,
    saveAssessments: saveMatrixAssessments,
  } = useSyllabusMatrix(form.courseId || undefined, activeStudentId);
  usePageLoadState(
    loading ||
      trainingSettingsLoading ||
      trainingRecordsLoading ||
      coursesLoading ||
      aircraftLoading ||
      usersLoading ||
      (step === 'form' && Boolean(form.courseId) && matrixLoading),
    'Loading outstanding records',
    'Preparing flights, students, instructors, courses and lesson matrix data...'
  );

  // Criteria come from the course level, pass marks from the lesson
  const activeCriteria = useMemo<LessonAssessmentCriterion[]>(
    () => selectedCourse?.assessmentCriteria ?? [],
    [selectedCourse?.assessmentCriteria]
  );

  useEffect(() => {
    if (!requestedDraftStudentId || users.length === 0) return;

    const requestedStudent = users.find(member => member.id === requestedDraftStudentId);
    if (!requestedStudent) return;

    setDraftStudentId(requestedStudent.id);
    setShowDraftComposer(true);
    setQueueView('mine');

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('draftStudentId');
    setSearchParams(nextParams, { replace: true });
  }, [requestedDraftStudentId, searchParams, setSearchParams, users]);

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
  const matrixAssessmentLoading = Boolean(selectedLesson && matrixLoading);

  const nextLessonAfterSelected = useMemo(() => {
    if (!selectedCourse || selectedLessonIndex < 0) return null;
    return selectedCourse.lessons[selectedLessonIndex + 1] ?? null;
  }, [selectedCourse, selectedLessonIndex]);

  const selectedCourseOpenDeficiencies = useMemo(
    () => selectedCourse ? (openDeficienciesByCourse.get(selectedCourse.id) ?? []) : [],
    [openDeficienciesByCourse, selectedCourse]
  );

  const selectedLessonDeficiencyGate = getTrainingDeficiencyGate(selectedLesson);
  const nextLessonDeficiencyGate = getTrainingDeficiencyGate(nextLessonAfterSelected);
  const selectedLessonBlockingDeficiencies = useMemo(
    () => selectedLessonDeficiencyGate
      ? selectedCourseOpenDeficiencies.filter(deficiency => deficiency.stage === selectedLessonDeficiencyGate)
      : [],
    [selectedCourseOpenDeficiencies, selectedLessonDeficiencyGate]
  );
  const remainingDeficienciesAfterRecord = useMemo(() => {
    const resolvedIds = new Set(form.resolvedDeficiencyIds ?? []);
    return [
      ...selectedCourseOpenDeficiencies.filter(deficiency => !resolvedIds.has(deficiency.id)),
      ...(form.newDeficiencies ?? []).map(deficiency => ({
        ...deficiency,
        id: deficiency.clientReference,
        courseId: selectedCourse?.id || '',
      })),
    ];
  }, [form.newDeficiencies, form.resolvedDeficiencyIds, selectedCourse?.id, selectedCourseOpenDeficiencies]);
  const nextLessonBlockingDeficiencies = useMemo(
    () => nextLessonDeficiencyGate
      ? remainingDeficienciesAfterRecord.filter(deficiency => deficiency.stage === nextLessonDeficiencyGate)
      : [],
    [nextLessonDeficiencyGate, remainingDeficienciesAfterRecord]
  );

  const highestGradesToDate = useMemo(() => {
    if (!activeStudentId || !selectedCourse) return {};

    return trainingRecords
      .filter(record => record.studentId === activeStudentId && record.courseId === selectedCourse.id && record.status !== 'draft')
      .reduce<Record<string, string>>((acc, record) => {
        Object.entries(record.criteriaGrades ?? {}).forEach(([criterionId, grade]) => {
          const criterion = selectedCourse.assessmentCriteria.find(item => item.id === criterionId);
          acc[criterionId] = bestGrade(acc[criterionId], grade, criterion?.gradingSystem) ?? '-';
        });
        return acc;
      }, {});
  }, [activeStudentId, selectedCourse, trainingRecords]);

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

  const lessonMeetsProgressionRule = shouldAdvanceToNextLesson(
    trainingSettings.nextLessonRule,
    lessonPassed,
    canProceedWithCarryForward && proceedWithCarryForward,
  );
  const lessonWillProceed = lessonMeetsProgressionRule && nextLessonBlockingDeficiencies.length === 0;

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

  const effectiveCriteriaGrades = hasMatrixAssessment ? matrixDerivedCriteriaGrades : form.criteriaGrades;

  const twoOccasionReadiness = useMemo(() => getTwoOccasionReadiness({
    course: selectedCourse,
    records: trainingRecords,
    studentId: activeStudentId,
    nextLesson: lessonWillProceed ? nextLessonAfterSelected : null,
    currentRecordGrades: effectiveCriteriaGrades,
  }), [
    activeStudentId,
    effectiveCriteriaGrades,
    lessonWillProceed,
    nextLessonAfterSelected,
    selectedCourse,
    trainingRecords,
  ]);

  const consecutivePassReadiness = useMemo(() => getConsecutivePassReadiness({
    course: selectedCourse,
    records: trainingRecords,
    studentId: activeStudentId,
    lesson: lessonWillProceed ? selectedLesson : null,
    currentRecordGrades: effectiveCriteriaGrades,
  }), [
    activeStudentId,
    effectiveCriteriaGrades,
    lessonWillProceed,
    selectedCourse,
    selectedLesson,
    trainingRecords,
  ]);

  const nextLessonForRecord = trainingSettings.nextLessonRule === 'manual'
    ? ''
    : lessonWillProceed
      ? consecutivePassReadiness.blocked || twoOccasionReadiness.blocked
        ? (selectedLesson?.name || selectedLesson?.sequenceTitle || 'Repeat current lesson')
        : (nextLessonAfterSelected?.name || nextLessonAfterSelected?.sequenceTitle || 'Course complete')
      : selectedLesson
        ? (selectedLesson.name || selectedLesson.sequenceTitle || 'Repeat current lesson')
        : '';

  const selectedCourseRequiresAck = Boolean(
    trainingSettings.forceStudentAcknowledgementForAllCourses ||
    selectedCourse?.requiresStudentAcknowledgement
  );
  const coursesWithLessons = useMemo(
    () => courses.filter(course => course.status === 'published' && course.lessons.length > 0),
    [courses]
  );
  const activeEnrolledCourseIds = useMemo(
    () => new Set(activeStudentEnrolments.filter(enrolment => enrolment.status === 'active').map(enrolment => enrolment.courseId)),
    [activeStudentEnrolments]
  );
  const sortedCoursesWithLessons = useMemo(
    () => [...coursesWithLessons].sort((a, b) => {
      const aEnrolled = activeEnrolledCourseIds.has(a.id) ? 1 : 0;
      const bEnrolled = activeEnrolledCourseIds.has(b.id) ? 1 : 0;
      if (aEnrolled !== bEnrolled) return bEnrolled - aEnrolled;
      return a.title.localeCompare(b.title);
    }),
    [activeEnrolledCourseIds, coursesWithLessons]
  );
  const recommendedLesson = useMemo(() => {
    if (!activeStudentId || coursesWithLessons.length === 0 || enrolmentsLoading) return null;

    const enrolledCourses = coursesWithLessons.filter(course => activeEnrolledCourseIds.has(course.id));
    if (enrolledCourses.length === 0) return null;

    const completedRecords = trainingRecords
      .filter(record => record.studentId === activeStudentId && record.status !== 'draft' && Boolean(record.courseId))
      .sort((a, b) => (b.bookingStartTime ?? b.date).getTime() - (a.bookingStartTime ?? a.date).getTime());
    const previousRecord = completedRecords.find(record => activeEnrolledCourseIds.has(record.courseId || ''));
    const course = previousRecord
      ? enrolledCourses.find(item => item.id === previousRecord.courseId)
      : enrolledCourses[0];
    if (!course) return null;

    const rawRecommendation = previousRecord?.nextLesson?.trim() || '';
    if (/course\s+complete|completed\s+course/i.test(rawRecommendation)) return null;

    const recommendationKey = normaliseSyllabusLessonKey(rawRecommendation).toLowerCase();
    const lesson = rawRecommendation
      ? course.lessons.find(item => {
          const keys = [item.id, item.sequenceCode, item.name, item.sequenceTitle]
            .filter(Boolean)
            .map(value => normaliseSyllabusLessonKey(String(value)).toLowerCase());
          return keys.some(key => key === recommendationKey || recommendationKey.endsWith(key) || key.endsWith(recommendationKey));
        })
      : course.lessons[0];

    if (!lesson) return null;
    const previousLesson = previousRecord
      ? course.lessons.find(item => item.id === previousRecord.lessonId)
      : undefined;
    return { course, lesson, previousRecord, previousLesson };
  }, [activeEnrolledCourseIds, activeStudentId, coursesWithLessons, enrolmentsLoading, trainingRecords]);
  const recommendedLessonBlockingDeficiencies = useMemo(() => {
    if (!recommendedLesson) return [];
    const gate = getTrainingDeficiencyGate(recommendedLesson.lesson);
    if (!gate) return [];
    return (openDeficienciesByCourse.get(recommendedLesson.course.id) ?? [])
      .filter(deficiency => deficiency.stage === gate);
  }, [openDeficienciesByCourse, recommendedLesson]);
  const availableReviewTemplates = useMemo(() => {
    return flightReviews.templates.filter(template => {
      if (template.status !== 'published') return false;
      return userCanConductReview(user, template.configuration.allowed_reviewer_roles);
    });
  }, [flightReviews.templates, user]);
  const reviewForActiveFlight = useMemo(
    () => flightReviews.records.find(record => record.status !== 'cancelled' && reviewMatchesDraftOrFlight(record, {
      activeFlightLogId: isDraftSession ? undefined : activeLog?.id,
      draftTrainingRecordId: activeDraftRecord?.id,
    })) ?? null,
    [activeDraftRecord?.id, activeLog?.id, flightReviews.records, isDraftSession]
  );
  const activeReviewRecord = useMemo(
    () => flightReviews.records.find(record => record.id === activeReviewRecordId)
      ?? (reviewForActiveFlight?.id === activeReviewRecordId ? reviewForActiveFlight : null),
    [activeReviewRecordId, flightReviews.records, reviewForActiveFlight]
  );
  const canConductActiveReview = userCanConductReview(
    user,
    activeReviewRecord?.templateSnapshot.review_configuration?.allowed_reviewer_roles,
  );
  const studentOptions = useMemo(
    () => users
      .filter(member => {
        const roles = member.roles?.length ? member.roles : [member.role];
        return member.isActive !== false && roles.some(role => role === 'student' || role === 'pilot');
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  );
  const prefillDraftStudentFromBooking = useCallback(async () => {
    const requestId = ++draftStudentPrefillRequestRef.current;
    draftStudentChangedRef.current = false;
    setDraftStudentId('');
    setDraftStudentPrefillStatus('loading');

    if (!user?.id) {
      setDraftStudentPrefillStatus('unavailable');
      return;
    }

    const now = new Date();
    const { data, error } = await supabase
      .from('bookings')
      .select('student_id, start_time, end_time, status, deleted_at')
      .eq('instructor_id', user.id)
      .not('student_id', 'is', null)
      .gte('end_time', now.toISOString())
      .order('start_time', { ascending: true })
      .limit(50);

    if (requestId !== draftStudentPrefillRequestRef.current || draftStudentChangedRef.current) return;
    if (error) {
      console.warn('Could not prefill the draft student from bookings', error);
      setDraftStudentPrefillStatus('unavailable');
      return;
    }

    const recommendation = getDraftStudentRecommendation(
      (data ?? []).map(booking => ({
        studentId: booking.student_id,
        startTime: booking.start_time,
        endTime: booking.end_time,
        status: booking.status,
        deletedAt: booking.deleted_at,
      })),
      studentOptions.map(student => student.id),
      now,
    );

    if (!recommendation) {
      setDraftStudentPrefillStatus('none');
      return;
    }

    setDraftStudentId(recommendation.studentId);
    setDraftStudentPrefillStatus(recommendation.source);
  }, [studentOptions, user?.id]);

  const toggleDraftComposer = useCallback(() => {
    if (showDraftComposer) {
      draftStudentPrefillRequestRef.current += 1;
      setDraftStudentPrefillStatus('idle');
      setShowDraftComposer(false);
      return;
    }

    setShowDraftComposer(true);
    void prefillDraftStudentFromBooking();
  }, [prefillDraftStudentFromBooking, showDraftComposer]);
  const draftRecords = useMemo(
    () => trainingRecords
      .filter(record => record.status === 'draft' && (canViewAllInstructorRecords || record.instructorId === user?.id))
      .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [canViewAllInstructorRecords, trainingRecords, user?.id]
  );
  const draftRecordsByStudent = useMemo(() => {
    const map = new Map<string, typeof draftRecords>();
    draftRecords.forEach(record => {
      map.set(record.studentId, [...(map.get(record.studentId) ?? []), record]);
    });
    return map;
  }, [draftRecords]);
  const myOutstandingLogs = useMemo(
    () => outstandingLogs.filter(log => {
      if (log.instructor_id !== user?.id) return false;
      const candidate = users.find(member => member.id === log.student_id);
      const isInstructorCandidate = candidate?.roles?.some(role => role === 'instructor' || role === 'senior_instructor')
        || candidate?.role === 'instructor'
        || candidate?.role === 'senior_instructor';
      return !isInstructorCandidate || isCfi;
    }),
    [isCfi, outstandingLogs, user?.id, users]
  );
  const otherInstructorOutstandingLogs = useMemo(
    () => outstandingLogs.filter(log => {
      if (log.instructor_id === user?.id) return false;
      const candidate = users.find(member => member.id === log.student_id);
      const isInstructorCandidate = candidate?.roles?.some(role => role === 'instructor' || role === 'senior_instructor')
        || candidate?.role === 'instructor'
        || candidate?.role === 'senior_instructor';
      return !isInstructorCandidate || isCfi;
    }),
    [isCfi, outstandingLogs, user?.id, users]
  );
  const visibleOutstandingLogs = queueView === 'dismissed'
    ? []
    : canViewAllInstructorRecords && queueView === 'others'
      ? otherInstructorOutstandingLogs
      : canViewAllInstructorRecords
        ? myOutstandingLogs
        : myOutstandingLogs;
  const visibleDismissedLogs = queueView === 'dismissed'
    ? dismissedLogs.filter(log => {
        const candidate = users.find(member => member.id === log.student_id);
        const isInstructorCandidate = candidate?.roles?.some(role => role === 'instructor' || role === 'senior_instructor')
          || candidate?.role === 'instructor'
          || candidate?.role === 'senior_instructor';
        return !isInstructorCandidate || (isCfi && log.instructor_id === user?.id);
      })
    : [];
  const activeCandidate = activeLog ? users.find(member => member.id === activeLog.student_id) : undefined;
  const activeIsInstructorCompliance = Boolean(
    activeCandidate
    && isCfi
    && (
      activeCandidate.role === 'instructor'
      || activeCandidate.role === 'senior_instructor'
      || activeCandidate.roles?.some(role => role === 'instructor' || role === 'senior_instructor')
    )
  );
  const queueSubmit = useCallback((job: QueuedTrainingRecordSubmit) => {
    const next = enqueueTrainingRecordJob(readQueuedSubmits(), job);
    writeQueuedSubmits(next);
    setPendingSubmits(next);
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

    if (job.existingTrainingRecordId) {
      await updateTrainingRecord(job.existingTrainingRecordId, {
        ...job.recordData,
        date: recordDate,
      });
      trainingRecordId = job.existingTrainingRecordId;
    } else {
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

    if (
      trainingRecordId
      && ((job.deficiencyChanges?.newDeficiencies.length ?? 0) > 0
        || (job.deficiencyChanges?.resolvedDeficiencyIds.length ?? 0) > 0)
    ) {
      await applyTrainingDeficiencyChanges({
        trainingRecordId,
        newDeficiencies: job.deficiencyChanges?.newDeficiencies,
        resolvedDeficiencyIds: job.deficiencyChanges?.resolvedDeficiencyIds,
        resolutionNote: job.deficiencyChanges?.resolutionNote,
      });
    }

    if (job.shouldMarkRecorded) {
      await markRecorded(job.flightLogId);
    }

    if (job.shouldNotifyStudent) {
      const { data: existingNotification, error: notificationLookupError } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', job.recordData.studentId)
        .eq('type', 'training_record')
        .contains('metadata', { training_record_id: trainingRecordId })
        .limit(1)
        .maybeSingle();
      if (notificationLookupError) throw notificationLookupError;

      if (!existingNotification) {
        const { error: notificationError } = await supabase.from('notifications').insert({
          user_id: job.recordData.studentId,
          type: 'training_record',
          title: 'Lesson record requires your sign-off',
          message: `${job.instructorName || 'Your instructor'} has submitted a training record for your flight on ${format(recordDate, 'd MMM yyyy')}. Please review and acknowledge it.`,
          is_read: false,
          metadata: {
            student_id: job.recordData.studentId,
            training_record_id: trainingRecordId,
          },
        });
        if (notificationError) throw notificationError;
      }
    }
  }, [addTrainingRecord, markRecorded, saveMatrixAssessments, updateTrainingRecord]);

  const syncPendingSubmits = useCallback(async () => {
    const queue = readQueuedSubmits();
    if (queue.length === 0 || syncingOfflineQueueRef.current || !navigator.onLine) return;

    syncingOfflineQueueRef.current = true;
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
      syncingOfflineQueueRef.current = false;
      setSyncingOfflineQueue(false);
    }
  }, [clearDraft, refetch, submitQueuedJob]);

  function openLog(log: OutstandingFlightLog, draftRecord?: typeof trainingRecords[number]) {
    toast.remove();
    setActiveLog(log);
    setDraftSession(null);
    setActiveDraftRecord(draftRecord ?? null);
    setActiveReviewRecordId(null);
    const draftKey = getDraftKey(user?.id, log.id);
    const savedDraft = draftKey && typeof window !== 'undefined'
      ? window.localStorage.getItem(draftKey)
      : null;

    if (draftRecord) {
      setRecordEntryType(draftRecord.isFlightReview ? 'review_test' : 'lesson');
      setForm({
        ...emptyForm(),
        courseId: draftRecord.courseId || '',
        lessonId: draftRecord.lessonId || '',
        formalBriefing: draftRecord.formalBriefing,
        briefingComments: draftRecord.briefingComments || '',
        flightComments: draftRecord.comments || '',
        criteriaGrades: draftRecord.criteriaGrades || {},
        matrixGrades: {},
        isFlightReview: draftRecord.isFlightReview || false,
        flightReviewType: draftRecord.flightReviewType || 'Flight Review',
        flightReviewResult: draftRecord.flightReviewResult || 'not_assessed',
        flightReviewNotes: draftRecord.flightReviewNotes || '',
      });
      setStep(draftRecord.lessonId ? 'form' : draftRecord.courseId ? 'lesson' : 'course');
      setProceedWithCarryForward(false);
      setDraftSavedAt(null);
      toast.success('Draft loaded. Review it, then submit to attach it to this flight.');
    } else if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft) as { form?: RecordFormState; step?: Step; savedAt?: string };
        setRecordEntryType('lesson');
        setForm({
          ...emptyForm(),
          formalBriefing: trainingSettings.defaultFormalBriefing,
          ...(parsed.form ?? {}),
          newDeficiencies: parsed.form?.newDeficiencies ?? [],
          resolvedDeficiencyIds: parsed.form?.resolvedDeficiencyIds ?? [],
          deficiencyResolutionNote: parsed.form?.deficiencyResolutionNote ?? '',
        });
        setStep(parsed.step || (parsed.form?.lessonId ? 'form' : parsed.form?.courseId ? 'lesson' : 'course'));
        setProceedWithCarryForward(Boolean((parsed as { proceedWithCarryForward?: boolean }).proceedWithCarryForward));
        setDraftSavedAt(parsed.savedAt ? new Date(parsed.savedAt) : null);
        toast.success('Recovered saved training record draft');
      } catch {
        setRecordEntryType('lesson');
        setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
        setStep('course');
        setProceedWithCarryForward(false);
      }
    } else {
      setRecordEntryType(isCfi ? null : 'lesson');
      setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
      setStep(isCfi ? 'action' : 'course');
      setProceedWithCarryForward(false);
      setDraftSavedAt(null);
    }
    setCommentCleanupOriginal(null);
  }

  function openDraftSession(record?: typeof trainingRecords[number]) {
    const student = users.find(member => member.id === (record?.studentId || draftStudentId));
    const aircraft = record?.aircraftId ? aircraftList.find(item => item.id === record.aircraftId) : undefined;
    if (!student?.id) {
      toast.error('Select a student before starting a draft');
      return;
    }

    toast.remove();
    const sessionId = record?.id ? `draft-record:${record.id}` : `draft-session:${Date.now()}`;
    const startedAt = record?.date?.toISOString() || new Date().toISOString();
    setDraftSession({
      id: sessionId,
      studentId: student.id,
      studentName: student.name,
      aircraftId: aircraft?.id || record?.aircraftId || undefined,
      aircraftRegistration: aircraft?.registration || record?.registration || undefined,
      startedAt,
    });
    setActiveLog({
      id: sessionId,
      aircraft_id: aircraft?.id || record?.aircraftId || '',
      student_id: student.id,
      instructor_id: user?.id || '',
      start_time: startedAt,
      end_time: startedAt,
      dual_time: 0,
      solo_time: 0,
      training_record_status: 'pending',
      student_name: student.name,
      student_email: student.email,
      instructor_name: user?.name,
      aircraft_registration: aircraft?.registration || record?.registration || undefined,
      aircraft_type: aircraft?.type || record?.aircraftType || undefined,
    });
    setActiveDraftRecord(record ?? null);
    setRecordEntryType(record ? (record.isFlightReview ? 'review_test' : 'lesson') : (isCfi ? null : 'lesson'));
    setActiveReviewRecordId(null);
    setForm(record ? {
      ...emptyForm(),
      courseId: record.courseId || '',
      lessonId: record.lessonId || '',
      formalBriefing: record.formalBriefing,
      briefingComments: record.briefingComments || '',
      flightComments: record.comments || '',
      criteriaGrades: record.criteriaGrades || {},
      matrixGrades: {},
      isFlightReview: record.isFlightReview || false,
      flightReviewType: record.flightReviewType || 'Flight Review',
      flightReviewResult: record.flightReviewResult || 'not_assessed',
      flightReviewNotes: record.flightReviewNotes || '',
    } : { ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
    setStep(record ? (record.lessonId ? 'form' : record.courseId ? 'lesson' : 'course') : (isCfi ? 'action' : 'course'));
    setProceedWithCarryForward(false);
    setCommentCleanupOriginal(null);
    setDraftSavedAt(record ? record.date : null);
  }

  function closePanel() {
    setActiveLog(null);
    setActiveDraftRecord(null);
    setDraftSession(null);
    setStep('action');
    setRecordEntryType(null);
    setActiveReviewRecordId(null);
    setForm({ ...emptyForm(), formalBriefing: trainingSettings.defaultFormalBriefing });
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
    setDeficiencyDraft('');
    onPopupClose?.();
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
    setForm(f => ({
      ...f,
      courseId,
      lessonId: '',
      criteriaGrades: {},
      matrixGrades: {},
      newDeficiencies: [],
      resolvedDeficiencyIds: [],
      deficiencyResolutionNote: '',
    }));
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
    setStep('lesson');
  }

  async function handleRestoreDismissed(log: OutstandingFlightLog) {
    try {
      await restoreRecord(log.id);
    } catch {
      // error already toasted
    }
  }

  async function handleDeleteDraftRecord(record: typeof trainingRecords[number]) {
    const student = users.find(member => member.id === record.studentId);
    const course = courses.find(item => item.id === record.courseId);
    const lesson = course?.lessons.find(item => item.id === record.lessonId);
    const recordLabel = lesson?.name || lesson?.sequenceTitle || course?.title || 'this lesson';
    const studentLabel = student?.name || 'this member';

    const confirmed = window.confirm(
      `Delete the draft for ${studentLabel} - ${recordLabel}?\n\nThis cannot be undone, but submitted lesson records will not be affected.`
    );
    if (!confirmed) return;

    setDeletingDraftId(record.id);
    try {
      await deleteDraftTrainingRecord(record.id);
      if (activeDraftRecord?.id === record.id) closePanel();
    } catch {
      // The hook displays the database error to the user.
    } finally {
      setDeletingDraftId(null);
    }
  }

  function handleSelectLesson(lessonId: string, courseIdOverride?: string) {
    const targetCourseId = courseIdOverride || form.courseId;
    const course = courses.find(c => c.id === targetCourseId);
    const lesson = course?.lessons.find(l => l.id === lessonId);
    const studentPreviousRecords = activeStudentId && course
      ? trainingRecords.filter(record => record.studentId === activeStudentId && record.courseId === course.id && record.status !== 'draft')
      : [];

    const highestByCriterion = studentPreviousRecords.reduce<Record<string, string>>((acc, record) => {
      Object.entries(record.criteriaGrades ?? {}).forEach(([criterionId, grade]) => {
        const criterion = course?.assessmentCriteria.find(item => item.id === criterionId);
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
      courseId: targetCourseId,
      lessonId,
      criteriaGrades: defaults,
      matrixGrades: {},
      isFlightReview: Boolean(lesson?.isFlightTest),
      flightReviewType: lesson?.isFlightTest ? 'Flight Test' : 'Flight Review',
      flightReviewResult: 'not_assessed',
      flightReviewNotes: '',
    }));
    setDeficiencyStage(getDefaultTrainingDeficiencyStage(course, lesson));
    setDeficiencyDraft('');
    setCommentCleanupOriginal(null);
    setProceedWithCarryForward(false);
    setStep('form');
  }

  function handleSelectRecordType(type: RecordEntryType) {
    setRecordEntryType(type);
    setActiveReviewRecordId(null);
    if (type === 'lesson') {
      const savedCourse = courses.find(course => course.id === form.courseId);
      const savedLesson = savedCourse?.lessons.find(lesson => lesson.id === form.lessonId);

      if (!savedCourse) {
        setForm(current => ({ ...current, courseId: '', lessonId: '' }));
        setStep('course');
      } else if (!savedLesson) {
        setForm(current => ({ ...current, lessonId: '' }));
        setStep('lesson');
      } else {
        setStep('form');
      }
    } else {
      setStep('action');
    }
  }

  function handleChangeRecordType() {
    setActiveReviewRecordId(null);
    setRecordEntryType(null);
    setStep('action');
  }

  function handleOpenRecommendedLesson() {
    if (!recommendedLesson) return;
    if (recommendedLessonBlockingDeficiencies.length > 0) {
      const gateLabel = getTrainingDeficiencyGate(recommendedLesson.lesson) === 'pre_solo' ? 'solo' : 'pilot test';
      toast.error(`Resolve ${recommendedLessonBlockingDeficiencies.length} open ${gateLabel} ${recommendedLessonBlockingDeficiencies.length === 1 ? 'deficiency' : 'deficiencies'} before proceeding`);
      return;
    }
    setRecordEntryType('lesson');
    handleSelectLesson(recommendedLesson.lesson.id, recommendedLesson.course.id);
  }

  async function handleStartReview(templateId: string) {
    if (!activeLog || !activeStudentId || !user?.id) return;
    const existing = reviewForActiveFlight;
    if (existing) {
      if (!userCanConductReview(
        user,
        existing.templateSnapshot.review_configuration?.allowed_reviewer_roles,
      )) {
        toast.error('Your CRM role is not authorised to conduct this review or test');
        return;
      }
      setActiveReviewRecordId(existing.id);
      return;
    }

    setStartingReview(true);
    try {
      let sourceDraftRecordId = activeDraftRecord?.id;
      if (isDraftSession && !sourceDraftRecordId) {
        const template = flightReviews.templates.find(item => item.id === templateId);
        if (!template) throw new Error('Select a review or test template');

        const draftPayload = createReviewDraftTrainingRecord({
          studentId: activeStudentId,
          instructorId: user.id,
          templateId,
          templateTitle: template.title,
          startedAt: activeLog.start_time,
          aircraftId: activeLog.aircraft_id,
          aircraftType: activeLog.aircraft_type,
          registration: activeLog.aircraft_registration,
        });
        const createdDraft = await addTrainingRecord(draftPayload);
        if (!createdDraft?.id) throw new Error('The review draft could not be created');
        sourceDraftRecordId = createdDraft.id as string;
        setActiveDraftRecord({
          ...draftPayload,
          id: sourceDraftRecordId,
          auditLog: [],
          sequences: [],
        });
      }

      const record = await flightReviews.startReview({
        templateId,
        candidateId: activeStudentId,
        reviewerUserId: user.id,
        reviewDate: format(new Date(activeLog.start_time), 'yyyy-MM-dd'),
        ...createReviewDraftLinkage({
          isDraftSession,
          activeFlightLogId: activeLog.id,
          draftTrainingRecordId: sourceDraftRecordId,
        }),
        aircraftId: activeLog.aircraft_id || undefined,
        aircraftType: activeLog.aircraft_type || '',
        registration: activeLog.aircraft_registration || '',
      });
      const flightMinutes = Math.max(0, Math.round(((activeLog.dual_time ?? 0) + (activeLog.solo_time ?? 0)) * 60));
      if (flightMinutes > 0) {
        await flightReviews.updateReview(record.id, { flightMinutes });
      }
      setActiveReviewRecordId(record.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start review or test');
    } finally {
      setStartingReview(false);
    }
  }

  async function handleCleanupFlightComments(mode: CommentCleanupMode) {
    if (!form.flightComments.trim()) {
      toast.error('Write flight comments before using AI cleanup');
      return;
    }
    setCommentCleanupLoading(mode);
    try {
      const matrixResults = activeMatrixRequirements.flatMap(requirement => {
        const achieved = form.matrixGrades[requirement.matrixRowId];
        if (!achieved) return [];
        const row = rowsById.get(requirement.matrixRowId);
        const label = row?.code || row?.elementCode || row?.unitCode || row?.description || 'Matrix item';
        return [`${label}: achieved ${achieved}, required ${requirement.requiredStandard}`];
      });
      const cleanup = await cleanupInstructorComment(form.flightComments, buildTrainingCommentContext({
        studentId: activeLog?.student_id,
        studentName: activeLog?.student_name,
        course: selectedCourse,
        lesson: selectedLesson,
        records: trainingRecords,
        currentCriteriaGrades: effectiveCriteriaGrades,
        matrixResults,
        nextLessonName: lessonWillProceed
          ? nextLessonAfterSelected?.name || nextLessonAfterSelected?.sequenceTitle
          : selectedLesson?.name || selectedLesson?.sequenceTitle,
        aircraft: activeLog?.aircraft_registration,
        date: activeLog?.start_time ? format(new Date(activeLog.start_time), 'yyyy-MM-dd') : undefined,
        durationMinutes: activeLog
          ? Math.round(((activeLog.dual_time || 0) + (activeLog.solo_time || 0)) * 60)
          : undefined,
      }), mode);
      setCommentCleanupOriginal(form.flightComments);
      setForm(current => ({ ...current, flightComments: cleanup.rewrittenComment }));
      toast.success(cleanup.usedFallback
        ? 'AI Rewrite was unavailable, so a safe local grammar cleanup was applied'
        : mode === 'readability'
          ? 'Flight comments rewritten for readability'
          : 'Flight comments grammar cleaned up');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI comment cleanup failed');
    } finally {
      setCommentCleanupLoading(null);
    }
  }

  function handleRevertFlightComments() {
    if (commentCleanupOriginal === null) return;
    setForm(current => ({ ...current, flightComments: commentCleanupOriginal }));
    setCommentCleanupOriginal(null);
  }

  function handleAddDeficiency() {
    const description = deficiencyDraft.trim();
    if (description.length < 3) {
      toast.error('Describe the deficiency before adding it');
      return;
    }

    setForm(current => ({
      ...current,
      newDeficiencies: [
        ...(current.newDeficiencies ?? []),
        {
          clientReference: crypto.randomUUID(),
          stage: deficiencyStage,
          description,
        },
      ],
    }));
    setDeficiencyDraft('');
  }

  function handleToggleDeficiencyResolved(deficiencyId: string) {
    setForm(current => {
      const selected = new Set(current.resolvedDeficiencyIds ?? []);
      if (selected.has(deficiencyId)) selected.delete(deficiencyId);
      else selected.add(deficiencyId);
      return { ...current, resolvedDeficiencyIds: Array.from(selected) };
    });
  }

  function handleRemoveNewDeficiency(clientReference: string) {
    setForm(current => ({
      ...current,
      newDeficiencies: (current.newDeficiencies ?? []).filter(
        deficiency => deficiency.clientReference !== clientReference,
      ),
    }));
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
    setPopupRequestHandled(false);
    setPopupRequestMissing(false);
  }, [requestedFlightLogId]);

  useEffect(() => {
    if (!popupOnly || loading || popupRequestHandled) return;
    const requestedLog = requestedFlightLogId
      ? outstandingLogs.find(log => log.id === requestedFlightLogId)
      : outstandingLogs.find(log => log.instructor_id === user?.id) ?? outstandingLogs[0];

    setPopupRequestHandled(true);
    if (requestedLog) {
      openLog(requestedLog);
    } else {
      setPopupRequestMissing(true);
    }
  }, [loading, outstandingLogs, popupOnly, popupRequestHandled, requestedFlightLogId, user?.id]);

  useEffect(() => {
    if (!activeLog || typeof window === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeLog]);

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
      existingTrainingRecordId: activeDraftRecord?.id,
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
      deficiencyChanges: {
        newDeficiencies: form.newDeficiencies ?? [],
        resolvedDeficiencyIds: form.resolvedDeficiencyIds ?? [],
        resolutionNote: form.deficiencyResolutionNote,
      },
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
    if (deficienciesLoading || deficienciesError) {
      toast.error('Wait for the instructor-only deficiencies to load before submitting');
      return;
    }
    if (selectedLessonBlockingDeficiencies.length > 0) {
      const gateLabel = selectedLessonDeficiencyGate === 'pre_solo' ? 'solo' : 'pilot test';
      toast.error(`This ${gateLabel} lesson is blocked by ${selectedLessonBlockingDeficiencies.length} open ${selectedLessonBlockingDeficiencies.length === 1 ? 'deficiency' : 'deficiencies'}. Mark them fixed in an earlier lesson first.`);
      return;
    }
    if (
      selectedLessonIsFlightTest
      && form.flightReviewResult === 'not_assessed'
    ) {
      toast.error('Select Pass or Further training required for this flight test');
      return;
    }
    if (
      selectedLessonIsFlightTest
      && requiresFormalReviewFindings({ trainingResult: form.flightReviewResult })
      && !form.flightReviewNotes.trim()
    ) {
      toast.error(`Enter ${FORMAL_REVIEW_FINDINGS_LABEL.toLowerCase()} for this outcome`);
      return;
    }

    const submitJob = buildSubmitJob();
    if (!submitJob) {
      toast.error('Could not prepare this training record');
      return;
    }

    queueSubmit(submitJob);
    closePanel();

    if (!navigator.onLine) {
      toast.success('Training record saved on this device. It will sync when signal returns.');
      return;
    }

    toast.success('Training record is being completed in the background. You can keep working.');
    void syncPendingSubmits();
  }

  async function handleSaveDraftRecord() {
    if (!activeLog || !user || !selectedLesson) return;
    if (!form.courseId || !form.lessonId) {
      toast.error('Please select a course and lesson before saving the draft');
      return;
    }

    const aircraft = aircraftList.find(a => a.id === activeLog.aircraft_id);
    const criteriaGrades = hasMatrixAssessment
      ? { ...form.criteriaGrades, ...matrixDerivedCriteriaGrades }
      : form.criteriaGrades;
    const draftPayload = {
      studentId: activeLog.student_id,
      courseId: form.courseId,
      lessonId: form.lessonId,
      date: new Date(activeLog.start_time),
      aircraftId: activeLog.aircraft_id,
      aircraftType: aircraft?.type ?? activeLog.aircraft_type ?? 'single-engine',
      registration: aircraft?.registration ?? activeLog.aircraft_registration ?? '',
      instructorId: user.id,
      dualTimeMin: 0,
      soloTimeMin: 0,
      comments: form.flightComments,
      briefingComments: form.briefingComments,
      formalBriefing: form.formalBriefing,
      criteriaGrades,
      lessonCodes: selectedLesson.sequenceCode ? [selectedLesson.sequenceCode] : [],
      nextLesson: nextLessonForRecord,
      status: 'draft' as const,
      studentAck: false,
      studentComments: '',
      attachments: [],
      isFlightReview: Boolean(selectedLesson.isFlightTest),
      flightReviewType: selectedLesson.isFlightTest ? (form.flightReviewType || 'Flight Test') : undefined,
      flightReviewResult: selectedLesson.isFlightTest ? form.flightReviewResult : undefined,
      flightReviewNotes: selectedLesson.isFlightTest ? form.flightReviewNotes : undefined,
    };

    setSubmitting(true);
    try {
      let savedDraftId = activeDraftRecord?.id;
      if (activeDraftRecord?.id) {
        await updateTrainingRecord(activeDraftRecord.id, draftPayload);
      } else {
        const createdDraft = await addTrainingRecord(draftPayload);
        savedDraftId = createdDraft?.id;
      }
      if (savedDraftId && (form.newDeficiencies?.length ?? 0) > 0) {
        await applyTrainingDeficiencyChanges({
          trainingRecordId: savedDraftId,
          newDeficiencies: form.newDeficiencies,
        });
        await refetchDeficiencies();
      }
      toast.success('Training record draft saved. Attach it to the logged flight when you are back.');
      closePanel();
    } catch (error) {
      if (isNetworkLikeError(error)) {
        toast.success('Signal dropped. Your in-flight draft is still saved on this device.');
      } else {
        toast.error('Failed to save training record draft');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    if (popupOnly) {
      return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Loading outstanding record">
          <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-5 text-sm font-semibold text-slate-700 shadow-2xl dark:bg-[#171a21] dark:text-slate-100">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            Loading outstanding record...
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 p-3 sm:p-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (popupOnly && popupRequestMissing) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Outstanding record unavailable">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]">
          <CheckCircle className="mx-auto h-10 w-10 text-emerald-500" />
          <h2 className="mt-3 text-lg font-bold text-slate-950 dark:text-white">Record no longer outstanding</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">It may already have been completed, dismissed, or reassigned.</p>
          <button type="button" onClick={onPopupClose} className="mt-5 min-h-11 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Close</button>
        </div>
      </div>
    );
  }

  const queueButtons = [
    { id: 'mine' as const, label: 'Assigned to me', icon: AlertCircle },
    ...(canViewAllInstructorRecords ? [{ id: 'others' as const, label: 'Other instructors', icon: BookOpen }] : []),
    { id: 'dismissed' as const, label: 'No record needed', icon: Undo2 },
  ];
  const recordTypeOptions = [
    {
      id: 'lesson' as const,
      label: 'Lesson',
      description: 'Complete a lesson record and competency assessment.',
      icon: BookOpen,
    },
    {
      id: 'review_test' as const,
      label: 'Review / Test',
      description: 'Complete a flight review, flight test or proficiency check.',
      icon: Award,
    },
    ...(activeIsInstructorCompliance ? [{
      id: 'instructor_review' as const,
      label: 'Instructor Review',
      description: 'Complete a protected S&P check or instructor renewal.',
      icon: ShieldCheck,
    }] : []),
  ];

  const renderRecordTypeSelector = (compact = false) => !isCfi || compact ? null : (
    <div className={`grid min-w-0 gap-2 ${recordTypeOptions.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {recordTypeOptions.map(option => {
        const Icon = option.icon;
        const selected = recordEntryType === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSelectRecordType(option.id)}
            aria-pressed={selected}
            className={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition sm:px-4 ${
              selected
                ? 'border-blue-500 bg-blue-50 text-blue-950 shadow-sm ring-1 ring-blue-200 dark:bg-blue-950/35 dark:text-blue-100 dark:ring-blue-400/20'
                : 'border-gray-200 bg-white text-gray-800 hover:border-blue-300 hover:bg-blue-50/60 dark:border-[#343b47] dark:bg-[#171a21] dark:text-gray-100 dark:hover:bg-blue-950/20'
            }`}
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-[#252b35] dark:text-gray-300'}`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{option.label}</span>
              {!compact && <span className="mt-0.5 block text-xs leading-4 text-gray-500 dark:text-gray-400">{option.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={popupOnly ? 'contents' : 'flex h-full min-w-0 flex-col gap-4 p-3 sm:p-6'}>
      <header className={`${popupOnly ? 'hidden' : ''} overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-950 via-blue-950 to-slate-900 text-white shadow-sm dark:border-blue-400/20`}>
        <div className="flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-blue-100 ring-1 ring-white/15">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Training queue</p>
                <h2 className="mt-0.5 text-2xl font-bold tracking-tight">Outstanding Records</h2>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-blue-100/80">
                  Choose a lesson, review or test for each flight, or start an in-flight draft before take-off.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleDraftComposer}
              aria-pressed={showDraftComposer}
              className={`inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition sm:w-auto ${
                showDraftComposer
                  ? 'bg-emerald-50 text-emerald-800 shadow-sm ring-1 ring-emerald-200'
                  : 'bg-emerald-700 text-white shadow-sm hover:bg-emerald-800'
              }`}
            >
              <Save className="h-4 w-4 shrink-0" />
              <span className="truncate">Make Draft</span>
            </button>
          </div>

          <div className={`grid min-w-0 gap-2 rounded-2xl bg-white/8 p-1.5 ring-1 ring-white/10 sm:grid-cols-2 ${
            canViewAllInstructorRecords ? 'xl:grid-cols-3' : 'xl:grid-cols-2'
          }`}>
            {queueButtons.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQueueView(item.id)}
                  aria-pressed={queueView === item.id}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    queueView === item.id
                      ? 'bg-white text-blue-950 shadow-sm'
                      : 'text-blue-50 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className={`grid min-h-0 min-w-0 gap-4 lg:gap-6 ${popupOnly ? 'contents' : 'grid-cols-1'}`}>
      {/* Left: list of outstanding flights */}
      <div className={`${popupOnly ? 'hidden' : 'flex'} min-w-0 flex-col gap-4 w-full`}>
        {showDraftComposer && (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm dark:border-blue-400/25 dark:from-blue-950/25 dark:to-[#171a21]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Save className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-blue-950 dark:text-blue-100">Start an in-flight draft</p>
              <p className="mt-0.5 text-xs leading-5 text-blue-800 dark:text-blue-200">
                Capture comments and assessment marks during the flight, then attach the draft once the flight is logged.
              </p>
            </div>
          </div>
          <div className="mt-3">
            <SearchableSelect
              value={draftStudentId}
              onChange={event => {
                draftStudentChangedRef.current = true;
                setDraftStudentId(event.target.value);
                setDraftStudentPrefillStatus('idle');
              }}
              className="w-full min-w-0 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-400/30 dark:bg-[#111827] dark:text-gray-100"
            >
              <option value="">Select student/pilot</option>
              {studentOptions.map(member => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </SearchableSelect>
            {draftStudentPrefillStatus === 'loading' && (
              <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-200">Finding your current or next booked student...</p>
            )}
            {draftStudentPrefillStatus === 'current' && (
              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">Prefilled from your current booking. You can still select another student.</p>
            )}
            {draftStudentPrefillStatus === 'next' && (
              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">Prefilled from your next booking. You can still select another student.</p>
            )}
            {draftStudentPrefillStatus === 'none' && (
              <p className="mt-1.5 text-xs text-blue-700 dark:text-blue-200">No current or upcoming booked student was found. Select a student manually.</p>
            )}
            {draftStudentPrefillStatus === 'unavailable' && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">Booking details could not be checked. Select a student manually.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => openDraftSession()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!draftStudentId}
          >
            <BookOpen className="h-4 w-4" />
            Choose Draft Type
          </button>
          {draftRecords.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-200">
                Saved drafts
              </p>
              {draftRecords.slice(0, 4).map(record => {
                const student = users.find(member => member.id === record.studentId);
                const course = courses.find(item => item.id === record.courseId);
                const lesson = course?.lessons.find(item => item.id === record.lessonId);
                return (
                  <div
                    key={record.id}
                    className="flex w-full items-stretch overflow-hidden rounded-lg border border-blue-200 bg-white text-xs text-blue-950 transition hover:border-blue-300 dark:border-blue-400/20 dark:bg-[#111827] dark:text-blue-100"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openDraftSession(record)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openDraftSession(record);
                        }
                      }}
                      className="min-w-0 flex-1 px-3 py-2 text-left transition hover:bg-blue-100 dark:hover:bg-blue-950/40"
                    >
                      <StudentFileLink
                        studentId={student?.id}
                        name={student?.name || 'Unknown member'}
                        className="block truncate font-semibold"
                      />
                      <span className="block truncate opacity-80">{lesson?.name || lesson?.sequenceTitle || course?.title || record.flightReviewType || 'Draft training record'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteDraftRecord(record)}
                      disabled={deletingDraftId === record.id}
                      title={`Delete draft ${record.isFlightReview ? 'review/test' : 'lesson'} record`}
                      aria-label={`Delete draft ${record.isFlightReview ? 'review/test' : 'lesson'} record for ${student?.name || 'member'}`}
                      className="flex w-11 shrink-0 items-center justify-center border-l border-blue-100 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-50 dark:border-blue-400/20 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                    >
                      {deletingDraftId === record.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {queueView !== 'dismissed' && visibleOutstandingLogs.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-12">
            <CheckCircle className="h-14 w-14 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {canViewAllInstructorRecords && queueView === 'others' ? 'No other instructor records waiting' : 'All caught up'}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {canViewAllInstructorRecords && queueView === 'others'
                ? 'There are no outstanding records assigned to other instructors.'
                : 'No outstanding training records assigned to this queue.'}
            </p>
          </div>
        ) : (
          queueView !== 'dismissed' && visibleOutstandingLogs.map(log => {
            const isActive = activeLog?.id === log.id;
            const expanded = expandedLogs.has(log.id);
            const flightDate = new Date(log.start_time);
            const durationH = ((log.dual_time ?? 0) + (log.solo_time ?? 0)).toFixed(1);
            const matchingDrafts = draftRecordsByStudent.get(log.student_id) ?? [];
            const isMine = log.instructor_id === user?.id;
            const candidate = users.find(member => member.id === log.student_id);
            const isInstructorCandidate = Boolean(
              candidate?.role === 'instructor'
              || candidate?.role === 'senior_instructor'
              || candidate?.roles?.some(role => role === 'instructor' || role === 'senior_instructor')
            );

            return (
              <div
                key={log.id}
                className={`bg-white rounded-xl border transition-all duration-200 dark:bg-[#171a21] ${
                  isActive
                    ? 'border-blue-400 shadow-md ring-1 ring-blue-200 dark:ring-blue-400/30'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm dark:border-[#2c2f36] dark:hover:border-[#4b5563]'
                }`}
              >
                <div className={`h-1 rounded-t-xl ${isMine ? 'bg-blue-500' : 'bg-amber-500'}`} />
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 mt-0.5 ${
                        isMine
                          ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-400/20'
                          : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-400/20'
                      }`}>
                        <AlertCircle className={`h-5 w-5 ${isMine ? 'text-blue-600 dark:text-blue-300' : 'text-amber-600 dark:text-amber-300'}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StudentFileLink
                            studentId={log.student_id}
                            name={log.student_name ?? 'Unknown Student'}
                            className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
                          />
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            isMine
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                          }`}>
                            {isMine ? 'Assigned to you' : 'Other instructor'}
                          </span>
                          {isInstructorCandidate && isCfi && (
                            <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200">
                              CFI/DCFI compliance
                            </span>
                          )}
                        </div>
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
                          {log.instructor_name && (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isMine ? 'text-blue-600 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}>
                              Instructor: {log.instructor_name}
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
                      Create Record
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  {matchingDrafts.length > 0 && (
                    <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50 p-3 dark:border-blue-400/20 dark:bg-blue-950/20">
                      <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">
                        Draft available for this member
                      </p>
                      {matchingDrafts.slice(0, 3).map(record => {
                        const course = courses.find(item => item.id === record.courseId);
                        const lesson = course?.lessons.find(item => item.id === record.lessonId);
                        return (
                          <div
                            key={record.id}
                            className="flex w-full items-stretch overflow-hidden rounded-md bg-white text-xs text-blue-950 ring-1 ring-blue-100 dark:bg-[#111827] dark:text-blue-100 dark:ring-blue-400/20"
                          >
                            <button
                              type="button"
                              onClick={() => openLog(log, record)}
                              className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-blue-100 dark:hover:bg-blue-950/40"
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{lesson?.name || lesson?.sequenceTitle || course?.title || 'Draft training record'}</span>
                                <span className="block truncate opacity-75">Saved {format(record.date, 'd MMM yyyy')}</span>
                              </span>
                              <span className="inline-flex shrink-0 items-center gap-1 font-semibold">
                                <LinkIcon className="h-3.5 w-3.5" />
                                Use draft
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteDraftRecord(record)}
                              disabled={deletingDraftId === record.id}
                              title="Delete draft lesson record"
                              aria-label="Delete draft lesson record"
                              className="flex w-11 shrink-0 items-center justify-center border-l border-blue-100 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-wait disabled:opacity-50 dark:border-blue-400/20 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            >
                              {deletingDraftId === record.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Trash2 className="h-4 w-4" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {queueView === 'dismissed' && visibleDismissedLogs.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <Undo2 className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">No restorable records</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No logged flights are currently marked as no record needed.</p>
          </div>
        )}

        {queueView === 'dismissed' && visibleDismissedLogs.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">No record needed</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Restore one if a training record needs to be added after all.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {visibleDismissedLogs.slice(0, 8).map(log => {
                const flightDate = new Date(log.start_time);
                const isMine = log.instructor_id === user?.id;
                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#111827]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StudentFileLink
                          studentId={log.student_id}
                          name={log.student_name ?? 'Unknown Student'}
                          className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100"
                        />
                        {canViewAllInstructorRecords && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            isMine
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                          }`}>
                            {isMine ? 'Mine' : log.instructor_name || 'Other'}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                        {format(flightDate, 'EEE d MMM yyyy')} &middot; {format(flightDate, 'h:mm a')} &middot; {log.aircraft_registration ?? '-'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestoreDismissed(log)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-50 dark:border-blue-400/30 dark:bg-[#171a21] dark:text-blue-200 dark:hover:bg-blue-950/40"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Active record workspace */}
      {activeLog && !recordEntryType && (
        <section
          className="fixed inset-0 z-[110] space-y-3 overflow-y-auto bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4 lg:p-6 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-6xl"
          role="dialog"
          aria-modal="true"
          aria-label="Choose outstanding record type"
          onMouseDown={event => { if (event.target === event.currentTarget) closePanel(); }}
        >
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gray-50 px-4 py-4 dark:border-[#2c2f36] dark:bg-[#11141a] sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Create record for</p>
                <h3 className="mt-1 truncate text-xl font-bold text-gray-950 dark:text-white">
                  <StudentFileLink studentId={activeLog.student_id} name={activeLog.student_name || 'Unknown member'} />
                </h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {format(new Date(activeLog.start_time), 'EEE d MMM yyyy, h:mm a')} &middot; {activeLog.aircraft_registration || 'No aircraft'}
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label="Close record workspace"
                className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-[#252b35] dark:hover:text-gray-100"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-4 sm:p-6 lg:p-8">
              <div>
                <h4 className="text-base font-bold text-gray-950 dark:text-white">What are you recording?</h4>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose the form that matches this session. The selected workspace will take over the main area.</p>
              </div>
              {renderRecordTypeSelector()}

              <div className="hidden border-t border-gray-200 pt-6 dark:border-[#2c2f36]">
                {enrolmentsLoading ? (
                  <div className="flex min-h-28 items-center justify-center gap-3 rounded-xl bg-gray-50 text-sm text-gray-600 dark:bg-[#11141a] dark:text-gray-300">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    Finding the recommended lesson...
                  </div>
                ) : recommendedLesson ? (
                  <div className="overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-950/20">
                    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
                          <Target className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Recommended next lesson</p>
                          <p className="mt-1 text-base font-bold text-emerald-950 dark:text-emerald-100">
                            {recommendedLesson.lesson.name || recommendedLesson.lesson.sequenceTitle}
                          </p>
                          <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
                            {recommendedLesson.course.title}
                            {recommendedLesson.previousLesson ? ` · follows ${recommendedLesson.previousLesson.name || recommendedLesson.previousLesson.sequenceTitle}` : ' · first lesson in this enrolment'}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenRecommendedLesson}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
                      >
                        Open lesson
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-4 text-sm text-gray-600 dark:border-[#39414d] dark:bg-[#11141a] dark:text-gray-300">
                    No next lesson recommendation is available. Select <strong>Lesson</strong> to choose a course and lesson manually.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {activeLog && recordEntryType === 'instructor_review' && activeIsInstructorCompliance && activeCandidate && user && (
        <div
          className="fixed inset-0 z-[110] space-y-3 overflow-y-auto bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4 lg:p-6 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-6xl"
          role="dialog"
          aria-modal="true"
          aria-label="Instructor review record"
          onMouseDown={event => { if (event.target === event.currentTarget) closePanel(); }}
        >
          <button type="button" onClick={handleChangeRecordType} className="inline-flex min-h-10 max-w-max items-center gap-2 rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-slate-900">
            <RotateCcw className="h-3.5 w-3.5" /> Change record type
          </button>
          <InstructorComplianceRecordForm
            flightLog={activeLog}
            candidate={activeCandidate}
            examiner={user}
            onClose={closePanel}
            onCompleted={async () => {
              await markRecorded(activeLog.id);
              await refetch();
            }}
          />
        </div>
      )}
      {activeLog && recordEntryType === 'review_test' && !activeReviewRecord && (
        <section
          className="fixed inset-0 z-[110] space-y-3 overflow-y-auto bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4 lg:p-6 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-6xl"
          role="dialog"
          aria-modal="true"
          aria-label="Review or test record"
          onMouseDown={event => { if (event.target === event.currentTarget) closePanel(); }}
        >
          <button type="button" onClick={handleChangeRecordType} className="inline-flex min-h-10 max-w-max items-center gap-2 rounded-xl border border-white/20 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-slate-900">
            <RotateCcw className="h-3.5 w-3.5" /> Change record type
          </button>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-4 dark:border-[#2c2f36] dark:bg-[#11141a] sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Review / Test</p>
                <h3 className="mt-1 truncate text-lg font-bold text-gray-950 dark:text-white">
                  Choose the correct form for{' '}
                  <StudentFileLink studentId={activeLog.student_id} name={activeLog.student_name || 'Unknown member'} />
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Only published forms you are authorised to conduct are shown.</p>
              </div>
              <button type="button" onClick={closePanel} aria-label="Close record workspace" className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-[#252b35] dark:hover:text-gray-100">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 sm:p-6">
              {flightReviews.loading ? (
                <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  Loading review and test forms...
                </div>
              ) : reviewForActiveFlight ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-400/25 dark:bg-blue-950/25">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">Existing {reviewForActiveFlight.status.replaceAll('_', ' ')}</p>
                      <h4 className="mt-1 text-base font-bold text-blue-950 dark:text-blue-100">{reviewForActiveFlight.templateSnapshot.title || reviewForActiveFlight.reviewType}</h4>
                      <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">Continue this record rather than creating a duplicate for the same flight.</p>
                    </div>
                    {userCanConductReview(
                      user,
                      reviewForActiveFlight.templateSnapshot.review_configuration?.allowed_reviewer_roles,
                    ) ? (
                      <button type="button" onClick={() => setActiveReviewRecordId(reviewForActiveFlight.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                        Continue record
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <p className="max-w-xs text-xs font-semibold text-blue-800 dark:text-blue-200">
                        Assigned for completion by a user holding one of the template's authorised CRM roles.
                      </p>
                    )}
                  </div>
                </div>
              ) : availableReviewTemplates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center dark:border-[#39414d] dark:bg-[#11141a]">
                  <Award className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
                  <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">No review or test forms available</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Publish a form in Training Courses, or check its permitted reviewer roles.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 xl:grid-cols-2">
                  {availableReviewTemplates.map(template => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => void handleStartReview(template.id)}
                      disabled={startingReview}
                      className="group flex min-h-32 items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 dark:border-[#343b47] dark:bg-[#11141a] dark:hover:bg-blue-950/25 sm:p-5"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-950/50 dark:text-blue-200">
                        {startingReview ? <Loader2 className="h-5 w-5 animate-spin" /> : <Award className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold text-gray-950 dark:text-white">{template.title}</span>
                        <span className="mt-1 block text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">{template.coursePurpose.replaceAll('_', ' ')}</span>
                        <span className="mt-2 block text-sm leading-5 text-gray-500 dark:text-gray-400">{template.description || `${template.configuration.checklist?.length ?? 0} assessment items`}</span>
                      </span>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-gray-300 transition group-hover:text-blue-500" />
                    </button>
                  ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {activeLog && recordEntryType === 'lesson' && (
        <div
          className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4 lg:p-6 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-6xl"
          role="dialog"
          aria-modal="true"
          aria-label="Lesson training record"
          onMouseDown={event => { if (event.target === event.currentTarget) closePanel(); }}
        >
          <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            {/* Panel header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-4 dark:border-[#2c2f36] dark:bg-[#11141a] sm:px-6">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {isDraftSession ? 'In-flight Draft Record' : activeDraftRecord ? 'Attach Draft Training Record' : 'Training Record'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  <StudentFileLink studentId={activeLog.student_id} name={activeLog.student_name || 'Unknown member'} />
                  {' '}&middot; {isDraftSession ? 'Started' : 'Flight'} {format(new Date(activeLog.start_time), 'd MMM yyyy')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {isCfi && (
                  <button type="button" onClick={handleChangeRecordType} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-950/30">
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Change type</span>
                  </button>
                )}
                <button
                  onClick={closePanel}
                  aria-label="Close training record"
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
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

            <div className="p-4 sm:p-6">
              <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-400/20 dark:bg-blue-950/30 dark:text-blue-100 lg:hidden">
                <p className="font-semibold">
                  <StudentFileLink studentId={activeLog.student_id} name={activeLog.student_name ?? 'Unknown Student'} />
                </p>
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
                  {recommendedLesson && (
                    <button
                      type="button"
                      onClick={handleOpenRecommendedLesson}
                      className={`mb-5 flex w-full items-center gap-3 rounded-xl border p-4 text-left transition ${
                        recommendedLessonBlockingDeficiencies.length > 0
                          ? 'border-red-200 bg-red-50 hover:border-red-300 dark:border-red-400/25 dark:bg-red-950/20'
                          : 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-400/25 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/35'
                      }`}
                    >
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${recommendedLessonBlockingDeficiencies.length > 0 ? 'bg-red-600' : 'bg-emerald-600'}`}>
                        {recommendedLessonBlockingDeficiencies.length > 0 ? <ShieldAlert className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-xs font-bold uppercase tracking-wide ${recommendedLessonBlockingDeficiencies.length > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                          {recommendedLessonBlockingDeficiencies.length > 0 ? 'Recommended lesson blocked' : 'Recommended next lesson'}
                        </span>
                        <span className={`mt-0.5 block truncate text-sm font-bold ${recommendedLessonBlockingDeficiencies.length > 0 ? 'text-red-950 dark:text-red-100' : 'text-emerald-950 dark:text-emerald-100'}`}>{recommendedLesson.lesson.name || recommendedLesson.lesson.sequenceTitle}</span>
                        <span className={`block truncate text-xs ${recommendedLessonBlockingDeficiencies.length > 0 ? 'text-red-800 dark:text-red-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                          {recommendedLesson.course.title}
                          {recommendedLessonBlockingDeficiencies.length > 0 ? ` · resolve ${recommendedLessonBlockingDeficiencies.length} ${recommendedLessonBlockingDeficiencies.length === 1 ? 'deficiency' : 'deficiencies'} first` : ''}
                        </span>
                      </span>
                      <ArrowRight className={`h-5 w-5 shrink-0 ${recommendedLessonBlockingDeficiencies.length > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
                    </button>
                  )}
                  {coursesLoading ? (
                    <div className="rounded-xl border border-blue-100 bg-blue-50 p-6 text-center text-blue-900 dark:border-blue-400/20 dark:bg-blue-950/30 dark:text-blue-100">
                      <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                      <p className="text-sm font-semibold">Loading training courses...</p>
                      <p className="mt-1 text-xs text-blue-700 dark:text-blue-200">The record form will appear as soon as the syllabus data is ready.</p>
                    </div>
                  ) : coursesWithLessons.length === 0 ? (
                    <div className="text-center py-10 text-gray-400">
                      <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No courses available. Create a course in Syllabus Management first.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sortedCoursesWithLessons.map(course => (
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
                            <p className="text-xs text-gray-500 mt-0.5">
                              {course.category} &middot; {course.lessons.length} lessons
                              {activeEnrolledCourseIds.has(course.id) && <span className="ml-2 font-semibold text-emerald-600 dark:text-emerald-300">Enrolled</span>}
                              {(openDeficienciesByCourse.get(course.id)?.length ?? 0) > 0 && (
                                <span className="ml-2 font-semibold text-amber-700 dark:text-amber-300">
                                  {openDeficienciesByCourse.get(course.id)?.length} open {openDeficienciesByCourse.get(course.id)?.length === 1 ? 'deficiency' : 'deficiencies'}
                                </span>
                              )}
                            </p>
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
                    {selectedCourse.lessons.map((lesson, idx) => {
                      const gate = getTrainingDeficiencyGate(lesson);
                      const blockingCount = gate
                        ? selectedCourseOpenDeficiencies.filter(deficiency => deficiency.stage === gate).length
                        : 0;
                      return (
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
                          {blockingCount > 0 && (
                            <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-300">
                              Blocked by {blockingCount} open {gate === 'pre_solo' ? 'pre-solo' : 'pre-test'} {blockingCount === 1 ? 'deficiency' : 'deficiencies'}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-400 shrink-0 transition-colors" />
                      </button>
                      );
                    })}
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
                  {isDraftSession && (
                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 dark:border-indigo-400/25 dark:bg-indigo-950/25 dark:text-indigo-100">
                      <p className="font-semibold">This is not attached to a logged flight yet.</p>
                      <p className="mt-1 text-xs leading-5">
                        Save it as a draft now. After the flight is logged, use the matching draft shown under the outstanding record to attach and submit it.
                      </p>
                    </div>
                  )}

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
                          onClick={() => handleCleanupFlightComments('grammar')}
                          disabled={commentCleanupLoading !== null || !form.flightComments.trim()}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-400/40 dark:bg-blue-950/50 dark:text-blue-200 dark:hover:bg-blue-900/60"
                          title="Fix grammar with AI"
                          aria-label="Fix flight comment grammar with AI"
                        >
                          {commentCleanupLoading === 'grammar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Grammar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCleanupFlightComments('readability')}
                          disabled={commentCleanupLoading !== null || !form.flightComments.trim()}
                          className="inline-flex h-8 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-400/40 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                          title="Rewrite for readability without adding facts"
                          aria-label="Rewrite flight comments for readability with AI"
                        >
                          {commentCleanupLoading === 'readability' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                          Rewrite
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
                      Use Grammar for light fixes, or Rewrite for a clearer version without adding facts.
                    </p>
                  </div>

                  {/* Instructor-only structured deficiencies */}
                  <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/70 dark:border-amber-400/25 dark:bg-amber-950/15">
                    <div className="flex items-start gap-3 border-b border-amber-200 px-4 py-4 dark:border-amber-400/20 sm:px-5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white">
                        <ShieldAlert className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-amber-950 dark:text-amber-100">Training deficiencies</h4>
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-slate-100 dark:text-slate-900">Instructor only</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                          Track each issue separately. Students continue to see the lesson comments and grades, but never this section.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 p-4 sm:p-5">
                      {selectedLessonBlockingDeficiencies.length > 0 && (
                        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-100">
                          <p className="font-bold">This {selectedLessonDeficiencyGate === 'pre_solo' ? 'solo lesson' : 'pilot test'} cannot be submitted yet.</p>
                          <p className="mt-1 text-xs leading-5 text-red-800 dark:text-red-200">
                            {selectedLessonBlockingDeficiencies.length} open {selectedLessonBlockingDeficiencies.length === 1 ? 'deficiency must' : 'deficiencies must'} be marked fixed in an earlier lesson record first.
                          </p>
                        </div>
                      )}

                      {deficienciesLoading ? (
                        <div className="flex items-center gap-2 rounded-xl bg-white/80 p-3 text-sm text-amber-800 dark:bg-[#111827] dark:text-amber-200">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading open deficiencies...
                        </div>
                      ) : deficienciesError ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-950/30 dark:text-red-200">
                          Deficiencies could not be loaded. Do not submit until the connection is restored.
                        </div>
                      ) : selectedCourseOpenDeficiencies.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Open items — tick only those fixed during this lesson</p>
                          {selectedCourseOpenDeficiencies.map(deficiency => {
                            const checked = (form.resolvedDeficiencyIds ?? []).includes(deficiency.id);
                            const sourceLesson = selectedCourse.lessons.find(lesson => lesson.id === deficiency.sourceLessonId);
                            return (
                              <label
                                key={deficiency.id}
                                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                                  checked
                                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-950/25'
                                    : 'border-amber-200 bg-white hover:border-amber-300 dark:border-amber-400/20 dark:bg-[#111827]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleToggleDeficiencyResolved(deficiency.id)}
                                  className="mt-1 h-5 w-5 rounded border-amber-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className={`block text-sm font-semibold leading-5 ${checked ? 'text-emerald-950 line-through decoration-emerald-500/60 dark:text-emerald-100' : 'text-slate-900 dark:text-slate-100'}`}>
                                    {deficiency.description}
                                  </span>
                                  <span className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span className="font-semibold">Must be fixed before {deficiency.stage === 'pre_solo' ? 'solo' : 'pilot test'}</span>
                                    {sourceLesson && <span>Raised in {sourceLesson.name || sourceLesson.sequenceTitle}</span>}
                                  </span>
                                </span>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${checked ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'}`}>
                                  {checked ? 'Fixed' : 'Open'}
                                </span>
                              </label>
                            );
                          })}
                          {(form.resolvedDeficiencyIds?.length ?? 0) > 0 && (
                            <label className="block pt-1">
                              <span className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">How the selected items were fixed (optional)</span>
                              <textarea
                                rows={2}
                                value={form.deficiencyResolutionNote ?? ''}
                                onChange={event => setForm(current => ({ ...current, deficiencyResolutionNote: event.target.value }))}
                                placeholder="Brief evidence or corrective action..."
                                className="w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-400/25 dark:bg-[#111827] dark:text-slate-100"
                              />
                            </label>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-950/25 dark:text-emerald-200">
                          <CheckCircle className="h-4 w-4" /> No open deficiencies for this course.
                        </div>
                      )}

                      {(form.newDeficiencies?.length ?? 0) > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">New items from this lesson</p>
                          {form.newDeficiencies.map(deficiency => (
                            <div key={deficiency.clientReference} className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-400/25 dark:bg-blue-950/20">
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-blue-950 dark:text-blue-100">{deficiency.description}</p>
                                <p className="mt-1 text-[11px] font-semibold text-blue-700 dark:text-blue-200">Before {deficiency.stage === 'pre_solo' ? 'solo' : 'pilot test'}</p>
                              </div>
                              <button type="button" onClick={() => handleRemoveNewDeficiency(deficiency.clientReference)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30" aria-label="Remove new deficiency">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="rounded-xl border border-dashed border-amber-300 bg-white/70 p-3 dark:border-amber-400/30 dark:bg-[#111827] sm:p-4">
                        <label className="block text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-100">Add a deficiency requiring attention</label>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {([
                            { value: 'pre_solo' as const, label: 'Before solo' },
                            { value: 'pre_test' as const, label: 'Before pilot test' },
                          ]).map(option => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setDeficiencyStage(option.value)}
                              className={`min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                                deficiencyStage === option.value
                                  ? 'border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 dark:border-[#363b45] dark:bg-[#171a21] dark:text-slate-300'
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <textarea
                          rows={3}
                          maxLength={2000}
                          value={deficiencyDraft}
                          onChange={event => setDeficiencyDraft(event.target.value)}
                          placeholder="One specific issue, observable standard, or corrective action required..."
                          className="mt-3 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-400/25 dark:bg-[#0f172a] dark:text-slate-100 dark:placeholder:text-slate-500"
                        />
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-[11px] leading-4 text-amber-700 dark:text-amber-200">Add one issue at a time so each can be marked fixed independently.</p>
                          <button type="button" onClick={handleAddDeficiency} disabled={deficiencyDraft.trim().length < 3} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
                            <Plus className="h-4 w-4" /> Add deficiency
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* CASA Matrix Assessment */}
                  {matrixAssessmentLoading && (
                    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-400/30 dark:bg-blue-950/25 dark:text-blue-100">
                      Loading lesson-specific assessment rows...
                    </div>
                  )}

                  {!matrixAssessmentLoading && hasMatrixAssessment && (
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

                  {!matrixAssessmentLoading && !hasMatrixAssessment && activeCriteria.length > 0 && (
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
                    nextLessonBlockingDeficiencies.length > 0
                      ? 'border-red-200 bg-red-50'
                    : consecutivePassReadiness.blocked || twoOccasionReadiness.blocked
                      ? 'border-indigo-200 bg-indigo-50'
                      : lessonPassed
                      ? 'border-emerald-200 bg-emerald-50'
                      : lessonWillProceed
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-amber-200 bg-amber-50'
                  }`}>
                    <p className={`font-semibold ${
                      nextLessonBlockingDeficiencies.length > 0
                        ? 'text-red-800'
                      : consecutivePassReadiness.blocked || twoOccasionReadiness.blocked
                        ? 'text-indigo-800'
                        : lessonPassed
                        ? 'text-emerald-800'
                        : lessonWillProceed
                          ? 'text-blue-800'
                          : 'text-amber-800'
                    }`}>
                      {nextLessonBlockingDeficiencies.length > 0
                        ? `Next ${nextLessonDeficiencyGate === 'pre_solo' ? 'solo lesson' : 'pilot test'} blocked by open deficiencies`
                      : consecutivePassReadiness.blocked
                        ? 'Consecutive pass required before next lesson'
                        : twoOccasionReadiness.blocked
                        ? `Two-occasion rule: not ready to recommend ${twoOccasionReadiness.targetLessonName}`
                        : lessonPassed
                          ? 'Lesson pass achieved'
                          : lessonWillProceed
                            ? 'Lesson proceeding with carry-forward items'
                            : 'Lesson not passed yet'}
                    </p>
                    <p className={`mt-1 text-xs ${
                      nextLessonBlockingDeficiencies.length > 0
                        ? 'text-red-700'
                      : consecutivePassReadiness.blocked || twoOccasionReadiness.blocked
                        ? 'text-indigo-700'
                        : lessonPassed
                        ? 'text-emerald-700'
                        : lessonWillProceed
                          ? 'text-blue-700'
                          : 'text-amber-700'
                    }`}>
                      Next lesson on record: {nextLessonForRecord || 'Not set'}
                    </p>
                    {nextLessonBlockingDeficiencies.length > 0 && (
                      <p className="mt-2 text-xs text-red-700">
                        Resolve {nextLessonBlockingDeficiencies.length} {nextLessonDeficiencyGate === 'pre_solo' ? 'pre-solo' : 'pre-test'} {nextLessonBlockingDeficiencies.length === 1 ? 'deficiency' : 'deficiencies'} before proceeding.
                      </p>
                    )}
                    {consecutivePassReadiness.blocked && (
                      <p className="mt-2 text-xs text-indigo-700">
                        Needs 2 consecutive passes for: {consecutivePassReadiness.missing.slice(0, 4).map(item => item.name).join(', ')}
                        {consecutivePassReadiness.missing.length > 4 ? ` and ${consecutivePassReadiness.missing.length - 4} more` : ''}.
                      </p>
                    )}
                    {twoOccasionReadiness.blocked && (
                      <p className="mt-2 text-xs text-indigo-700">
                        Needs two {twoOccasionReadiness.targetGrade} occasions before this gate. Still short: {twoOccasionReadiness.missing.slice(0, 4).map(item => `${item.name} (${item.count}/2)`).join(', ')}
                        {twoOccasionReadiness.missing.length > 4 ? ` and ${twoOccasionReadiness.missing.length - 4} more` : ''}.
                      </p>
                    )}
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
                          <SearchableSelect
                            value={form.flightReviewResult}
                            onChange={event => setForm(f => ({ ...f, flightReviewResult: event.target.value as RecordFormState['flightReviewResult'] }))}
                            className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                          >
                            <option value="not_assessed">Not assessed</option>
                            <option value="pass">Pass</option>
                            <option value="fail">Further training required</option>
                          </SearchableSelect>
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="block text-xs font-medium text-orange-800 mb-1">
                            {FORMAL_REVIEW_FINDINGS_LABEL} {requiresFormalReviewFindings({ trainingResult: form.flightReviewResult }) ? '(required)' : '(optional)'}
                          </span>
                          <textarea
                            rows={3}
                            value={form.flightReviewNotes}
                            onChange={event => setForm(f => ({ ...f, flightReviewNotes: event.target.value }))}
                            required={requiresFormalReviewFindings({ trainingResult: form.flightReviewResult })}
                            className="w-full px-3 py-2 text-sm border border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                          />
                          <span className="mt-1 block text-xs leading-5 text-orange-800">
                            The flight comments are the main debrief. Add only formal findings, further training, limitations, or follow-up that must be recorded with the outcome.
                          </span>
                        </label>
                        {form.flightReviewResult === 'pass' && (
                          <p className="text-xs text-orange-800 sm:col-span-2">
                            On submit, the student's flight review date will be updated. Pilot status is granted by a verified licence.
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="pt-2 border-t border-gray-100">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {activeDraftRecord?.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteDraftRecord(activeDraftRecord)}
                          disabled={submitting || deletingDraftId === activeDraftRecord.id}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-950/30"
                        >
                          {deletingDraftId === activeDraftRecord.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                          Delete Draft
                        </button>
                      )}
                      <button
                        onClick={isDraftSession ? handleSaveDraftRecord : handleSubmit}
                        disabled={submitting || (!isDraftSession && (deficienciesLoading || Boolean(deficienciesError) || (trainingSettings.requireFlightComments && !form.flightComments.trim())))}
                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitting ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            {isDraftSession ? 'Saving draft...' : 'Submitting...'}
                          </>
                        ) : (
                          <>
                            {isDraftSession ? <Save className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                            {isDraftSession ? 'Save Draft Record' : activeDraftRecord ? 'Attach Draft & Submit' : 'Submit Training Record'}
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 text-center mt-2">
                      {isDraftSession
                        ? 'Drafts stay hidden from the student until they are attached to a logged flight and submitted.'
                        : selectedCourseRequiresAck
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
      {activeReviewRecord && activeLog && user && canConductActiveReview && (
        <FlightReviewRecordEditor
          record={activeReviewRecord}
          items={flightReviews.itemsByRecord.get(activeReviewRecord.id) ?? []}
          attachments={flightReviews.attachmentsByRecord.get(activeReviewRecord.id) ?? []}
          candidateName={activeLog.student_name || activeCandidate?.name || 'Member'}
          reviewerName={user.name || 'Reviewer'}
          currentUserId={user.id}
          flightComments={flightReviews.flightCommentsByRecord.get(activeReviewRecord.id) || form.flightComments}
          endorsementOptions={trainingSettings.endorsementTypes}
          linkedFlight={!isDraftSession ? {
            id: activeLog.id,
            aircraftId: activeLog.aircraft_id || undefined,
            aircraftType: activeLog.aircraft_type || undefined,
            registration: activeLog.aircraft_registration || undefined,
            reviewDate: format(new Date(activeLog.start_time), 'yyyy-MM-dd'),
            flightMinutes: Math.max(0, Math.round(((activeLog.dual_time ?? 0) + (activeLog.solo_time ?? 0)) * 60)),
          } : undefined}
          onClose={() => setActiveReviewRecordId(null)}
          onUpdateRecord={async (id, input) => {
            const updateInput = !isDraftSession && !activeReviewRecord.flightLogId
              ? { ...input, flightLogId: activeLog.id }
              : input;
            const updated = await flightReviews.updateReview(id, updateInput);
            if (input.status === 'completed' && !isDraftSession) {
              await markRecorded(activeLog.id);
              await refetch();
            }
            return updated;
          }}
          onUpdateItem={flightReviews.updateItem}
          onUploadAttachment={flightReviews.uploadAttachment}
          onCreateAttachmentUrl={flightReviews.createAttachmentUrl}
        />
      )}
    </div>
  );
};
