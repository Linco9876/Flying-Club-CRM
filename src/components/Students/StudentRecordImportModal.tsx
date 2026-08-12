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
  getRecordImportCourses,
  getImportWorkflowPresentation,
  type ImportMappingState,
  parseCsv,
  withUtf8CsvBom,
} from '../../utils/studentRecordImport';
import {
  buildCourseCompetencyDefinitions,
  buildCourseCriterionDefinitions,
  createCourseTransferCsv,
  getCourseCompetencyGuideCsv,
  getCourseStudentRecordTemplate,
  getCourseTransferFilename,
  type ImportedFlightTestResult,
  normaliseImportedFlightTestResult,
  type CourseCompetencyDefinition,
  validateCourseStudentRecordCsv,
  type CourseTransferRecordType,
} from '../../utils/studentCourseRecordTransfer';
import {
  buildReviewChecklistTransferDefinitions,
  createReviewTransferCsv,
  getReviewChecklistGuideCsv,
  getReviewRecordTemplate,
  type ReviewChecklistTransferDefinition,
  validateReviewRecordCsv,
} from '../../utils/studentReviewRecordTransfer';

interface ImportBatch {
  id: string;
  record_type: CourseTransferRecordType;
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

interface FlightTestImportOutcome {
  result: ImportedFlightTestResult;
  findings: string;
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
  const [recordType, setRecordType] = useState<CourseTransferRecordType>('lesson');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [matrixCompetencies, setMatrixCompetencies] = useState<CourseCompetencyDefinition[]>([]);
  const [loadingCompetencies, setLoadingCompetencies] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [mappings, setMappings] = useState<ImportMappingState>(EMPTY_MAPPINGS);
  const [serverPreview, setServerPreview] = useState<ServerPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [requestAcknowledgement, setRequestAcknowledgement] = useState(false);
  const [flightTestOutcomes, setFlightTestOutcomes] = useState<Record<number, FlightTestImportOutcome>>({});
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);

  const selectedCourse = useMemo(
    () => courses.find(course => course.id === selectedCourseId) || null,
    [courses, selectedCourseId],
  );
  const availableCourses = useMemo(
    () => getRecordImportCourses(courses, recordType),
    [courses, recordType],
  );
  const identity = useMemo(
    () => selectedCourse ? { studentId, studentName, course: selectedCourse } : null,
    [selectedCourse, studentId, studentName],
  );
  const competencies = useMemo(
    () => [
      ...(selectedCourse && recordType === 'lesson'
        ? buildCourseCriterionDefinitions(selectedCourse)
        : []),
      ...matrixCompetencies,
    ],
    [matrixCompetencies, recordType, selectedCourse],
  );
  const reviewChecklist = useMemo<ReviewChecklistTransferDefinition[]>(
    () => selectedCourse && recordType === 'review'
      ? buildReviewChecklistTransferDefinitions(selectedCourse)
      : [],
    [recordType, selectedCourse],
  );
  const validation = useMemo(
    () => parsed && identity
      ? recordType === 'review'
        ? validateReviewRecordCsv(parsed, identity, reviewChecklist)
        : validateCourseStudentRecordCsv(parsed, recordType, identity, competencies, mappings)
      : null,
    [competencies, identity, mappings, parsed, recordType, reviewChecklist],
  );

  const flightTestImportRows = useMemo(() => {
    if (!validation || !selectedCourse || recordType !== 'lesson') return [];
    const flightTestLessons = new Map(
      selectedCourse.lessons
        .filter(lesson => lesson.isFlightTest)
        .map(lesson => [lesson.id, lesson]),
    );
    return validation.rows.flatMap(row => {
      const lesson = flightTestLessons.get(String(row.lesson_id || ''));
      if (!lesson) return [];
      const override = flightTestOutcomes[row.source_row];
      return [{
        row,
        lesson,
        result: override?.result
          || normaliseImportedFlightTestResult(String(row.flight_review_result || ''))
          || 'not_assessed',
        findings: override?.findings ?? String(row.flight_review_notes || ''),
      }];
    });
  }, [flightTestOutcomes, recordType, selectedCourse, validation]);

