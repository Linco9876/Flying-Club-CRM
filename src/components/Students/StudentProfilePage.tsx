import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LessonStudyAsset, Student, StudentExamResult, TrainingRecord, TrainingModule, LessonGradingSystem, User as AppUser } from '../../types';
import { ArrowLeft, User, Phone, Mail, Calendar, Award, Clock, FileText, Plus, CreditCard as Edit, CheckCircle, AlertTriangle, BookOpen, GraduationCap, Shield, Wallet, History, Save, X, Loader2, Plane, Upload, Download, ChevronDown, Sparkles, RotateCcw, RefreshCw, Search, ChevronRight, Image } from 'lucide-react';
import toast from 'react-hot-toast';
import { useStudents } from '../../hooks/useStudents';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useUsers } from '../../hooks/useUsers';
import { LogbookTab } from './LogbookTab';
import { StudentDocumentsTab } from './StudentDocumentsTab';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useSafetyReports } from '../../hooks/useSafetyReports';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { StudentCourseEnrolment, useStudentCourseEnrolments } from '../../hooks/useStudentCourseEnrolments';
import {
  formatSyllabusMatrixText,
  matrixStandardMeetsRequirement,
  matrixStandardShortLabel,
  useSyllabusMatrix,
} from '../../hooks/useSyllabusMatrix';
import { supabase } from '../../lib/supabase';
import { hasAnyRole } from '../../utils/rbac';
import { reconcilePilotStatusForUser } from '../../utils/pilotStatus';
import { cleanupInstructorComment, type CommentCleanupMode } from '../../utils/commentCleanup';
import { getConsecutivePassReadiness, getTwoOccasionReadiness } from '../../utils/trainingReadiness';

interface StudentInfoForm {
  name: string;
  phone: string;
  dateOfBirth: string;
  raausId: string;
  membershipExpiry: string;
  medicalType: string;
  medicalExpiry: string;
  casaArn: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
  endorsements: Student['endorsements'];
}

interface StudentInfoEndorsementDraft {
  type: string;
  dateObtained: string;
  expiryDate: string;
  isActive: boolean;
}

interface TrainingRecordEditForm {
  comments: string;
  briefingComments: string;
  formalBriefing: boolean;
  nextLesson: string;
  criteriaGrades: Record<string, string>;
  isFlightReview: boolean;
  flightReviewType: string;
  flightReviewResult: 'pass' | 'fail' | 'not_assessed';
  flightReviewNotes: string;
}

interface ExamFormState {
  courseId: string;
  examId: string;
  score: string;
  examDate: string;
  notes: string;
  kdrCompleted: boolean;
  kdrNotes: string;
}

interface ExamEditFormState {
  score: string;
  examDate: string;
  notes: string;
  kdrCompleted: boolean;
  kdrNotes: string;
  removeExistingFile: boolean;
}

const EXAM_UPLOAD_BUCKET = 'student-exam-uploads';
const LESSON_STUDY_BUCKET = 'training-lesson-assets';

const toDateInputValue = (date?: Date) => date ? date.toISOString().slice(0, 10) : '';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatCourseRichText = (value?: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const html = /<\/?[a-z][\s\S]*>/i.test(trimmed)
    ? trimmed
    : escapeHtml(trimmed)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
  if (typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const allowed = new Set(['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a']);
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    const normalized = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
    const inner = Array.from(element.childNodes).map(walk).join('');
    if (!allowed.has(normalized)) return inner;
    if (normalized === 'br') return '<br />';
    if (normalized === 'a') {
      const href = element.getAttribute('href') || '';
      return /^https?:\/\//i.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : inner;
    }
    return `<${normalized}>${inner}</${normalized}>`;
  };
  return Array.from(doc.body.childNodes).map(walk).join('').trim();
};

