import { Student, StudentExamResult, TrainingModule, TrainingRecord, User } from '../types';
import { supabase } from '../lib/supabase';
import { formatSyllabusMatrixText } from '../hooks/useSyllabusMatrix';
import type { StudentCourseEnrolment } from '../hooks/useStudentCourseEnrolments';
import { richTextToPlainText } from './richText';
import {
  calculateCourseProgressMatrixLayout,
  chunkPdfColumns,
  criterionCode,
  normalisePdfText,
  truncatePdfText,
  wrapPdfText,
} from './coursePdfLayout';
import {
  courseExamEvidenceForExport,
  courseExamResultsForExport,
  courseRecordAcknowledgementEvidence,
  courseRecordAcknowledgementLabel,
  courseRecordInstructorName,
} from './coursePdfOptions';

const EXAM_UPLOAD_BUCKET = 'student-exam-uploads';

type ExportCoursePdfInput = {
  student: Student;
  course: TrainingModule;
  records: TrainingRecord[];
  exams: StudentExamResult[];
  users: User[];
  exportedBy?: User | null;
  courseEnrolments?: StudentCourseEnrolment[];
  includeExamSheets?: boolean;
  download?: boolean;
  preloadedMatrixData?: {
    rows: any[];
    requirements: any[];
    assessments: any[];
  };
};

type Point = { x: number; y: number };

const pageSize: [number, number] = [842, 595];
const margin = 34;

