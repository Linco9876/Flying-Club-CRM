import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { TrainingModule } from '../../types';
import { supabase } from '../../lib/supabase';
import {
  createRejectedRowsCsv,
  type CsvParseResult,
  formatLessonLabel,
  type ImportMappingState,
  parseCsv,
  type StudentRecordImportType,
  withUtf8CsvBom,
} from '../../utils/studentRecordImport';
import {
  buildCourseCompetencyDefinitions,
  createCourseTransferCsv,
  getCourseCompetencyGuideCsv,
  getCourseStudentRecordTemplate,
  getCourseTransferFilename,
  type CourseCompetencyDefinition,
  validateCourseStudentRecordCsv,
} from '../../utils/studentCourseRecordTransfer';

interface ImportBatch {
  id: string;
  record_type: StudentRecordImportType;
  source_filename: string;
  status: 'committed' | 'rolled_back';
  total_rows: number;
  imported_rows: number;
  duplicate_rows: number;
  competency_rows?: number;
  course_id?: string | null;
  course_version?: string | null;
  imported_at: string;
  rolled_back_at?: string | null;
}

interface ServerPreview {
  can_import: boolean;
  committed: boolean;
  batch_id?: string;
  total_rows: number;
  ready_rows?: number;
  imported_rows?: number;
  duplicate_rows: number;
  error_rows: number;
  rows?: Array<{ source_row: number; status: 'ready' | 'duplicate' | 'error'; messages: string[] }>;
}

interface StudentRecordImportModalProps {
  studentId: string;
  studentName: string;
  courses: TrainingModule[];
  isAdmin: boolean;
  onClose: () => void;
  onImported: () => Promise<void> | void;
}

const EMPTY_MAPPINGS: ImportMappingState = { courses: {}, lessons: {}, exams: {} };
const keyForCourse = (value: string) => value.trim().toLocaleLowerCase();