  const hasIncompleteFlightTestOutcomes = flightTestImportRows.some(item => (
    !['pass', 'fail'].includes(item.result)
    || (item.result === 'fail' && !item.findings.trim())
  ));

  const preparedImportRows = useMemo(() => {
    if (!validation) return [];
    const outcomes = new Map(flightTestImportRows.map(item => [item.row.source_row, item]));
    return validation.rows.map(row => {
      const outcome = outcomes.get(row.source_row);
      if (!outcome) return row;
      return {
        ...row,
        is_flight_review: true,
        flight_review_type: 'Flight Test',
        flight_review_result: outcome.result,
        flight_review_notes: outcome.findings.trim(),
      };
    });
  }, [flightTestImportRows, validation]);

  useEffect(() => setServerPreview(null), [flightTestOutcomes, validation]);

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
      setMatrixCompetencies([]);
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
      setMatrixCompetencies(buildCourseCompetencyDefinitions(
        rowsResult.data || [],
        requirementsResult.data || [],
      ));
    }).catch(error => {
      console.error('Failed to load course competency codes:', error);
      if (active) {
        setMatrixCompetencies([]);
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
    setFlightTestOutcomes({});
    setServerPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTypeChange = (nextType: CourseTransferRecordType) => {
    setRecordType(nextType);
    setSelectedCourseId('');
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
    setFlightTestOutcomes({});
    setServerPreview(null);
  };

  const updateCourseMapping = (label: string, courseId: string) => {
    setMappings(current => ({
      ...current,
      courses: { ...current.courses, [keyForCourse(label)]: courseId },
    }));
  };

  const preview = async () => {
    if (
      !sourceFile
      || !validation
      || !selectedCourse
      || validation.errors.length > 0
      || preparedImportRows.length === 0
      || hasIncompleteFlightTestOutcomes
    ) return;
    setPreviewing(true);
    try {
      const rpcName = recordType === 'review'
        ? 'process_student_review_record_import'
        : 'process_student_course_record_import';
      const parameters = {
        p_student_id: studentId,
        p_course_id: selectedCourse.id,
        p_course_version: selectedCourse.version,
        p_filename: sourceFile.name,
        p_rows: preparedImportRows,
        p_commit: false,
        ...(recordType === 'review'
          ? {}
          : {
              p_record_type: recordType,
              p_request_student_acknowledgement: requestAcknowledgement,
            }),
      };
      const { data, error } = await supabase.rpc(rpcName, parameters);
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
    if (
      !sourceFile
      || !validation
      || !selectedCourse
      || !serverPreview?.can_import
      || hasIncompleteFlightTestOutcomes
    ) return;
    setImporting(true);
    try {
      const rpcName = recordType === 'review'
        ? 'process_student_review_record_import'
        : 'process_student_course_record_import';
      const parameters = {
        p_student_id: studentId,
        p_course_id: selectedCourse.id,
        p_course_version: selectedCourse.version,
        p_filename: sourceFile.name,
        p_rows: preparedImportRows,
        p_commit: true,
        ...(recordType === 'review'
          ? {}
          : {
              p_record_type: recordType,
              p_request_student_acknowledgement: requestAcknowledgement,
            }),
      };
      const { data, error } = await supabase.rpc(rpcName, parameters);
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
      recordType === 'review'
        ? getReviewRecordTemplate(identity, reviewChecklist)
        : getCourseStudentRecordTemplate(recordType, identity, competencies),
      getCourseTransferFilename(identity, recordType, 'template'),
    );
  };

  const downloadCompetencyGuide = () => {
    if (!identity) return;
    downloadTextFile(
      recordType === 'review'
        ? getReviewChecklistGuideCsv(identity, reviewChecklist)
        : getCourseCompetencyGuideCsv(identity, competencies),
      getCourseTransferFilename(identity, recordType, 'competency-guide'),
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
          .select('id,date,lesson_id,registration,aircraft_type,dual_time_min,solo_time_min,comments,formal_briefing,next_lesson,student_ack,source_instructor_name,source_organisation,source_reference,instructor_id,criteria_grades,flight_review_result,flight_review_notes')
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
            flight_test_result: lesson?.isFlightTest
              ? record.flight_review_result === 'pass'
                ? 'Pass'
                : record.flight_review_result === 'fail'
                  ? 'Further training required'
                  : ''
              : '',
            flight_test_findings: lesson?.isFlightTest ? record.flight_review_notes || '' : '',
          };
          competencies
            .filter(competency => competency.kind === 'criterion')
            .forEach(criterion => {
              const grade = (record.criteria_grades as Record<string, string> | null)?.[criterion.code];
              if (grade !== undefined && grade !== null && String(grade).trim()) {
                row[criterion.column] = String(grade);
              }
            });
          (assessmentsByRecord.get(record.id) || []).forEach(assessment => {
            const competency = competencies.find(candidate => candidate.id === assessment.matrix_row_id);
            if (!competency || !assessment.achieved_standard) return;
            row[competency.column] = String(assessment.achieved_standard);
            if (competency.commentsColumn) row[competency.commentsColumn] = assessment.comments || '';
          });
          return row;
        });
      } else if (recordType === 'exam') {
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
      } else {
        const { data: reviews, error: reviewsError } = await supabase
          .from('flight_review_records')
          .select('id,review_date,status,external_examiner_name,external_examiner_identifier,external_examiner_organisation,reviewer_user_id,registration,aircraft_type,aircraft_group,ground_minutes,flight_minutes,candidate_objectives,reviewer_summary,remedial_plan,minimums_override_reason,emergency_plan_confirmed,logbook_entry_confirmed,authority_submission_confirmed,candidate_ack,next_review_due,source_reference,assessment_details')
          .eq('candidate_id', studentId)
          .eq('template_course_id', identity.course.id)
          .order('review_date', { ascending: true });
        if (reviewsError) throw reviewsError;
        const reviewIds = (reviews || []).map(review => review.id);
        const reviewerIds = [...new Set((reviews || []).map(review => review.reviewer_user_id).filter(Boolean))];
        const [itemsResult, reviewersResult, attachmentsResult] = await Promise.all([
          reviewIds.length
            ? supabase
                .from('flight_review_record_items')
                .select('review_record_id,template_item_key,result,notes')
                .in('review_record_id', reviewIds)
            : Promise.resolve({ data: [], error: null }),
          reviewerIds.length
            ? supabase.from('users').select('id,name,email').in('id', reviewerIds)
            : Promise.resolve({ data: [], error: null }),
          reviewIds.length
            ? supabase
                .from('flight_review_attachments')
                .select('review_record_id,category,file_name')
                .in('review_record_id', reviewIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (itemsResult.error) throw itemsResult.error;
        if (reviewersResult.error) throw reviewersResult.error;
        if (attachmentsResult.error) throw attachmentsResult.error;
        const reviewers = new Map((reviewersResult.data || []).map(reviewer => [
          reviewer.id,
          reviewer.name || reviewer.email || 'Portal reviewer',
        ]));
        const itemsByRecord = new Map<string, Array<{
          template_item_key: string;
          result: string;
          notes: string | null;
        }>>();
        (itemsResult.data || []).forEach(item => {
          const current = itemsByRecord.get(item.review_record_id) || [];
          current.push(item);
          itemsByRecord.set(item.review_record_id, current);
        });
        const attachmentsByRecord = new Map<string, string[]>();
        (attachmentsResult.data || []).forEach(attachment => {
          const current = attachmentsByRecord.get(attachment.review_record_id) || [];
          current.push(`${attachment.category}: ${attachment.file_name}`);
          attachmentsByRecord.set(attachment.review_record_id, current);
        });
        exportRows = (reviews || []).map(review => {
          const assessmentDetails = (review.assessment_details || {}) as Record<string, unknown>;
          const evidenceReference = String(assessmentDetails.historicalEvidenceReference || '').trim()
            || (attachmentsByRecord.get(review.id) || []).join('; ');
          const row: Record<string, string> = {
            ...common,
            record_reference: review.source_reference || `portal-${review.id}`,
            review_date: review.review_date,
            status: review.status,
            reviewer_name: review.external_examiner_name || reviewers.get(review.reviewer_user_id) || 'Portal reviewer',
            reviewer_identifier: review.external_examiner_identifier || '',
            reviewer_organisation: review.external_examiner_organisation || 'Bendigo Flying Club portal',
            aircraft_registration: review.registration || '',
            aircraft_type: review.aircraft_type || '',
            aircraft_group: review.aircraft_group || '',
            ground_time: `${Math.floor((review.ground_minutes || 0) / 60)}:${String((review.ground_minutes || 0) % 60).padStart(2, '0')}`,
            flight_time: `${Math.floor((review.flight_minutes || 0) / 60)}:${String((review.flight_minutes || 0) % 60).padStart(2, '0')}`,
            candidate_objectives: review.candidate_objectives || '',
            reviewer_summary: review.reviewer_summary || '',
            further_training_plan: review.remedial_plan || '',
            minimums_override_reason: review.minimums_override_reason || '',
            emergency_plan_confirmed: review.emergency_plan_confirmed ? 'Yes' : 'No',
            logbook_entry_confirmed: review.logbook_entry_confirmed ? 'Yes' : 'No',
            authority_submission_confirmed: review.authority_submission_confirmed ? 'Yes' : 'No',
            candidate_acknowledged: review.candidate_ack ? 'Yes' : 'No',
            evidence_reference: evidenceReference,
            next_review_due: review.next_review_due || '',
          };
          (itemsByRecord.get(review.id) || []).forEach(item => {
            const definition = reviewChecklist.find(candidate => candidate.key === item.template_item_key);
            if (!definition) return;
            row[definition.resultColumn] = item.result;
            row[definition.notesColumn] = item.notes || '';
          });
          return row;
        });
      }

      if (exportRows.length === 0) {
        const recordLabel = recordType === 'lesson' ? 'lesson records' : recordType === 'exam' ? 'exam results' : 'review or test records';
        toast.error(`No ${recordLabel} exist for this student and course`);
        return;
      }
      downloadTextFile(
        recordType === 'review'
          ? createReviewTransferCsv(reviewChecklist, exportRows)
          : createCourseTransferCsv(recordType, competencies, exportRows),
        getCourseTransferFilename(identity, recordType, 'export'),
      );
      const recordLabel = recordType === 'lesson' ? 'lesson records' : recordType === 'exam' ? 'exam results' : 'review or test records';
      toast.success(`Exported ${exportRows.length} ${recordLabel}`);
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
    && !hasMappingWork
    && !hasIncompleteFlightTestOutcomes,
  );
  const localReadyRows = validation?.rows.length || 0;
  const importPresentation = getImportWorkflowPresentation({
    localReadyRows,
    previewComplete: Boolean(serverPreview),
    serverCanImport: Boolean(serverPreview?.can_import),
    serverReadyRows: serverPreview?.ready_rows || 0,
    duplicateRows: serverPreview?.duplicate_rows || 0,
    errorRows: serverPreview?.error_rows || 0,
  });

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
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-gray-100 p-1">
                  {(['lesson', 'exam', 'review'] as CourseTransferRecordType[]).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleTypeChange(type)}
                      className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                        recordType === type ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {type === 'lesson' ? 'Lesson records' : type === 'exam' ? 'Exam results' : 'Reviews & tests'}
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
                    {availableCourses.map(course => (
                      <option key={course.id} value={course.id}>{course.title} · version {course.version}</option>
                    ))}
                  </select>
                </label>
                {availableCourses.length === 0 && (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900" role="status">
                    {recordType === 'review'
                      ? 'No review or test forms are available. Ask an administrator to publish a form in Training Settings.'
                      : recordType === 'exam'
                        ? 'No courses with configured exams are available.'
                        : 'No courses with configured lessons are available.'}
                  </p>
                )}
                {selectedCourse && recordType === 'lesson' && (
                  <p className={`mt-2 text-xs ${!loadingCompetencies && competencies.length === 0 ? 'font-medium text-amber-700' : 'text-gray-600'}`}>
                    {loadingCompetencies
                      ? 'Loading course criteria...'
                      : competencies.length > 0
                        ? `${competencies.length} criteria and competency column${competencies.length === 1 ? '' : 's'} will be included in this course format.`
                        : 'This course has no criteria or competency codes configured. The template will import lesson records only.'}
                  </p>
                )}
                {selectedCourse && recordType === 'review' && (
                  <p className="mt-2 text-xs text-gray-600">
                    {reviewChecklist.length} checklist item{reviewChecklist.length === 1 ? '' : 's'} from this versioned review form will be included.
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
                    {((recordType === 'lesson' && competencies.length > 0) || (recordType === 'review' && reviewChecklist.length > 0)) && (
                      <button
                        type="button"
                        onClick={downloadCompetencyGuide}
                        disabled={!identity}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-300 bg-blue-100 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-200 disabled:opacity-50"
                      >
                        <Download className="h-4 w-4" /> {recordType === 'review' ? 'Checklist guide' : 'Criteria and competency guide'}
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
                      {competencies.length > 0 && (
                        <li>
                          Enter the grade shown in the guide—for example NC, S or C, or 1, 2 or 3 for detailed matrices.
                          Leave unassessed columns blank.
                        </li>
                      )}
                      <li>Use Yes or No for formal briefing and historical student acknowledgement.</li>
                      <li>For a course flight test, choose Pass or Further training required in the portal after uploading. Fresh templates also include optional result and formal findings columns.</li>
                    </ul>
                  ) : recordType === 'exam' ? (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>Completed rows are detected automatically. Include may also be Yes, X, Completed or Done.</li>
                      <li>Enter Skip in Include to deliberately omit a filled row.</li>
                      <li>Record reference is optional. Use the original result number when available; otherwise the portal creates one automatically.</li>
                      <li>Scores and pass marks are percentages between 0 and 100.</li>
                      <li>Use Yes or No for KDR completed.</li>
                    </ul>
                  ) : (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li>Use one row for each review, flight test or club check.</li>
                      <li>Completed rows are detected automatically. Enter Skip to deliberately omit a filled row.</li>
                      <li>Dates may be DD/MM/YYYY or YYYY-MM-DD; times may be 1.25 hours, 1:15, or 75m.</li>
                      <li>Use the checklist guide values exactly. A completed record requires every required item to be satisfactory or not_applicable.</li>
                      <li>Attachments remain in the portal and are not embedded in CSV files.</li>
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
                    {validation.errors.map(error => (
                      <div key={`${error.sourceRow}-${error.messages.join()}`} className="rounded-lg bg-white p-3 text-sm text-red-900 ring-1 ring-red-100">
                        <strong>Row {error.sourceRow}:</strong> {error.messages.join(' ')}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {flightTestImportRows.length > 0 && (
                <section className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" />
                    <div>
                      <h3 className="font-semibold text-orange-950">Flight test outcome required</h3>
                      <p className="mt-1 text-sm text-orange-800">
                        Confirm the official result for each imported course flight test. This is stored in both the lesson record and the formal Reviews &amp; Tests register.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-4">
                    {flightTestImportRows.map(item => (
                      <div key={item.row.source_row} className="rounded-lg border border-orange-200 bg-white p-4">
                        <p className="text-sm font-semibold text-gray-900">
                          Row {item.row.source_row}: {item.lesson.sequenceCode ? `${item.lesson.sequenceCode} · ` : ''}{item.lesson.name}
                        </p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-orange-900">Result</span>
                            <select
                              value={item.result}
                              onChange={event => {
                                const result = event.target.value as ImportedFlightTestResult;
                                setFlightTestOutcomes(current => ({
                                  ...current,
                                  [item.row.source_row]: {
                                    result,
                                    findings: current[item.row.source_row]?.findings ?? item.findings,
                                  },
                                }));
                              }}
                              className="w-full rounded-lg border border-orange-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                            >
                              <option value="not_assessed">Select result…</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Further training required</option>
                            </select>
                          </label>
                          <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-orange-900">
                              Formal findings or required follow-up {item.result === 'fail' ? '(required)' : '(optional)'}
                            </span>
                            <textarea
                              rows={3}
                              value={item.findings}
                              onChange={event => {
                                const findings = event.target.value;
                                setFlightTestOutcomes(current => ({
                                  ...current,
                                  [item.row.source_row]: {
                                    result: current[item.row.source_row]?.result ?? item.result,
                                    findings,
                                  },
                                }));
                              }}
                              required={item.result === 'fail'}
                              className="w-full resize-none rounded-lg border border-orange-300 px-3 py-2.5 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100"
                            />
                          </label>
                        </div>
                        {item.result === 'not_assessed' && (
                          <p className="mt-2 text-xs font-medium text-orange-800">Select a result before previewing the import.</p>
                        )}
                        {item.result === 'fail' && !item.findings.trim() && (
                          <p className="mt-2 text-xs font-medium text-orange-800">Record the required further training or formal findings before previewing.</p>
                        )}
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

              {canPreview && !serverPreview && (
                <section className="rounded-xl border border-blue-200 bg-blue-50 p-4" role="status">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                    <div>
                      <h3 className="font-semibold text-blue-950">{importPresentation.title}</h3>
                      <p className="mt-1 text-sm text-blue-800">{importPresentation.detail}</p>
                    </div>
                  </div>
                </section>
              )}

              {serverPreview && (
                <section className={`rounded-xl border p-4 ${serverPreview.can_import ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`} role="status">
                  <div className="flex items-start gap-3">
                    {serverPreview.can_import ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <AlertTriangle className="h-6 w-6 text-red-600" />}
                    <div>
                      <h3 className={`font-semibold ${serverPreview.can_import ? 'text-emerald-950' : 'text-red-950'}`}>
                        {importPresentation.title}
                      </h3>
                      <p className={`mt-1 text-sm ${serverPreview.can_import ? 'text-emerald-800' : 'text-red-800'}`}>
                        {importPresentation.detail}
                      </p>
                      <p className={`mt-1 text-xs ${serverPreview.can_import ? 'text-emerald-700' : 'text-red-700'}`}>
                        {serverPreview.ready_rows || 0} ready · {serverPreview.duplicate_rows} duplicate{serverPreview.duplicate_rows === 1 ? '' : 's'} · {serverPreview.error_rows} errors
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
                  className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                    serverPreview
                      ? 'border border-blue-300 bg-white text-blue-700 hover:bg-blue-50'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {serverPreview ? `Preview ${localReadyRows} records again` : importPresentation.actionLabel}
                </button>
                {serverPreview && (
                  <button
                    type="button"
                    onClick={() => void commit()}
                    disabled={importPresentation.action !== 'import' || importing || previewing}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-600"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {importPresentation.actionLabel}
                  </button>
                )}
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