const CourseRichText: React.FC<{ value?: string; fallback?: string }> = ({ value, fallback = 'Not recorded' }) => {
  const html = formatCourseRichText(value);
  if (!html) {
    return <p className="mt-1 text-sm text-gray-500">{fallback}</p>;
  }

  return (
    <div
      className="mt-1 text-sm leading-6 text-gray-700 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '';
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const hasMeaningfulCourseContent = (value?: string) => String(value || '').replace(/<[^>]+>/g, '').trim().length > 0;

const matchLessonIndexByLabel = (lessons: TrainingModule['lessons'], label?: string) => {
  const target = (label || '').trim().toLowerCase();
  if (!target) return -1;
  return lessons.findIndex((lesson) => {
    const candidates = [
      lesson.id,
      lesson.name,
      lesson.sequenceTitle,
      lesson.sequenceCode,
      lesson.sequenceId,
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    return candidates.includes(target);
  });
};

const XeroContactPanel: React.FC<{ student: Student; canManage: boolean; onChanged: () => void }> = ({ student, canManage, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [matches, setMatches] = useState<Array<{ contactId: string; name: string; email: string }>>([]);

  const invoke = async (action: string, body: Record<string, unknown>) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke('xero-sync', {
        body: { action, ...body },
      });
      if (error) throw error;
      return data as any;
    } finally {
      setBusy(null);
    }
  };

  const syncContact = async () => {
    try {
      await invoke('sync-member-contact', { userId: student.id });
      toast.success('Xero contact synced');
      onChanged();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to sync Xero contact');
    }
  };

  const searchContact = async () => {
    try {
      const data = await invoke('search-contacts', { email: student.email });
      setMatches(Array.isArray(data?.contacts) ? data.contacts : []);
      if (!data?.contacts?.length) toast('No exact Xero email match found');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to search Xero contacts');
    }
  };

  const linkContact = async (contactId: string) => {
    try {
      await invoke('link-contact', { userId: student.id, contactId });
      toast.success('Xero contact linked');
      setMatches([]);
      onChanged();
    } catch (error: any) {
      toast.error(error?.message || 'Failed to link Xero contact');
    }
  };

  if (!canManage) return null;

  const status = student.xeroContactSyncStatus || (student.xeroContactId ? 'linked' : 'not_linked');

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-950">Xero Contact</h2>
          <p className="mt-1 text-xs text-sky-800">
            {student.xeroContactId
              ? `${student.xeroContactName || student.name} ${student.xeroContactEmail ? `(${student.xeroContactEmail})` : ''}`
              : 'Not linked yet'}
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-sky-800">
          {status.replace(/_/g, ' ')}
        </span>
      </div>
      {student.xeroContactSyncError && (
        <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{student.xeroContactSyncError}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={syncContact}
          disabled={!!busy}
          className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
        >
          {busy === 'sync-member-contact' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync/Create
        </button>
        <button
          type="button"
          onClick={searchContact}
          disabled={!!busy}
          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-60"
        >
          {busy === 'search-contacts' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Find by email
        </button>
      </div>
      {matches.length > 0 && (
        <div className="mt-3 space-y-2">
          {matches.map(match => (
            <div key={match.contactId} className="rounded-md border border-sky-200 bg-white p-2">
              <p className="text-xs font-semibold text-gray-900">{match.name || 'Unnamed Xero contact'}</p>
              <p className="text-xs text-gray-500">{match.email || 'No email'}</p>
              <button
                type="button"
                onClick={() => linkContact(match.contactId)}
                disabled={!!busy}
                className="mt-2 rounded bg-gray-900 px-2 py-1 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
              >
                Link this contact
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

interface ProfileTimelineEvent {
  id: string;
  date: Date | null;
  title: string;
  description: string;
  kind: string;
  badge?: string;
  colorClass: string;
  isFuture?: boolean;
}

interface StudentInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  total: number;
}

interface StudentInvoiceSummary {
  id: string;
  invoiceNumber: string;
  date: Date;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  items: StudentInvoiceItem[];
}

type CourseProgressSummary = {
  course: TrainingModule;
  percentage: number;
  isComplete: boolean;
  completedLessons: number;
  totalLessons: number;
  criteriaProgress: Array<{
    criterion: TrainingModule['assessmentCriteria'][number];
    bestGrade: string;
    bestScore: number;
    isComplete: boolean;
  }>;
  hasCriteria: boolean;
  recordsCount: number;
};

interface StudentProfilePageProps {
  portalSection?: 'training' | 'documents';
}

export const StudentProfilePage: React.FC<StudentProfilePageProps> = ({ portalSection }) => {
  const { studentId: routeStudentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const studentId = routeStudentId || user?.id;
  const [activeTab, setActiveTab] = useState(() => {
    if (portalSection === 'documents') return 'documents';
    if (portalSection === 'training') return 'training';
    return searchParams.get('tab') || (location.pathname.startsWith('/training') ? 'training' : 'profile');
  });
  const [trainingSubtab, setTrainingSubtab] = useState<'training' | 'exams' | 'courses'>(() => {
    const subtab = searchParams.get('subtab');
    if (subtab === 'exams' || subtab === 'courses' || subtab === 'training') return subtab;
    const legacyTab = searchParams.get('tab');
    if (legacyTab === 'exams' || legacyTab === 'courses') return legacyTab;
    return 'training';
  });
  const [showMatrixView, setShowMatrixView] = useState(false);
  const [expandedRecordMatrixIds, setExpandedRecordMatrixIds] = useState<Set<string>>(new Set());
  const [selectedTrainingCourseId, setSelectedTrainingCourseId] = useState('');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [aircraftFilter, setAircraftFilter] = useState('');
  const [instructorFilter, setInstructorFilter] = useState('');
  const [showInfoEditor, setShowInfoEditor] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState<StudentInfoForm>({
    name: '',
    phone: '',
    dateOfBirth: '',
    raausId: '',
    membershipExpiry: '',
    medicalType: '',
    medicalExpiry: '',
    casaArn: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    endorsements: [],
  });
  const [infoEndorsementDraft, setInfoEndorsementDraft] = useState<StudentInfoEndorsementDraft>({
    type: '',
    dateObtained: '',
    expiryDate: '',
    isActive: true,
  });
  const [editingTrainingRecord, setEditingTrainingRecord] = useState<TrainingRecord | null>(null);
  const [trainingEditForm, setTrainingEditForm] = useState<TrainingRecordEditForm | null>(null);
  const [commentCleanupLoading, setCommentCleanupLoading] = useState<CommentCleanupMode | null>(null);
  const [commentCleanupOriginal, setCommentCleanupOriginal] = useState<string | null>(null);
  const [savingTrainingRecord, setSavingTrainingRecord] = useState(false);
  const [studentExamResults, setStudentExamResults] = useState<StudentExamResult[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [examUploadFile, setExamUploadFile] = useState<File | null>(null);
  const [editingExamResult, setEditingExamResult] = useState<StudentExamResult | null>(null);
  const [examEditForm, setExamEditForm] = useState<ExamEditFormState | null>(null);
  const [examEditFile, setExamEditFile] = useState<File | null>(null);
  const [savingExamEdit, setSavingExamEdit] = useState(false);
  const [deletingExamId, setDeletingExamId] = useState<string | null>(null);
  const [studentInvoices, setStudentInvoices] = useState<StudentInvoiceSummary[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpDate, setTopUpDate] = useState(new Date().toISOString().slice(0, 10));
  const [topUpDescription, setTopUpDescription] = useState('Account top-up');
  const [topUpPaymentMethodId, setTopUpPaymentMethodId] = useState('');
  const [savingTopUp, setSavingTopUp] = useState(false);
  const [billingActionId, setBillingActionId] = useState<string | null>(null);
  const [examForm, setExamForm] = useState<ExamFormState>({
    courseId: '',
    examId: '',
    score: '',
    examDate: new Date().toISOString().slice(0, 10),
    notes: '',
    kdrCompleted: true,
    kdrNotes: '',
  });

  const { students, loading: studentsLoading, refetch: refetchStudents } = useStudents();
  const {
    trainingRecords,
    loading: trainingRecordsLoading,
    updateTrainingRecord,
    refetch: refetchTrainingRecords,
  } = useTrainingRecords(studentId, { requireStudentId: true });
  const { users } = useUsers();
  const { modules: trainingCourses } = useTrainingModules();
  const { settings: portalSettings } = usePortalUxSettings();
  const { reports: safetyReports } = useSafetyReports();
  const { settings: trainingSettings } = useTrainingSettings();
  const billing = useBillingAccounts({
    enabled: activeTab === 'billing',
    scope: 'member',
    userId: studentId,
  });
  const { paymentMethods } = useBillingSettings({ enabled: activeTab === 'billing', paymentMethodsOnly: true });
  const {
    enrolments: courseEnrolments,
    loading: courseEnrolmentsLoading,
    enrolInCourse,
    sendDeclarationLinks,
  } = useStudentCourseEnrolments(studentId);
  const isOwnStudentPortal = Boolean(user && studentId === user.id && (portalSection === 'training' || portalSection === 'documents' || user.role === 'student' || user.role === 'pilot'));

  const student = useMemo(() => {
    if (!studentId) {
      return null;
    }
    return students.find(s => s.id === studentId) ?? null;
  }, [students, studentId]);
  const canEditStudentInfo = Boolean(user && student && (student.id === user.id || hasAnyRole(user, ['admin', 'instructor', 'senior_instructor'])));
  const canManageBilling = hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']);

  const studentTrainingRecords = useMemo(
    () => trainingRecords.filter(record => record.studentId === studentId),
    [trainingRecords, studentId]
  );
  const trainingCourseOptions = useMemo(() => {
    const courseIdsWithRecords = new Set(studentTrainingRecords.map(record => record.courseId).filter(Boolean));
    const activeEnrolmentIds = new Set(
      courseEnrolments
        .filter(enrolment => enrolment.status === 'active')
        .map(enrolment => enrolment.courseId)
    );
    const relevantCourseIds = new Set([...courseIdsWithRecords, ...activeEnrolmentIds]);
    return trainingCourses.filter(course => relevantCourseIds.has(course.id));
  }, [courseEnrolments, studentTrainingRecords, trainingCourses]);
  const selectedTrainingCourse = useMemo(
    () => trainingCourses.find(course => course.id === selectedTrainingCourseId) ?? null,
    [selectedTrainingCourseId, trainingCourses]
  );
  const {
    assessments: selectedMatrixAssessments,
    requirements: selectedMatrixRequirements,
    rowsById: selectedMatrixRowsById,
    bestAssessmentByRow: selectedBestMatrixAssessmentByRow,
  } = useSyllabusMatrix(selectedTrainingCourseId || undefined, studentId);
  const linkedSafetyReports = useMemo(
    () => safetyReports.filter(report => report.reporterId === studentId || report.involvedUserIds.includes(studentId || '')),
    [safetyReports, studentId]
  );
  const courseProgressSummaries = useMemo(
    () => calculateCourseProgress(trainingCourses, studentTrainingRecords, trainingSettings.courseCompletionRule),
    [studentTrainingRecords, trainingCourses, trainingSettings.courseCompletionRule]
  );
  const mostAdvancedCourseProgress = useMemo(() => {
    return courseProgressSummaries
      .filter(progress => progress.recordsCount > 0 || progress.completedLessons > 0 || progress.percentage > 0)
      .sort((a, b) =>
        b.percentage - a.percentage ||
        b.completedLessons - a.completedLessons ||
        b.recordsCount - a.recordsCount ||
        a.course.title.localeCompare(b.course.title)
      )[0] ?? null;
  }, [courseProgressSummaries]);

  useEffect(() => {
    if (trainingCourseOptions.length === 0) {
      if (selectedTrainingCourseId) setSelectedTrainingCourseId('');
      return;
    }

    if (!selectedTrainingCourseId || !trainingCourseOptions.some(course => course.id === selectedTrainingCourseId)) {
      setSelectedTrainingCourseId(trainingCourseOptions[0].id);
    }
  }, [selectedTrainingCourseId, trainingCourseOptions]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (portalSection) return;
    if (tab) setActiveTab(tab);
  }, [portalSection, searchParams]);

  useEffect(() => {
    if (portalSection === 'documents') {
      setActiveTab('documents');
      return;
    }
    if (portalSection === 'training') {
      setActiveTab('training');
      const subtab = searchParams.get('subtab');
      if (subtab === 'training' || subtab === 'exams' || subtab === 'courses') {
        setTrainingSubtab(subtab);
      } else {
        const legacyTab = searchParams.get('tab');
        if (legacyTab === 'exams' || legacyTab === 'courses') {
          setTrainingSubtab(legacyTab);
        } else {
          setTrainingSubtab('training');
        }
      }
    }
  }, [portalSection, searchParams]);

  useEffect(() => {
    if (!studentId || !['profile', 'training', 'courses'].includes(activeTab)) return;
    void refetchTrainingRecords();
  }, [activeTab, refetchTrainingRecords, studentId]);

  const handleTabChange = (tabId: string) => {
    if (isOwnStudentPortal && portalSection === 'training' && (tabId === 'training' || tabId === 'exams' || tabId === 'courses')) {
      setActiveTab('training');
      setTrainingSubtab(tabId);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('subtab', tabId);
      nextParams.delete('tab');
      setSearchParams(nextParams, { replace: true });
      return;
    }

    setActiveTab(tabId);
    const nextParams = new URLSearchParams(searchParams);
    if (tabId === 'profile') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', tabId);
    }
    nextParams.delete('subtab');
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!studentsLoading && routeStudentId && !student) {
      toast.error('Student not found');
      navigate('/students');
    }
  }, [studentsLoading, routeStudentId, student, navigate]);

  const isPilot = Boolean(student?.roles?.includes('pilot') || student?.role === 'pilot');

  const fetchStudentExamResults = useCallback(async () => {
    if (!studentId) return;
    setLoadingExams(true);
    try {
      const { data, error } = await supabase
        .from('student_exam_results')
        .select('*')
        .eq('student_id', studentId)
        .order('exam_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      setStudentExamResults((data || []).map((row: any) => ({
        id: row.id,
        studentId: row.student_id,
        courseId: row.course_id || undefined,
        examId: row.exam_id,
        examName: row.exam_name,
        score: Number(row.score || 0),
        passMark: Number(row.pass_mark || 0),
        result: row.result,
        examDate: row.exam_date ? new Date(row.exam_date) : new Date(),
        notes: row.notes || '',
        instructorId: row.instructor_id || undefined,
        fileName: row.file_name || undefined,
        fileType: row.file_type || undefined,
        fileSize: Number(row.file_size || 0),
        storagePath: row.storage_path || undefined,
        answerSheetOnly: row.answer_sheet_only !== false,
        kdrRequired: row.kdr_required !== false,
        kdrCompleted: Boolean(row.kdr_completed),
        kdrCompletionMethod: row.kdr_completion_method || 'verbal',
        kdrNotes: row.kdr_notes || '',
        kdrSignedOffBy: row.kdr_signed_off_by || undefined,
        kdrSignedOffAt: row.kdr_signed_off_at ? new Date(row.kdr_signed_off_at) : undefined,
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      })));
    } catch (error) {
      console.error('Failed to load exam results:', error);
      setStudentExamResults([]);
    } finally {
      setLoadingExams(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudentExamResults();
  }, [fetchStudentExamResults]);

  const fetchStudentInvoices = useCallback(async () => {
    if (!studentId) return;
    setLoadingInvoices(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, date, total, status, invoice_items(id, description, quantity, rate, total)')
        .eq('student_id', studentId)
        .order('date', { ascending: false });

      if (error) throw error;

      setStudentInvoices((data || []).map((row: any) => ({
        id: row.id,
        invoiceNumber: row.invoice_number,
        date: row.date ? new Date(`${row.date}T12:00:00`) : new Date(),
        total: Number(row.total || 0),
        status: row.status || 'draft',
        items: (row.invoice_items || []).map((item: any) => ({
          id: item.id,
          description: item.description || '',
          quantity: Number(item.quantity || 0),
          rate: Number(item.rate || 0),
          total: Number(item.total || 0),
        })),
      })));
    } catch (error) {
      console.error('Failed to load invoices:', error);
      setStudentInvoices([]);
    } finally {
      setLoadingInvoices(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchStudentInvoices();
  }, [fetchStudentInvoices]);

  const selectedExamCourse = trainingCourses.find(course => course.id === examForm.courseId) ?? null;
  const selectedExam = selectedExamCourse?.exams.find(exam => exam.id === examForm.examId) ?? null;
  const canManageExamResult = useCallback((result: StudentExamResult) => {
    if (!user) return false;
    return result.instructorId === user.id || hasAnyRole(user, ['admin']);
  }, [user]);

  const createExamStoragePath = (file: File, ownerStudentId: string) => {
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'exam-upload';
    return `${ownerStudentId}/${Date.now()}-${safeFileName}`;
  };

  const handleLogExam = async () => {
    if (!student || !user || !selectedExamCourse || !selectedExam) {
      toast.error('Select a course and exam');
      return;
    }
    const score = Number(examForm.score);
    if (!Number.isFinite(score)) {
      toast.error('Enter a valid exam score');
      return;
    }

    setSavingExam(true);
    let storagePath: string | null = null;
    try {
      if (examUploadFile) {
        storagePath = createExamStoragePath(examUploadFile, student.id);
        const { error: uploadError } = await supabase.storage
          .from(EXAM_UPLOAD_BUCKET)
          .upload(storagePath, examUploadFile, {
            contentType: examUploadFile.type || 'application/octet-stream',
            upsert: false,
          });

        if (uploadError) throw uploadError;
      }

      const { error } = await supabase.from('student_exam_results').insert({
        student_id: student.id,
        course_id: selectedExamCourse.id,
        exam_id: selectedExam.id,
        exam_name: selectedExam.name,
        score,
        pass_mark: selectedExam.passMark,
        result: score >= selectedExam.passMark ? 'pass' : 'fail',
        exam_date: examForm.examDate || new Date().toISOString().slice(0, 10),
        notes: '',
        instructor_id: user.id,
        file_name: examUploadFile?.name || null,
        file_type: examUploadFile?.type || null,
        file_size: examUploadFile?.size || 0,
        storage_path: storagePath,
        answer_sheet_only: true,
        kdr_required: true,
        kdr_completed: examForm.kdrCompleted,
        kdr_completion_method: 'verbal',
        kdr_notes: examForm.kdrNotes.trim(),
        kdr_signed_off_by: examForm.kdrCompleted ? user.id : null,
        kdr_signed_off_at: examForm.kdrCompleted ? new Date().toISOString() : null,
      });

      if (error) throw error;

      setExamForm({
        courseId: selectedExamCourse.id,
        examId: '',
        score: '',
        examDate: new Date().toISOString().slice(0, 10),
        notes: '',
        kdrCompleted: true,
        kdrNotes: '',
      });
      setExamUploadFile(null);
      await fetchStudentExamResults();
      toast.success('Exam result logged');
    } catch (error) {
      if (storagePath) {
        await supabase.storage.from(EXAM_UPLOAD_BUCKET).remove([storagePath]);
      }
      console.error('Failed to log exam:', error);
      toast.error('Failed to log exam result');
    } finally {
      setSavingExam(false);
    }
  };

  const downloadExamUpload = async (result: StudentExamResult) => {
    if (!result.storagePath) return;
    try {
      const { data, error } = await supabase.storage
        .from(EXAM_UPLOAD_BUCKET)
        .createSignedUrl(result.storagePath, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open exam upload:', error);
      toast.error('Failed to open exam upload');
    }
  };

  const openExamEditor = (result: StudentExamResult) => {
    if (!canManageExamResult(result)) return;
    setEditingExamResult(result);
    setExamEditForm({
      score: String(result.score),
      examDate: result.examDate.toISOString().slice(0, 10),
      notes: result.notes || '',
      kdrCompleted: Boolean(result.kdrCompleted),
      kdrNotes: result.kdrNotes || '',
      removeExistingFile: false,
    });
    setExamEditFile(null);
  };

  const closeExamEditor = () => {
    setEditingExamResult(null);
    setExamEditForm(null);
    setExamEditFile(null);
  };

  const saveExamEdit = async () => {
    if (!student || !editingExamResult || !examEditForm || !canManageExamResult(editingExamResult)) return;
    const score = Number(examEditForm.score);
    if (!Number.isFinite(score)) {
      toast.error('Enter a valid exam score');
      return;
    }

    setSavingExamEdit(true);
    let newStoragePath: string | null = null;
    const oldStoragePath = editingExamResult.storagePath;
    try {
      if (examEditFile) {
        newStoragePath = createExamStoragePath(examEditFile, student.id);
        const { error: uploadError } = await supabase.storage
          .from(EXAM_UPLOAD_BUCKET)
          .upload(newStoragePath, examEditFile, {
            contentType: examEditFile.type || 'application/octet-stream',
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }

      const nextStoragePath = newStoragePath || (examEditForm.removeExistingFile ? null : oldStoragePath || null);
      const nextFileName = examEditFile?.name || (examEditForm.removeExistingFile ? null : editingExamResult.fileName || null);
      const nextFileType = examEditFile?.type || (examEditForm.removeExistingFile ? null : editingExamResult.fileType || null);
      const nextFileSize = examEditFile?.size || (examEditForm.removeExistingFile ? 0 : editingExamResult.fileSize || 0);

      const { error } = await supabase
        .from('student_exam_results')
        .update({
          score,
          result: score >= editingExamResult.passMark ? 'pass' : 'fail',
          exam_date: examEditForm.examDate || new Date().toISOString().slice(0, 10),
          notes: examEditForm.notes.trim(),
          kdr_completed: examEditForm.kdrCompleted,
          kdr_completion_method: examEditForm.kdrCompleted ? 'verbal' : 'verbal',
          kdr_notes: examEditForm.kdrNotes.trim(),
          kdr_signed_off_by: examEditForm.kdrCompleted ? user?.id || editingExamResult.kdrSignedOffBy || null : null,
          kdr_signed_off_at: examEditForm.kdrCompleted ? (editingExamResult.kdrSignedOffAt?.toISOString() || new Date().toISOString()) : null,
          file_name: nextFileName,
          file_type: nextFileType,
          file_size: nextFileSize,
          storage_path: nextStoragePath,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingExamResult.id);

      if (error) throw error;

      if ((newStoragePath || examEditForm.removeExistingFile) && oldStoragePath) {
        await supabase.storage.from(EXAM_UPLOAD_BUCKET).remove([oldStoragePath]);
      }

      await fetchStudentExamResults();
      closeExamEditor();
      toast.success('Exam result updated');
    } catch (error) {
      if (newStoragePath) {
        await supabase.storage.from(EXAM_UPLOAD_BUCKET).remove([newStoragePath]);
      }
      console.error('Failed to update exam result:', error);
      toast.error('Failed to update exam result');
    } finally {
      setSavingExamEdit(false);
    }
  };

  const deleteExamResult = async (result: StudentExamResult) => {
    if (!canManageExamResult(result)) return;
    const confirmed = window.confirm(`Delete ${result.examName}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingExamId(result.id);
    try {
      const { error } = await supabase
        .from('student_exam_results')
        .delete()
        .eq('id', result.id);
      if (error) throw error;

      if (result.storagePath) {
        await supabase.storage.from(EXAM_UPLOAD_BUCKET).remove([result.storagePath]);
      }

      await fetchStudentExamResults();
      toast.success('Exam result deleted');
    } catch (error) {
      console.error('Failed to delete exam result:', error);
      toast.error('Failed to delete exam result');
    } finally {
      setDeletingExamId(null);
    }
  };

  const openInfoEditor = () => {
    if (!student) return;
    setInfoForm({
      name: student.name || '',
      phone: student.phone || '',
      dateOfBirth: toDateInputValue(student.dateOfBirth),
      raausId: student.raausId || '',
      membershipExpiry: toDateInputValue(student.licenceExpiry),
      medicalType: student.medicalType || '',
      medicalExpiry: toDateInputValue(student.medicalExpiry),
      casaArn: student.casaId || '',
      emergencyContactName: student.emergencyContact?.name || '',
      emergencyContactPhone: student.emergencyContact?.phone || '',
      emergencyContactRelationship: student.emergencyContact?.relationship || '',
      endorsements: student.endorsements || [],
    });
    setInfoEndorsementDraft({
      type: '',
      dateObtained: '',
      expiryDate: '',
      isActive: true,
    });
    setShowInfoEditor(true);
  };

  const updateInfoField = (field: keyof StudentInfoForm, value: string) => {
    setInfoForm(prev => ({ ...prev, [field]: value }));
  };

  const addInfoEndorsement = () => {
    if (!infoEndorsementDraft.type.trim()) {
      toast.error('Select or enter an endorsement type');
      return;
    }

    if (!infoEndorsementDraft.dateObtained) {
      toast.error('Select the endorsement obtained date');
      return;
    }

    const nextType = infoEndorsementDraft.type.trim();
    const duplicate = infoForm.endorsements.some((endorsement) =>
      endorsement.type.trim().toLowerCase() === nextType.toLowerCase() &&
      endorsement.isActive === infoEndorsementDraft.isActive
    );

    if (duplicate) {
      toast.error('That endorsement is already on this member');
      return;
    }

    setInfoForm((prev) => ({
      ...prev,
      endorsements: [
        ...prev.endorsements,
        {
          id: `info-endorsement-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: nextType,
          dateObtained: new Date(infoEndorsementDraft.dateObtained),
          expiryDate: infoEndorsementDraft.expiryDate ? new Date(infoEndorsementDraft.expiryDate) : undefined,
          isActive: infoEndorsementDraft.isActive,
        },
      ],
    }));

    setInfoEndorsementDraft({
      type: '',
      dateObtained: '',
      expiryDate: '',
      isActive: true,
    });
    toast.success('Endorsement added');
  };

  const removeInfoEndorsement = (endorsementId: string) => {
    setInfoForm((prev) => ({
      ...prev,
      endorsements: prev.endorsements.filter((endorsement) => endorsement.id !== endorsementId),
    }));
    toast.success('Endorsement removed');
  };

  const saveStudentInfo = async () => {
    if (!student || !canEditStudentInfo) return;
    setSavingInfo(true);

    try {
      const { data: updatedUsers, error: userError } = await supabase
        .from('users')
        .update({
          name: infoForm.name.trim() || student.name,
          phone: infoForm.phone.trim() || null,
        })
        .eq('id', student.id)
        .select('id');

      if (userError) throw userError;
      if (!updatedUsers || updatedUsers.length === 0) {
        throw new Error('You do not have permission to update this member.');
      }

      const studentPayload = {
          raaus_id: infoForm.raausId.trim() || null,
          licence_expiry: infoForm.membershipExpiry || null,
          medical_type: infoForm.medicalType.trim() || null,
          medical_expiry: infoForm.medicalExpiry || null,
          casa_id: infoForm.casaArn.trim() || null,
          date_of_birth: infoForm.dateOfBirth || null,
          emergency_contact_name: infoForm.emergencyContactName.trim() || null,
          emergency_contact_phone: infoForm.emergencyContactPhone.trim() || null,
          emergency_contact_relationship: infoForm.emergencyContactRelationship.trim() || null,
      };

      const { data: updatedStudentRows, error: studentUpdateError } = await supabase
        .from('students')
        .update(studentPayload)
        .eq('id', student.id)
        .select('id');

      if (studentUpdateError) throw studentUpdateError;

      if (!updatedStudentRows || updatedStudentRows.length === 0) {
        const { error: studentInsertError } = await supabase
          .from('students')
          .insert({ id: student.id, ...studentPayload });

        if (studentInsertError) throw studentInsertError;
      }

      const { error: deleteEndorsementsError } = await supabase
        .from('endorsements')
        .delete()
        .eq('student_id', student.id);

      if (deleteEndorsementsError) throw deleteEndorsementsError;

      if (infoForm.endorsements.length > 0) {
        const endorsementsToInsert = infoForm.endorsements.map((endorsement) => ({
          student_id: student.id,
          type: endorsement.type,
          date_obtained: toDateInputValue(endorsement.dateObtained) || null,
          expiry_date: toDateInputValue(endorsement.expiryDate) || null,
          instructor_id: endorsement.instructorId || user?.id || null,
          is_active: endorsement.isActive,
        }));

        const { error: endorsementsError } = await supabase
          .from('endorsements')
          .insert(endorsementsToInsert);

        if (endorsementsError) throw endorsementsError;
      }

      await reconcilePilotStatusForUser({
        userId: student.id,
        endorsements: infoForm.endorsements,
        pilotStatusEndorsementTypes: trainingSettings.pilotStatusEndorsementTypes,
        currentRole: student.role,
        currentRoles: student.roles,
      });

      await refetchStudents();
      setShowInfoEditor(false);
      toast.success('Student information updated');
    } catch (error) {
      console.error('Failed to update student information:', error);
      toast.error(`Failed to update student information: ${getErrorMessage(error, 'Unknown error')}`);
    } finally {
      setSavingInfo(false);
    }
  };

  const handleAddTopUp = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!student || !canManageBilling) return;
    const amount = Number(topUpAmount);
    const topUpIncrement = billing.minimumPrepaidPack ?? 1000;
    if (!Number.isFinite(amount) || amount < topUpIncrement || amount % topUpIncrement !== 0) {
      toast.error(`Top-ups must be made in $${topUpIncrement.toFixed(currencyDecimals)} increments.`);
      return;
    }

    setSavingTopUp(true);
    try {
      await billing.addTopUp(
        student.id,
        amount,
        topUpDescription.trim() || 'Account top-up',
        topUpPaymentMethodId || undefined,
        topUpDate,
        { autoVerify: true }
      );
      setTopUpAmount('');
      setTopUpDescription('Account top-up');
      await refetchStudents();
    } finally {
      setSavingTopUp(false);
    }
  };

  const handleVerifyTopUp = async (transactionId: string) => {
    setBillingActionId(transactionId);
    try {
      await billing.verifyTransaction(transactionId);
      await refetchStudents();
    } finally {
      setBillingActionId(null);
    }
  };

  const loading = studentsLoading;
  const recordsLoading = trainingRecordsLoading;

  const handleAddTrainingRecord = () => {
    if (!student?.id) return;
    toast('Opening a draft training record. You can attach it to a flight log later.');
    navigate(`/training/outstanding-records?draftStudentId=${encodeURIComponent(student.id)}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'submitted':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'locked':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const formatDecimalTime = (minutes: number) => {
    return (minutes / 60).toFixed(1);
  };

  const getBookingDateTime = (record: TrainingRecord) => record.bookingStartTime || record.date;

  const formatBookingDateTime = (record: TrainingRecord) =>
    getBookingDateTime(record).toLocaleString('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const canAddRecord = hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']);
  const canEditRecord = (record: TrainingRecord) => {
    if (!user) return false;
    return hasAnyRole(user, ['admin']) || (
      hasAnyRole(user, ['instructor', 'senior_instructor']) && record.instructorId === user.id
    );
  };

  const getRecordCourse = (record: TrainingRecord) => trainingCourses.find(course => course.id === record.courseId);

  const normaliseLessonLookupText = (value?: string) =>
    (value || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const getRecordLesson = (record: TrainingRecord) => {
    const course = getRecordCourse(record);
    if (!course) return undefined;

    const byId = course.lessons.find(lesson => lesson.id === record.lessonId);
    if (byId) return byId;

    const recordCodes = record.lessonCodes || [];
    const exactCode = course.lessons.find(lesson =>
      recordCodes.some(code => code === lesson.sequenceCode)
    );
    if (exactCode) return exactCode;

    const lookupValues = recordCodes.map(normaliseLessonLookupText).filter(Boolean);
    const aliases: Record<string, string[]> = {
      tif: ['trial instruction flight', 'trial instructional flight', 'trial flight'],
      circuits: ['circuit introduction', 'circuits', 'circuits continued'],
      'medium turns': ['turning', 'basic turning', 'medium turns'],
      'climbing turns': ['turning', 'basic turning', 'climbing turns'],
      'flight test': ['pilot certificate flight test', 'rpc flight test'],
    };

    return course.lessons.find(lesson => {
      const lessonTexts = [
        lesson.sequenceCode,
        lesson.name,
        lesson.sequenceTitle,
      ].map(normaliseLessonLookupText).filter(Boolean);

      return lookupValues.some(value => {
        const expanded = [value, ...(aliases[value] || []).map(normaliseLessonLookupText)];
        return expanded.some(candidate =>
          lessonTexts.some(lessonText =>
            lessonText === candidate ||
            lessonText.includes(candidate) ||
            candidate.includes(lessonText)
          )
        );
      });
    });
  };

  const getRecordLessonDisplay = (record: TrainingRecord) => {
    const lesson = getRecordLesson(record);
    if (lesson) {
      return {
        title: lesson.name || lesson.sequenceTitle || lesson.sequenceCode || 'Lesson not recorded',
        code: lesson.sequenceCode || record.lessonCodes.join(', '),
      };
    }

    const recordedLesson = (record.lessonCodes || []).filter(Boolean).join(', ');
    return {
      title: recordedLesson || 'Lesson not recorded',
      code: recordedLesson,
    };
  };

  const getNextLessonFromAssessment = (
    record: TrainingRecord,
    criteriaGrades: Record<string, string>
  ) => {
    const course = getRecordCourse(record);
    const lesson = getRecordLesson(record);
    if (!course || !lesson) return record.nextLesson || '';

    const lessonIndex = course.lessons.findIndex(courseLesson => courseLesson.id === lesson.id);
    const nextLesson = lessonIndex >= 0 ? course.lessons[lessonIndex + 1] : undefined;
    const passed = course.assessmentCriteria.length > 0 && course.assessmentCriteria.every(criterion => {
      const grade = criteriaGrades[criterion.id] || '-';
      const passMark = lesson.passMarks?.[criterion.id] ?? '-';
      return isGradeAtLeastTarget(grade, passMark, criterion.gradingSystem);
    });

    if (passed) {
      const consecutiveReadiness = getConsecutivePassReadiness({
        course,
        records: trainingRecords,
        studentId: record.studentId,
        lesson,
        currentRecordGrades: criteriaGrades,
        excludeRecordId: record.id,
      });
      if (consecutiveReadiness.blocked) {
        return lesson.name || lesson.sequenceTitle || 'Repeat current lesson';
      }

      const readiness = getTwoOccasionReadiness({
        course,
        records: trainingRecords,
        studentId: record.studentId,
        nextLesson,
        currentRecordGrades: criteriaGrades,
        excludeRecordId: record.id,
      });
      if (readiness.blocked) {
        return lesson.name || lesson.sequenceTitle || 'Repeat current lesson';
      }
      return nextLesson?.name || nextLesson?.sequenceTitle || 'Course complete';
    }

    return lesson.name || lesson.sequenceTitle || 'Repeat current lesson';
  };

  const createId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  const openTrainingRecordEditor = (record: TrainingRecord) => {
    if (!canEditRecord(record)) return;
    setEditingTrainingRecord(record);
    setCommentCleanupOriginal(null);
    setTrainingEditForm({
      comments: record.comments || '',
      briefingComments: record.briefingComments || '',
      formalBriefing: record.formalBriefing,
      nextLesson: record.nextLesson || '',
      criteriaGrades: { ...(record.criteriaGrades || {}) },
      isFlightReview: Boolean(record.isFlightReview),
      flightReviewType: record.flightReviewType || 'Flight Review',
      flightReviewResult: record.flightReviewResult || 'not_assessed',
      flightReviewNotes: record.flightReviewNotes || '',
    });
  };

  const handleCleanupTrainingEditComments = async (mode: CommentCleanupMode) => {
    if (!editingTrainingRecord || !trainingEditForm) return;
    if (!trainingEditForm.comments.trim()) {
      toast.error('Write lesson comments before using AI cleanup');
      return;
    }

    setCommentCleanupLoading(mode);
    try {
      const lesson = getRecordLesson(editingTrainingRecord);
      const course = getRecordCourse(editingTrainingRecord);
      const rewritten = await cleanupInstructorComment(trainingEditForm.comments, {
        studentName: student?.name,
        lessonName: lesson?.name || lesson?.sequenceTitle,
        lessonCode: lesson?.sequenceCode || editingTrainingRecord.lessonCodes.join(', '),
        courseName: course?.title,
        aircraft: editingTrainingRecord.registration,
        date: formatBookingDateTime(editingTrainingRecord),
      }, mode);
      setCommentCleanupOriginal(trainingEditForm.comments);
      setTrainingEditForm(form => form ? { ...form, comments: rewritten } : form);
      toast.success(mode === 'readability' ? 'Lesson comments rewritten for readability' : 'Lesson comments grammar cleaned up');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI comment cleanup failed');
    } finally {
      setCommentCleanupLoading(null);
    }
  };

  const handleRevertTrainingEditComments = () => {
    if (commentCleanupOriginal === null) return;
    setTrainingEditForm(form => form ? { ...form, comments: commentCleanupOriginal } : form);
    setCommentCleanupOriginal(null);
  };

  const describeTrainingRecordChanges = (
    record: TrainingRecord,
    form: TrainingRecordEditForm
  ) => {
    const course = getRecordCourse(record);
    const changes: string[] = [];
    const calculatedNextLesson = getNextLessonFromAssessment(record, form.criteriaGrades);

    if ((record.comments || '').trim() !== form.comments.trim()) {
      changes.push('Lesson comments changed');
    }
    if ((record.briefingComments || '').trim() !== form.briefingComments.trim()) {
      changes.push('Briefing comments changed');
    }
    if (record.formalBriefing !== form.formalBriefing) {
      changes.push(`Formal briefing changed to ${form.formalBriefing ? 'Yes' : 'No'}`);
    }
    if ((record.nextLesson || '').trim() !== calculatedNextLesson.trim()) {
      changes.push(`Next lesson changed from "${record.nextLesson || 'Not set'}" to "${calculatedNextLesson || 'Not set'}"`);
    }
    if ((record.flightReviewResult || 'not_assessed') !== form.flightReviewResult) {
      changes.push(`Flight review result changed to ${form.flightReviewResult.replace('_', ' ')}`);
    }

    const criteriaIds = new Set([
      ...Object.keys(record.criteriaGrades || {}),
      ...Object.keys(form.criteriaGrades || {}),
    ]);
    criteriaIds.forEach(criterionId => {
      const before = record.criteriaGrades?.[criterionId] || '-';
      const after = form.criteriaGrades?.[criterionId] || '-';
      if (before !== after) {
        const criterionName = course?.assessmentCriteria.find(criterion => criterion.id === criterionId)?.name || 'Assessment criterion';
        changes.push(`${criterionName} changed from ${before} to ${after}`);
      }
    });

    return changes;
  };

  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const handleAcknowledge = useCallback(async (recordId: string) => {
    if (!student) return;
    const acknowledgementTime = new Date();
    setAcknowledgingId(recordId);
    try {
      await updateTrainingRecord(recordId, {
        studentAck: true,
        studentAckName: student.name,
        studentAckTimestamp: acknowledgementTime,
        status: trainingSettings.lockRecordAfterStudentAck ? 'locked' : 'submitted',
      });
      toast.success('Record acknowledged');
    } catch {
      // error already toasted
    } finally {
      setAcknowledgingId(null);
    }
  }, [student, studentTrainingRecords, trainingSettings.lockRecordAfterStudentAck, updateTrainingRecord]);

  const handleSaveTrainingRecordEdit = async () => {
    if (!editingTrainingRecord || !trainingEditForm || !user || !canEditRecord(editingTrainingRecord)) return;

    const changes = describeTrainingRecordChanges(editingTrainingRecord, trainingEditForm);
    if (changes.length === 0) {
      toast('No changes to save');
      return;
    }

    const courseRequiresAck = Boolean(
      trainingSettings.forceStudentAcknowledgementForAllCourses ||
      getRecordCourse(editingTrainingRecord)?.requiresStudentAcknowledgement
    );
    const wasAcknowledged = editingTrainingRecord.studentAck && courseRequiresAck;
    const calculatedNextLesson = getNextLessonFromAssessment(editingTrainingRecord, trainingEditForm.criteriaGrades);
    const isCourseDefinedTestFlight = Boolean(getRecordLesson(editingTrainingRecord)?.isFlightTest);
    const keepLegacyFlightReview = Boolean(editingTrainingRecord.isFlightReview && !isCourseDefinedTestFlight);
    const isFlightReviewRecord = isCourseDefinedTestFlight || keepLegacyFlightReview;
    const updatedAuditLog = [
      ...(editingTrainingRecord.auditLog || []),
      {
        id: createId(),
        timestamp: new Date(),
        userId: user.id,
        userName: user.name || user.email || 'Unknown user',
        action: wasAcknowledged ? 'record_revised_after_student_acknowledgement' : 'record_updated',
        changes: {
          summary: changes,
          studentAcknowledgementRequired: wasAcknowledged,
        },
      },
    ];

    setSavingTrainingRecord(true);
    try {
      await updateTrainingRecord(editingTrainingRecord.id, {
        comments: trainingEditForm.comments.trim(),
        briefingComments: trainingEditForm.briefingComments.trim(),
        formalBriefing: trainingEditForm.formalBriefing,
        nextLesson: calculatedNextLesson,
        criteriaGrades: trainingEditForm.criteriaGrades,
        isFlightReview: isFlightReviewRecord,
        flightReviewType: isFlightReviewRecord ? (trainingEditForm.flightReviewType.trim() || (isCourseDefinedTestFlight ? 'Flight Test' : 'Flight Review')) : '',
        flightReviewResult: isFlightReviewRecord ? trainingEditForm.flightReviewResult : undefined,
        flightReviewNotes: isFlightReviewRecord ? trainingEditForm.flightReviewNotes.trim() : '',
        auditLog: updatedAuditLog,
        ...(wasAcknowledged ? {
          status: 'submitted' as const,
          studentAck: false,
          studentAckName: null,
          studentAckTimestamp: null,
        } : {}),
      } as Partial<Omit<TrainingRecord, 'id' | 'sequences'>>);

      if (wasAcknowledged) {
        await supabase.from('notifications').insert({
          user_id: editingTrainingRecord.studentId,
          type: 'training_record',
          title: 'Training record changed - review required',
          message: `${user.name || 'An instructor'} updated a training record you had already acknowledged. Changes: ${changes.join('; ')}.`,
          is_read: false,
          metadata: {
            student_id: editingTrainingRecord.studentId,
            training_record_id: editingTrainingRecord.id,
            change_summary: changes.join('; '),
          },
        });
      }

      setEditingTrainingRecord(null);
      setTrainingEditForm(null);
      await refetchStudents();
      toast.success(wasAcknowledged ? 'Record updated and sent back to the student for approval' : 'Training record updated');
    } catch (error) {
      console.error('Failed to update training record:', error);
    } finally {
      setSavingTrainingRecord(false);
    }
  };

  // Apply filters to training records
  const filteredRecords = studentTrainingRecords.filter(record => {
    const startDate = dateFilter.start ? new Date(dateFilter.start) : null;
    const endDate = dateFilter.end ? new Date(dateFilter.end) : null;
    const bookingDate = getBookingDateTime(record);
    const matchesCourse = !selectedTrainingCourseId || record.courseId === selectedTrainingCourseId;
    const matchesDateRange = (!startDate || bookingDate >= startDate) &&
                            (!endDate || bookingDate <= endDate);
    const matchesAircraft = !aircraftFilter || record.registration === aircraftFilter;
    const matchesInstructor = !instructorFilter || record.instructorId === instructorFilter;

    return matchesCourse && matchesDateRange && matchesAircraft && matchesInstructor;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) =>
    getBookingDateTime(b).getTime() - getBookingDateTime(a).getTime()
  );
  const selectedCourseHasSyllabusMatrix = selectedMatrixRequirements.length > 0;
  const selectedCourseMatrixSummary = useMemo(() => {
    if (!selectedCourseHasSyllabusMatrix) {
      return null;
    }

    const items = selectedMatrixRequirements
      .map(requirement => {
        const row = selectedMatrixRowsById.get(requirement.matrixRowId);
        const achieved = selectedBestMatrixAssessmentByRow.get(requirement.matrixRowId)?.achievedStandard;
        const meetsRequirement = matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
        return { requirement, row, achieved, meetsRequirement };
      })
      .filter(item => item.row)
      .sort((a, b) =>
        a.requirement.lessonSequenceCode.localeCompare(b.requirement.lessonSequenceCode, undefined, { numeric: true }) ||
        (a.row?.sortOrder ?? 0) - (b.row?.sortOrder ?? 0)
      );

    const metItems = items.filter(item => item.meetsRequirement);
    const outstandingItems = items.filter(item => !item.meetsRequirement);
    const standardOneOutstanding = outstandingItems.filter(item => item.requirement.requiredStandard === 1).length;
    const byLesson = new Map<string, {
      lessonCode: string;
      lessonTitle: string;
      total: number;
      outstanding: number;
      items: typeof outstandingItems;
    }>();

    items.forEach(item => {
      const key = item.requirement.lessonSequenceCode;
      const current = byLesson.get(key) ?? {
        lessonCode: key,
        lessonTitle: item.requirement.lessonColumnTitle,
        total: 0,
        outstanding: 0,
        items: [],
      };
      current.total += 1;
      if (!item.meetsRequirement) {
        current.outstanding += 1;
        current.items.push(item);
      }
      byLesson.set(key, current);
    });

    return {
      totalCount: items.length,
      metCount: metItems.length,
      outstandingCount: outstandingItems.length,
      standardOneOutstanding,
      percentage: items.length > 0 ? Math.round((metItems.length / items.length) * 100) : 0,
      byLesson: Array.from(byLesson.values())
        .filter(group => group.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding || a.lessonCode.localeCompare(b.lessonCode, undefined, { numeric: true })),
    };
  }, [
    selectedBestMatrixAssessmentByRow,
    selectedCourseHasSyllabusMatrix,
    selectedMatrixRequirements,
    selectedMatrixRowsById,
  ]);

  const matrixAssessmentMeetsRequirement = useCallback((
    achieved?: number,
    required?: number
  ) => {
    if (!required) {
      return Boolean(achieved);
    }
    return matrixStandardMeetsRequirement(achieved as 1 | 2 | 3 | undefined, required as 1 | 2 | 3 | undefined);
  }, []);

  const getRecordMatrixAssessmentSummary = useCallback((record: TrainingRecord) => {
    const recordAssessments = selectedMatrixAssessments.filter(
      assessment => assessment.trainingRecordId === record.id
    );

    if (recordAssessments.length === 0) {
      return null;
    }

    const lessonCodes = new Set(record.lessonCodes || []);
    const items = recordAssessments
      .map(assessment => {
        const row = selectedMatrixRowsById.get(assessment.matrixRowId);
        const requirement = selectedMatrixRequirements.find(req =>
          req.matrixRowId === assessment.matrixRowId &&
          (
            (assessment.lessonId && req.lessonId === assessment.lessonId) ||
            (record.lessonId && req.lessonId === record.lessonId) ||
            lessonCodes.has(req.lessonSequenceCode)
          )
        ) || selectedMatrixRequirements.find(req => req.matrixRowId === assessment.matrixRowId);
        const currentBestAssessment = selectedBestMatrixAssessmentByRow.get(assessment.matrixRowId);
        const attemptMeetsRequirement = matrixAssessmentMeetsRequirement(assessment.achievedStandard, requirement?.requiredStandard);
        const currentMeetsRequirement = matrixAssessmentMeetsRequirement(currentBestAssessment?.achievedStandard, requirement?.requiredStandard);

        return {
          assessment,
          row,
          requirement,
          currentBestAssessment,
          attemptMeetsRequirement,
          meetsRequirement: currentMeetsRequirement,
          resolvedLater: !attemptMeetsRequirement &&
            currentMeetsRequirement &&
            Boolean(currentBestAssessment?.trainingRecordId) &&
            currentBestAssessment?.trainingRecordId !== record.id,
        };
      })
      .filter(item => item.row)
      .sort((a, b) => (a.row?.sortOrder ?? 0) - (b.row?.sortOrder ?? 0));

    if (items.length === 0) {
      return null;
    }

    const metCount = items.filter(item => item.meetsRequirement).length;
    const attemptMetCount = items.filter(item => item.attemptMeetsRequirement).length;
    const notMetItems = items.filter(item => !item.meetsRequirement);
    const attemptNotMetItems = items.filter(item => !item.attemptMeetsRequirement);
    const resolvedLaterItems = items.filter(item => item.resolvedLater);
    const unassessedCount = items.filter(item => !item.currentBestAssessment?.achievedStandard).length;
    const attemptUnassessedCount = items.filter(item => !item.assessment.achievedStandard).length;

    return {
      items,
      notMetItems,
      attemptNotMetItems,
      resolvedLaterItems,
      metCount,
      attemptMetCount,
      unassessedCount,
      attemptUnassessedCount,
      totalCount: items.length,
    };
  }, [matrixAssessmentMeetsRequirement, selectedBestMatrixAssessmentByRow, selectedMatrixAssessments, selectedMatrixRequirements, selectedMatrixRowsById]);
  const toggleRecordMatrix = useCallback((recordId: string) => {
    setExpandedRecordMatrixIds(current => {
      const next = new Set(current);
      if (next.has(recordId)) {
        next.delete(recordId);
      } else {
        next.add(recordId);
      }
      return next;
    });
  }, []);
  const filteredTotalMinutes = filteredRecords.reduce((sum, record) => sum + record.dualTimeMin + record.soloTimeMin, 0);
  const filteredPendingAck = filteredRecords.filter(record => record.status === 'submitted' && !record.studentAck).length;
  const latestFilteredBooking = sortedRecords[0] ? getBookingDateTime(sortedRecords[0]) : null;
  const hasTrainingFilters = Boolean(dateFilter.start || dateFilter.end || aircraftFilter || instructorFilter);
  const clearTrainingFilters = () => {
    setDateFilter({ start: '', end: '' });
    setAircraftFilter('');
    setInstructorFilter('');
  };

  const tabs = useMemo(() => [
    { id: 'profile', label: 'Overview', icon: <User className="h-4 w-4" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
    { id: 'logbook', label: 'Logbook', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'training', label: 'Pilot File', icon: <FileText className="h-4 w-4" /> },
    { id: 'exams', label: 'Exams', icon: <Award className="h-4 w-4" /> },
    { id: 'courses', label: 'Courses', icon: <GraduationCap className="h-4 w-4" /> },
    { id: 'billing', label: 'Billing', icon: <Wallet className="h-4 w-4" /> },
    { id: 'safety', label: 'Safety', icon: <Shield className="h-4 w-4" /> },
    { id: 'timeline', label: 'Timeline', icon: <History className="h-4 w-4" /> },
  ].filter(tab => {
    if (!isOwnStudentPortal) return true;
    if (tab.id === 'profile' || tab.id === 'timeline' || tab.id === 'exams' || tab.id === 'courses') return false;
    if (!portalSettings.show_progress_tracking && (tab.id === 'training' || tab.id === 'courses' || tab.id === 'exams')) return false;
    if (!portalSettings.show_invoices_in_portal && tab.id === 'billing') return false;
    return true;
  }), [isOwnStudentPortal, portalSettings.show_invoices_in_portal, portalSettings.show_progress_tracking]);

  const trainingSubtabs = useMemo(() => [
    { id: 'training', label: 'Training Records' },
    { id: 'exams', label: 'Exams' },
    { id: 'courses', label: 'Courses' },
  ], []);

  useEffect(() => {
    if (isOwnStudentPortal && portalSection) return;
    if (!tabs.some(tab => tab.id === activeTab)) {
      handleTabChange(tabs[0]?.id || 'training');
    }
  }, [activeTab, isOwnStudentPortal, portalSection, tabs]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <div className="h-6 bg-gray-200 rounded mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-2">
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-gray-900 mb-2">Student not found</h3>
          <button
            onClick={() => navigate('/students')}
            className="text-blue-600 hover:text-blue-800"
          >
            Return to students list
          </button>
        </div>
      </div>
    );
  }

  const totalDualTime = studentTrainingRecords.reduce((sum, record) => sum + record.dualTimeMin, 0);
  const totalSoloTime = studentTrainingRecords.reduce((sum, record) => sum + record.soloTimeMin, 0);
  const totalFlightTime = totalDualTime + totalSoloTime;
  const lastFlightDate = studentTrainingRecords.length > 0
    ? new Date(Math.max(...studentTrainingRecords.map(r => r.date.getTime())))
    : null;

  const isExpiryNear = (date?: Date) => {
    if (!date) return false;
    const daysUntilExpiry = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 60;
  };

  const complianceItems = [
    { label: 'Pilot status', value: isPilot ? 'Pilot - solo hire permitted' : 'Student - instructor/approval required', warn: !isPilot },
    { label: 'RAAus membership', value: student.licenceExpiry?.toLocaleDateString() || 'Not recorded', warn: isExpiryNear(student.licenceExpiry) },
    { label: 'Medical', value: student.medicalExpiry?.toLocaleDateString() || 'Not recorded', warn: isExpiryNear(student.medicalExpiry) },
    { label: 'Flight review', value: student.lastFlightReview ? new Date(student.lastFlightReview).toLocaleDateString() : 'Not recorded', warn: false },
    { label: 'Endorsements', value: `${student.endorsements.filter(e => e.isActive).length} active`, warn: false },
  ];

  const currencyDecimals = portalSettings.currency_decimals ?? 2;
  const formatCurrency = (amount: number) => `$${amount.toFixed(currencyDecimals)}`;
  const billingAccount = billing.pilotAccounts.find(account => account.userId === student.id);
  const accountBalance = billingAccount?.balance ?? 0;
  const billingTransactions = billing.transactions
    .filter(transaction => transaction.userId === student.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const unpaidFlights = billing.unpaidFlights
    .filter(flight => flight.userId === student.id)
    .sort((a, b) => new Date(b.flightDate).getTime() - new Date(a.flightDate).getTime());
  const pendingTopUps = billingTransactions.filter(transaction => transaction.type === 'topup' && transaction.verifiedStatus === 'pending');
  const verifiedTopUps = billingTransactions.filter(transaction => transaction.type === 'topup' && transaction.verifiedStatus === 'verified')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const flightCharges = billingTransactions.filter(transaction => transaction.type === 'flight_charge')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const transactionSignedAmount = (type: string, amount: number) =>
    type === 'topup' || type === 'refund' ? amount : -amount;
  const transactionLabel = (type: string) => type.replace('_', ' ');

  const formatTimelineDate = (date: Date | null) => date
    ? date.toLocaleString('en-AU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'No date recorded';

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const timelineEvents: ProfileTimelineEvent[] = [
    {
      id: 'student-file',
      date: null,
      title: `${isPilot ? 'Pilot' : 'Student'} file available`,
      description: [student.email, student.phone].filter(Boolean).join(' | ') || 'Contact details not recorded',
      kind: 'Profile',
      badge: isPilot ? 'Pilot' : 'Student',
      colorClass: 'bg-blue-600',
    },
  ];

  if (student.lastFlightReview) {
    timelineEvents.push({
      id: 'last-flight-review',
      date: new Date(student.lastFlightReview),
      title: 'Current flight review recorded',
      description: isPilot ? 'Pilot compliance snapshot is using this review date.' : 'Review date is recorded on the profile.',
      kind: 'Compliance',
      badge: 'Review',
      colorClass: 'bg-indigo-600',
    });
  }

  if (student.licenceExpiry) {
    timelineEvents.push({
      id: 'raaus-expiry',
      date: new Date(student.licenceExpiry),
      title: 'RAAus membership expiry',
      description: student.raausId ? `Membership ${student.raausId}` : 'Membership number not recorded',
      kind: 'Compliance',
      badge: student.licenceExpiry >= todayStart ? 'Upcoming' : 'Expired',
      colorClass: student.licenceExpiry >= todayStart ? 'bg-amber-500' : 'bg-red-600',
      isFuture: student.licenceExpiry >= todayStart,
    });
  }

  if (student.medicalExpiry) {
    timelineEvents.push({
      id: 'medical-expiry',
      date: new Date(student.medicalExpiry),
      title: 'Medical expiry',
      description: student.medicalType || 'Medical type not recorded',
      kind: 'Compliance',
      badge: student.medicalExpiry >= todayStart ? 'Upcoming' : 'Expired',
      colorClass: student.medicalExpiry >= todayStart ? 'bg-amber-500' : 'bg-red-600',
      isFuture: student.medicalExpiry >= todayStart,
    });
  }

  studentTrainingRecords.forEach(record => {
    const lesson = getRecordLesson(record);
    const course = getRecordCourse(record);
    const instructor = users.find(u => u.id === record.instructorId);
    const recordMinutes = record.dualTimeMin + record.soloTimeMin;
    const title = record.isFlightReview
      ? `${record.flightReviewType || 'Flight review'}${record.flightReviewResult === 'pass' ? ' passed' : record.flightReviewResult === 'fail' ? ' not passed' : ''}`
      : lesson?.name || lesson?.sequenceTitle || record.lessonCodes.join(', ') || 'Training record';
    const statusText = record.status === 'submitted' && !record.studentAck
      ? 'Awaiting student acknowledgement'
      : record.status === 'locked'
        ? 'Locked'
        : record.status.charAt(0).toUpperCase() + record.status.slice(1);

    timelineEvents.push({
      id: `training-${record.id}`,
      date: getBookingDateTime(record),
      title,
      description: [
        course?.title,
        instructor?.name ? `Instructor: ${instructor.name}` : null,
        `${record.registration || 'No aircraft'}${record.aircraftType ? ` (${record.aircraftType})` : ''}`,
        recordMinutes > 0 ? `${formatDecimalTime(recordMinutes)} hrs` : null,
      ].filter(Boolean).join(' | '),
      kind: record.isFlightReview ? 'Flight Review' : 'Training',
      badge: statusText,
      colorClass: record.isFlightReview
        ? (record.flightReviewResult === 'fail' ? 'bg-red-600' : 'bg-purple-600')
        : (record.status === 'submitted' && !record.studentAck ? 'bg-amber-500' : 'bg-emerald-600'),
    });

    if (record.instructorSignTimestamp) {
      timelineEvents.push({
        id: `training-submitted-${record.id}`,
        date: record.instructorSignTimestamp,
        title: `Lesson record added: ${title}`,
        description: [
          instructor?.name ? `Added by ${instructor.name}` : 'Added by instructor',
          course?.title,
          record.registration || null,
        ].filter(Boolean).join(' | '),
        kind: 'Record Added',
        badge: 'Submitted',
        colorClass: 'bg-blue-600',
      });
    }

    (record.auditLog || []).forEach(entry => {
      const summary = Array.isArray(entry.changes?.summary)
        ? entry.changes.summary.join('; ')
        : typeof entry.changes?.summary === 'string'
          ? entry.changes.summary
          : '';
      const isRevisionAfterAck = entry.action === 'record_revised_after_student_acknowledgement';
      const isStudentAck = entry.action === 'student_acknowledged_record' || entry.action === 'student_acknowledged_revised_record';

      if (isRevisionAfterAck || entry.action === 'record_updated') {
        timelineEvents.push({
          id: `training-audit-${record.id}-${entry.id}`,
          date: entry.timestamp,
          title: `${isRevisionAfterAck ? 'Acknowledged lesson edited' : 'Lesson record edited'}: ${title}`,
          description: [
            entry.userName ? `Edited by ${entry.userName}` : 'Edited by instructor',
            summary || 'Record details updated',
          ].join(' | '),
          kind: 'Record Edit',
          badge: isRevisionAfterAck ? 'Student review required' : 'Edited',
          colorClass: isRevisionAfterAck ? 'bg-amber-500' : 'bg-sky-600',
        });
      }

      if (isStudentAck) {
        timelineEvents.push({
          id: `training-ack-audit-${record.id}-${entry.id}`,
          date: entry.timestamp,
          title: entry.action === 'student_acknowledged_revised_record'
            ? `Student acknowledged changes: ${title}`
            : `Student acknowledged lesson: ${title}`,
          description: [
            entry.userName ? `Acknowledged by ${entry.userName}` : 'Acknowledged by student',
            course?.title,
          ].filter(Boolean).join(' | '),
          kind: 'Acknowledgement',
          badge: entry.action === 'student_acknowledged_revised_record' ? 'Changes accepted' : 'Acknowledged',
          colorClass: 'bg-emerald-600',
        });
      }
    });

    const hasAckAuditEvent = (record.auditLog || []).some(entry =>
      entry.action === 'student_acknowledged_record' || entry.action === 'student_acknowledged_revised_record'
    );
    if (record.studentAckTimestamp && !hasAckAuditEvent) {
      const latestRevisionBeforeAck = (record.auditLog || [])
        .filter(entry =>
          entry.action === 'record_revised_after_student_acknowledgement' &&
          entry.timestamp.getTime() <= record.studentAckTimestamp!.getTime()
        )
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      timelineEvents.push({
        id: `training-ack-${record.id}`,
        date: record.studentAckTimestamp,
        title: latestRevisionBeforeAck
          ? `Student acknowledged changes: ${title}`
          : `Student acknowledged lesson: ${title}`,
        description: [
          record.studentAckName ? `Acknowledged by ${record.studentAckName}` : 'Acknowledged by student',
          course?.title,
        ].filter(Boolean).join(' | '),
        kind: 'Acknowledgement',
        badge: latestRevisionBeforeAck ? 'Changes accepted' : 'Acknowledged',
        colorClass: 'bg-emerald-600',
      });
    }
  });

  studentExamResults.forEach(result => {
    const course = trainingCourses.find(courseItem => courseItem.id === result.courseId);
    timelineEvents.push({
      id: `exam-${result.id}`,
      date: result.examDate,
      title: `Exam: ${result.examName}`,
      description: [
        course?.title,
        `${result.score}% scored, ${result.passMark}% required`,
        result.fileName ? `Evidence: ${result.fileName}` : null,
      ].filter(Boolean).join(' | '),
      kind: 'Exam',
      badge: result.result === 'pass' ? 'Passed' : 'Failed',
      colorClass: result.result === 'pass' ? 'bg-emerald-600' : 'bg-red-600',
    });
  });

  linkedSafetyReports.forEach(report => {
    timelineEvents.push({
      id: `safety-${report.id}`,
      date: report.createdAt,
      title: `Safety report: ${report.title}`,
      description: [
        report.reportType.replace('_', ' '),
        report.severity,
        report.status.replace('_', ' '),
        report.reporterId === student.id ? 'Reported by this person' : 'Involved person',
      ].join(' | '),
      kind: 'Safety',
      badge: report.status.replace('_', ' '),
      colorClass: report.severity === 'critical' || report.severity === 'high' ? 'bg-red-600' : 'bg-orange-500',
    });
  });

  const sortedTimelineEvents = timelineEvents.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.getTime() - a.date.getTime();
  });

  const timelineSummary = {
    training: studentTrainingRecords.length,
    exams: studentExamResults.length,
    safety: linkedSafetyReports.length,
    upcoming: sortedTimelineEvents.filter(event => event.isFuture).length,
  };

  return (
    <div className="p-3 sm:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-4 py-4 text-white shadow-sm sm:mb-6 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center space-x-3 sm:space-x-4">
          <button
            onClick={() => navigate('/students')}
            className="rounded-lg p-2 text-blue-100 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-bold text-white sm:text-2xl">{student.name}</h1>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${isPilot ? 'border-amber-300/30 bg-amber-400/15 text-amber-100' : 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100'}`}>
                {isPilot ? 'Pilot' : 'Student'}
              </span>
            </div>
            <p className="text-blue-100/80">{isPilot ? 'Pilot File' : 'Student File'}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
        {canEditStudentInfo && (
          <button
            onClick={openInfoEditor}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-slate-950 shadow-sm transition-colors hover:bg-blue-50"
          >
            <Edit className="h-4 w-4" />
            Edit Info
          </button>
        )}
        </div>
      </div>

      {!isOwnStudentPortal || !portalSection ? (
        <div className="app-tab-scroller">
          <nav className="app-tab-list">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`app-tab-button ${
                  activeTab === tab.id
                    ? 'app-tab-button-active'
                    : ''
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      ) : null}

      {isOwnStudentPortal && portalSection === 'training' ? (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          {trainingSubtabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                trainingSubtab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Tab Content */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Student Summary */}
          <div className="lg:col-span-1 space-y-6">
            {/* Personal Information */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Personal Information
              </h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Name</label>
                  <p className="text-sm text-gray-900">{student.name}</p>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Email</label>
                  <div className="flex items-center space-x-2">
                    <Mail className="h-3 w-3 text-gray-400" />
                    <p className="text-sm text-gray-900">{student.email}</p>
                  </div>
                </div>
                
                {student.phone && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Phone</label>
                    <div className="flex items-center space-x-2">
                      <Phone className="h-3 w-3 text-gray-400" />
                      <p className="text-sm text-gray-900">{student.phone}</p>
                    </div>
                  </div>
                )}
                
                {student.dateOfBirth && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Date of Birth</label>
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-3 w-3 text-gray-400" />
                      <p className="text-sm text-gray-900">{student.dateOfBirth.toLocaleDateString()}</p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Emergency Contact</label>
                  {student.emergencyContact ? (
                    <div className="text-sm text-gray-900">
                      <p>{student.emergencyContact.name}</p>
                      <p className="text-xs text-gray-600">{student.emergencyContact.phone} ({student.emergencyContact.relationship})</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-900">Not recorded</p>
                  )}
                  </div>
              </div>
            </div>

            {/* Aviation Credentials */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Aviation Credentials</h2>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">RAAus Membership Number</label>
                  <p className="text-sm text-gray-900">{student.raausId || 'Not recorded'}</p>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">CASA ARN</label>
                  <p className="text-sm text-gray-900">{student.casaId || 'Not recorded'}</p>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Medical Certificate</label>
                  <p className="text-sm text-gray-900">{student.medicalType || 'Not recorded'}</p>
                  {student.medicalExpiry && (
                    <p className={`text-xs ${isExpiryNear(student.medicalExpiry) ? 'text-yellow-600' : 'text-gray-500'}`}>
                      Expires: {student.medicalExpiry.toLocaleDateString()}
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">RAAus Membership Expiry</label>
                  <p className={`text-sm ${isExpiryNear(student.licenceExpiry) ? 'text-yellow-600' : 'text-gray-900'}`}>
                    {student.licenceExpiry?.toLocaleDateString() || 'Not recorded'}
                  </p>
                </div>

                {student.lastFlightReview && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Last Flight Review</label>
                    <p className={`text-sm ${(() => {
                      const reviewDate = new Date(student.lastFlightReview);
                      const twoYearsLater = new Date(reviewDate);
                      twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
                      const now = new Date();
                      const threeMonthsBefore = new Date(twoYearsLater);
                      threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);

                      if (now >= twoYearsLater) return 'text-red-600';
                      if (now >= threeMonthsBefore) return 'text-yellow-600';
                      return 'text-gray-900';
                    })()}`}>
                      {(() => {
                        const reviewDate = new Date(student.lastFlightReview);
                        const twoYearsLater = new Date(reviewDate);
                        twoYearsLater.setFullYear(twoYearsLater.getFullYear() + 2);
                        const now = new Date();
                        const threeMonthsBefore = new Date(twoYearsLater);
                        threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);

                        if (now >= twoYearsLater) {
                          return `${reviewDate.toLocaleDateString()} (Overdue)`;
                        }
                        if (now >= threeMonthsBefore) {
                          return `${reviewDate.toLocaleDateString()} (Due ${twoYearsLater.toLocaleDateString()})`;
                        }
                        return reviewDate.toLocaleDateString();
                      })()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Flight Statistics */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Flight Statistics
              </h2>
              
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-blue-900">Total Hours</p>
                  <p className="text-lg font-bold text-blue-600">{formatDecimalTime(totalFlightTime)}</p>
                </div>
                
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-green-900">Dual Time</p>
                  <p className="text-lg font-bold text-green-600">{formatDecimalTime(totalDualTime)}</p>
                </div>
                
                <div className="bg-orange-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-orange-900">Solo Time</p>
                  <p className="text-lg font-bold text-orange-600">{formatDecimalTime(totalSoloTime)}</p>
                </div>
                
                <div className="bg-purple-50 p-3 rounded-lg">
                  <p className="text-xs font-medium text-purple-900">Credit</p>
                  <p className="text-lg font-bold text-purple-600">{formatCurrency(accountBalance)}</p>
                </div>
              </div>
              
              {lastFlightDate && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Last Flight</p>
                  <p className="text-sm text-gray-900">{lastFlightDate.toLocaleDateString()}</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Shield className="h-5 w-5 mr-2" />
                Compliance Snapshot
              </h2>
              <div className="space-y-3">
                {complianceItems.map(item => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-600">{item.label}</span>
                    <span className={`text-sm font-medium ${item.warn ? 'text-amber-700' : 'text-gray-900'}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Endorsements */}
            {student.endorsements.filter(e => e.isActive).length > 0 && (
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Award className="h-5 w-5 mr-2" />
                  Active Endorsements
                </h2>
                
                <div className="space-y-2">
                  {student.endorsements.filter(e => e.isActive).map(endorsement => (
                    <div key={endorsement.id} className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded">
                      <span className="text-sm font-medium text-blue-900">
                        {endorsement.type.toUpperCase()}
                      </span>
                      <span className="text-xs text-blue-700">
                        {endorsement.dateObtained?.toLocaleDateString() || 'N/A'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Additional Profile Info */}
          <div className="lg:col-span-2">
            {(!isOwnStudentPortal || portalSettings.show_progress_tracking) ? (
              <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Training Progress Overview</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-blue-900">Lessons Completed</p>
                  <p className="text-2xl font-bold text-blue-600">{studentTrainingRecords.length}</p>
                </div>

                <div className="bg-green-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-green-900">Competent Sequences</p>
                  <p className="text-2xl font-bold text-green-600">
                    {studentTrainingRecords.reduce((sum, r) => sum + r.sequences.filter(s => s.competence === 'C').length, 0)}
                  </p>
                </div>
                
                <div className="bg-orange-50 p-4 rounded-lg">
                  <p className="text-sm font-medium text-orange-900">
                    {mostAdvancedCourseProgress ? `Progress to ${mostAdvancedCourseProgress.course.title}` : 'Course Progress'}
                  </p>
                  <p className="text-2xl font-bold text-orange-600">
                    {mostAdvancedCourseProgress?.percentage ?? 0}%
                  </p>
                </div>
              </div>

              {studentTrainingRecords.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No training records yet</h3>
                  <p className="text-gray-600 mb-4">This student hasn't completed any training sessions.</p>
                  {canAddRecord && (
                    <button
                      onClick={handleAddTrainingRecord}
                      className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mx-auto"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add First Training Record</span>
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-md font-medium text-gray-900 mb-3">Recent Training Activity</h3>
                  <div className="space-y-3">
                    {studentTrainingRecords.slice(0, 5).map(record => {
                      const instructor = users.find(u => u.id === record.instructorId);
                      return (
                        <div key={record.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {record.date.toLocaleDateString()} - {record.registration}
                            </p>
                            <p className="text-xs text-gray-600">
                              {instructor?.name || 'Unknown'} | {formatDecimalTime(record.dualTimeMin + record.soloTimeMin)}h
                            </p>
                          </div>
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 shadow-md">
                Training progress tracking is not shown in the student portal.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <StudentDocumentsTab student={student} />
      )}

      {activeTab === 'logbook' && student && (
        <LogbookTab
          userId={student.id}
          userName={student.name}
          isInstructor={false}
        />
      )}

      {(activeTab === 'exams' || (activeTab === 'training' && trainingSubtab === 'exams')) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          {hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']) && (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4 sm:p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Award className="h-5 w-5 mr-2" />
                Log Exam
              </h2>
              <div className="space-y-4">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Course</span>
                  <select
                    value={examForm.courseId}
                    onChange={event => setExamForm(form => ({ ...form, courseId: event.target.value, examId: '' }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select course</option>
                    {trainingCourses.filter(course => (course.exams || []).length > 0).map(course => (
                      <option key={course.id} value={course.id}>{course.title}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Exam</span>
                  <select
                    value={examForm.examId}
                    onChange={event => setExamForm(form => ({ ...form, examId: event.target.value }))}
                    disabled={!selectedExamCourse}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  >
                    <option value="">Select exam</option>
                    {(selectedExamCourse?.exams || []).map(exam => (
                      <option key={exam.id} value={exam.id}>{exam.name} - pass {exam.passMark}%</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Score (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={examForm.score}
                      onChange={event => setExamForm(form => ({ ...form, score: event.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Date</span>
                    <input
                      type="date"
                      value={examForm.examDate}
                      onChange={event => setExamForm(form => ({ ...form, examDate: event.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                  <label className="flex items-start gap-3 text-sm text-indigo-950">
                    <input
                      type="checkbox"
                      checked={examForm.kdrCompleted}
                      onChange={event => setExamForm(form => ({ ...form, kdrCompleted: event.target.checked }))}
                      className="mt-1 h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>
                      <span className="block font-semibold">KDR verbally reviewed with student</span>
                      <span className="mt-1 block text-xs text-indigo-700">
                        Store only the marked answer sheet and a short KDR evidence note.
                      </span>
                    </span>
                  </label>
                  <textarea
                    rows={2}
                    value={examForm.kdrNotes}
                    onChange={event => setExamForm(form => ({ ...form, kdrNotes: event.target.value }))}
                    placeholder="Optional KDR note, e.g. reviewed airspace and radio phraseology errors."
                    className="mt-3 w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <label className="block rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 hover:border-blue-300 hover:bg-blue-50">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                    <Upload className="h-4 w-4 text-blue-600" />
                    Upload answer sheet
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    Optional. Attach the student's marked answer sheet, scan, photo or PDF. Do not upload the question paper.
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                    onChange={event => setExamUploadFile(event.target.files?.[0] || null)}
                    className="mt-3 block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-blue-700"
                  />
                  {examUploadFile && (
                    <span className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs text-gray-700">
                      <span className="min-w-0 truncate">{examUploadFile.name}</span>
                      <button
                        type="button"
                        onClick={event => {
                          event.preventDefault();
                          setExamUploadFile(null);
                        }}
                        className="shrink-0 text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </span>
                  )}
                </label>
                {selectedExam && examForm.score && (
                  <div className={`rounded-lg border p-3 text-sm ${Number(examForm.score) >= selectedExam.passMark ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    {Number(examForm.score) >= selectedExam.passMark ? 'Pass' : 'Below pass'} - pass mark {selectedExam.passMark}%
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleLogExam}
                  disabled={savingExam || !selectedExam}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingExam ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Log Exam Result
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Exam History</h2>
              <p className="text-sm text-gray-500 mt-1">Ground exams and theory checks logged against this file.</p>
            </div>
            {loadingExams ? (
              <div className="p-6 text-sm text-gray-500">Loading exams...</div>
            ) : studentExamResults.length === 0 ? (
              <div className="p-10 text-center text-gray-500">
                <Award className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">No exams logged yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {studentExamResults.map(result => {
                  const instructor = users.find(u => u.id === result.instructorId);
                  const course = trainingCourses.find(c => c.id === result.courseId);
                  const canManageThisExam = canManageExamResult(result);
                  return (
                    <div key={result.id} className="px-6 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-gray-900">{result.examName}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {course?.title || 'Course not recorded'} · {result.examDate.toLocaleDateString()} · logged by {instructor?.name || 'Unknown'}
                          </p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${result.result === 'pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'}`}>
                          {result.result === 'pass' ? 'Pass' : 'Fail'} {result.score}% / {result.passMark}%
                        </span>
                      </div>
                      {result.notes && <p className="mt-3 text-sm text-gray-700">{result.notes}</p>}
                      <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                        result.kdrCompleted
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}>
                        <span className="font-semibold">
                          {result.kdrCompleted ? 'KDR verbally reviewed' : 'KDR not marked complete'}
                        </span>
                        {result.kdrSignedOffAt && (
                          <span> · {result.kdrSignedOffAt.toLocaleDateString()}</span>
                        )}
                        {result.kdrNotes && <p className="mt-1 text-gray-700">{result.kdrNotes}</p>}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {result.storagePath && (
                          <button
                            type="button"
                            onClick={() => downloadExamUpload(result)}
                            className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {result.fileName || 'Open exam upload'}
                          </button>
                        )}
                        {canManageThisExam && (
                          <>
                            <button
                              type="button"
                              onClick={() => openExamEditor(result)}
                              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteExamResult(result)}
                              disabled={deletingExamId === result.id}
                              className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingExamId === result.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {(activeTab === 'courses' || (activeTab === 'training' && trainingSubtab === 'courses')) && (
        <CourseProgressTab
          studentId={studentId!}
          student={student}
          trainingRecords={studentTrainingRecords}
          courses={trainingCourses}
          examResults={studentExamResults}
          users={users}
          enrolments={courseEnrolments}
          enrolmentsLoading={courseEnrolmentsLoading}
          onEnrolCourse={enrolInCourse}
          onSendDeclarationLinks={sendDeclarationLinks}
          refetchStudents={refetchStudents}
        />
      )}

      {activeTab === 'billing' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Credit</p>
              <p className={`text-2xl font-bold mt-2 ${accountBalance < 0 ? 'text-red-600' : accountBalance <= 0 ? 'text-amber-600' : 'text-gray-900'}`}>
                {formatCurrency(accountBalance)}
              </p>
              <p className="text-sm text-gray-500 mt-1">Live member credit from Xero</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending Top-ups</p>
              <p className="text-2xl font-bold text-amber-600 mt-2">{pendingTopUps.length}</p>
              <p className="text-sm text-gray-500 mt-1">Awaiting verification</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Verified Top-ups</p>
              <p className="text-2xl font-bold text-emerald-600 mt-2">{formatCurrency(verifiedTopUps)}</p>
              <p className="text-sm text-gray-500 mt-1">Total funds added</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unpaid Flights</p>
              <p className={`text-2xl font-bold mt-2 ${unpaidFlights.length > 0 ? 'text-red-600' : 'text-gray-900'}`}>{unpaidFlights.length}</p>
              <p className="text-sm text-gray-500 mt-1">{formatCurrency(flightCharges)} logged charges</p>
            </div>
          </div>

          {canManageBilling && (
            <form onSubmit={handleAddTopUp} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                <div className="lg:w-36">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input
                    type="number"
                    min={billing.minimumPrepaidPack ?? 1000}
                    step={billing.minimumPrepaidPack ?? 1000}
                    value={topUpAmount}
                    onChange={event => setTopUpAmount(event.target.value)}
                    placeholder={String(billing.minimumPrepaidPack ?? 1000)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="lg:w-44">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={topUpDate}
                    onChange={event => setTopUpDate(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="lg:w-56">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    value={topUpPaymentMethodId}
                    onChange={event => setTopUpPaymentMethodId(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Not selected</option>
                    {paymentMethods.filter(method => method.active && method.allowAccountTopup !== false).map(method => (
                      <option key={method.id} value={method.id}>{method.name}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <input
                    value={topUpDescription}
                    onChange={event => setTopUpDescription(event.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={savingTopUp}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingTopUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Top-up
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">Top-ups are recorded as pending until verified by an admin.</p>
              <p className="mt-1 text-xs text-gray-500">Prepaid clients need a positive verified prepaid balance. Top-ups can only be recorded in {formatCurrency(billing.minimumPrepaidPack ?? 1000)} increments.</p>
            </form>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="flex items-center text-lg font-semibold text-gray-900">
                  <Wallet className="h-5 w-5 mr-2 text-blue-600" />
                  Account Ledger
                </h2>
                <p className="mt-1 text-sm text-gray-500">Top-ups, flight charges, refunds and balance changes.</p>
              </div>
              {billing.loading ? (
                <div className="p-6 text-sm text-gray-500">Loading billing ledger...</div>
              ) : billingTransactions.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No account transactions recorded yet.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {billingTransactions.slice(0, 12).map(transaction => {
                    const signedAmount = transactionSignedAmount(transaction.type, transaction.amount);
                    return (
                      <div key={transaction.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{transaction.description || transactionLabel(transaction.type)}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              {new Date(transaction.createdAt).toLocaleString('en-AU')} | {transaction.paymentMethodName || 'No method'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${signedAmount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {signedAmount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(signedAmount))}
                            </p>
                            {transaction.balanceAfter != null && (
                              <p className="mt-1 text-xs text-gray-500">Bal {formatCurrency(transaction.balanceAfter)}</p>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            transaction.verifiedStatus === 'verified'
                              ? 'bg-emerald-100 text-emerald-700'
                              : transaction.verifiedStatus === 'rejected'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}>
                            {transaction.verifiedStatus}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium capitalize text-gray-700">
                            {transactionLabel(transaction.type)}
                          </span>
                          {canManageBilling && transaction.type === 'topup' && transaction.verifiedStatus === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleVerifyTopUp(transaction.id)}
                              disabled={billingActionId === transaction.id}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {billingActionId === transaction.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                              Verify
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Unpaid Flights</h2>
                <p className="mt-1 text-sm text-gray-500">Flights waiting for payment finalisation.</p>
              </div>
              {billing.loading ? (
                <div className="p-6 text-sm text-gray-500">Loading unpaid flights...</div>
              ) : unpaidFlights.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500">No unpaid flights for this file.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {unpaidFlights.map(flight => (
                    <div key={flight.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{flight.aircraftRegistration} | {flight.flightTypeName || flight.paymentType || 'Flight'}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {new Date(flight.flightDate).toLocaleString('en-AU')} | {flight.flightDuration.toFixed(1)} hrs
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-red-700">{formatCurrency(flight.calculatedCost || 0)}</p>
                      </div>
                      {canManageBilling && (
                        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Finalise payment from the Financial Dashboard so Stripe, prepaid, and Xero stay reconciled.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="border-b border-gray-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Invoices</h2>
              <p className="mt-1 text-sm text-gray-500">Invoice records linked to this student or pilot file.</p>
            </div>
            {loadingInvoices ? (
              <div className="p-6 text-sm text-gray-500">Loading invoices...</div>
            ) : studentInvoices.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">No invoices recorded yet.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {studentInvoices.map(invoice => (
                  <details key={invoice.id} className="group px-5 py-4">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{invoice.invoiceNumber}</p>
                        <p className="mt-1 text-xs text-gray-500">{invoice.date.toLocaleDateString('en-AU')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                          invoice.status === 'paid'
                            ? 'bg-emerald-100 text-emerald-700'
                            : invoice.status === 'overdue'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}>
                          {invoice.status}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">{formatCurrency(invoice.total)}</span>
                      </div>
                    </summary>
                    {invoice.items.length > 0 && (
                      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                        <table className="min-w-full divide-y divide-gray-100 text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold text-gray-600">Item</th>
                              <th className="px-3 py-2 text-right font-semibold text-gray-600">Qty</th>
                              <th className="px-3 py-2 text-right font-semibold text-gray-600">Rate</th>
                              <th className="px-3 py-2 text-right font-semibold text-gray-600">Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {invoice.items.map(item => (
                              <tr key={item.id}>
                                <td className="px-3 py-2 text-gray-900">{item.description}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(item.rate)}</td>
                                <td className="px-3 py-2 text-right font-medium text-gray-900">{formatCurrency(item.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'safety' && (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
            <Shield className="h-5 w-5 mr-2" />
            Safety & Incident Links
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Safety reports involving this pilot or student should appear here, including hazards, incidents, accidents and corrective actions.
          </p>
          {linkedSafetyReports.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-gray-300 rounded-lg">
              <AlertTriangle className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">No linked safety reports</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
              {linkedSafetyReports.map(report => (
                <div key={report.id} className="p-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{report.title}</p>
                    <p className="text-xs text-gray-500 mt-1">{report.createdAt.toLocaleDateString()} · {report.reportType.replace('_', ' ')}</p>
                  </div>
                  <span className="text-xs font-medium text-gray-600 capitalize">{report.status.replace('_', ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'timeline' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <History className="h-5 w-5 mr-2 text-blue-600" />
                  Student File Timeline
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Chronological view of training, exams, safety reports and compliance dates for this file.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-gray-500">Training</p>
                  <p className="text-lg font-semibold text-gray-900">{timelineSummary.training}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-gray-500">Exams</p>
                  <p className="text-lg font-semibold text-gray-900">{timelineSummary.exams}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-gray-500">Safety</p>
                  <p className="text-lg font-semibold text-gray-900">{timelineSummary.safety}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] font-medium uppercase text-gray-500">Upcoming</p>
                  <p className="text-lg font-semibold text-gray-900">{timelineSummary.upcoming}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {sortedTimelineEvents.length === 0 ? (
              <div className="p-8 text-center">
                <History className="mx-auto h-10 w-10 text-gray-300" />
                <h3 className="mt-3 text-sm font-semibold text-gray-900">No timeline activity yet</h3>
                <p className="mt-1 text-sm text-gray-500">Training records, exams and safety events will appear here automatically.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {sortedTimelineEvents.map((event, index) => (
                  <div key={event.id} className="grid gap-3 p-4 sm:grid-cols-[150px_1fr]">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">{formatTimelineDate(event.date)}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-400">{event.kind}</p>
                    </div>
                    <div className="relative flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`mt-1 h-3 w-3 rounded-full ${event.colorClass}`} />
                        {index < sortedTimelineEvents.length - 1 && (
                          <span className="mt-1 h-full min-h-8 w-px bg-gray-200" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">{event.title}</h3>
                          {event.badge && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                              event.badge.toLowerCase().includes('fail') || event.badge.toLowerCase().includes('expired')
                                ? 'bg-red-100 text-red-700'
                                : event.badge.toLowerCase().includes('awaiting') || event.badge.toLowerCase().includes('upcoming')
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-100 text-gray-700'
                            }`}>
                              {event.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-600">{event.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {(activeTab === 'training' && trainingSubtab === 'training') && (
        <div className="space-y-6">
          {/* Pending sign-off banner — shown to the student whose profile this is */}
          {user?.id === studentId && (() => {
            const pendingAck = filteredRecords.filter(r => r.status === 'submitted' && !r.studentAck);
            if (pendingAck.length === 0) return null;
            return (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-900">
                    {pendingAck.length} record{pendingAck.length > 1 ? 's require' : ' requires'} your acknowledgement
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Review your instructor's comments below for {selectedTrainingCourse?.title || 'the selected course'} and sign off that you have read and agree.
                  </p>
                </div>
              </div>
            );
          })()}

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-5 border-b border-gray-200">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <FileText className="h-5 w-5 mr-2 text-blue-600" />
                    Training Records
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedCourseHasSyllabusMatrix
                      ? 'Review CASA RPL lesson attempts, outstanding syllabus matrix items, and the full course matrix.'
                      : 'Review lesson records, competency criteria, next lessons, and student acknowledgements.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg bg-gray-100 p-1">
                    <button
                      onClick={() => setShowMatrixView(false)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        !showMatrixView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Records
                    </button>
                    <button
                      onClick={() => setShowMatrixView(true)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        showMatrixView ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {selectedCourseHasSyllabusMatrix ? 'CASA Matrix' : 'Criteria Matrix'}
                    </button>
                  </div>
                  {canAddRecord && (
                    <button
                      onClick={handleAddTrainingRecord}
                      className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      <Plus className="h-4 w-4" />
                      Add Record
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-blue-700">Course</span>
                    <p className="mt-1 text-sm font-medium text-blue-950">
                      {selectedTrainingCourse?.title || 'Select a course'}
                    </p>
                  </div>
                  <label className="block md:hidden">
                    <span className="sr-only">Course</span>
                    <select
                      value={selectedTrainingCourseId}
                      onChange={(event) => setSelectedTrainingCourseId(event.target.value)}
                      className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {trainingCourseOptions.length === 0 ? (
                        <option value="">No courses available</option>
                      ) : (
                        trainingCourseOptions.map(course => {
                          const count = studentTrainingRecords.filter(record => record.courseId === course.id).length;
                          return (
                            <option key={course.id} value={course.id}>
                              {course.title}{count > 0 ? ` (${count} record${count === 1 ? '' : 's'})` : ''}
                            </option>
                          );
                        })
                      )}
                    </select>
                  </label>
                </div>
                <div className="mt-3 hidden gap-2 overflow-x-auto pb-1 md:flex">
                  {trainingCourseOptions.length === 0 ? (
                    <span className="rounded-lg border border-dashed border-blue-200 bg-white/70 px-3 py-2 text-sm font-medium text-blue-700 dark:border-blue-500/30 dark:bg-[#11141a] dark:text-blue-200">
                      No courses available
                    </span>
                  ) : (
                    trainingCourseOptions.map(course => {
                      const count = studentTrainingRecords.filter(record => record.courseId === course.id).length;
                      const isSelected = selectedTrainingCourseId === course.id;
                      return (
                        <button
                          key={course.id}
                          type="button"
                          onClick={() => setSelectedTrainingCourseId(course.id)}
                          className={`shrink-0 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                            isSelected
                              ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                              : 'border-blue-200 bg-white text-blue-800 hover:border-blue-300 hover:bg-blue-100'
                          }`}
                        >
                          <span className="block max-w-[15rem] truncate">{course.title}</span>
                          <span className={`mt-0.5 block text-xs font-medium ${isSelected ? 'text-blue-100' : 'text-blue-600'}`}>
                            {count} record{count === 1 ? '' : 's'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                {selectedTrainingCourse && (
                  <p className="mt-3 text-xs text-blue-700">
                    {selectedCourseHasSyllabusMatrix
                      ? `Showing ${selectedTrainingCourse.title}. This course uses the CASA syllabus matrix plus lesson records.`
                      : `Showing ${selectedTrainingCourse.title}. Matrix columns use this course's assessment criteria and grading types.`}
                  </p>
                )}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase text-gray-500">Records</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{filteredRecords.length}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase text-gray-500">Hours</p>
                  <p className="mt-1 text-2xl font-semibold text-blue-600">{formatDecimalTime(filteredTotalMinutes)}</p>
                </div>
                {selectedCourseHasSyllabusMatrix && selectedCourseMatrixSummary ? (
                  <>
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-indigo-700">Matrix Met</p>
                      <p className="mt-1 text-2xl font-semibold text-indigo-900">{selectedCourseMatrixSummary.percentage}%</p>
                      <p className="mt-0.5 text-xs text-indigo-700">
                        {selectedCourseMatrixSummary.metCount}/{selectedCourseMatrixSummary.totalCount} items
                      </p>
                    </div>
                    <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-red-700">Needs Attention</p>
                      <p className="mt-1 text-2xl font-semibold text-red-700">{selectedCourseMatrixSummary.outstandingCount}</p>
                      <p className="mt-0.5 text-xs text-red-700">
                        {selectedCourseMatrixSummary.standardOneOutstanding} final-standard
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-gray-500">Awaiting</p>
                      <p className={`mt-1 text-2xl font-semibold ${filteredPendingAck > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {filteredPendingAck}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase text-gray-500">Latest Booking</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">
                        {latestFilteredBooking ? latestFilteredBooking.toLocaleString('en-AU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
                <label className="block">
                  <span className="block text-xs font-medium text-gray-500 uppercase mb-1">Booking After</span>
                  <input
                    type="datetime-local"
                    value={dateFilter.start}
                    onChange={(e) => setDateFilter(prev => ({ ...prev, start: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-500 uppercase mb-1">Booking Before</span>
                  <input
                    type="datetime-local"
                    value={dateFilter.end}
                    onChange={(e) => setDateFilter(prev => ({ ...prev, end: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-500 uppercase mb-1">Aircraft</span>
                  <select
                    value={aircraftFilter}
                    onChange={(e) => setAircraftFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Aircraft</option>
                    {Array.from(new Set(studentTrainingRecords.map(r => r.registration).filter(Boolean))).map(reg => (
                      <option key={reg} value={reg}>{reg}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-gray-500 uppercase mb-1">Instructor</span>
                  <select
                    value={instructorFilter}
                    onChange={(e) => setInstructorFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Instructors</option>
                    {users.filter(u => u.role === 'instructor' || u.role === 'admin' || u.role === 'senior_instructor').map(instructor => (
                      <option key={instructor.id} value={instructor.id}>{instructor.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              {hasTrainingFilters && (
                <button
                  type="button"
                  onClick={clearTrainingFilters}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
                >
                  <X className="h-4 w-4" />
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {recordsLoading ? (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ) : sortedRecords.length > 0 ? (
            <>
              {/* Overview Matrix */}
              {showMatrixView && (() => {
                if (selectedCourseHasSyllabusMatrix && selectedCourseMatrixSummary) {
                  return (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-indigo-100 bg-white shadow-sm overflow-hidden">
                        <div className="border-b border-indigo-100 bg-indigo-50 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900">CASA RPL Matrix Overview</h3>
                              <p className="mt-1 text-sm text-indigo-900">
                                Course-wide view of required CASA matrix items. Lesson cards show the exact result for each attempt.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs font-semibold">
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
                                {selectedCourseMatrixSummary.metCount} met
                              </span>
                              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                                {selectedCourseMatrixSummary.outstandingCount} outstanding
                              </span>
                              <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-indigo-800">
                                {selectedCourseMatrixSummary.percentage}% complete
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 p-4 md:grid-cols-3">
                          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                            <p className="text-xs font-semibold uppercase text-gray-500">Required Items</p>
                            <p className="mt-2 text-2xl font-semibold text-gray-900">{selectedCourseMatrixSummary.totalCount}</p>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                            <p className="text-xs font-semibold uppercase text-emerald-700">Meeting Standard</p>
                            <p className="mt-2 text-2xl font-semibold text-emerald-800">{selectedCourseMatrixSummary.metCount}</p>
                          </div>
                          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                            <p className="text-xs font-semibold uppercase text-red-700">Needs Attention</p>
                            <p className="mt-2 text-2xl font-semibold text-red-700">{selectedCourseMatrixSummary.outstandingCount}</p>
                            <p className="mt-1 text-xs text-red-700">
                              {selectedCourseMatrixSummary.standardOneOutstanding} required to final qualification standard
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                          <h4 className="text-sm font-semibold text-gray-900">Outstanding Matrix Items By Lesson</h4>
                          <p className="mt-1 text-xs text-gray-500">
                            Start with the lessons that still have the most uncovered CASA requirements.
                          </p>
                          {selectedCourseMatrixSummary.byLesson.length === 0 ? (
                            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                              All CASA matrix requirements currently meet the required standard.
                            </div>
                          ) : (
                            <div className="mt-4 space-y-3">
                              {selectedCourseMatrixSummary.byLesson.slice(0, 8).map(group => (
                                <div key={group.lessonCode} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-gray-900">{group.lessonCode} {group.lessonTitle}</p>
                                      <p className="mt-0.5 text-xs text-gray-500">{group.outstanding}/{group.total} still need evidence</p>
                                    </div>
                                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 border border-red-200">
                                      {group.outstanding}
                                    </span>
                                  </div>
                                  <div className="mt-2 space-y-1.5">
                                    {group.items.slice(0, 3).map(item => (
                                      <p key={item.requirement.id} className="text-xs text-gray-700">
                                        <span className="font-semibold">{formatSyllabusMatrixText(item.row?.code)}</span>{' '}
                                        {formatSyllabusMatrixText(item.row?.description)}
                                      </p>
                                    ))}
                                    {group.items.length > 3 && (
                                      <p className="text-xs font-medium text-gray-500">+ {group.items.length - 3} more</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>

                        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                          <h4 className="text-sm font-semibold text-gray-900">Lesson Attempts</h4>
                          <p className="mt-1 text-xs text-gray-500">
                            Each attempt links instructor comments with its CASA matrix result.
                          </p>
                          <div className="mt-4 space-y-3">
                            {sortedRecords.map(record => {
                              const summary = getRecordMatrixAssessmentSummary(record);
                              const instructor = users.find(u => u.id === record.instructorId);
                              const lesson = getRecordLesson(record);
                              const lessonLabel = lesson?.name || lesson?.sequenceTitle || record.lessonCodes.join(', ') || 'Lesson';
                              return (
                                <div key={record.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-gray-900">{lessonLabel}</p>
                                      <p className="mt-0.5 text-xs text-gray-500">
                                        {formatBookingDateTime(record)} | {record.registration || 'No aircraft'} | {instructor?.name || 'Unknown instructor'}
                                      </p>
                                    </div>
                                    {summary ? (
                                      <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                                        <span className="rounded-full border border-indigo-100 bg-white px-2 py-0.5 text-indigo-800">
                                          {summary.metCount}/{summary.totalCount} currently met
                                        </span>
                                        {summary.notMetItems.length > 0 ? (
                                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700">
                                            {summary.notMetItems.length} need attention
                                          </span>
                                        ) : (
                                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                                            Clear
                                          </span>
                                        )}
                                        {summary.resolvedLaterItems.length > 0 && (
                                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-700">
                                            {summary.resolvedLaterItems.length} resolved later
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-gray-500">
                                        No matrix recorded
                                      </span>
                                    )}
                                  </div>
                                  {summary?.notMetItems.length ? (
                                    <div className="mt-2 rounded-md border border-red-100 bg-white p-2">
                                      <p className="text-xs font-semibold uppercase text-red-700">Not yet met</p>
                                      <div className="mt-1 space-y-1">
                                        {summary.notMetItems.slice(0, 4).map(item => (
                                          <p key={item.assessment.matrixRowId} className="text-xs text-red-900">
                                            <span className="font-semibold">{formatSyllabusMatrixText(item.row?.code)}</span>{' '}
                                            {formatSyllabusMatrixText(item.row?.description)}
                                          </p>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      </div>
                    </div>
                  );
                }

                const matrixCriteria = selectedTrainingCourse?.assessmentCriteria ?? [];

                const getGrade = (record: TrainingRecord, critId: string) => {
                  const g = record.criteriaGrades?.[critId];
                  return g && g !== '-' ? g : '–';
                };

                const isUnassessedGrade = (grade: string) => !grade || grade === '-' || grade === '–' || grade.includes('â');
                const normaliseGradeLabel = (grade: string, system: LessonGradingSystem) =>
                  isUnassessedGrade(grade) ? '-' : system === 'Out of 100' ? `${grade}%` : grade;
                const gradeColor = (grade: string, system: LessonGradingSystem) => {
                  if (isUnassessedGrade(grade)) return 'bg-gray-100 text-gray-400 border-gray-200';
                  if (system === 'Out of 100') {
                    const score = Number(grade);
                    if (Number.isNaN(score)) return 'bg-gray-100 text-gray-400 border-gray-200';
                    if (score >= 80) return 'bg-emerald-600 text-white border-emerald-600';
                    if (score >= 50) return 'bg-amber-400 text-white border-amber-400';
                    return 'bg-red-500 text-white border-red-500';
                  }
                  if (grade === 'C' || grade === 'Pass') return 'bg-emerald-600 text-white border-emerald-600';
                  if (grade === 'S') return 'bg-amber-400 text-white border-amber-400';
                  if (grade === 'NC' || grade === 'Fail') return 'bg-red-500 text-white border-red-500';
                  return 'bg-gray-100 text-gray-400 border-gray-200';
                };

                return (
                  <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200">
                      <h3 className="text-lg font-medium text-gray-900">Competency Overview Matrix</h3>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs">
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-600 rounded"></span><span>C / Pass / 80-100% = strong pass</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded"></span><span>S / 50-79% = developing</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded"></span><span>NC / Fail / &lt;50% = not yet competent</span></div>
                        <div className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-100 border border-gray-300 rounded"></span><span>– = Not Assessed</span></div>
                      </div>
                    </div>

                    {matrixCriteria.length === 0 ? (
                      <div className="p-6 text-center text-sm text-gray-500">No graded criteria found in these records.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full border-collapse">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[120px]">Booking</th>
                              <th className="sticky left-20 z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[110px]">Instructor</th>
                              <th className="sticky left-[186px] z-10 bg-gray-50 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase border-r border-b border-gray-200 min-w-[80px]">Aircraft</th>
                              {matrixCriteria.map(crit => (
                                <th
                                  key={crit.id}
                                  title={crit.name}
                                  className="px-1 py-2 text-center text-xs font-medium text-gray-600 border-r border-b border-gray-200 min-w-[40px]"
                                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '110px' }}
                                >
                                  {crit.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {sortedRecords.map(record => {
                              const instructor = users.find(u => u.id === record.instructorId);
                              return (
                                <tr key={record.id} className="hover:bg-gray-50">
                                  <td className="sticky left-0 z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap">
                                    {formatBookingDateTime(record)}
                                  </td>
                                  <td className="sticky left-20 z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap max-w-[110px] truncate">
                                    {instructor?.name || 'Unknown'}
                                  </td>
                                  <td className="sticky left-[186px] z-10 bg-white px-3 py-2.5 text-xs text-gray-800 border-r border-gray-200 whitespace-nowrap">
                                    {record.registration || record.aircraftType}
                                  </td>
                                  {matrixCriteria.map(crit => {
                                    const grade = getGrade(record, crit.id);
                                    return (
                                      <td key={crit.id} className="px-1 py-2 text-center border-r border-gray-100">
                                        <span className={`inline-flex min-w-8 items-center justify-center rounded border px-1.5 py-1 text-xs font-bold ${gradeColor(grade, crit.gradingSystem)}`}>
                                          {normaliseGradeLabel(grade, crit.gradingSystem)}
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Lesson Cards */}
              {!showMatrixView && (
                <div className="space-y-4">
                  {sortedRecords.map(record => {
                    const instructor = users.find(u => u.id === record.instructorId);
                    const totalTime = (record.dualTimeMin + record.soloTimeMin) / 60;
                    const recordCourse = trainingCourses.find(c => c.id === record.courseId);
                    const recordLessonDisplay = getRecordLessonDisplay(record);
                    const lessonTitle = recordLessonDisplay.title;
                    const lessonCode = recordLessonDisplay.code;
                    const matrixSummary = getRecordMatrixAssessmentSummary(record);
                    const isMatrixExpanded = expandedRecordMatrixIds.has(record.id);
                    const latestRevision = [...(record.auditLog || [])]
                      .reverse()
                      .find(entry => entry.changes?.studentAcknowledgementRequired && Array.isArray(entry.changes?.summary));
                    const revisionSummary = latestRevision?.changes?.summary as string[] | undefined;
                    
                    return (
                      <div key={record.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                        <div className="border-b border-gray-100 p-5">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-base font-semibold text-gray-900">{lessonTitle}</h3>
                                {lessonCode && (
                                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{lessonCode}</span>
                                )}
                                <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(record.status)}`}>
                                  {record.status}
                                </span>
                                {record.isFlightReview && (
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                    record.flightReviewResult === 'pass'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : record.flightReviewResult === 'fail'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-orange-100 text-orange-800'
                                  }`}>
                                    {record.flightReviewType || 'Flight Review'}: {(record.flightReviewResult || 'not_assessed').replace('_', ' ')}
                                  </span>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                                <span className="inline-flex items-center gap-1.5">
                                  <Calendar className="h-4 w-4 text-gray-400" />
                                  {formatBookingDateTime(record)}
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <Plane className="h-4 w-4 text-gray-400" />
                                  {record.registration || 'Aircraft not recorded'}
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                  <User className="h-4 w-4 text-gray-400" />
                                  {instructor?.name || 'Unknown instructor'}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {record.status === 'locked' && record.studentAck && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Acknowledged
                                </span>
                              )}
                              {canEditRecord(record) && (
                                <button
                                  type="button"
                                  onClick={() => openTrainingRecordEditor(record)}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                  <Edit className="h-4 w-4" />
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="p-5 space-y-5">
                          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <div className="rounded-lg bg-gray-50 px-3 py-2">
                              <p className="text-xs font-medium uppercase text-gray-500">Total</p>
                              <p className="mt-1 text-lg font-semibold text-blue-600">{totalTime.toFixed(1)} hrs</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 px-3 py-2">
                              <p className="text-xs font-medium uppercase text-gray-500">Dual</p>
                              <p className="mt-1 text-lg font-semibold text-gray-900">{formatDecimalTime(record.dualTimeMin)} hrs</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 px-3 py-2">
                              <p className="text-xs font-medium uppercase text-gray-500">Solo</p>
                              <p className="mt-1 text-lg font-semibold text-gray-900">{formatDecimalTime(record.soloTimeMin)} hrs</p>
                            </div>
                            <div className="rounded-lg bg-gray-50 px-3 py-2">
                              <p className="text-xs font-medium uppercase text-gray-500">Next Lesson</p>
                              <p className="mt-1 truncate text-sm font-semibold text-gray-900" title={record.nextLesson || undefined}>
                                {record.nextLesson || '-'}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
                            <div className="space-y-4">
                              <section>
                                <h4 className="text-xs font-semibold uppercase text-gray-500">Lesson Comments</h4>
                                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                  <p className="whitespace-pre-wrap text-sm leading-6 text-gray-900">
                                    {record.comments || 'No lesson comments recorded.'}
                                  </p>
                                </div>
                              </section>

                              {record.briefingComments && (
                                <section>
                                  <h4 className="text-xs font-semibold uppercase text-gray-500">Briefing Comments</h4>
                                  <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 p-4">
                                    <p className="whitespace-pre-wrap text-sm leading-6 text-blue-950">{record.briefingComments}</p>
                                  </div>
                                </section>
                              )}
                            </div>

                            <div className="space-y-4">
                              <section className="rounded-lg border border-gray-200 p-4">
                                <h4 className="text-xs font-semibold uppercase text-gray-500">Record Details</h4>
                                <dl className="mt-3 space-y-2 text-sm">
                                  <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Course</dt>
                                    <dd className="text-right font-medium text-gray-900">{recordCourse?.title || 'Not recorded'}</dd>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Aircraft type</dt>
                                    <dd className="text-right font-medium text-gray-900">{record.aircraftType || '-'}</dd>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Formal brief</dt>
                                    <dd className="text-right font-medium text-gray-900">{record.formalBriefing ? 'Yes' : 'No'}</dd>
                                  </div>
                                  {record.instructorSignTimestamp && (
                                    <div className="flex justify-between gap-4">
                                      <dt className="text-gray-500">Submitted</dt>
                                      <dd className="text-right font-medium text-gray-900">
                                        {record.instructorSignTimestamp.toLocaleString('en-AU', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </dd>
                                    </div>
                                  )}
                                  {record.studentAckTimestamp && (
                                    <div className="flex justify-between gap-4">
                                      <dt className="text-gray-500">Acknowledged</dt>
                                      <dd className="text-right font-medium text-gray-900">{record.studentAckName || student.name}</dd>
                                    </div>
                                  )}
                                </dl>
                              </section>
                          

                              {record.criteriaGrades && Object.keys(record.criteriaGrades).length > 0 && (() => {
                                const course = trainingCourses.find(c => c.id === record.courseId);
                                if (!course) return null;
                                const assessedCriteria = course.assessmentCriteria
                                  .map(crit => ({ crit, grade: record.criteriaGrades[crit.id] }))
                                  .filter(item => item.grade && item.grade !== '-');

                                if (assessedCriteria.length === 0) {
                                  return (
                                    <section className="rounded-lg border border-gray-200 p-4">
                                      <h4 className="text-xs font-semibold uppercase text-gray-500">Assessment</h4>
                                      <p className="mt-2 text-sm text-gray-500">No criteria assessed in this record.</p>
                                    </section>
                                  );
                                }

                                return (
                                  <section className="rounded-lg border border-gray-200 p-4">
                                    <h4 className="text-xs font-semibold uppercase text-gray-500">Assessment</h4>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {assessedCriteria.map(({ crit, grade }) => {
                                        const isPilotReady = grade === 'C' || grade === 'Pass';
                                        const isSoloReady = grade === 'S';
                                        const isNotCompetent = grade === 'NC' || grade === 'Fail';
                                        return (
                                          <span
                                            key={crit.id}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                              isPilotReady
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                : isSoloReady
                                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                                                  : isNotCompetent
                                                    ? 'border-red-200 bg-red-50 text-red-700'
                                                    : 'border-gray-200 bg-gray-50 text-gray-700'
                                            }`}
                                          >
                                            {crit.name}: {grade}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </section>
                                );
                              })()}
                              {matrixSummary && (
                                <section className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <h4 className="text-xs font-semibold uppercase text-indigo-700">Lesson Matrix</h4>
                                      <p className="mt-1 text-xs text-indigo-900">
                                        Current status for the CASA matrix items assessed in this lesson. Historical attempt results are shown in the detail view.
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                      <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-indigo-800 border border-indigo-100">
                                        {matrixSummary.metCount}/{matrixSummary.totalCount} currently met
                                      </span>
                                      {matrixSummary.notMetItems.length > 0 && (
                                        <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-700 border border-red-200">
                                          {matrixSummary.notMetItems.length} need attention
                                        </span>
                                      )}
                                      {matrixSummary.resolvedLaterItems.length > 0 && (
                                        <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 border border-blue-200">
                                          {matrixSummary.resolvedLaterItems.length} resolved later
                                        </span>
                                      )}
                                      {matrixSummary.unassessedCount > 0 && (
                                        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 border border-amber-200">
                                          {matrixSummary.unassessedCount} carried forward
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {matrixSummary.notMetItems.length > 0 ? (
                                    <div className="mt-3 rounded-lg border border-red-100 bg-white p-3">
                                      <p className="text-xs font-semibold uppercase text-red-700">Needs attention</p>
                                      <div className="mt-2 space-y-2">
                                        {matrixSummary.notMetItems.map(({ assessment, row, requirement }) => (
                                          <div key={assessment.matrixRowId} className="rounded-md border border-red-100 bg-red-50/70 px-3 py-2">
                                            <div className="flex items-start justify-between gap-3">
                                              <div className="min-w-0">
                                                <p className="text-xs font-semibold text-red-950">
                                                  {formatSyllabusMatrixText(row?.code)} {formatSyllabusMatrixText(row?.description)}
                                                </p>
                                                <p className="mt-1 text-xs leading-5 text-red-800">
                                                  {assessment.comments || 'This matrix item was not recorded as meeting the required standard for this lesson.'}
                                                </p>
                                              </div>
                                              <div className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                                                <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-red-700">
                                                  {matrixStandardShortLabel(assessment.achievedStandard)}
                                                </span>
                                                <span className="text-red-300">/</span>
                                                <span className="rounded-full border border-red-200 bg-white px-2 py-0.5 text-red-700">
                                                  {requirement?.requiredStandard
                                                    ? `Req ${matrixStandardShortLabel(requirement.requiredStandard)}`
                                                    : 'Req not set'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                                      <p className="text-xs font-semibold text-emerald-800">
                                        All matrix items from this attempt now meet the required standard.
                                        {matrixSummary.resolvedLaterItems.length > 0
                                          ? ` ${matrixSummary.resolvedLaterItems.length} were resolved in a later repeat or follow-up lesson.`
                                          : ''}
                                      </p>
                                      {matrixSummary.attemptNotMetItems.length > 0 && (
                                        <p className="mt-1 text-xs text-emerald-700">
                                          Original attempt result: {matrixSummary.attemptMetCount}/{matrixSummary.totalCount} met.
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => toggleRecordMatrix(record.id)}
                                    className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50"
                                  >
                                    <span>{isMatrixExpanded ? 'Hide full lesson matrix' : 'View full lesson matrix'}</span>
                                    <ChevronDown className={`h-4 w-4 transition-transform ${isMatrixExpanded ? 'rotate-180' : ''}`} />
                                  </button>

                                  {isMatrixExpanded && (
                                    <div className="mt-3 space-y-2">
                                      {matrixSummary.items.map(({ assessment, row, requirement, meetsRequirement, currentBestAssessment, attemptMeetsRequirement, resolvedLater }) => (
                                      <div key={assessment.matrixRowId} className="rounded-md border border-white/80 bg-white px-3 py-2">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0">
                                            <p className="text-xs font-semibold text-gray-900">
                                              {formatSyllabusMatrixText(row?.code)} {formatSyllabusMatrixText(row?.description)}
                                            </p>
                                            {resolvedLater && (
                                              <p className="mt-1 text-xs leading-5 text-blue-700">
                                                This item was not met on this attempt, but it has since been resolved.
                                              </p>
                                            )}
                                            {assessment.comments && (
                                              <p className="mt-1 text-xs leading-5 text-gray-600">{assessment.comments}</p>
                                            )}
                                          </div>
                                          <div className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                                            <span className={`rounded-full border px-2 py-0.5 ${
                                              attemptMeetsRequirement
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                : assessment.achievedStandard
                                                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                                                  : 'border-gray-200 bg-gray-50 text-gray-500'
                                            }`}>
                                              Attempt {matrixStandardShortLabel(assessment.achievedStandard)}
                                            </span>
                                            <span className="text-gray-400">/</span>
                                            <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-indigo-700">
                                              {requirement?.requiredStandard
                                                ? `Req ${matrixStandardShortLabel(requirement.requiredStandard)}`
                                                : 'Req not set'}
                                            </span>
                                            <span className="text-gray-400">/</span>
                                            <span className={`rounded-full border px-2 py-0.5 ${
                                              meetsRequirement
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                : 'border-red-200 bg-red-50 text-red-700'
                                            }`}>
                                              Current {matrixStandardShortLabel(currentBestAssessment?.achievedStandard)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                      ))}
                                    </div>
                                  )}
                                </section>
                              )}
                              {record.isFlightReview && record.flightReviewNotes && (
                                <section className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                                  <h4 className="text-xs font-semibold uppercase text-orange-700">Flight Review Notes</h4>
                                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-orange-950">{record.flightReviewNotes}</p>
                                </section>
                              )}
                            </div>
                          </div>

                          <div className="border-t border-gray-200 pt-4 space-y-3">
                          {/* Student sign-off prompt */}
                          {record.status === 'submitted' && !record.studentAck && user?.id === studentId && (
                            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                              <p className="text-sm font-semibold text-amber-900 mb-1">Your acknowledgement is required</p>
                              <p className="text-xs text-amber-700 mb-3">
                                By acknowledging, you confirm you have read and agree with the lesson comments and assessment above.
                              </p>
                              {revisionSummary && revisionSummary.length > 0 && (
                                <div className="mb-3 rounded-md border border-amber-200 bg-white/70 p-3">
                                  <p className="text-xs font-semibold text-amber-900 mb-1">What changed</p>
                                  <ul className="list-disc pl-4 text-xs text-amber-800 space-y-1">
                                    {revisionSummary.map(change => (
                                      <li key={change}>{change}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <button
                                onClick={() => handleAcknowledge(record.id)}
                                disabled={acknowledgingId === record.id}
                                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {acknowledgingId === record.id ? (
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <CheckCircle className="h-4 w-4" />
                                )}
                                I have read and agree
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No training records found</h3>
                <p className="text-gray-600 mb-4">No records match the selected filters.</p>
                {canAddRecord && (
                  <button
                    onClick={handleAddTrainingRecord}
                    className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mx-auto"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Training Record</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {editingTrainingRecord && trainingEditForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Edit Training Record</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {editingTrainingRecord.studentAck
                    ? 'This record has already been acknowledged. Saving changes will send it back to the student for approval.'
                    : 'Update the record details below.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingTrainingRecord(null);
                  setTrainingEditForm(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {editingTrainingRecord.studentAck && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">Student re-approval required</p>
                  <p className="text-xs text-amber-700 mt-1">
                    The student will see the change summary and must acknowledge the updated record again.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Next Lesson</span>
                  <input
                    value={getNextLessonFromAssessment(editingTrainingRecord, trainingEditForm.criteriaGrades)}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Automatically set from this lesson's pass marks. Pass advances to the next lesson; below pass repeats this lesson.
                  </p>
                </label>
                <label className="flex items-center gap-2 pt-7">
                  <input
                    type="checkbox"
                    checked={trainingEditForm.formalBriefing}
                    onChange={event => setTrainingEditForm(form => form ? { ...form, formalBriefing: event.target.checked } : form)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Formal briefing conducted</span>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 flex items-center justify-between gap-3">
                  <span className="block text-sm font-medium text-gray-700">Lesson Comments</span>
                  <span className="flex items-center gap-2">
                    {commentCleanupOriginal !== null && (
                      <button
                        type="button"
                        onClick={handleRevertTrainingEditComments}
                        className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        title="Revert to your original comments"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Revert
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleCleanupTrainingEditComments('grammar')}
                      disabled={commentCleanupLoading !== null || !trainingEditForm.comments.trim()}
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Fix grammar with AI"
                    >
                      {commentCleanupLoading === 'grammar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Grammar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCleanupTrainingEditComments('readability')}
                      disabled={commentCleanupLoading !== null || !trainingEditForm.comments.trim()}
                      className="inline-flex h-8 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Rewrite for readability without adding facts"
                    >
                      {commentCleanupLoading === 'readability' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                      Rewrite
                    </button>
                  </span>
                </span>
                <textarea
                  value={trainingEditForm.comments}
                  onChange={event => setTrainingEditForm(form => form ? { ...form, comments: event.target.value } : form)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Briefing Comments</span>
                <textarea
                  value={trainingEditForm.briefingComments}
                  onChange={event => setTrainingEditForm(form => form ? { ...form, briefingComments: event.target.value } : form)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              {(() => {
                const isCourseDefinedTestFlight = Boolean(getRecordLesson(editingTrainingRecord)?.isFlightTest);
                const isLegacyFlightReview = Boolean(editingTrainingRecord.isFlightReview && !isCourseDefinedTestFlight);
                const showFlightOutcome = isCourseDefinedTestFlight || isLegacyFlightReview;
                if (!showFlightOutcome) return null;
                return (
                  <section className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-orange-700" />
                      <span className="text-sm font-semibold text-orange-950">
                        {isCourseDefinedTestFlight ? 'Course-defined test flight outcome' : 'Existing flight review/test outcome'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-orange-800">
                      Test flights are now controlled from the course lesson setup, not selected on individual records.
                    </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="block text-xs font-medium text-orange-800 mb-1">Review type</span>
                      <input
                        value={trainingEditForm.flightReviewType}
                        onChange={event => setTrainingEditForm(form => form ? { ...form, flightReviewType: event.target.value } : form)}
                        placeholder="Flight Test, Flight Review, RPC Test"
                        className="w-full px-3 py-2 border border-orange-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-orange-800 mb-1">Result</span>
                      <select
                        value={trainingEditForm.flightReviewResult}
                        onChange={event => setTrainingEditForm(form => form ? { ...form, flightReviewResult: event.target.value as TrainingRecordEditForm['flightReviewResult'] } : form)}
                        className="w-full px-3 py-2 border border-orange-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="not_assessed">Not assessed</option>
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </select>
                    </label>
                    <label className="block md:col-span-3">
                      <span className="block text-xs font-medium text-orange-800 mb-1">Review notes</span>
                      <textarea
                        value={trainingEditForm.flightReviewNotes}
                        onChange={event => setTrainingEditForm(form => form ? { ...form, flightReviewNotes: event.target.value } : form)}
                        rows={3}
                        className="w-full px-3 py-2 border border-orange-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </label>
                    {trainingEditForm.flightReviewResult === 'pass' && (
                      <p className="text-xs text-orange-800 md:col-span-3">
                        Saving a passed review records the flight review date. Pilot status is granted through configured endorsements.
                      </p>
                    )}
                  </div>
                  </section>
                );
              })()}

              {(() => {
                const course = getRecordCourse(editingTrainingRecord);
                if (!course || course.assessmentCriteria.length === 0) return null;
                return (
                  <section>
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Assessment Criteria</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {course.assessmentCriteria.map(criterion => {
                        const grade = trainingEditForm.criteriaGrades[criterion.id] || '-';
                        const gradeOptions = criterion.gradingSystem === 'Out of 100'
                          ? ['-', '0', '25', '50', '75', '100']
                          : GRADE_ORDER[criterion.gradingSystem];
                        return (
                          <label key={criterion.id} className="block rounded-lg border border-gray-200 p-3">
                            <span className="block text-sm font-medium text-gray-900 mb-2">{criterion.name}</span>
                            {criterion.gradingSystem === 'Out of 100' ? (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                value={grade === '-' ? '' : grade}
                                placeholder="-"
                                onChange={event => setTrainingEditForm(form => form ? {
                                  ...form,
                                  criteriaGrades: {
                                    ...form.criteriaGrades,
                                    [criterion.id]: event.target.value || '-',
                                  },
                                } : form)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            ) : (
                              <select
                                value={grade}
                                onChange={event => setTrainingEditForm(form => form ? {
                                  ...form,
                                  criteriaGrades: {
                                    ...form.criteriaGrades,
                                    [criterion.id]: event.target.value,
                                  },
                                } : form)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {gradeOptions.map(option => (
                                  <option key={option} value={option}>{option}</option>
                                ))}
                              </select>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })()}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                type="button"
                onClick={() => {
                  setEditingTrainingRecord(null);
                  setTrainingEditForm(null);
                }}
                disabled={savingTrainingRecord}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTrainingRecordEdit}
                disabled={savingTrainingRecord}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingTrainingRecord ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Record
              </button>
            </div>
          </div>
        </div>
      )}

      {editingExamResult && examEditForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Edit Exam Result</h2>
                <p className="text-sm text-gray-500 mt-1">{editingExamResult.examName}</p>
              </div>
              <button onClick={closeExamEditor} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Score (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={examEditForm.score}
                    onChange={event => setExamEditForm(form => form ? { ...form, score: event.target.value } : form)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 mb-1">Date</span>
                  <input
                    type="date"
                    value={examEditForm.examDate}
                    onChange={event => setExamEditForm(form => form ? { ...form, examDate: event.target.value } : form)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>

              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">Notes</span>
                <textarea
                  rows={3}
                  value={examEditForm.notes}
                  onChange={event => setExamEditForm(form => form ? { ...form, notes: event.target.value } : form)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <label className="flex items-start gap-3 text-sm text-indigo-950">
                  <input
                    type="checkbox"
                    checked={examEditForm.kdrCompleted}
                    onChange={event => setExamEditForm(form => form ? { ...form, kdrCompleted: event.target.checked } : form)}
                    className="mt-1 h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block font-semibold">KDR verbally reviewed with student</span>
                    <span className="mt-1 block text-xs text-indigo-700">
                      Store only the marked answer sheet and a short KDR evidence note.
                    </span>
                  </span>
                </label>
                <textarea
                  rows={2}
                  value={examEditForm.kdrNotes}
                  onChange={event => setExamEditForm(form => form ? { ...form, kdrNotes: event.target.value } : form)}
                  placeholder="Optional KDR note."
                  className="mt-3 w-full rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <label className="block rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-4 hover:border-blue-300 hover:bg-blue-50">
                <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  <Upload className="h-4 w-4 text-blue-600" />
                  Replace answer sheet
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  Optional. Uploading a new file replaces the current marked answer sheet.
                </span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.doc,.docx,.xls,.xlsx,image/*,application/pdf"
                  onChange={event => {
                    setExamEditFile(event.target.files?.[0] || null);
                    if (event.target.files?.[0]) {
                      setExamEditForm(form => form ? { ...form, removeExistingFile: false } : form);
                    }
                  }}
                  className="mt-3 block w-full text-xs text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-blue-700"
                />
                {examEditFile && (
                  <span className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-xs text-gray-700">
                    <span className="min-w-0 truncate">{examEditFile.name}</span>
                    <button
                      type="button"
                      onClick={event => {
                        event.preventDefault();
                        setExamEditFile(null);
                      }}
                      className="shrink-0 text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </span>
                )}
              </label>

              {editingExamResult.storagePath && !examEditFile && (
                <label className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-3">
                  <input
                    type="checkbox"
                    checked={examEditForm.removeExistingFile}
                    onChange={event => setExamEditForm(form => form ? { ...form, removeExistingFile: event.target.checked } : form)}
                    className="mt-1 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-red-900">Remove attached file</span>
                    <span className="block text-xs text-red-700 mt-1">{editingExamResult.fileName || 'Existing exam upload'}</span>
                  </span>
                </label>
              )}

              <div className={`rounded-lg border p-3 text-sm ${Number(examEditForm.score) >= editingExamResult.passMark ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                {Number(examEditForm.score) >= editingExamResult.passMark ? 'Pass' : 'Below pass'} - pass mark {editingExamResult.passMark}%
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button onClick={closeExamEditor} disabled={savingExamEdit} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveExamEdit} disabled={savingExamEdit} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {savingExamEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Exam
              </button>
            </div>
          </div>
        </div>
      )}

      {showInfoEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Edit Student Information</h2>
                <p className="text-sm text-gray-500 mt-1">Update contact, emergency and aviation credential details.</p>
              </div>
              <button onClick={() => setShowInfoEditor(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Personal Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Full Name</span>
                    <input value={infoForm.name} onChange={event => updateInfoField('name', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Phone</span>
                    <input type="tel" value={infoForm.phone} onChange={event => updateInfoField('phone', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</span>
                    <input type="date" value={infoForm.dateOfBirth} onChange={event => updateInfoField('dateOfBirth', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Aviation Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">RAAus Membership Number</span>
                    <input value={infoForm.raausId} onChange={event => updateInfoField('raausId', event.target.value)} placeholder="e.g. 123456" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">RAAus Membership Expiry</span>
                    <input type="date" value={infoForm.membershipExpiry} onChange={event => updateInfoField('membershipExpiry', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Medical Type</span>
                    <select value={infoForm.medicalType} onChange={event => updateInfoField('medicalType', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Not recorded</option>
                      <option value="Driver Licence Medical">Driver Licence Medical</option>
                      <option value="RAAus Medical Declaration">RAAus Medical Declaration</option>
                      <option value="CASA Basic Class 2">CASA Basic Class 2</option>
                      <option value="CASA Class 2">CASA Class 2</option>
                      <option value="CASA Class 1">CASA Class 1</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Medical Expiry</span>
                    <input type="date" value={infoForm.medicalExpiry} onChange={event => updateInfoField('medicalExpiry', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">CASA ARN</span>
                    <input value={infoForm.casaArn} onChange={event => updateInfoField('casaArn', event.target.value)} placeholder="Aviation Reference Number" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Emergency Contact</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Name</span>
                    <input value={infoForm.emergencyContactName} onChange={event => updateInfoField('emergencyContactName', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Phone</span>
                    <input type="tel" value={infoForm.emergencyContactPhone} onChange={event => updateInfoField('emergencyContactPhone', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-gray-700 mb-1">Relationship</span>
                    <input value={infoForm.emergencyContactRelationship} onChange={event => updateInfoField('emergencyContactRelationship', event.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </label>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Endorsements</h3>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="mb-4 text-sm text-gray-600">
                    {isOwnStudentPortal
                      ? 'Add any endorsements you currently hold. If an endorsement is set to grant Pilot status, you will automatically be treated as a pilot while that endorsement is active and current.'
                      : 'Add the endorsements this member currently holds. Any endorsement marked as granting Pilot status in Training / Syllabus Settings will automatically make them a pilot when active and current.'}
                  </p>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <label className="block md:col-span-2">
                      <span className="block text-sm font-medium text-gray-700 mb-1">Endorsement</span>
                      <input
                        list="student-profile-endorsement-types"
                        value={infoEndorsementDraft.type}
                        onChange={(event) => setInfoEndorsementDraft((prev) => ({ ...prev, type: event.target.value }))}
                        placeholder="Select or enter endorsement"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <datalist id="student-profile-endorsement-types">
                        {trainingSettings.endorsementTypes.map((type) => (
                          <option key={type} value={type} />
                        ))}
                      </datalist>
                    </label>
                    <label className="block">
                      <span className="block text-sm font-medium text-gray-700 mb-1">Obtained</span>
                      <input
                        type="date"
                        value={infoEndorsementDraft.dateObtained}
                        onChange={(event) => setInfoEndorsementDraft((prev) => ({ ...prev, dateObtained: event.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-sm font-medium text-gray-700 mb-1">Expiry</span>
                      <input
                        type="date"
                        value={infoEndorsementDraft.expiryDate}
                        onChange={(event) => setInfoEndorsementDraft((prev) => ({ ...prev, expiryDate: event.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={infoEndorsementDraft.isActive}
                        onChange={(event) => setInfoEndorsementDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Active endorsement
                    </label>
                    <button
                      type="button"
                      onClick={addInfoEndorsement}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      Add endorsement
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {infoForm.endorsements.length > 0 ? (
                      infoForm.endorsements.map((endorsement) => (
                        <div key={endorsement.id} className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{endorsement.type}</p>
                            <p className="text-xs text-gray-500">
                              Obtained {endorsement.dateObtained?.toLocaleDateString() || 'N/A'}
                              {endorsement.expiryDate ? ` | Expires ${endorsement.expiryDate.toLocaleDateString()}` : ''}
                              {endorsement.isActive ? ' | Active' : ' | Inactive'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeInfoEndorsement(endorsement.id)}
                            className="text-sm font-medium text-red-600 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-gray-500">No endorsements recorded yet.</p>
                    )}
                  </div>
                </div>
              </section>

              {hasAnyRole(user, ['admin']) && (
                <section>
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Xero Contact</h3>
                  <XeroContactPanel
                    student={student}
                    canManage
                    onChanged={refetchStudents}
                  />
                </section>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button onClick={() => setShowInfoEditor(false)} disabled={savingInfo} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveStudentInfo} disabled={savingInfo} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {savingInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- CourseProgressTab ----------

const GRADE_ORDER: Record<LessonGradingSystem, string[]> = {
  'NC/S/C/-': ['-', 'NC', 'S', 'C'],
  'Pass or Fail': ['Fail', 'Pass'],
  'Out of 100': [],
};

function gradeScore(grade: string, system: LessonGradingSystem): number {
  if (!grade || grade === '-') return 0;
  if (system === 'Out of 100') {
    const n = parseFloat(grade);
    return isNaN(n) ? 0 : n / 100;
  }
  const order = GRADE_ORDER[system];
  const idx = order.indexOf(grade);
  if (idx < 0) return 0;
  return idx / (order.length - 1);
}

function isGradeAtLeastTarget(grade: string, target: string, system: LessonGradingSystem): boolean {
  if (!target || target === '-') return true;
  if (!grade || grade === '-') return false;
  if (system === 'Out of 100') {
    return parseFloat(grade) >= parseFloat(target);
  }
  const order = GRADE_ORDER[system];
  const gradeIndex = order.indexOf(grade);
  const targetIndex = order.indexOf(target);
  return gradeIndex >= 0 && targetIndex >= 0 && gradeIndex >= targetIndex;
}

function calculateCourseProgress(
  courses: TrainingModule[],
  trainingRecords: TrainingRecord[],
  courseCompletionRule: string
): CourseProgressSummary[] {
  return courses.map((course) => {
    const courseRecords = trainingRecords.filter(record => record.courseId === course.id);
    const criteria = course.assessmentCriteria;
    const lessons = course.lessons;

    if (lessons.length === 0) return null;

    const lessonsById = new Map(lessons.map(lesson => [lesson.id, lesson]));
    const resolveLessonForRecord = (record: TrainingRecord) => {
      if (record.lessonId && lessonsById.has(record.lessonId)) {
        return lessonsById.get(record.lessonId);
      }

      const matchedIndex = (record.lessonCodes || [])
        .map((code) => matchLessonIndexByLabel(lessons, code))
        .find((index) => index >= 0);

      return matchedIndex === undefined || matchedIndex < 0 ? undefined : lessons[matchedIndex];
    };

    const touchedLessons = new Set<string>();
    for (const record of courseRecords) {
      const resolvedLesson = resolveLessonForRecord(record);
      if (resolvedLesson) touchedLessons.add(resolvedLesson.id);
    }

    const criteriaProgress = criteria.map((criterion) => {
      let bestScore = 0;
      let bestGrade = '';
      let isComplete = false;

      for (const record of courseRecords) {
        const grade = record.criteriaGrades?.[criterion.id];
        if (!grade || grade === '-') continue;

        const lesson = resolveLessonForRecord(record);
        const passMarkForLesson = lesson?.passMarks?.[criterion.id] ?? criterion.passingGrade;
        const system = criterion.gradingSystem;

        const score = gradeScore(grade, system);
        if (score > bestScore) {
          bestScore = score;
          bestGrade = grade;
        }
        if (isGradeAtLeastTarget(grade, passMarkForLesson, system)) {
          isComplete = true;
        }
      }

      return { criterion, bestGrade, bestScore, isComplete };
    });

    const completedLessons = touchedLessons.size;
    const lessonPercentage = lessons.length > 0 ? (completedLessons / lessons.length) * 100 : 0;
    const criteriaPercentage = criteriaProgress.length > 0
      ? (criteriaProgress.reduce((sum, cp) => sum + cp.bestScore, 0) / criteriaProgress.length) * 100
      : 0;

    const percentage = criteriaProgress.length > 0
      ? Math.min(100, Math.round((lessonPercentage + criteriaPercentage) / 2))
      : Math.min(100, Math.round(lessonPercentage));

    const criteriaComplete = criteriaProgress.length > 0 && criteriaProgress.every((cp) => cp.isComplete);
    const lessonsComplete = completedLessons === lessons.length && lessons.length > 0;
    const isComplete = courseCompletionRule === 'all_lessons_attempted'
      ? lessonsComplete
      : courseCompletionRule === 'criteria_or_lessons'
        ? criteriaComplete || lessonsComplete
        : criteriaProgress.length > 0
          ? criteriaComplete
          : lessonsComplete;

    return {
      course,
      percentage,
      isComplete,
      completedLessons,
      totalLessons: lessons.length,
      criteriaProgress,
      hasCriteria: criteria.length > 0,
      recordsCount: courseRecords.length,
    };
  }).filter((progress): progress is CourseProgressSummary => Boolean(progress));
}

interface CourseProgressTabProps {
  studentId: string;
  student: Student | null;
  trainingRecords: TrainingRecord[];
  courses: TrainingModule[];
  examResults: StudentExamResult[];
  users: AppUser[];
  enrolments: StudentCourseEnrolment[];
  enrolmentsLoading: boolean;
  onEnrolCourse: (courseId: string, enrolledBy?: string, notes?: string) => Promise<void>;
  onSendDeclarationLinks: (
    enrolmentId: string,
    options?: {
      recipientType?: 'student' | 'guardian' | 'both';
      deliveryMethod?: 'email' | 'sms';
      guardianEmail?: string;
      guardianPhone?: string;
      showToast?: boolean;
    }
  ) => Promise<{
    results?: Array<{
      recipientType: 'student' | 'guardian';
      deliveryMethod?: 'email' | 'sms' | 'manual';
      emailSent?: boolean;
      smsSent?: boolean;
      sendError?: string | null;
      manualLink?: string;
      skipped?: boolean;
      reason?: string;
    }>;
  }>;
  refetchStudents: () => Promise<void>;
}

const MatrixProgressSummaryCard: React.FC<{ course: TrainingModule; studentId: string }> = ({ course, studentId }) => {
  const { rowsById, requirements, bestAssessmentByRow, loading } = useSyllabusMatrix(course.id, studentId);

  const summary = useMemo(() => {
    const met = requirements.filter((requirement) => {
      const achieved = bestAssessmentByRow.get(requirement.matrixRowId)?.achievedStandard;
      return matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
    });
    const remaining = requirements
      .filter((requirement) => {
        const achieved = bestAssessmentByRow.get(requirement.matrixRowId)?.achievedStandard;
        return !matrixStandardMeetsRequirement(achieved, requirement.requiredStandard);
      })
      .map((requirement) => ({
        requirement,
        row: rowsById.get(requirement.matrixRowId),
        achieved: bestAssessmentByRow.get(requirement.matrixRowId)?.achievedStandard,
      }))
      .filter((item) => item.row)
      .sort((a, b) => (a.row?.sortOrder ?? 0) - (b.row?.sortOrder ?? 0));

    return {
      metCount: met.length,
      totalCount: requirements.length,
      percentage: requirements.length > 0 ? Math.round((met.length / requirements.length) * 100) : 0,
      standardOneRemaining: remaining.filter((item) => item.requirement.requiredStandard === 1).length,
      remaining: remaining.slice(0, 6),
    };
  }, [bestAssessmentByRow, requirements, rowsById]);

  if (loading) {
    return <div className="mt-4 h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />;
  }

  if (requirements.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">CASA Matrix Readiness</p>
          <p className="mt-1 text-sm text-blue-950">
            {summary.metCount} of {summary.totalCount} required matrix items meet the lesson standards recorded so far.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-blue-700">{summary.percentage}%</p>
          <p className="text-xs font-medium text-blue-600">{summary.standardOneRemaining} final-standard items remaining</p>
        </div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-blue-100">
        <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${summary.percentage}%` }} />
      </div>
      {summary.remaining.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Next gaps to close</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {summary.remaining.map(({ requirement, row, achieved }) => (
              <div key={requirement.id} className="rounded-lg bg-white p-3 text-xs ring-1 ring-blue-100">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{row?.elementCode || row?.unitCode || row?.code}</p>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                    {matrixStandardShortLabel(achieved)} / {requirement.requiredStandard}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-slate-600">{formatSyllabusMatrixText(row?.description)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const StudentCourseLessonLibrary: React.FC<{
  course: TrainingModule;
  records: TrainingRecord[];
}> = ({ course, records }) => {
  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => {
      const aTime = a.bookingStartTime?.getTime() ?? a.date.getTime();
      const bTime = b.bookingStartTime?.getTime() ?? b.date.getTime();
      return bTime - aTime;
    }),
    [records]
  );

  const attemptedIndexes = useMemo(
    () => sortedRecords
      .map((record) => {
        const byId = record.lessonId ? course.lessons.findIndex((lesson) => lesson.id === record.lessonId) : -1;
        if (byId >= 0) return byId;
        const byCode = (record.lessonCodes || [])
          .map((code) => matchLessonIndexByLabel(course.lessons, code))
          .find((index) => index >= 0);
        return byCode ?? -1;
      })
      .filter((index) => index >= 0),
    [course.lessons, sortedRecords]
  );

  const attemptedLessonIds = useMemo(
    () => new Set(attemptedIndexes.map((index) => course.lessons[index]?.id).filter(Boolean)),
    [attemptedIndexes, course.lessons]
  );

  const latestAttemptedIndex = attemptedIndexes.length > 0 ? Math.max(...attemptedIndexes) : -1;
  const recommendedIndex = useMemo(() => {
    const latestRecord = sortedRecords[0];
    const fromRecord = matchLessonIndexByLabel(course.lessons, latestRecord?.nextLesson);
    if (fromRecord >= 0) return fromRecord;
    const firstUnattempted = course.lessons.findIndex((lesson) => !attemptedLessonIds.has(lesson.id));
    if (firstUnattempted >= 0) return firstUnattempted;
    return latestAttemptedIndex >= 0 ? latestAttemptedIndex : 0;
  }, [attemptedLessonIds, course.lessons, latestAttemptedIndex, sortedRecords]);

  const accessibleLessonLimit = Math.max(0, Math.min(course.lessons.length - 1, recommendedIndex));
  const [selectedLessonId, setSelectedLessonId] = useState<string>(course.lessons[accessibleLessonLimit]?.id || course.lessons[0]?.id || '');

  useEffect(() => {
    const selectedLesson = course.lessons.find((lesson) => lesson.id === selectedLessonId);
    const selectedIndex = selectedLesson ? course.lessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1;
    if (!selectedLesson || selectedIndex > accessibleLessonLimit) {
      setSelectedLessonId(course.lessons[accessibleLessonLimit]?.id || course.lessons[0]?.id || '');
    }
  }, [accessibleLessonLimit, course.lessons, selectedLessonId]);

  const selectedLesson = course.lessons.find((lesson) => lesson.id === selectedLessonId) || course.lessons[accessibleLessonLimit] || course.lessons[0];
  const selectedIndex = selectedLesson ? course.lessons.findIndex((lesson) => lesson.id === selectedLesson.id) : -1;
  const previousLesson = selectedIndex > 0 ? course.lessons[selectedIndex - 1] : null;
  const upcomingLesson = selectedIndex >= 0 && selectedIndex < accessibleLessonLimit ? course.lessons[selectedIndex + 1] : null;
  const selectedStudyGuide = hasMeaningfulCourseContent(selectedLesson?.studyGuide) ? selectedLesson.studyGuide : '';
  const selectedPrep = hasMeaningfulCourseContent(selectedLesson?.studentPreparation) ? selectedLesson.studentPreparation : '';
  const selectedTheory = hasMeaningfulCourseContent(selectedLesson?.theory) ? selectedLesson.theory : '';
  const selectedExercises = hasMeaningfulCourseContent(selectedLesson?.flightExercises)
    ? selectedLesson.flightExercises
    : selectedLesson?.keyExercises.length
      ? selectedLesson.keyExercises.map((item) => `- ${item}`).join('\n')
      : '';

  const handleOpenStudyAsset = useCallback(async (asset: LessonStudyAsset) => {
    const { data, error } = await supabase.storage.from(LESSON_STUDY_BUCKET).createSignedUrl(asset.storagePath, 60);
    if (error) {
      toast.error('Failed to open lesson file');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }, []);

  if (!selectedLesson) {
    return null;
  }

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Lesson study area</p>
          <p className="mt-1 text-sm text-slate-600">Previous lessons stay available for revision, and the next recommended lesson is unlocked for study.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200">
            {attemptedLessonIds.size} {attemptedLessonIds.size === 1 ? 'lesson' : 'lessons'} unlocked by training so far
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 ring-1 ring-blue-200">
            Next: {course.lessons[recommendedIndex]?.name || course.lessons[recommendedIndex]?.sequenceTitle || 'Course complete'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Course map</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">Open any previous lesson for revision, or the next recommended lesson to prepare ahead.</p>
          </div>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {course.lessons.map((lesson, index) => {
              const isAccessible = index <= accessibleLessonLimit;
              const isCompleted = attemptedLessonIds.has(lesson.id);
              const isRecommended = index === recommendedIndex;
              const isSelected = selectedLessonId === lesson.id;

              return (
                <button
                  key={lesson.id}
                  type="button"
                  disabled={!isAccessible}
                  onClick={() => setSelectedLessonId(lesson.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50 shadow-sm'
                      : isAccessible
                        ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        : 'border-slate-200 bg-slate-50 opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {lesson.sequenceCode || `Lesson ${index + 1}`}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {lesson.name || lesson.sequenceTitle || `Lesson ${index + 1}`}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{lesson.stage} - {lesson.durationMinutes || 0} min</p>
                      {(lesson.studyAssets?.length || 0) > 0 && (
                        <p className="mt-2 text-[11px] font-medium text-emerald-700">
                          {lesson.studyAssets?.length} study {lesson.studyAssets?.length === 1 ? 'file' : 'files'}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {isCompleted ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Previous</span>
                      ) : isRecommended ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-blue-200">Next</span>
                      ) : !isAccessible ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">Later</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {selectedLesson.sequenceCode || `Lesson ${selectedIndex + 1}`}
              </p>
              <h4 className="mt-1 text-xl font-semibold text-slate-950">{selectedLesson.name || selectedLesson.sequenceTitle}</h4>
              <p className="mt-2 text-sm text-slate-500">{selectedLesson.stage} - {selectedLesson.durationMinutes || 0} min</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              {selectedIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(course.lessons[selectedIndex - 1].id)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-50"
                >
                  Previous lesson
                </button>
              )}
              {selectedIndex < accessibleLessonLimit && course.lessons[selectedIndex + 1] && (
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(course.lessons[selectedIndex + 1].id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100"
                >
                  Next lesson
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Objective</p>
              <CourseRichText value={selectedLesson.objective} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Theory focus</p>
              <CourseRichText value={selectedTheory} fallback="No theory focus has been added yet." />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flight exercises</p>
              <CourseRichText value={selectedExercises} fallback="No flight exercises have been added yet." />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-white p-2 text-emerald-700 shadow-sm ring-1 ring-emerald-100">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-950">Between-lesson study pack</p>
                <p className="mt-1 text-sm text-emerald-900">Use this section to prepare for the next flight or revise anything already covered.</p>
                {selectedPrep && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-white/90 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Before next lesson</p>
                    <CourseRichText value={selectedPrep} />
                  </div>
                )}
                <div className="mt-3 rounded-xl border border-emerald-100 bg-white p-4">
                  <CourseRichText value={selectedStudyGuide} fallback="No full study guide has been added yet." />
                </div>
              </div>
            </div>

            {selectedLesson.studyAssets && selectedLesson.studyAssets.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Study files</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {selectedLesson.studyAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => void handleOpenStudyAsset(asset)}
                      className="rounded-xl border border-emerald-200 bg-white p-4 text-left transition hover:bg-emerald-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                            {asset.type === 'image' ? <Image className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </span>
                          <p className="mt-3 text-sm font-semibold text-slate-900">{asset.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {asset.fileName}
                            {asset.sizeBytes ? ` - ${formatFileSize(asset.sizeBytes)}` : ''}
                          </p>
                          {asset.notes && <p className="mt-2 text-sm text-slate-600">{asset.notes}</p>}
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          Open
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {(previousLesson || upcomingLesson) && (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {previousLesson && (
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(previousLesson.id)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:bg-slate-100"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Previous lesson</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{previousLesson.name || previousLesson.sequenceTitle}</p>
                  <p className="mt-1 text-xs text-slate-500">{previousLesson.sequenceCode || `Lesson ${selectedIndex}`}</p>
                </button>
              )}
              {upcomingLesson && (
                <button
                  type="button"
                  onClick={() => setSelectedLessonId(upcomingLesson.id)}
                  className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4 text-left transition hover:bg-blue-100"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Coming up next</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{upcomingLesson.name || upcomingLesson.sequenceTitle}</p>
                  <p className="mt-1 text-xs text-slate-500">{upcomingLesson.sequenceCode || `Lesson ${selectedIndex + 2}`}</p>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const CourseProgressTab: React.FC<CourseProgressTabProps> = ({
  student,
  trainingRecords,
  courses,
  examResults,
  users,
  enrolments,
  enrolmentsLoading,
  onEnrolCourse,
  onSendDeclarationLinks,
  refetchStudents,
}) => {
  const { user } = useAuth();
  const { settings: trainingSettings } = useTrainingSettings();
  const [exportingCourseId, setExportingCourseId] = useState<string | null>(null);
  const [grantingEndorsementCourseIds, setGrantingEndorsementCourseIds] = useState<Set<string>>(new Set());
  const [selectedEnrolCourseId, setSelectedEnrolCourseId] = useState('');
  const [enrolmentNotes, setEnrolmentNotes] = useState('');
  const [enrollingCourse, setEnrollingCourse] = useState(false);
  const [sendingDeclarationKey, setSendingDeclarationKey] = useState<string | null>(null);
  const courseProgress = useMemo(
    () => calculateCourseProgress(courses, trainingRecords, trainingSettings.courseCompletionRule),
    [courses, trainingRecords, trainingSettings.courseCompletionRule]
  );

  const activeEnrolmentCourseIds = useMemo(
    () => new Set(enrolments.filter(enrolment => enrolment.status === 'active').map(enrolment => enrolment.courseId)),
    [enrolments]
  );
  const courseIdsWithRecords = useMemo(
    () => new Set(courseProgress
      .filter(cp => cp.recordsCount > 0 || cp.completedLessons > 0 || cp.percentage > 0)
      .map(cp => cp.course.id)),
    [courseProgress]
  );
  const enrolledCourses = courseProgress.filter((cp) => {
    return activeEnrolmentCourseIds.has(cp.course.id) || courseIdsWithRecords.has(cp.course.id);
  });
  const enrolmentChoices = courses.filter(course =>
    course.status === 'published' &&
    !activeEnrolmentCourseIds.has(course.id) &&
    !courseIdsWithRecords.has(course.id)
  );
  const canManageCourseEnrolments = Boolean(student && user && hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']));

  const grantCompletionEndorsement = useCallback(async (course: TrainingModule) => {
    if (!student || !user || !course.completionEndorsementEnabled || !course.completionEndorsementType?.trim()) return;
    if (!hasAnyRole(user, ['admin', 'instructor', 'senior_instructor'])) return;

    const endorsementType = course.completionEndorsementType.trim();
    const alreadyActive = student.endorsements.some((endorsement) =>
      endorsement.isActive && endorsement.type.trim().toLowerCase() === endorsementType.toLowerCase()
    );
    if (alreadyActive || grantingEndorsementCourseIds.has(course.id)) return;

    setGrantingEndorsementCourseIds((current) => new Set(current).add(course.id));
    try {
      const obtained = new Date();
      const expiryDate = course.completionEndorsementExpiryMonths
        ? new Date(obtained.getFullYear(), obtained.getMonth() + course.completionEndorsementExpiryMonths, obtained.getDate())
        : null;

      const { error } = await supabase.from('endorsements').insert({
        student_id: student.id,
        type: endorsementType,
        date_obtained: obtained.toISOString().slice(0, 10),
        expiry_date: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
        instructor_id: user.id,
        is_active: true,
      });

      if (error) throw error;
      let pilotRoleGranted = false;
      try {
        const reconciled = await reconcilePilotStatusForUser({
          userId: student.id,
          endorsements: [
            ...student.endorsements,
            {
              id: 'new',
              type: endorsementType,
              dateObtained: obtained,
              expiryDate: expiryDate || undefined,
              instructorId: user.id,
              isActive: true,
            },
          ],
          pilotStatusEndorsementTypes: trainingSettings.pilotStatusEndorsementTypes,
          currentRole: student.role,
          currentRoles: student.roles,
        });
        pilotRoleGranted = reconciled.changed && reconciled.role === 'pilot';
      } catch (roleError) {
        console.error('Failed to reconcile pilot status after endorsement:', roleError);
        toast.error('Endorsement saved, but Pilot status could not be updated');
      }
      await refetchStudents();
      toast.success(
        pilotRoleGranted
          ? `${endorsementType} endorsement granted. ${student.name} is now a pilot.`
          : `${endorsementType} endorsement granted for course completion`
      );
    } catch (error) {
      console.error('Failed to grant completion endorsement:', error);
      toast.error('Failed to grant completion endorsement');
    } finally {
      setGrantingEndorsementCourseIds((current) => {
        const next = new Set(current);
        next.delete(course.id);
        return next;
      });
    }
  }, [grantingEndorsementCourseIds, refetchStudents, student, trainingSettings.pilotStatusEndorsementTypes, user]);

  useEffect(() => {
    if (!student || !user || !hasAnyRole(user, ['admin', 'instructor', 'senior_instructor'])) return;
    enrolledCourses.forEach(({ course, isComplete, percentage }) => {
      if (isComplete && percentage >= 100 && course.completionEndorsementEnabled) {
        void grantCompletionEndorsement(course);
      }
    });
  }, [enrolledCourses, grantCompletionEndorsement, student, user]);

  const handleExportCourse = async (course: TrainingModule) => {
    if (!student) {
      toast.error('Student file is still loading');
      return;
    }

    setExportingCourseId(course.id);
    try {
      const { exportCoursePdf } = await import('../../utils/coursePdfExport');
      await exportCoursePdf({
        student,
        course,
        records: trainingRecords,
        exams: examResults,
        users,
        exportedBy: user,
        courseEnrolments: enrolments,
      });
      toast.success('Course PDF exported');
    } catch (error) {
      console.error('Failed to export course PDF:', error);
      toast.error('Failed to export course PDF');
    } finally {
      setExportingCourseId(null);
    }
  };

  const handleEnrolCourse = async () => {
    if (!student || !user || !selectedEnrolCourseId) return;
    setEnrollingCourse(true);
    try {
      await onEnrolCourse(selectedEnrolCourseId, user.id, enrolmentNotes);
      setSelectedEnrolCourseId('');
      setEnrolmentNotes('');
    } finally {
      setEnrollingCourse(false);
    }
  };

  const handleSendDeclarationLink = async (
    enrolment: StudentCourseEnrolment,
    recipientType: 'student' | 'guardian',
    deliveryMethod: 'email' | 'sms' = 'email'
  ) => {
    const actionKey = `${enrolment.id}-${recipientType}-${deliveryMethod}`;
    setSendingDeclarationKey(actionKey);
    try {
      let guardianEmail: string | undefined;
      let guardianPhone: string | undefined;

      if (recipientType === 'guardian' && deliveryMethod === 'email') {
        const current = enrolment.guardianDeclarationEmail || '';
        guardianEmail = window.prompt('Parent/guardian email address', current) || undefined;
        if (!guardianEmail?.trim()) return;
      }

      if (recipientType === 'guardian' && deliveryMethod === 'sms') {
        const current = enrolment.guardianDeclarationPhone || student?.emergencyContact?.phone || '';
        guardianPhone = window.prompt('Parent/guardian mobile number for SMS', current) || undefined;
        if (!guardianPhone?.trim()) return;
      }

      const result = await onSendDeclarationLinks(enrolment.id, {
        recipientType,
        deliveryMethod,
        guardianEmail,
        guardianPhone,
        showToast: false,
      });
      const activeResult = result.results?.find(item => item.recipientType === recipientType);
      if (!activeResult) {
        toast.error('No declaration link response was returned');
        return;
      }

      if (activeResult.sendError) {
        toast.error(activeResult.sendError);
        return;
      }

      if (activeResult?.emailSent || activeResult?.smsSent) {
        toast.success(`${recipientType === 'student' ? 'Student' : 'Parent/guardian'} declaration link sent`);
        return;
      }

      if (activeResult?.manualLink) {
        try {
          await navigator.clipboard?.writeText(activeResult.manualLink);
          toast.success('Signing link generated and copied');
        } catch {
          window.prompt('Signing link generated. Copy this link:', activeResult.manualLink);
          toast.success('Signing link generated');
        }
        return;
      }

      toast.success(activeResult?.reason || 'No declaration link needed');
    } catch (error) {
      console.error('Failed to send declaration signing link:', error);
      toast.error('Failed to send declaration signing link');
    } finally {
      setSendingDeclarationKey(null);
    }
  };

  return (
    <div className="space-y-6">
      {canManageCourseEnrolments && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">Course Enrolment</p>
              <p className="text-xs text-gray-500 mt-1">Enrol this member before the first lesson is logged.</p>
              <select
                value={selectedEnrolCourseId}
                onChange={(event) => setSelectedEnrolCourseId(event.target.value)}
                disabled={enrolmentsLoading || enrolmentChoices.length === 0}
                className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              >
                <option value="">
                  {enrolmentChoices.length === 0 ? 'No published courses available to enrol' : 'Select a course'}
                </option>
                {enrolmentChoices.map(course => (
                  <option key={course.id} value={course.id}>{course.title}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</label>
              <input
                type="text"
                value={enrolmentNotes}
                onChange={(event) => setEnrolmentNotes(event.target.value)}
                placeholder="Optional enrolment note"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleEnrolCourse}
              disabled={!selectedEnrolCourseId || enrollingCourse}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {enrollingCourse ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Enrol
            </button>
          </div>
        </div>
      )}

      {enrolledCourses.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-12 text-center">
          <GraduationCap className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No course enrolments yet</h3>
          <p className="text-gray-500 text-sm">
            Enrolled courses and progress will appear here, even before the first lesson is logged.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Courses In Progress</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{enrolledCourses.filter(c => !c.isComplete).length}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Courses Completed</p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">{enrolledCourses.filter(c => c.isComplete).length}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Total Enrolled</p>
              <p className="text-3xl font-bold text-gray-700 mt-1">{enrolledCourses.length}</p>
            </div>
          </div>

      {enrolledCourses.map(({ course, percentage, isComplete, completedLessons, totalLessons, criteriaProgress, hasCriteria }) => {
        const enrolment = enrolments.find(item => item.courseId === course.id && item.status === 'active');
        const courseRecords = trainingRecords.filter((record) => record.courseId === course.id && record.status !== 'draft');
        const declarationRequired = Boolean(course.requiresFlyingDeclaration);
        const declarationSigned = Boolean(
          enrolment?.declarationSignedAt &&
          (enrolment.declarationVersion ?? 0) >= (course.flyingDeclarationVersion ?? 1)
        );
        const studentIsMinor = Boolean(student?.dateOfBirth && new Date() < new Date(
          student.dateOfBirth.getFullYear() + 18,
          student.dateOfBirth.getMonth(),
          student.dateOfBirth.getDate()
        ));
        const guardianRequired = declarationRequired && studentIsMinor && (course.requiresGuardianDeclarationForMinors ?? true);
        const guardianDeclarationSigned = Boolean(
          enrolment?.guardianDeclarationSignedAt &&
          (enrolment.guardianDeclarationVersion ?? 0) >= (course.flyingDeclarationVersion ?? 1)
        );

        return (
        <div key={course.id} className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-1">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{course.title}</h3>
                  {isComplete && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Completed
                    </span>
                  )}
                  {activeEnrolmentCourseIds.has(course.id) && !isComplete && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                      Enrolled
                    </span>
                  )}
                  {course.completionEndorsementEnabled && course.completionEndorsementType && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                      <Award className="h-3 w-3 mr-1" />
                      Grants {course.completionEndorsementType}
                    </span>
                  )}
                  {declarationRequired && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${
                      declarationSigned && (!guardianRequired || guardianDeclarationSigned)
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}>
                      <Shield className="h-3 w-3 mr-1" />
                      {declarationSigned && (!guardianRequired || guardianDeclarationSigned) ? 'Declaration signed' : 'Declaration required'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{course.category} &middot; v{course.version}</p>
              </div>
              <div className="ml-4 flex shrink-0 items-start gap-3">
                <button
                  type="button"
                  onClick={() => handleExportCourse(course)}
                  disabled={exportingCourseId === course.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {exportingCourseId === course.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Export PDF
                </button>
                <div className="text-right">
                <span className={`text-3xl font-bold ${isComplete ? 'text-emerald-600' : percentage >= 50 ? 'text-blue-600' : 'text-gray-700'}`}>
                  {percentage}%
                </span>
                </div>
              </div>
            </div>

            {declarationRequired && (
              <div className={`mb-4 rounded-lg border p-3 text-sm ${
                declarationSigned && (!guardianRequired || guardianDeclarationSigned)
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <p className="font-semibold">{course.flyingDeclarationTitle || 'Flying Declaration'}</p>
                  <div className="space-y-2 text-xs sm:text-right">
                    <p>
                      {declarationSigned
                        ? `Student signed ${enrolment?.declarationSignedAt?.toLocaleDateString('en-AU') || 'date not recorded'} by ${enrolment?.declarationSignedName || student?.name || 'student'}${enrolment?.declarationMemberNumber ? `, member ${enrolment.declarationMemberNumber}` : ''}`
                        : `Awaiting student signature for version ${course.flyingDeclarationVersion ?? 1}`}
                    </p>
                    {guardianRequired && (
                      <p>
                        {guardianDeclarationSigned
                          ? `Parent/guardian signed ${enrolment?.guardianDeclarationSignedAt?.toLocaleDateString('en-AU') || 'date not recorded'} by ${enrolment?.guardianDeclarationSignedName || 'guardian'}${enrolment?.guardianDeclarationRelationship ? ` (${enrolment.guardianDeclarationRelationship})` : ''}`
                          : 'Awaiting parent/guardian signature'}
                      </p>
                    )}
                    {canManageCourseEnrolments && enrolment && (!declarationSigned || (guardianRequired && !guardianDeclarationSigned)) && (
                      <div className="flex flex-wrap justify-start gap-2 pt-1 sm:justify-end">
                        {!declarationSigned && (
                          <button
                            type="button"
                            onClick={() => handleSendDeclarationLink(enrolment, 'student', 'email')}
                            disabled={sendingDeclarationKey === `${enrolment.id}-student-email`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                          >
                            {sendingDeclarationKey === `${enrolment.id}-student-email` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            Send student link
                          </button>
                        )}
                        {guardianRequired && !guardianDeclarationSigned && (
                          <button
                            type="button"
                            onClick={() => handleSendDeclarationLink(enrolment, 'guardian', 'email')}
                            disabled={sendingDeclarationKey === `${enrolment.id}-guardian-email`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                          >
                            {sendingDeclarationKey === `${enrolment.id}-guardian-email` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            Send parent email
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{completedLessons} of {totalLessons} lessons attempted</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all duration-500 ${isComplete ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Criteria breakdown */}
            {hasCriteria && criteriaProgress.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Assessment Criteria</p>
                <div className="flex flex-wrap gap-2">
                  {criteriaProgress.map(({ criterion, bestGrade, bestScore, isComplete: critComplete }) => {
                    let chipClass = 'bg-gray-100 text-gray-600 border-gray-200';
                    if (critComplete) chipClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                    else if (bestScore > 0) chipClass = 'bg-amber-100 text-amber-800 border-amber-200';

                    return (
                      <div
                        key={criterion.id}
                        title={`Best grade: ${bestGrade || 'None'}`}
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${chipClass}`}
                      >
                        {critComplete && <CheckCircle className="h-3 w-3 mr-1" />}
                        {criterion.name}
                        {bestGrade && bestGrade !== '-' && (
                          <span className="ml-1 opacity-70">({bestGrade})</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {student && <MatrixProgressSummaryCard course={course} studentId={student.id} />}

            <StudentCourseLessonLibrary course={course} records={courseRecords} />
          </div>
        </div>
        );
      })}
        </>
      )}
    </div>
  );
};