const downloadTextFile = (contents: string, filename: string) => {
  const blob = new Blob([withUtf8CsvBom(contents)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const StudentRecordImportModal: React.FC<StudentRecordImportModalProps> = ({
  studentId,
  studentName,
  courses,
  isAdmin,
  onClose,
  onImported,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [recordType, setRecordType] = useState<StudentRecordImportType>('lesson');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [competencies, setCompetencies] = useState<CourseCompetencyDefinition[]>([]);
  const [loadingCompetencies, setLoadingCompetencies] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mappings, setMappings] = useState<ImportMappingState>(EMPTY_MAPPINGS);
  const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [requestAcknowledgement, setRequestAcknowledgement] = useState(false);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const selectedCourse = useMemo(
    () => courses.find(course => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );
  const identity = useMemo(
    () => selectedCourse ? { studentId, studentName, course: selectedCourse } : null,
    [selectedCourse, studentId, studentName],
  );
  const validation = useMemo(
    () => parsed && identity
      ? validateCourseStudentRecordCsv(parsed, recordType, identity, competencies, mappings)
      : null,
    [competencies, identity, mappings, parsed, recordType],
  );

  useEffect(() => setServerPreview(null), [validation]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from('student_record_import_batches')
      .select('id,record_type,source_filename,status,total_rows,imported_rows,duplicate_rows,competency_rows,course_id,course_version,imported_at,rolled_back_at')
      .eq('student_id', studentId)
      .order('imported_at', { ascending: false })
      .limit(10);
    if (error) console.error('Failed to load student import history:', error);
    setBatches((data || []) as ImportBatch[]);
    setLoadingHistory(false);
  }, [studentId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    if (!selectedCourseId || recordType !== 'lesson') {
      setCompetencies([]);
      setLoadingCompetencies(false);
      return () => {
        active = false;
      };
    }
    setLoadingCompetencies(true);
    void Promise.all([
      supabase
        .from('syllabus_matrix_rows')
        .select('id,code,description')
        .eq('course_id', selectedCourseId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('syllabus_matrix_requirements')
        .select('matrix_row_id,lesson_id')
        .eq('course_id', selectedCourseId),
    ]).then(([rowsResult, requirementsResult]) => {
      if (!active) return;
      if (rowsResult.error) throw rowsResult.error;
      if (requirementsResult.error) throw requirementsResult.error;
      setCompetencies(buildCourseCompetencyDefinitions(
        rowsResult.data || [],
        requirementsResult.data || [],
      ));
    }).catch(error => {
      console.error('Failed to load course competency codes:', error);
      if (active) {
        setCompetencies([]);
        toast.error('Could not load the course competency codes');
      }
    }).finally(() => {
      if (active) setLoadingCompetencies(false);
    });
    return () => {
      active = false;
    };
  }, [recordType, selectedCourseId]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
      ) || [])].filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  const resetFile = () => {
    setSourceFile(null);
    setParsed(null);
    setMappings(EMPTY_MAPPINGS);
    setServerPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTypeChange = (nextType: StudentRecordImportType) => {
    setRecordType(nextType);
    resetFile();
    setRequestAcknowledgement(false);
  };

  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
    resetFile();
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Choose a CSV file');
      return;
    }
    if (file.size > 2_000_000) {
      toast.error('CSV files are limited to 2 MB');
      return;
    }
    const result = parseCsv(await file.text());
    setSourceFile(file);
    setParsed(result);
    setMappings(EMPTY_MAPPINGS);
    setServerPreview(null);
  };

  const updateCourseMapping = (label: string, courseId: string) => {
    setMappings(current => ({
      ...current,
      courses: { ...current.courses, [keyForCourse(label)]: courseId },
    }));
  };

  const preview = async () => {
    if (!sourceFile || !validation || !selectedCourse || validation.errors.length > 0 || validation.rows.length === 0) return;
    setPreviewing(true);
    try {
      const { data, error } = await supabase.rpc('process_student_course_record_import', {
        p_student_id: studentId,
        p_course_id: selectedCourse.id,
        p_course_version: selectedCourse.version,
        p_record_type: recordType,
        p_filename: sourceFile.name,
        p_rows: validation.rows,
        p_commit: false,
        p_request_student_acknowledgement: requestAcknowledgement,
      });
      if (error) throw error;
      setServerPreview(data as ServerPreview);
    } catch (error: any) {
      console.error('Failed to preview student record import:', error);
      toast.error(error?.message || 'Could not validate the import');
    } finally {
      setPreviewing(false);
    }
  };

  const commit = async () => {
    if (!sourceFile || !validation || !selectedCourse || !serverPreview?.can_import) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.rpc('process_student_course_record_import', {
        p_student_id: studentId,
        p_course_id: selectedCourse.id,
        p_course_version: selectedCourse.version,
        p_record_type: recordType,
        p_filename: sourceFile.name,
        p_rows: validation.rows,
        p_commit: true,
        p_request_student_acknowledgement: requestAcknowledgement,
      });
      if (error) throw error;
      const result = data as ServerPreview;
      toast.success(
        `${result.imported_rows || 0} ${recordType} record${result.imported_rows === 1 ? '' : 's'} imported`
        + (result.duplicate_rows ? `; ${result.duplicate_rows} duplicate${result.duplicate_rows === 1 ? '' : 's'} skipped` : ''),
      );
      resetFile();
      await Promise.all([loadHistory(), onImported()]);
    } catch (error: any) {
      console.error('Failed to import student records:', error);
      toast.error(error?.message || 'Import failed without changing any records');
    } finally {
      setImporting(false);
    }
  };

  const rollback = async (batch: ImportBatch) => {
    const confirmed = window.confirm(
      `Undo the import from ${batch.source_filename}?\n\n`
      + `This removes only the ${batch.imported_rows} records created by that import. The reversal remains in the audit history.`,
    );
    if (!confirmed) return;
    setRollingBackId(batch.id);
    try {
      const { data, error } = await supabase.rpc('rollback_student_record_import', { p_batch_id: batch.id });
      if (error) throw error;
      const result = data as { deleted_records?: number };
      toast.success(`Import undone; ${result.deleted_records || 0} record${result.deleted_records === 1 ? '' : 's'} removed`);
      await Promise.all([loadHistory(), onImported()]);
    } catch (error: any) {
      console.error('Failed to undo student record import:', error);
      toast.error(error?.message || 'Could not undo this import');
    } finally {
      setRollingBackId(null);
    }
  };

  const downloadRejected = () => {
    if (!parsed || !validation) return;
    const serverErrors = (serverPreview?.rows || [])
      .filter(row => row.status === 'error')
      .map(row => ({ sourceRow: row.source_row, messages: row.messages }));
    const combined = [...validation.errors, ...serverErrors];
    downloadTextFile(
      createRejectedRowsCsv(parsed, combined),
      `${studentName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${recordType}-records-to-correct.csv`,
    );
  };

  const downloadTemplate = () => {
    if (!identity) return;
    downloadTextFile(
      getCourseStudentRecordTemplate(recordType, identity, competencies),
      getCourseTransferFilename(identity, recordType, 'template'),
    );
  };

  const downloadCompetencyGuide = () => {
    if (!identity) return;
    downloadTextFile(
      getCourseCompetencyGuideCsv(identity, competencies),
      getCourseTransferFilename(identity, 'lesson', 'competency-guide'),
    );
  };

  const exportCurrentData = async () => {
    if (!identity) return;
    setExporting(true);
    try {
      const common = {
        include: 'Yes',
        student_portal_id: studentId,
        student_name: studentName,
        course: identity.course.title,
        course_version: identity.course.version,
      };
      let exportRows: Array<Record<string, string>> = [];

      if (recordType === 'lesson') {
        const { data: records, error: recordsError } = await supabase
          .from('training_records')
          .select('id,date,lesson_id,registration,aircraft_type,dual_time_min,solo_time_min,comments,formal_briefing,next_lesson,student_ack,source_instructor_name,source_organisation,source_reference,instructor_id')
          .eq('student_id', studentId)
          .eq('course_id', identity.course.id)
          .order('date', { ascending: true });
        if (recordsError) throw recordsError;

        const recordIds = (records || []).map(record => record.id);
        const instructorIds = [...new Set((records || []).map(record => record.instructor_id).filter(Boolean))];
        const [assessmentsResult, instructorsResult] = await Promise.all([
          recordIds.length
            ? supabase
                .from('student_matrix_assessments')
                .select('training_record_id,matrix_row_id,achieved_standard,comments')
                .in('training_record_id', recordIds)
            : Promise.resolve({ data: [], error: null }),
          instructorIds.length
            ? supabase.from('users').select('id,name,email').in('id', instructorIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (assessmentsResult.error) throw assessmentsResult.error;
        if (instructorsResult.error) throw instructorsResult.error;
        const instructors = new Map((instructorsResult.data || []).map(instructor => [
          instructor.id,
          instructor.name || instructor.email || 'Portal instructor',
        ]));
        const assessmentsByRecord = new Map<string, Array<{
          matrix_row_id: string;
          achieved_standard: number | null;
          comments: string | null;
        }>>();
        (assessmentsResult.data || []).forEach(assessment => {
          const current = assessmentsByRecord.get(assessment.training_record_id) || [];
          current.push(assessment);
          assessmentsByRecord.set(assessment.training_record_id, current);
        });

        exportRows = (records || []).map(record => {
          const lesson = identity.course.lessons.find(candidate => candidate.id === record.lesson_id);
          const row: Record<string, string> = {
            ...common,
            record_reference: record.source_reference || `portal-${record.id}`,
            date: record.date,
            lesson: lesson ? formatLessonLabel(lesson) : '',
            aircraft_registration: record.registration || '',
            aircraft_type: record.aircraft_type || '',
            dual_time: `${Math.floor((record.dual_time_min || 0) / 60)}:${String((record.dual_time_min || 0) % 60).padStart(2, '0')}`,
            solo_time: `${Math.floor((record.solo_time_min || 0) / 60)}:${String((record.solo_time_min || 0) % 60).padStart(2, '0')}`,
            instructor_name: record.source_instructor_name || instructors.get(record.instructor_id) || 'Portal instructor',
            source_organisation: record.source_organisation || 'Bendigo Flying Club portal',
            comments: record.comments || '',
            formal_briefing: record.formal_briefing ? 'Yes' : 'No',
            next_lesson: record.next_lesson || '',
            student_acknowledged: record.student_ack ? 'Yes' : 'No',
          };
          (assessmentsByRecord.get(record.id) || []).forEach(assessment => {
            const competency = competencies.find(candidate => candidate.id === assessment.matrix_row_id);
            if (!competency || !assessment.achieved_standard) return;
            row[competency.column] = String(assessment.achieved_standard);
            row[competency.commentsColumn] = assessment.comments || '';
          });
          return row;
        });
      } else {
        const { data: exams, error } = await supabase
          .from('student_exam_results')
          .select('id,exam_date,exam_id,exam_name,score,pass_mark,notes,kdr_completed,source_instructor_name,source_organisation,source_reference,instructor_id')
          .eq('student_id', studentId)
          .eq('course_id', identity.course.id)
          .order('exam_date', { ascending: true });
        if (error) throw error;
        const instructorIds = [...new Set((exams || []).map(exam => exam.instructor_id).filter(Boolean))];
        const { data: instructorRows, error: instructorsError } = instructorIds.length
          ? await supabase.from('users').select('id,name,email').in('id', instructorIds)
          : { data: [], error: null };
        if (instructorsError) throw instructorsError;
        const instructors = new Map((instructorRows || []).map(instructor => [
          instructor.id,
          instructor.name || instructor.email || 'Portal instructor',
        ]));
        exportRows = (exams || []).map(exam => ({
          ...common,
          record_reference: exam.source_reference || `portal-${exam.id}`,
          exam_date: exam.exam_date,
          exam: exam.exam_name || identity.course.exams?.find(candidate => candidate.id === exam.exam_id)?.name || '',
          score_percent: String(exam.score),
          pass_mark: String(exam.pass_mark),
          instructor_name: exam.source_instructor_name || instructors.get(exam.instructor_id) || 'Portal instructor',
          source_organisation: exam.source_organisation || 'Bendigo Flying Club portal',
          notes: exam.notes || '',
          kdr_completed: exam.kdr_completed ? 'Yes' : 'No',
        }));
      }

      if (exportRows.length === 0) {
        toast.error(`No ${recordType === 'lesson' ? 'lesson records' : 'exam results'} exist for this student and course`);
        return;
      }
      downloadTextFile(
        createCourseTransferCsv(recordType, competencies, exportRows),
        getCourseTransferFilename(identity, recordType, 'export'),
      );
      toast.success(`Exported ${exportRows.length} ${recordType === 'lesson' ? 'lesson records' : 'exam results'}`);
    } catch (error: any) {
      console.error('Failed to export student course records:', error);
      toast.error(error?.message || 'Could not export the current data');
    } finally {
      setExporting(false);
    }
  };

  const hasMappingWork = Boolean(
    validation?.unmatchedCourses.length
    || validation?.unmatchedLessons.length
    || validation?.unmatchedExams.length,
  );
  const canPreview = Boolean(
    sourceFile
    && validation
    && validation.rows.length > 0
    && validation.errors.length === 0
    && !hasMappingWork,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="student-import-title" aria-describedby="student-import-description">
      <div ref={dialogRef} className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-slate-900 px-5 py-4 text-white sm:px-6">
          <div className="min-w-0">
            <h2 id="student-import-title" className="break-words text-lg font-bold sm:text-xl">Import or export student records</h2>
            <p id="student-import-description" className="mt-1 break-words text-sm text-slate-300">{studentName} · previewed and audited before anything is saved</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Close import records">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-5">
              <section>
                <p className="mb-2 text-sm font-semibold text-gray-900">1. Choose the course and record type</p>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
                  {(['lesson', 'exam'] as StudentRecordImportType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleTypeChange(type)}
                      className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                        recordType === type ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {type === 'lesson' ? 'Lesson records' : 'Exam results'}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block text-sm font-medium text-gray-800">
                  Course
                  <select
                    value={selectedCourseId}
                    onChange={event => handleCourseChange(event.target.value)}
                    className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">Choose a course...</option>
                    {courses.map(course => (
                      <option key={course.id} value={course.id}>{course.title} · version {course.version}</option>
                    ))}
                  </select>
                </label>
                {selectedCourse && recordType === 'lesson' && (
                  <p className={`mt-2 text-xs ${!loadingCompetencies && competencies.length === 0 ? 'font-medium text-amber-700' : 'text-gray-600'}`}>
                    {loadingCompetencies
                      ? 'Loading competency codes...'
                      : competencies.length > 0
                        ? `${competencies.length} competency code${competencies.length === 1 ? '' : 's'} will be included in this course format.`
                        : 'This course has no competency codes configured. The template will import lesson records only.'}
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="font-semibold text-blue-950">2. Download or export</p>
                    <p className="mt-1 text-sm text-blue-800">
                      The file is tied to {studentName} and the selected course version. Existing data exports in the same format and can be safely re-imported.
                    </p>
                    <p className="mt-2 text-sm font-medium text-blue-900">
                      Fill in the completed rows—the portal detects them automatically. Enter Skip in Include only when you want to omit a filled row.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={downloadTemplate}
                      disabled={!identity || loadingCompetencies}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" /> Download course template
                    </button>
                    <button
                      type="button"
                      onClick={() => void exportCurrentData()}
                      disabled={!identity || exporting || loadingCompetencies}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                      Export current data
                    </button>
                    {recordType === 'lesson' && competencies.length > 0 && (
                      <button
                        type="button"
                        onClick={downloadCompetencyGuide}
                        disabled={!identity}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-200 disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" /> Competency code guide
                      </button>
                    )}
                  </div>
                </div>
                <details className="mt-3 text-sm text-blue-900">
                  <summary className="cursor-pointer font-medium">Formatting help and examples</summary>
                  {recordType === 'lesson' ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>Completed rows are detected automatically. Include may also be Yes, X, Completed or Done.</li>
                      <li>Enter Skip in Include to deliberately omit a filled row.</li>
                      <li>Record reference is optional. Use an old lesson or logbook number when available; otherwise the portal creates a stable reference automatically.</li>
                      <li>Dates may be DD/MM/YYYY or YYYY-MM-DD.</li>
                      <li>Times may be 1.25 hours, 1:15, or 75m.</li>
                      {competencies.length > 0 && <li>Enter 1, 2 or 3 in the relevant competency-code columns; leave unassessed codes blank.</li>}
                      <li>Use Yes or No for formal briefing and historical student acknowledgement.</li>
                    </ul>
                  ) : (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>Completed rows are detected automatically. Include may also be Yes, X, Completed or Done.</li>
                      <li>Enter Skip in Include to deliberately omit a filled row.</li>
                      <li>Record reference is optional. Use the original result number when available; otherwise the portal creates one automatically.</li>
                      <li>Scores and pass marks are percentages between 0 and 100.</li>
                      <li>Use Yes or No for KDR completed.</li>
                    </ul>
                  )}
                </details>
              </section>

              <section>
                <p className="mb-2 text-sm font-semibold text-gray-900">3. Upload the completed CSV</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={event => void handleFile(event.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!identity || loadingCompetencies}
                  className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-gray-300 px-5 py-8 text-center hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-8 w-8 text-blue-600" />
                  <span className="mt-2 font-semibold text-gray-900">{sourceFile ? sourceFile.name : 'Choose CSV file'}</span>
                  <span className="mt-1 text-xs text-gray-500">
                    {identity ? 'Maximum 500 records and 2 MB' : 'Choose a course first'}
                  </span>
                </button>
                {parsed?.errors.map(error => (
                  <p key={error} className="mt-2 flex items-start gap-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>
                ))}
              </section>

              {validation && hasMappingWork && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-semibold text-amber-950">4. Match names to the portal</h3>
                  <p className="mt-1 text-sm text-amber-800">Nothing is created automatically. Confirm what each historical label means.</p>
                  <div className="mt-4 space-y-3">
                    {validation.unmatchedCourses.map(label => (
                      <label key={label} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
                        <span className="font-medium text-gray-800">Course: “{label}”</span>
                        <select
                          value={mappings.courses[keyForCourse(label)] || ''}
                          onChange={event => updateCourseMapping(label, event.target.value)}
                          className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-gray-900"
                        >
                          <option value="">Choose course…</option>
                          {courses.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
                        </select>
                      </label>
                    ))}
                    {validation.unmatchedLessons.map(item => {
                      const course = courses.find(candidate => candidate.id === item.courseId);
                      return (
                        <label key={item.key} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
                          <span className="font-medium text-gray-800">Lesson: “{item.lessonLabel}”</span>
                          <select
                            value={mappings.lessons[item.key] || ''}
                            disabled={!course}
                            onChange={event => setMappings(current => ({ ...current, lessons: { ...current.lessons, [item.key]: event.target.value } }))}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-gray-900 disabled:opacity-50"
                          >
                            <option value="">{course ? 'Choose lesson…' : 'Choose the course first'}</option>
                            {course?.lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.sequenceCode ? `${lesson.sequenceCode} · ` : ''}{lesson.name}</option>)}
                          </select>
                        </label>
                      );
                    })}
                    {validation.unmatchedExams.map(item => {
                      const course = courses.find(candidate => candidate.id === item.courseId);
                      return (
                        <label key={item.key} className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3">
                          <span className="font-medium text-gray-800">Exam: “{item.examLabel}”</span>
                          <select
                            value={mappings.exams[item.key] || ''}
                            disabled={!course}
                            onChange={event => setMappings(current => ({ ...current, exams: { ...current.exams, [item.key]: event.target.value } }))}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-gray-900 disabled:opacity-50"
                          >
                            <option value="">{course ? 'Choose exam…' : 'Choose the course first'}</option>
                            {course?.exams?.map(exam => <option key={exam.id} value={exam.id}>{exam.name}</option>)}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {validation && validation.errors.length > 0 && (
                <section className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-red-950">
                        {validation.errors.length} row{validation.errors.length === 1 ? ' needs' : 's need'} attention
                      </h3>
                      <p className="text-sm text-red-800">Correct these before the server preview can run.</p>
                    </div>
                    <button type="button" onClick={downloadRejected} className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">
                      <Download className="h-4 w-4" /> Download rows to correct
                    </button>
                  </div>
                  <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                    {validation.errors.slice(0, 30).map(error => (
                      <div key={`${error.sourceRow}-${error.messages.join()}`} className="rounded-lg bg-white p-3 text-sm text-red-900 ring-1 ring-red-100">
                        <strong>Row {error.sourceRow}:</strong> {error.messages.join(' ')}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recordType === 'lesson' && validation && (
                <label className="flex items-start gap-3 rounded-xl border border-gray-200 p-4">
                  <input
                    type="checkbox"
                    checked={requestAcknowledgement}
                    onChange={event => {
                      setRequestAcknowledgement(event.target.checked);
                      setServerPreview(null);
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Ask the student to acknowledge imported lessons</span>
                    <span className="mt-1 block text-xs text-gray-600">Off by default. Historical records remain locked and do not generate an acknowledgement task unless enabled.</span>
                  </span>
                </label>
              )}

              {serverPreview && (
                <section className={`rounded-xl border p-4 ${serverPreview.can_import ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-start gap-3">
                    {serverPreview.can_import ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-red-600" />}
                    <div>
                      <h3 className={`font-semibold ${serverPreview.can_import ? 'text-emerald-950' : 'text-red-950'}`}>
                        {serverPreview.can_import ? 'Server validation passed' : 'Server validation found a problem'}
                      </h3>
                      <p className={`mt-1 text-sm ${serverPreview.can_import ? 'text-emerald-800' : 'text-red-800'}`}>
                        {serverPreview.ready_rows || 0} ready · {serverPreview.duplicate_rows} duplicate{serverPreview.duplicate_rows === 1 ? '' : 's'} will be skipped · {serverPreview.error_rows} errors
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">Close</button>
                <button
                  type="button"
                  onClick={() => void preview()}
                  disabled={!canPreview || previewing || importing}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Preview safely
                </button>
                <button
                  type="button"
                  onClick={() => void commit()}
                  disabled={!serverPreview?.can_import || importing || previewing}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Import {serverPreview?.ready_rows || 0} records
                </button>
              </div>
            </main>

            <aside className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <ShieldCheck className="h-6 w-6 text-emerald-700" />
                <h3 className="mt-2 font-semibold text-emerald-950">Safe historical import</h3>
                <ul className="mt-2 space-y-2 text-xs leading-5 text-emerald-900">
                  <li>Does not create bookings or flight logs.</li>
                  <li>Does not alter aircraft times or maintenance.</li>
                  <li>Does not create invoices or contact Stripe/Xero.</li>
                  <li>Duplicate uploads are skipped.</li>
                  <li>Original source and importer remain traceable.</li>
                </ul>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-gray-500" />
                  <h3 className="font-semibold text-gray-900">Recent imports</h3>
                </div>
                {loadingHistory ? (
                  <div className="mt-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-600" /></div>
                ) : batches.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">No CSV imports for this student.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {batches.map(batch => (
                      <div key={batch.id} className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900" title={batch.source_filename}>{batch.source_filename}</p>
                            <p className="mt-1 text-xs text-gray-500">{new Date(batch.imported_at).toLocaleString()} · {batch.record_type}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${batch.status === 'committed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                            {batch.status === 'committed' ? 'Imported' : 'Undone'}
                          </span>
                        </div>
                          <p className="mt-2 text-xs text-gray-600">
                            {batch.course_id
                              ? `${courses.find(course => course.id === batch.course_id)?.title || 'Course'}${batch.course_version ? ` v${batch.course_version}` : ''} · `
                              : ''}
                            {batch.imported_rows} added · {batch.duplicate_rows} skipped
                            {batch.competency_rows ? ` · ${batch.competency_rows} competency results` : ''}
                          </p>
                        {isAdmin && batch.status === 'committed' && (
                          <button
                            type="button"
                            onClick={() => void rollback(batch)}
                            disabled={rollingBackId === batch.id}
                            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:text-red-800 disabled:opacity-50"
                          >
                            {rollingBackId === batch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Undo this import
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
                Imports over 25 rows require MFA. Undoing an import always requires administrator MFA.
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};