const formatDate = (date?: Date) => {
  if (!date) return 'Not recorded';
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatShortDate = (date?: Date) => {
  if (!date) return '';
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const isUnder18 = (dateOfBirth?: Date) => {
  if (!dateOfBirth) return false;
  const eighteenthBirthday = new Date(dateOfBirth);
  eighteenthBirthday.setFullYear(eighteenthBirthday.getFullYear() + 18);
  return new Date() < eighteenthBirthday;
};

const abbreviateName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name.slice(0, 16);
  return `${parts[0][0]}.${parts.slice(1).join(' ')}`.slice(0, 18);
};

const minutesToHours = (minutes: number) => (minutes / 60).toFixed(1);

const fetchAllPages = async <T,>(
  buildQuery: () => any,
  pageSize = 1000
): Promise<T[]> => {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
};

const matrixGradeLabel = (grade: string, system?: string) => {
  if (!grade || grade === '-' || grade === '–' || grade.includes('â')) return '-';
  return system === 'Out of 100' ? `${grade}%` : grade;
};

const matrixGradeColor = (grade: string, system?: string, palette?: { green: any; blue: any; amber: any; red: any; dark: any; grey: any }) => {
  if (!palette || !grade || grade === '-' || grade === '–' || grade.includes('â')) return palette?.grey;
  if (system === 'Out of 100') {
    const score = Number(grade);
    if (Number.isNaN(score)) return palette.grey;
    if (score >= 80) return palette.green;
    if (score >= 50) return palette.amber;
    return palette.red;
  }
  if (grade === 'C' || grade === 'Pass') return palette.green;
  if (grade === 'S') return palette.blue;
  if (grade === 'NC' || grade === 'Fail') return palette.red;
  return palette.dark;
};

const safeFilename = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'course-export';

const achievedMeetsRequired = (achieved?: number, required?: number) => {
  if (!achieved || !required) return false;
  return achieved <= required;
};

const matrixEvidenceLabel = (item: any) => {
  const row = item.row;
  const achieved = item.assessment?.achieved_standard || '-';
  const required = item.requirement.required_standard;
  const code = row.element_code || row.unit_code || row.code;
  return `${code} ${achieved}/${required} - ${formatSyllabusMatrixText(row.description)}`;
};

const wrapText = (text: string, font: any, size: number, maxWidth: number) => {
  return wrapPdfText(text, value => font.widthOfTextAtSize(value, size), maxWidth);
};

const stripHtml = richTextToPlainText;

const downloadBlob = (bytes: Uint8Array, filename: string) => {
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  // Safari and some installed/PWA browser contexts can cancel a download when
  // its object URL is revoked in the same task as the synthetic click.
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
};

export async function exportCoursePdf({
  student,
  course,
  records,
  exams,
  users,
  exportedBy,
  courseEnrolments = [],
  includeExamSheets = false,
  download = true,
  preloadedMatrixData,
}: ExportCoursePdfInput) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const dark = rgb(0.07, 0.13, 0.22);
  const grey = rgb(0.34, 0.39, 0.47);
  const lightGrey = rgb(0.95, 0.97, 0.98);
  const borderGrey = rgb(0.78, 0.83, 0.88);
  const blue = rgb(0.04, 0.32, 0.68);
  const paleBlue = rgb(0.92, 0.96, 1);
  const green = rgb(0.04, 0.45, 0.24);
  const amber = rgb(0.72, 0.35, 0.05);
  const red = rgb(0.72, 0.08, 0.08);
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${student.name} - ${course.title}`);
  pdfDoc.setAuthor('Bendigo Flying Club CRM');
  pdfDoc.setSubject('Student course progress export');
  pdfDoc.setCreator('Bendigo Flying Club CRM');

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);

  let page = pdfDoc.addPage(pageSize);
  let { width, height } = page.getSize();
  let cursor = height - margin;
  let pageNo = 1;
  let runningSection = 'Course summary';

  const fitText = (text: string, font: any, size: number, maxWidth: number) =>
    truncatePdfText(text, value => font.widthOfTextAtSize(value, size), maxWidth);

  const addFooter = () => {
    page.drawLine({
      start: { x: margin, y: 28 },
      end: { x: width - margin, y: 28 },
      thickness: 0.5,
      color: borderGrey,
    });
    page.drawText(`Generated ${formatDate(new Date())}`, {
      x: margin,
      y: 15,
      size: 7,
      font: regular,
      color: grey,
    });
    const footerTitle = fitText(`${student.name} - ${course.title}`, regular, 7, 360);
    page.drawText(footerTitle, {
      x: (width - regular.widthOfTextAtSize(footerTitle, 7)) / 2,
      y: 15,
      size: 7,
      font: regular,
      color: grey,
    });
    const pageLabel = `Page ${pageNo}`;
    page.drawText(pageLabel, {
      x: width - margin - regular.widthOfTextAtSize(pageLabel, 7),
      y: 15,
      size: 7,
      font: bold,
      color: dark,
    });
  };

  const drawRunningHeader = () => {
    page.drawRectangle({
      x: margin,
      y: height - 48,
      width: width - margin * 2,
      height: 24,
      color: paleBlue,
      borderColor: borderGrey,
      borderWidth: 0.5,
    });
    const identity = fitText(`${student.name}  |  ${course.title}`, bold, 8.5, 500);
    page.drawText(identity, { x: margin + 9, y: height - 39, size: 8.5, font: bold, color: dark });
    const section = fitText(runningSection, regular, 8, 190);
    page.drawText(section, {
      x: width - margin - 9 - regular.widthOfTextAtSize(section, 8),
      y: height - 39,
      size: 8,
      font: regular,
      color: blue,
    });
    cursor = height - 62;
  };

  const newPage = () => {
    addFooter();
    page = pdfDoc.addPage(pageSize);
    ({ width, height } = page.getSize());
    pageNo += 1;
    drawRunningHeader();
  };

  const ensureSpace = (required: number) => {
    if (cursor - required < margin) newPage();
  };

  const drawText = (text: string, at: Point, options: { size?: number; font?: any; color?: any; maxWidth?: number; lineHeight?: number } = {}) => {
    const size = options.size ?? 9;
    const font = options.font ?? regular;
    const color = options.color ?? dark;
    const lineHeight = options.lineHeight ?? size + 3;
    const safeText = normalisePdfText(text);
    const lines = options.maxWidth ? wrapText(safeText, font, size, options.maxWidth) : [safeText];
    lines.forEach((line, index) => {
      page.drawText(line, { x: at.x, y: at.y - index * lineHeight, size, font, color });
    });
    return lines.length * lineHeight;
  };

  const drawSectionTitle = (title: string, minimumFollowingSpace = 16) => {
    runningSection = title;
    ensureSpace(34 + minimumFollowingSpace);
    page.drawRectangle({ x: margin, y: cursor - 24, width: width - margin * 2, height: 24, color: blue });
    page.drawRectangle({ x: margin, y: cursor - 24, width: 5, height: 24, color: dark });
    page.drawText(fitText(title, bold, 10, width - margin * 2 - 24), { x: margin + 12, y: cursor - 16, size: 10, font: bold, color: rgb(1, 1, 1) });
    cursor -= 34;
  };

  const drawInfoBox = (title: string, value: string, x: number, y: number, boxWidth: number, boxHeight = 46) => {
    page.drawRectangle({ x, y: y - boxHeight, width: boxWidth, height: boxHeight, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.8 });
    page.drawText(title, { x: x + 8, y: y - 14, size: 7, font: bold, color: grey });
    page.drawText(fitText(value || 'Not recorded', bold, 10, boxWidth - 16), { x: x + 8, y: y - 30, size: 10, font: bold, color: dark });
  };

  const drawLabelValueGrid = (
    rows: Array<[string, string]>,
    options: { columns?: number; labelWidth?: number; rowHeight?: number; valueSize?: number } = {}
  ) => {
    const columns = options.columns ?? 2;
    const minRowHeight = options.rowHeight ?? 24;
    const valueSize = options.valueSize ?? 8;
    const columnWidth = (width - margin * 2) / columns;
    const rowCount = Math.ceil(rows.length / columns);
    const valueLineHeight = valueSize + 2;
    const gridRows = Array.from({ length: rowCount }, (_, rowIndex) => {
      const cells = rows.slice(rowIndex * columns, rowIndex * columns + columns).map(([label, value]) => {
        const labelLines = wrapText(label, bold, 7, columnWidth - 10);
        const valueLines = wrapText(value || 'Not recorded', regular, valueSize, columnWidth - 10);
        return {
          label,
          value: value || 'Not recorded',
          height: Math.max(minRowHeight, labelLines.length * 9 + 4 + valueLines.length * valueLineHeight + 8),
        };
      });
      return {
        cells,
        height: Math.max(minRowHeight, ...cells.map((cell) => cell.height)),
      };
    });
    const totalHeight = gridRows.reduce((sum, row) => sum + row.height, 0);
    ensureSpace(totalHeight + 8);

    let yOffset = 0;
    gridRows.forEach((gridRow) => {
      gridRow.cells.forEach((cell, col) => {
        const x = margin + col * columnWidth;
        const y = cursor - yOffset;
        drawText(cell.label, { x, y }, { size: 7, font: bold, color: grey, maxWidth: columnWidth - 10 });
        drawText(cell.value, { x, y: y - 11 }, { size: valueSize, color: dark, maxWidth: columnWidth - 10, lineHeight: valueLineHeight });
      });
      yOffset += gridRow.height;
    });
    cursor -= totalHeight + 8;
  };

  const drawParagraphBlock = (title: string, value: string, _legacyMaxLines?: number) => {
    const text = stripHtml(value);
    if (!text) return;
    const fontSize = 8.5;
    const lineHeight = 11;
    const lines = wrapText(text, regular, fontSize, width - margin * 2 - 20);
    let continued = false;

    const drawLabel = () => {
      ensureSpace(26);
      page.drawText(`${title}${continued ? ' (continued)' : ''}`, { x: margin, y: cursor, size: 8, font: bold, color: blue });
      cursor -= 13;
      continued = true;
    };

    drawLabel();
    lines.forEach((line) => {
      if (cursor - lineHeight < margin) {
        newPage();
        drawLabel();
      }
      page.drawText(line, { x: margin, y: cursor, size: fontSize, font: regular, color: dark });
      cursor -= lineHeight;
    });
    cursor -= 6;
  };

  const drawFirstPageDeclarationWording = (title: string, value: string) => {
    const text = stripHtml(value);
    if (!text) return;

    const maxWidth = width - margin * 2 - 20;
    const availableHeight = Math.max(44, cursor - margin - 8);
    let fontSize = 8.5;
    let lineHeight = 11;
    let lines = wrapText(text, regular, fontSize, maxWidth);

    while (fontSize > 5.5 && 15 + lines.length * lineHeight > availableHeight) {
      fontSize -= 0.25;
      lineHeight = fontSize + 2;
      lines = wrapText(text, regular, fontSize, maxWidth);
    }

    page.drawText(title, { x: margin, y: cursor, size: 8, font: bold, color: blue });
    cursor -= 13;
    lines.forEach((line) => {
      page.drawText(line, { x: margin, y: cursor, size: fontSize, font: regular, color: dark });
      cursor -= lineHeight;
    });
    cursor -= 6;
  };

  const drawDigitalSignatureBox = (
    title: string,
    signatureName: string,
    dateText: string,
    detail: string,
    x: number,
    y: number,
    boxWidth: number,
    boxHeight = 72
  ) => {
    page.drawRectangle({
      x,
      y: y - boxHeight,
      width: boxWidth,
      height: boxHeight,
      color: rgb(1, 1, 1),
      borderColor: borderGrey,
      borderWidth: 0.7,
    });
    page.drawText(title, { x: x + 10, y: y - 14, size: 7, font: bold, color: grey });
    page.drawText(fitText(signatureName || 'Not digitally signed', signatureName ? bold : regular, signatureName ? 16 : 10, boxWidth - 20), {
      x: x + 10,
      y: y - 36,
      size: signatureName ? 16 : 10,
      font: signatureName ? bold : regular,
      color: signatureName ? dark : grey,
    });
    page.drawText(fitText(`Date: ${dateText || 'Not recorded'}`, regular, 8, boxWidth - 20), { x: x + 10, y: y - 52, size: 8, font: regular, color: dark });
    drawText(detail, { x: x + 10, y: y - 64 }, { size: 6.5, color: grey, maxWidth: boxWidth - 20, lineHeight: 7 });
  };

  const drawDeclarationSignatureRecord = (
    title: string,
    isSigned: boolean,
    signatureName: string | undefined,
    signedAt: Date | undefined,
    rows: Array<[string, string]>,
    detail: string
  ) => {
    const boxHeight = 94;
    ensureSpace(boxHeight + 22);
    page.drawRectangle({
      x: margin,
      y: cursor - boxHeight,
      width: width - margin * 2,
      height: boxHeight,
      color: isSigned ? rgb(0.94, 0.99, 0.96) : rgb(1, 0.97, 0.94),
      borderColor: isSigned ? green : amber,
      borderWidth: 1.2,
    });
    page.drawRectangle({
      x: margin,
      y: cursor - 24,
      width: width - margin * 2,
      height: 24,
      color: isSigned ? green : amber,
    });
    page.drawText(fitText(`${isSigned ? 'SIGNED ELECTRONICALLY' : 'NOT SIGNED'} - ${title}`, bold, 9, width - margin * 2 - 20), {
      x: margin + 10,
      y: cursor - 16,
      size: 9,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText(fitText(isSigned ? (signatureName || 'Signature name not recorded') : 'Awaiting electronic signature', bold, 16, 292), {
      x: margin + 10,
      y: cursor - 45,
      size: 16,
      font: bold,
      color: isSigned ? dark : amber,
    });
    page.drawText(`Signed date: ${isSigned ? formatDate(signedAt) : 'Not signed'}`, {
      x: margin + 10,
      y: cursor - 62,
      size: 8.5,
      font: regular,
      color: dark,
    });

    const rightX = margin + 322;
    rows.slice(0, 4).forEach(([label, value], index) => {
      const y = cursor - 42 - index * 14;
      page.drawText(fitText(label, bold, 7, 88), { x: rightX, y, size: 7, font: bold, color: grey });
      page.drawText(fitText(value || 'Not recorded', regular, 8, width - rightX - 112), { x: rightX + 92, y, size: 8, font: regular, color: dark });
    });

    drawText(detail, { x: margin + 10, y: cursor - 76 }, { size: 6.5, color: grey, maxWidth: 288, lineHeight: 7 });
    cursor -= boxHeight + 12;
  };

  const drawDigitalSignatureCertification = () => {
    const acknowledgementEvidence = chronologicalCourseRecords.map((record) => ({
      record,
      evidence: courseRecordAcknowledgementEvidence(record),
    }));
    const acknowledgedCourseRecords = acknowledgementEvidence.filter(({ evidence }) => evidence.acknowledged);
    const allLessonsAcknowledged = chronologicalCourseRecords.length > 0 &&
      acknowledgementEvidence.every(({ evidence }) => evidence.acknowledged);
    const latestStudentAck = acknowledgedCourseRecords
      .map(({ evidence }) => evidence.acknowledgedAt)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const hasUndatedAcknowledgement = acknowledgedCourseRecords.some(
      ({ evidence }) => !evidence.acknowledgedAt,
    );
    const hasHistoricalAcknowledgement = acknowledgedCourseRecords.some(
      ({ evidence }) => evidence.historicalImport,
    );
    const exporterName = exportedBy?.name || exportedBy?.email || 'Authenticated CRM user';
    const recordedStudentName = acknowledgedCourseRecords
      .map(({ record }) => record.studentAckName?.trim())
      .find((name) => name && !/^historical acknowledgement\s*\(imported\)$/i.test(name));
    const studentSignatureName = allLessonsAcknowledged
      ? recordedStudentName || student.name
      : '';
    const studentCertificationTitle = allLessonsAcknowledged && hasUndatedAcknowledgement
      ? 'Student acknowledgement status'
      : 'Student digital signature';
    const studentAcknowledgementDate = !allLessonsAcknowledged
      ? 'Not added'
      : hasUndatedAcknowledgement
        ? (latestStudentAck ? `Latest recorded ${formatDate(latestStudentAck)}; some dates unavailable` : 'Historical import - date not recorded')
        : formatDate(latestStudentAck);
    const studentAcknowledgementDetail = !allLessonsAcknowledged
      ? 'Not generated because not every lesson record in this course has been acknowledged by the student.'
      : hasUndatedAcknowledgement
        ? `Every lesson record is marked acknowledged in the CRM. ${hasHistoricalAcknowledgement ? 'Historical imports do not contain a portal acknowledgement timestamp and are shown as status evidence, not a timestamped portal signature.' : 'At least one acknowledgement date was not recorded, so this is shown as status evidence rather than a timestamped portal signature.'}`
        : 'Generated because every lesson record in this course has a timestamped student acknowledgement in the CRM.';
    const boxGap = 12;
    const boxWidth = (width - margin * 2 - boxGap) / 2;
    const boxHeight = 78;
    ensureSpace(boxHeight + 58);

    drawDigitalSignatureBox(
      'Export generated by',
      exporterName,
      formatDate(new Date()),
      'Identifies the authenticated CRM user who generated this file. This is not a lesson instructor signature.',
      margin,
      cursor,
      boxWidth,
      boxHeight
    );
    drawDigitalSignatureBox(
      studentCertificationTitle,
      studentSignatureName,
      studentAcknowledgementDate,
      studentAcknowledgementDetail,
      margin + boxWidth + boxGap,
      cursor,
      boxWidth,
      boxHeight
    );
    cursor -= boxHeight + 12;

    drawText(
      'Digital signature note: The export generator is the signed-in CRM user who created this file and is not used as the instructor for any lesson. Each lesson retains its own recorded instructor. A student digital signature is shown only when every exported lesson has a recorded acknowledgement timestamp. Historical imported acknowledgements remain clearly marked as acknowledged, but are shown as status evidence rather than a timestamped portal signature.',
      { x: margin, y: cursor },
      { size: 7.5, color: grey, maxWidth: width - margin * 2, lineHeight: 10 }
    );
    cursor -= 34;
  };

  const courseRecords = records
    .filter((record) => record.courseId === course.id && record.status !== 'draft')
    .sort((a, b) => (b.bookingStartTime || b.date).getTime() - (a.bookingStartTime || a.date).getTime());
  const chronologicalCourseRecords = [...courseRecords].sort((a, b) =>
    (a.bookingStartTime || a.date).getTime() - (b.bookingStartTime || b.date).getTime()
  );
  const lessonsById = new Map(course.lessons.map((lesson) => [lesson.id, lesson]));
  const lessonsByCode = new Map(
    course.lessons
      .filter((lesson) => lesson.sequenceCode)
      .map((lesson) => [lesson.sequenceCode, lesson])
  );
  const resolveLesson = (record: TrainingRecord) => {
    const lesson = record.lessonId ? lessonsById.get(record.lessonId) : undefined;
    const fallbackLesson = record.lessonCodes
      .map((code) => lessonsByCode.get(code))
      .find(Boolean);
    const recordedCode = record.lessonCodes[0];
    const byName = recordedCode
      ? course.lessons.find((item) =>
          item.name.trim().toLowerCase() === recordedCode.trim().toLowerCase() ||
          `${item.sequenceCode} ${item.name}`.trim().toLowerCase() === recordedCode.trim().toLowerCase()
        )
      : undefined;
    return lesson || fallbackLesson || byName;
  };
  const resolveLessonName = (record: TrainingRecord) => {
    return resolveLesson(record)?.name || record.lessonCodes[0] || record.registration || 'Flight';
  };
  const courseExams = courseExamResultsForExport(course, exams);
  const courseExamEvidence = courseExamEvidenceForExport(course, exams);

  let matrixRows: any[] = preloadedMatrixData?.rows ?? [];
  let matrixRequirements: any[] = preloadedMatrixData?.requirements ?? [];
  let matrixAssessments: any[] = preloadedMatrixData?.assessments ?? [];

  if (!preloadedMatrixData) {
    const matrixResults = await Promise.allSettled([
      fetchAllPages<any>(() =>
        supabase
          .from('syllabus_matrix_rows')
          .select('*')
          .eq('course_id', course.id)
          .order('sort_order', { ascending: true })
      ),
      fetchAllPages<any>(() =>
        supabase
          .from('syllabus_matrix_requirements')
          .select('*')
          .eq('course_id', course.id)
          .order('lesson_sequence_code', { ascending: true })
      ),
      fetchAllPages<any>(() =>
        supabase
          .from('student_matrix_assessments')
          .select('*')
          .eq('course_id', course.id)
          .eq('student_id', student.id)
      ),
    ]);
    const [rowsResult, requirementsResult, assessmentsResult] = matrixResults;
    matrixRows = rowsResult.status === 'fulfilled' ? rowsResult.value : [];
    matrixRequirements = requirementsResult.status === 'fulfilled' ? requirementsResult.value : [];
    matrixAssessments = assessmentsResult.status === 'fulfilled' ? assessmentsResult.value : [];

    const lookupFailures = matrixResults.filter((result) => result.status === 'rejected');
    if (lookupFailures.length > 0) {
      console.warn(
        'Course PDF exported without some optional syllabus matrix data:',
        lookupFailures.map((result) => result.status === 'rejected' ? result.reason : null),
      );
    }
  }

  const matrixRowById = new Map(matrixRows.map((row: any) => [row.id, row]));
  const bestAssessmentByRow = new Map<string, any>();
  matrixAssessments.forEach((assessment: any) => {
    const current = bestAssessmentByRow.get(assessment.matrix_row_id);
    if (!current || (
      assessment.achieved_standard &&
      (!current.achieved_standard || assessment.achieved_standard < current.achieved_standard)
    )) {
      bestAssessmentByRow.set(assessment.matrix_row_id, assessment);
    }
  });
  const metMatrixRequirements = matrixRequirements.filter((requirement: any) =>
    achievedMeetsRequired(
      bestAssessmentByRow.get(requirement.matrix_row_id)?.achieved_standard,
      requirement.required_standard
    )
  );
  const remainingMatrixRequirements = matrixRequirements
    .filter((requirement: any) =>
      !achievedMeetsRequired(
        bestAssessmentByRow.get(requirement.matrix_row_id)?.achieved_standard,
        requirement.required_standard
      )
    )
    .map((requirement: any) => ({
      requirement,
      row: matrixRowById.get(requirement.matrix_row_id),
      achieved: bestAssessmentByRow.get(requirement.matrix_row_id)?.achieved_standard,
    }))
    .filter((item: any) => item.row)
    .sort((a: any, b: any) => (a.row.sort_order ?? 0) - (b.row.sort_order ?? 0));

  const hasMatrixRows = matrixRows.length > 0;
  const hasMatrixRequirements = matrixRequirements.length > 0;
  const isRplSyllabusCourse = hasMatrixRequirements || hasMatrixRows || /rpl|casa/i.test(`${course.title} ${course.category}`);
  const isRaausSyllabusCourse = /raaus|rpc|ab[-\s]?initio|recreational pilot/i.test(`${course.title} ${course.category}`);
  const isStructuredAviationCourse = isRplSyllabusCourse || isRaausSyllabusCourse;
  const assessmentsByTrainingRecord = new Map<string, any[]>();
  matrixAssessments.forEach((assessment: any) => {
    if (!assessment.training_record_id) return;
    assessmentsByTrainingRecord.set(assessment.training_record_id, [
      ...(assessmentsByTrainingRecord.get(assessment.training_record_id) ?? []),
      assessment,
    ]);
  });
  const requirementsByLessonKey = new Map<string, any[]>();
  matrixRequirements.forEach((requirement: any) => {
    [requirement.lesson_id, requirement.lesson_sequence_code]
      .filter(Boolean)
      .forEach((key) => {
        requirementsByLessonKey.set(key, [
          ...(requirementsByLessonKey.get(key) ?? []),
          requirement,
        ]);
      });
  });
  const getRecordMatrixSummary = (record: TrainingRecord) => {
    const assessments = assessmentsByTrainingRecord.get(record.id) ?? [];
    const lessonKeys = [record.lessonId, ...record.lessonCodes].filter(Boolean) as string[];
    const lessonRequirements = lessonKeys.flatMap((key) => requirementsByLessonKey.get(key) ?? []);
    const requirementByRow = new Map<string, any>();
    lessonRequirements.forEach((requirement: any) => {
      const current = requirementByRow.get(requirement.matrix_row_id);
      if (!current || requirement.required_standard < current.required_standard) {
        requirementByRow.set(requirement.matrix_row_id, requirement);
      }
    });

    const assessmentByRow = new Map<string, any>();
    assessments.forEach((assessment: any) => {
      assessmentByRow.set(assessment.matrix_row_id, assessment);
    });

    const items = [...requirementByRow.values()]
      .map((requirement: any) => {
        const assessment = assessmentByRow.get(requirement.matrix_row_id);
        const bestAssessment = bestAssessmentByRow.get(requirement.matrix_row_id);
        const row = matrixRowById.get(requirement.matrix_row_id);
        if (!row) return null;

        const attemptMeetsRequirement = achievedMeetsRequired(assessment?.achieved_standard, requirement.required_standard);
        const currentMeetsRequirement = achievedMeetsRequired(bestAssessment?.achieved_standard, requirement.required_standard);
        const carriedForward = !attemptMeetsRequirement;
        const resolvedLater = carriedForward && currentMeetsRequirement;

        return {
          assessment,
          bestAssessment,
          requirement,
          row,
          attemptMeetsRequirement,
          currentMeetsRequirement,
          carriedForward,
          resolvedLater,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => (a.row.sort_order ?? 0) - (b.row.sort_order ?? 0));

    const assessedItems = items.filter((item: any) => item.assessment?.achieved_standard);

    return {
      total: items.length,
      assessed: assessedItems.length,
      met: items.filter((item: any) => item.attemptMeetsRequirement).length,
      notMet: items.filter((item: any) => item.assessment?.achieved_standard && !item.attemptMeetsRequirement),
      unassessed: items.filter((item: any) => !item.assessment?.achieved_standard),
      carriedForward: items.filter((item: any) => item.carriedForward),
      resolvedLater: items.filter((item: any) => item.resolvedLater),
      stillOutstanding: items.filter((item: any) => item.carriedForward && !item.currentMeetsRequirement),
      items,
    };
  };

  const dualMinutes = courseRecords.reduce((sum, record) => sum + (record.dualTimeMin || 0), 0);
  const soloMinutes = courseRecords.reduce((sum, record) => sum + (record.soloTimeMin || 0), 0);
  const latestRecord = courseRecords[0];
  const courseEnrolment = courseEnrolments.find((enrolment) => enrolment.courseId === course.id && enrolment.status === 'active')
    ?? courseEnrolments.find((enrolment) => enrolment.courseId === course.id);
  const declarationSigned = Boolean(
    courseEnrolment?.declarationSignedAt &&
    (courseEnrolment.declarationVersion ?? 0) >= (course.flyingDeclarationVersion ?? 1)
  );
  const guardianDeclarationRequired = Boolean(course.requiresFlyingDeclaration && isUnder18(student.dateOfBirth) && (course.requiresGuardianDeclarationForMinors ?? true));
  const guardianDeclarationSigned = Boolean(
    courseEnrolment?.guardianDeclarationSignedAt &&
    (courseEnrolment.guardianDeclarationVersion ?? 0) >= (course.flyingDeclarationVersion ?? 1)
  );

  page.drawRectangle({ x: 0, y: height - 86, width, height: 86, color: dark });
  page.drawRectangle({ x: 0, y: height - 86, width: 8, height: 86, color: blue });
  page.drawText(fitText(student.name, bold, 22, 500), { x: margin, y: height - 38, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(fitText(course.title, regular, 12, 500), { x: margin, y: height - 60, size: 12, font: regular, color: rgb(0.88, 0.91, 0.95) });
  page.drawText(isRplSyllabusCourse ? 'RPL(A) syllabus completion pack' : isRaausSyllabusCourse ? 'RAAus training course record' : 'Student course file export', { x: width - 226, y: height - 38, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText(fitText(`Status: ${course.status}`, regular, 9, 154), { x: width - 190, y: height - 56, size: 9, font: regular, color: rgb(0.88, 0.91, 0.95) });
  cursor = height - 112;

  const boxWidth = (width - margin * 2 - 32) / 5;
  drawInfoBox('Dual', `${minutesToHours(dualMinutes)} hr`, margin, cursor, boxWidth);
  drawInfoBox('Solo', `${minutesToHours(soloMinutes)} hr`, margin + (boxWidth + 8), cursor, boxWidth);
  drawInfoBox('Total', `${minutesToHours(dualMinutes + soloMinutes)} hr`, margin + (boxWidth + 8) * 2, cursor, boxWidth);
  drawInfoBox('Records', String(courseRecords.length), margin + (boxWidth + 8) * 3, cursor, boxWidth);
  drawInfoBox('Latest', latestRecord ? formatDate(latestRecord.bookingStartTime || latestRecord.date) : 'No flights', margin + (boxWidth + 8) * 4, cursor, boxWidth);
  cursor -= 70;

  if (course.requiresFlyingDeclaration) {
    drawSectionTitle(course.flyingDeclarationTitle || 'Flying Declaration');
    drawDeclarationSignatureRecord(
      'Student flying declaration',
      declarationSigned,
      courseEnrolment?.declarationSignedName,
      courseEnrolment?.declarationSignedAt,
      [
        ['Required', 'Yes'],
        ['RAAus member number', courseEnrolment?.declarationMemberNumber || student.raausId || 'Not recorded'],
        ['Version', String(courseEnrolment?.declarationVersion ?? course.flyingDeclarationVersion ?? 1)],
        ['Record source', courseEnrolment?.declarationSignedAt ? 'CRM electronic declaration' : 'Awaiting CRM signature'],
      ],
      declarationSigned
        ? 'This declaration was signed electronically in the CRM. The declaration wording below is the signed wording snapshot stored with the course enrolment.'
        : 'This course requires a student flying declaration, but the CRM does not show a current signed declaration for this course enrolment.'
    );
    const declarationWording = courseEnrolment?.declarationTextSnapshot || course.flyingDeclarationText || '';
    if (declarationWording.trim()) {
      drawFirstPageDeclarationWording(
        declarationSigned ? 'Signed declaration wording' : 'Declaration wording awaiting signature',
        declarationWording,
      );
    }
  }

  drawSectionTitle(isStructuredAviationCourse ? 'Student and Course Details' : 'Details');
  const detailRows: Array<[string, string]> = [
    ['RAAus Number', student.raausId || 'Not recorded'],
    ['RAAus Expiry', formatDate(student.licenceExpiry)],
    ['CASA ARN', student.casaId || 'Not recorded'],
    ['Medical Expiry', formatDate(student.medicalExpiry)],
    ['Mobile', student.mobilePhone || student.phone || 'Not recorded'],
    ['Address', student.address || 'Not recorded'],
    ['Date of Birth', formatDate(student.dateOfBirth)],
    ['Emergency Contact', student.emergencyContact ? `${student.emergencyContact.name} - ${student.emergencyContact.phone}` : 'Not recorded'],
  ];
  drawLabelValueGrid(detailRows, { columns: 4, rowHeight: 36, valueSize: 8.5 });

  if (course.requiresFlyingDeclaration && guardianDeclarationRequired) {
    drawSectionTitle(course.guardianDeclarationTitle || 'Under 18 Years - Parent/Guardian Declaration');
    drawDeclarationSignatureRecord(
      'Parent/guardian declaration',
      guardianDeclarationSigned,
      courseEnrolment?.guardianDeclarationSignedName,
      courseEnrolment?.guardianDeclarationSignedAt,
      [
        ['Required', 'Yes - student under 18'],
        ['Relationship', courseEnrolment?.guardianDeclarationRelationship || 'Not recorded'],
        ['Contact', [courseEnrolment?.guardianDeclarationEmail, courseEnrolment?.guardianDeclarationPhone].filter(Boolean).join(' / ') || 'Not recorded'],
        ['Version', String(courseEnrolment?.guardianDeclarationVersion ?? course.flyingDeclarationVersion ?? 1)],
      ],
      guardianDeclarationSigned
        ? 'This parent/guardian declaration was signed electronically using a secure one-time CRM signing link.'
        : 'The CRM does not show a current parent/guardian declaration signature for this under-18 student.'
    );
    const guardianWording = courseEnrolment?.guardianDeclarationTextSnapshot || course.guardianDeclarationText || '';
    if (guardianWording.trim()) {
      drawParagraphBlock(
        guardianDeclarationSigned ? 'Signed parent/guardian declaration wording' : 'Parent/guardian declaration wording awaiting signature',
        guardianWording,
        10,
      );
    }
  }

  if (isStructuredAviationCourse) {
    drawSectionTitle(isRplSyllabusCourse ? 'RPL(A) Syllabus Overview' : 'RAAus Ab-Initio Course Overview', 70);
    drawParagraphBlock('Course description', course.description, 5);
    if (course.prerequisites.length > 0 || course.objectives.length > 0 || course.evaluationCriteria.length > 0) {
      const overviewBlocks: Array<[string, string, number]> = [
        ['Prerequisites', course.prerequisites.length > 0 ? course.prerequisites.join(', ') : 'No mandatory prerequisites recorded', 4],
        ['Objectives', course.objectives.length > 0 ? course.objectives.join('; ') : 'Objectives are managed in the course lesson library', 6],
        ['Evaluation focus', course.evaluationCriteria.length > 0 ? course.evaluationCriteria.join('; ') : 'Evaluation is recorded against the CASA planning matrix', 6],
        ['Course resources', course.resources.length > 0 ? course.resources.map((resource) => resource.title).join(', ') : 'Aircraft, briefing material and flight training records', 4],
      ];
      overviewBlocks.forEach(([title, value, maxLines]) => {
        drawParagraphBlock(title, value, maxLines);
      });
    }

    drawSectionTitle('Performance Standard Key', 54);
    ensureSpace(54);
    const standardWidth = (width - margin * 2 - 16) / 3;
    const performanceStandards = isRplSyllabusCourse
      ? [
          ['3', 'Training received', 'Has received training in the element but is not yet consistently competent.'],
          ['2', 'Supervised solo standard', 'Developing proficiency and considered safe for supervised solo practice.'],
          ['1', 'Qualification standard', 'Competent to the standard required for qualification issue.'],
        ]
      : [
          ['NC', 'Not yet competent', 'More training or practice is required before the element is satisfactory.'],
          ['S', 'Solo standard', 'The element is satisfactory for the applicable supervised solo stage.'],
          ['C', 'Competent', 'The element is consistently demonstrated to the required course standard.'],
        ];
    performanceStandards.forEach(([standard, title, description], index) => {
      const x = margin + index * (standardWidth + 8);
      const standardLabelWidth = bold.widthOfTextAtSize(standard, 16);
      const textX = x + Math.max(34, standardLabelWidth + 18);
      page.drawRectangle({ x, y: cursor - 48, width: standardWidth, height: 48, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.8 });
      page.drawText(standard, { x: x + 9, y: cursor - 20, size: 16, font: bold, color: blue });
      page.drawText(fitText(title, bold, 8, standardWidth - (textX - x) - 8), { x: textX, y: cursor - 16, size: 8, font: bold, color: dark });
      drawText(description, { x: textX, y: cursor - 28 }, { size: 7, color: grey, maxWidth: standardWidth - (textX - x) - 8, lineHeight: 8 });
    });
    cursor -= 62;

    drawSectionTitle('Flight Training and Theory Summary', 70);
    const lessonSummaryColumns = [88, 260, 48, 48, 64, 64, 84, 118];
    const lessonHeader = ['Lesson #', 'Lesson description', 'Dual', 'Solo', 'Prog dual', 'Prog solo', 'Matrix', 'Records'];
    const drawLessonSummaryHeader = () => {
      let headerX = margin;
      page.drawRectangle({ x: margin, y: cursor - 24, width: width - margin * 2, height: 24, color: paleBlue, borderColor: borderGrey, borderWidth: 0.6 });
      lessonHeader.forEach((header, index) => {
        page.drawText(header, { x: headerX + 5, y: cursor - 16, size: 7.5, font: bold, color: dark });
        headerX += lessonSummaryColumns[index];
      });
      cursor -= 24;
    };
    drawLessonSummaryHeader();

    let progressiveDual = 0;
    let progressiveSolo = 0;
    for (const [lessonIndex, lesson] of course.lessons.entries()) {
      const lessonRecords = chronologicalCourseRecords.filter((record) =>
        record.lessonId === lesson.id ||
        record.lessonCodes.includes(lesson.sequenceCode) ||
        record.lessonCodes.some((code) => code.trim().toLowerCase() === lesson.name.trim().toLowerCase())
      );
      const lessonDual = lessonRecords.reduce((sum, record) => sum + (record.dualTimeMin || 0), 0);
      const lessonSolo = lessonRecords.reduce((sum, record) => sum + (record.soloTimeMin || 0), 0);
      progressiveDual += lessonDual;
      progressiveSolo += lessonSolo;
      const lessonRequirements = [
        ...(requirementsByLessonKey.get(lesson.id) ?? []),
        ...(requirementsByLessonKey.get(lesson.sequenceCode) ?? []),
      ];
      const lessonMet = lessonRequirements.filter((requirement: any) =>
        achievedMeetsRequired(
          bestAssessmentByRow.get(requirement.matrix_row_id)?.achieved_standard,
          requirement.required_standard
        )
      ).length;
      const values = [
        lesson.sequenceCode || lesson.sequenceTitle || '',
        lesson.name,
        lessonDual ? minutesToHours(lessonDual) : '-',
        lessonSolo ? minutesToHours(lessonSolo) : '-',
        minutesToHours(progressiveDual),
        minutesToHours(progressiveSolo),
        lessonRequirements.length > 0 ? `${lessonMet}/${lessonRequirements.length}` : '-',
        lessonRecords.length ? `${lessonRecords.length} attempt${lessonRecords.length === 1 ? '' : 's'}` : 'Not yet logged',
      ];
      const lessonLines = wrapText(String(values[1]), bold, 8, lessonSummaryColumns[1] - 10);
      const rowHeight = Math.max(24, lessonLines.length * 10 + 8);
      if (cursor - rowHeight < margin) {
        newPage();
        drawLessonSummaryHeader();
      }

      let x = margin;
      page.drawRectangle({
        x: margin,
        y: cursor - rowHeight,
        width: width - margin * 2,
        height: rowHeight,
        color: lessonIndex % 2 === 0 ? rgb(1, 1, 1) : lightGrey,
        borderColor: borderGrey,
        borderWidth: 0.35,
      });
      values.forEach((value, index) => {
        if (index === 1) {
          lessonLines.forEach((line, lineIndex) => {
            page.drawText(line, { x: x + 5, y: cursor - 15 - lineIndex * 10, size: 8, font: bold, color: dark });
          });
        } else {
          const font = index === 0 ? bold : regular;
          const text = fitText(String(value), font, 8, lessonSummaryColumns[index] - 10);
          page.drawText(text, { x: x + 5, y: cursor - 15, size: 8, font, color: dark });
        }
        x += lessonSummaryColumns[index];
      });
      cursor -= rowHeight;
    }
    cursor -= 12;
  }

  drawSectionTitle('Exams');
  if (courseExams.length === 0) {
    drawText('No exam results recorded for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
    cursor -= 20;
  } else {
    const columns = [60, 64, 82, 250, 150, 168];
    const headers = ['Score', 'Result', 'Date', 'Exam', 'Answer sheet', 'KDR'];
    let x = margin;
    page.drawRectangle({ x: margin, y: cursor - 22, width: width - margin * 2, height: 22, color: paleBlue, borderColor: borderGrey, borderWidth: 0.5 });
    headers.forEach((header, i) => {
      page.drawText(header, { x: x + 5, y: cursor - 15, size: 8, font: bold, color: dark });
      x += columns[i];
    });
    cursor -= 22;

    for (const exam of courseExams) {
      x = margin;
      const rowText = [
        `${exam.score}%`,
        exam.result === 'pass' ? 'Pass' : 'Fail',
        formatDate(exam.examDate),
        exam.examName,
        exam.fileName || 'No file attached',
        exam.kdrCompleted
          ? `Verbal KDR${exam.kdrSignedOffAt ? ` ${formatDate(exam.kdrSignedOffAt)}` : ''}`
          : 'Not recorded',
      ];
      const wrappedCells = rowText.map((text, index) => wrapText(text, index === 1 ? bold : regular, 8.2, columns[index] - 10));
      const rowHeight = Math.max(24, Math.max(...wrappedCells.map(lines => lines.length)) * 10 + 8);
      ensureSpace(rowHeight + 4);
      const rowColor = exam.result === 'pass' ? green : amber;
      page.drawRectangle({ x: margin, y: cursor - rowHeight, width: width - margin * 2, height: rowHeight, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.35 });
      wrappedCells.forEach((lines, i) => {
        lines.forEach((line, lineIndex) => {
          page.drawText(line, { x: x + 5, y: cursor - 15 - lineIndex * 10, size: 8.2, font: i === 1 ? bold : regular, color: i === 1 ? rowColor : dark });
        });
        x += columns[i];
      });
      cursor -= rowHeight;
    }
    cursor -= 12;
  }

  if (hasMatrixRequirements) {
    drawSectionTitle('CASA Planning Matrix Summary');
    const matrixPercentage = Math.round((metMatrixRequirements.length / matrixRequirements.length) * 100);
    const finalStandardRemaining = remainingMatrixRequirements.filter((item: any) => item.requirement.required_standard === 1).length;
    ensureSpace(70);
    const matrixBoxWidth = (width - margin * 2 - 16) / 3;
    drawInfoBox('Matrix progress', `${matrixPercentage}%`, margin, cursor, matrixBoxWidth, 42);
    drawInfoBox('Items met', `${metMatrixRequirements.length} / ${matrixRequirements.length}`, margin + matrixBoxWidth + 8, cursor, matrixBoxWidth, 42);
    drawInfoBox('Final standard remaining', String(finalStandardRemaining), margin + (matrixBoxWidth + 8) * 2, cursor, matrixBoxWidth, 42);
    cursor -= 56;

    if (remainingMatrixRequirements.length > 0) {
      ensureSpace(32);
      page.drawText('Highest priority remaining items', { x: margin, y: cursor, size: 9, font: bold, color: dark });
      cursor -= 14;
      for (const item of remainingMatrixRequirements.slice(0, 12)) {
        const row = item.row;
        const achieved = item.achieved ? String(item.achieved) : '-';
        const required = String(item.requirement.required_standard);
        const label = `${row.element_code || row.unit_code || row.code} ${achieved}/${required}`;
        const descriptionLines = wrapText(formatSyllabusMatrixText(row.description), regular, 8.2, width - margin * 2 - 124);
        const rowHeight = Math.max(22, descriptionLines.length * 10 + 6);
        ensureSpace(rowHeight + 4);
        page.drawText(fitText(label, bold, 8, 108), { x: margin, y: cursor - 10, size: 8, font: bold, color: amber });
        descriptionLines.forEach((line, lineIndex) => {
          page.drawText(line, { x: margin + 118, y: cursor - 10 - lineIndex * 10, size: 8.2, font: regular, color: dark });
        });
        cursor -= rowHeight;
      }
      cursor -= 8;
    } else {
      drawText('All matrix requirements recorded for this course currently meet the required standards.', { x: margin, y: cursor }, { size: 9, color: green });
      cursor -= 18;
    }
  } else if (hasMatrixRows) {
    drawSectionTitle('CASA Planning Matrix Summary');
    drawText(
      'CASA matrix rows are configured for this course, but no lesson pass requirements are linked. The export cannot calculate lesson matrix completion until the lesson requirement links are restored.',
      { x: margin, y: cursor },
      { size: 9, color: amber, maxWidth: width - margin * 2, lineHeight: 11 }
    );
    cursor -= 34;
  }

  drawSectionTitle('Course Progress Matrix', 100);
  if (course.lessons.length === 0) {
    drawText('No lessons are configured for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
  } else {
    const criteria = course.assessmentCriteria;
    if (criteria.length > 0) {
      page.drawText('Assessment key', { x: margin, y: cursor, size: 9, font: bold, color: blue });
      cursor -= 15;
      const keyColumnWidth = (width - margin * 2 - 16) / 2;
      for (let index = 0; index < criteria.length; index += 2) {
        const cells = criteria.slice(index, index + 2).map((criterion, cellIndex) => {
          const criterionIndex = index + cellIndex;
          const label = `${criterionCode(criterion.name, criterionIndex)} - ${criterion.name} (${criterion.gradingSystem}; pass ${criterion.passingGrade})`;
          return wrapText(label, regular, 7.8, keyColumnWidth - 12);
        });
        const keyRowHeight = Math.max(20, ...cells.map(lines => lines.length * 9 + 7));
        ensureSpace(keyRowHeight + 4);
        cells.forEach((lines, cellIndex) => {
          const cellX = margin + cellIndex * (keyColumnWidth + 16);
          page.drawRectangle({ x: cellX, y: cursor - keyRowHeight, width: keyColumnWidth, height: keyRowHeight, color: lightGrey });
          lines.forEach((line, lineIndex) => {
            page.drawText(line, { x: cellX + 6, y: cursor - 12 - lineIndex * 9, size: 7.8, font: lineIndex === 0 ? bold : regular, color: dark });
          });
        });
        cursor -= keyRowHeight + 4;
      }
      cursor -= 6;
    }

    const matrixLayout = calculateCourseProgressMatrixLayout(width, margin, criteria.length);
    const criteriaGroups = chunkPdfColumns(criteria, matrixLayout.columnsPerGroup);
    const { coreWidths, timeColumnWidth, compact: compactMatrix } = matrixLayout;
    const rowHeight = compactMatrix ? 21 : 23;
    const headerHeight = compactMatrix ? 27 : 30;
    const headerFontSize = compactMatrix ? 6.5 : 8;
    const bodyFontSize = compactMatrix ? 7.2 : 8.2;

    criteriaGroups.forEach((criteriaGroup, groupIndex) => {
      const criterionAreaWidth = width - margin * 2 - coreWidths.reduce((sum, value) => sum + value, 0) - timeColumnWidth * 2;
      const criterionWidth = criteriaGroup.length > 0 ? criterionAreaWidth / criteriaGroup.length : criterionAreaWidth;

      const drawProgressHeader = () => {
        ensureSpace(68);
        const groupLabel = criteria.length > 0
          ? criteriaGroups.length === 1
            ? `All ${criteria.length} assessment columns`
            : `Assessment columns ${groupIndex + 1} of ${criteriaGroups.length}`
          : 'Flight and briefing summary';
        page.drawText(groupLabel, { x: margin, y: cursor, size: 8.5, font: bold, color: blue });
        cursor -= 14;
        page.drawRectangle({ x: margin, y: cursor - headerHeight, width: width - margin * 2, height: headerHeight, color: paleBlue, borderColor: borderGrey, borderWidth: 0.6 });
        let headerX = margin;
        ['Lesson', 'Instructor', 'Date', 'Brief'].forEach((header, index) => {
          page.drawText(header, { x: headerX + 4, y: cursor - 18, size: compactMatrix ? 7.2 : 8, font: bold, color: dark });
          headerX += coreWidths[index];
        });
        criteriaGroup.forEach((criterion) => {
          const criterionIndex = criteria.indexOf(criterion);
          const label = criterionCode(criterion.name, criterionIndex);
          const labelWidth = bold.widthOfTextAtSize(label, headerFontSize);
          page.drawText(label, {
            x: headerX + Math.max(2, (criterionWidth - labelWidth) / 2),
            y: cursor - 18,
            size: headerFontSize,
            font: bold,
            color: dark,
          });
          headerX += criterionWidth;
        });
        ['Dual', 'Solo'].forEach((header) => {
          page.drawText(header, { x: headerX + 3, y: cursor - 18, size: compactMatrix ? 6.8 : 8, font: bold, color: dark });
          headerX += timeColumnWidth;
        });
        cursor -= headerHeight;
      };

      drawProgressHeader();
      chronologicalCourseRecords.forEach((record, recordIndex) => {
        if (cursor - rowHeight < margin) {
          newPage();
          drawProgressHeader();
        }

        let x = margin;
        const instructor = courseRecordInstructorName(record, users);
        const cells = [
          resolveLessonName(record),
          abbreviateName(instructor),
          formatShortDate(record.bookingStartTime || record.date),
          record.formalBriefing ? 'Yes' : 'No',
        ];
        page.drawRectangle({
          x: margin,
          y: cursor - rowHeight,
          width: width - margin * 2,
          height: rowHeight,
          color: recordIndex % 2 === 0 ? rgb(1, 1, 1) : lightGrey,
          borderColor: borderGrey,
          borderWidth: 0.35,
        });
        cells.forEach((cell, index) => {
          const text = fitText(cell, regular, bodyFontSize, coreWidths[index] - 8);
          page.drawText(text, { x: x + 4, y: cursor - 14, size: bodyFontSize, font: regular, color: dark });
          x += coreWidths[index];
        });
        criteriaGroup.forEach((criterion) => {
          const grade = record.criteriaGrades?.[criterion.id] || '-';
          const label = matrixGradeLabel(grade, criterion.gradingSystem);
          const color = matrixGradeColor(grade, criterion.gradingSystem, { green, blue, amber, red, dark, grey }) || grey;
          const gradeWidth = mono.widthOfTextAtSize(label, bodyFontSize);
          page.drawText(label, {
            x: x + Math.max(2, (criterionWidth - gradeWidth) / 2),
            y: cursor - 14,
            size: bodyFontSize,
            font: mono,
            color,
          });
          x += criterionWidth;
        });
        [record.dualTimeMin, record.soloTimeMin].forEach((minutes) => {
          const value = minutesToHours(minutes);
          page.drawText(value, { x: x + 3, y: cursor - 14, size: bodyFontSize, font: regular, color: dark });
          x += timeColumnWidth;
        });
        cursor -= rowHeight;
      });
      cursor -= 16;
    });
  }

  const trainingRecordSectionTitle = isStructuredAviationCourse
    ? 'Training Records and Instructor Comments'
    : 'Lesson Notes and Record Cards';
  if (isStructuredAviationCourse && courseRecords.length > 0) {
    runningSection = trainingRecordSectionTitle;
    newPage();
  }
  drawSectionTitle(trainingRecordSectionTitle, 80);
  if (courseRecords.length === 0) {
    drawText('No lesson comments recorded for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
  } else {
    for (const record of chronologicalCourseRecords) {
      const instructor = courseRecordInstructorName(record, users);
      const lessonName = resolveLessonName(record);
      const comments = stripHtml(record.comments);
      const briefing = stripHtml(record.briefingComments);
      const reviewNotes = stripHtml(record.flightReviewNotes || '');
      const matrixSummary = getRecordMatrixSummary(record);
      const matrixLines = isRplSyllabusCourse && matrixSummary.total > 0
        ? [
            {
              text: `CASA matrix: ${matrixSummary.met}/${matrixSummary.total} lesson requirements satisfactory on this attempt. ${matrixSummary.carriedForward.length} unsatisfactory or carried forward${record.nextLesson ? ` to ${record.nextLesson}` : ''}.`,
              color: matrixSummary.carriedForward.length > 0 ? amber : green,
              font: bold,
            },
            ...(matrixSummary.met > 0 ? [{
              text: `Satisfactory matrix items (${matrixSummary.met})`,
              color: green,
              font: bold,
            }] : []),
            ...matrixSummary.items.filter((item: any) => item.attemptMeetsRequirement).slice(0, 6).map((item: any) => ({
              text: `Met: ${matrixEvidenceLabel(item)}`,
              color: green,
              font: regular,
            })),
            ...(matrixSummary.met > 6 ? [{
              text: `Plus ${matrixSummary.met - 6} more satisfactory matrix item${matrixSummary.met - 6 === 1 ? '' : 's'}.`,
              color: grey,
              font: regular,
            }] : []),
            ...(matrixSummary.carriedForward.length > 0 ? [{
              text: `Unsatisfactory / carried forward matrix items (${matrixSummary.carriedForward.length})`,
              color: amber,
              font: bold,
            }] : []),
            ...matrixSummary.carriedForward.slice(0, 8).map((item: any) => {
              const prefix = item.assessment?.achieved_standard ? 'Not met' : 'Not assessed';
              const later = item.resolvedLater ? ' - resolved in a later lesson' : ' - moved forward';
              return {
                text: `${prefix}: ${matrixEvidenceLabel(item)}${later}`,
                color: item.resolvedLater ? green : amber,
                font: regular,
              };
            }),
            ...(matrixSummary.carriedForward.length > 8 ? [{
              text: `Plus ${matrixSummary.carriedForward.length - 8} more unsatisfactory/carried-forward matrix item${matrixSummary.carriedForward.length - 8 === 1 ? '' : 's'}.`,
              color: grey,
              font: regular,
            }] : []),
          ]
        : [];
      const meta = [
        `Instructor: ${instructor}`,
        `Aircraft: ${record.registration || record.aircraftType || 'Not recorded'}`,
        `Dual: ${minutesToHours(record.dualTimeMin)} hr`,
        `Solo: ${minutesToHours(record.soloTimeMin)} hr`,
        `Briefing: ${record.formalBriefing ? 'Yes' : 'No'}`,
        `Student ack: ${courseRecordAcknowledgementLabel(record, formatDate)}`,
      ].join('  |  ');

      const drawRecordHeading = (continued = false) => {
        const metaLines = wrapText(meta, regular, 8.2, width - margin * 2 - 24);
        const headingHeight = 36 + metaLines.length * 10;
        const minimumBodySpace = continued ? 28 : 52;
        if (cursor - headingHeight - minimumBodySpace < margin) newPage();

        page.drawRectangle({
          x: margin,
          y: cursor - headingHeight,
          width: width - margin * 2,
          height: headingHeight,
          color: paleBlue,
          borderColor: borderGrey,
          borderWidth: 0.6,
        });
        page.drawRectangle({ x: margin, y: cursor - headingHeight, width: 5, height: headingHeight, color: blue });
        const date = formatDate(record.bookingStartTime || record.date);
        const dateWidth = bold.widthOfTextAtSize(date, 8.5);
        const title = fitText(`${lessonName}${continued ? ' (continued)' : ''}`, bold, 11, width - margin * 2 - dateWidth - 42);
        page.drawText(title, { x: margin + 13, y: cursor - 18, size: 11, font: bold, color: dark });
        page.drawText(date, { x: width - margin - 10 - dateWidth, y: cursor - 18, size: 8.5, font: bold, color: grey });
        metaLines.forEach((line, lineIndex) => {
          page.drawText(line, { x: margin + 13, y: cursor - 34 - lineIndex * 10, size: 8.2, font: regular, color: grey });
        });
        cursor -= headingHeight + 8;
      };

      const drawRecordSection = (
        label: string,
        entries: Array<{ text: string; font?: any; color?: any; size?: number }>,
        labelColor = blue,
      ) => {
        if (entries.length === 0) return;
        let needsLabel = true;
        let labelIsContinuation = false;

        entries.forEach((entry) => {
          const entryFont = entry.font ?? regular;
          const entryColor = entry.color ?? dark;
          const entrySize = entry.size ?? 9;
          const lineHeight = entrySize + 3;
          const lines = wrapText(entry.text, entryFont, entrySize, width - margin * 2 - 24);

          lines.forEach((line) => {
            const required = lineHeight + (needsLabel ? 18 : 0);
            if (cursor - required < margin) {
              newPage();
              drawRecordHeading(true);
              needsLabel = true;
              labelIsContinuation = true;
            }
            if (needsLabel) {
              page.drawText(`${label}${labelIsContinuation ? ' (continued)' : ''}`, { x: margin + 12, y: cursor, size: 8, font: bold, color: labelColor });
              cursor -= 14;
              needsLabel = false;
              labelIsContinuation = false;
            }
            page.drawText(line, { x: margin + 12, y: cursor, size: entrySize, font: entryFont, color: entryColor });
            cursor -= lineHeight;
          });
          cursor -= 3;
        });
        cursor -= 5;
      };

      drawRecordHeading();
      drawRecordSection(
        'Instructor comments',
        [{
          text: comments || 'No instructor comments recorded.',
          color: comments ? dark : grey,
          size: 9,
        }],
      );

      if (briefing) {
        drawRecordSection('Briefing comments', [{ text: briefing, size: 8.8 }]);
      }

      if (record.isFlightReview || reviewNotes) {
        const reviewLabel = `Review / test - ${record.flightReviewResult || 'not assessed'}`;
        drawRecordSection(reviewLabel, reviewNotes ? [{ text: reviewNotes, size: 8.8 }] : [{ text: 'No formal findings or follow-up recorded.', color: grey, size: 8.8 }], record.flightReviewResult === 'pass' ? green : amber);
      }

      if (matrixLines.length > 0) {
        drawRecordSection('CASA matrix evidence', matrixLines.map(line => ({
          text: line.text,
          font: line.font,
          color: line.color,
          size: 8,
        })));
      }

      ensureSpace(18);
      page.drawLine({ start: { x: margin, y: cursor }, end: { x: width - margin, y: cursor }, thickness: 0.6, color: borderGrey });
      cursor -= 14;
    }
  }

  if (isStructuredAviationCourse) {
    drawSectionTitle('Certification and Completion');
    const assessedLessonCount = new Set(courseRecords.map((record) => {
      const lesson = resolveLesson(record);
      return lesson?.id || record.lessonCodes[0]?.trim().toLowerCase();
    }).filter(Boolean)).size;
    const acknowledgedRecordCount = courseRecords.filter(record => record.studentAck).length;
    const completionRows: Array<[string, string]> = [
      isRplSyllabusCourse
        ? ['Matrix completion', hasMatrixRequirements ? `${metMatrixRequirements.length} of ${matrixRequirements.length} required items met` : hasMatrixRows ? 'Matrix rows configured, lesson requirements missing' : 'No CASA matrix configured']
        : ['Training records', `${courseRecords.length} records across ${assessedLessonCount} lessons`],
      isRplSyllabusCourse
        ? ['Remaining items', hasMatrixRequirements ? (remainingMatrixRequirements.length > 0 ? String(remainingMatrixRequirements.length) : 'None recorded') : hasMatrixRows ? 'Cannot calculate until lesson requirements are linked' : 'None recorded']
        : ['Student acknowledgements', `${acknowledgedRecordCount} of ${courseRecords.length} records acknowledged`],
      ['Flight test lesson', course.lessons.find((lesson) => lesson.isFlightTest)?.name || 'Not designated in course editor'],
      ['Course endorsement', course.completionEndorsementEnabled && course.completionEndorsementType ? course.completionEndorsementType : 'No automatic endorsement configured'],
      ['Course licence', course.completionLicenceEnabled && course.completionLicenceType ? course.completionLicenceType : 'No automatic licence configured'],
    ];
    drawLabelValueGrid(completionRows, { columns: 4, rowHeight: 30, valueSize: 8 });
    drawText(
      includeExamSheets
        ? `This staff export summarises the CRM record for the student course, including lesson records, comments, ${isRplSyllabusCourse ? 'CASA matrix assessments, ' : ''}and uploaded exam evidence available at the time of export.`
        : 'This student export summarises course progress, lesson records, comments, assessment results and exam outcomes. Staff-only uploaded exam sheets are excluded.',
      { x: margin, y: cursor },
      { size: 8, color: grey, maxWidth: width - margin * 2, lineHeight: 10 }
    );
    cursor -= 26;
    drawDigitalSignatureCertification();
  }

  addFooter();

  for (const exam of includeExamSheets ? courseExamEvidence : []) {
    try {
      const { data, error } = await supabase.storage.from(EXAM_UPLOAD_BUCKET).download(exam.storagePath!);
      if (error || !data) continue;
      const bytes = await data.arrayBuffer();
      const mimeType = exam.fileType || data.type || 'application/octet-stream';
      await pdfDoc.attach(bytes, exam.fileName || `${safeFilename(exam.examName)}-upload`, {
        mimeType,
        description: `${exam.examName} uploaded exam evidence`,
        creationDate: exam.createdAt,
        modificationDate: exam.createdAt,
      });

      if (mimeType === 'application/pdf') {
        const evidencePdf = await PDFDocument.load(bytes);
        const copiedPages = await pdfDoc.copyPages(evidencePdf, evidencePdf.getPageIndices());
        copiedPages.forEach((copiedPage, index) => {
          pdfDoc.addPage(copiedPage);
          copiedPage.drawText(fitText(`${exam.examName} evidence - ${exam.fileName || 'uploaded PDF'} - page ${index + 1}`, regular, 7, copiedPage.getWidth() - 48), {
            x: 24,
            y: 18,
            size: 7,
            font: regular,
            color: grey,
          });
        });
      } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/png') {
        const image = mimeType === 'image/png'
          ? await pdfDoc.embedPng(bytes)
          : await pdfDoc.embedJpg(bytes);
        const evidencePage = pdfDoc.addPage(pageSize);
        const pageW = evidencePage.getWidth();
        const pageH = evidencePage.getHeight();
        evidencePage.drawRectangle({ x: 0, y: pageH - 44, width: pageW, height: 44, color: dark });
        evidencePage.drawText(fitText(`${exam.examName} evidence`, bold, 14, pageW - margin * 2 - 250), { x: margin, y: pageH - 28, size: 14, font: bold, color: rgb(1, 1, 1) });
        const evidenceFileName = fitText(exam.fileName || 'Uploaded exam image', regular, 8, 220);
        evidencePage.drawText(evidenceFileName, { x: pageW - margin - regular.widthOfTextAtSize(evidenceFileName, 8), y: pageH - 28, size: 8, font: regular, color: rgb(0.9, 0.92, 0.95) });
        const maxW = pageW - margin * 2;
        const maxH = pageH - 84;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        const imgW = image.width * scale;
        const imgH = image.height * scale;
        evidencePage.drawImage(image, {
          x: (pageW - imgW) / 2,
          y: margin,
          width: imgW,
          height: imgH,
        });
      }
    } catch (error) {
      console.warn('Failed to attach exam file to course PDF:', error);
    }
  }

  const pdfBytes = await pdfDoc.save();
  if (download) {
    downloadBlob(pdfBytes, `${safeFilename(student.name)}-${safeFilename(course.title)}.pdf`);
  }
  return pdfBytes;
}
