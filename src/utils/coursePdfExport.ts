import { Student, StudentExamResult, TrainingModule, TrainingRecord, User } from '../types';
import { supabase } from '../lib/supabase';
import { formatSyllabusMatrixText } from '../hooks/useSyllabusMatrix';

const EXAM_UPLOAD_BUCKET = 'student-exam-uploads';

type ExportCoursePdfInput = {
  student: Student;
  course: TrainingModule;
  records: TrainingRecord[];
  exams: StudentExamResult[];
  users: User[];
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

const abbreviateName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return name.slice(0, 16);
  return `${parts[0][0]}.${parts.slice(1).join(' ')}`.slice(0, 18);
};

const criterionCode = (name: string, index: number) => {
  const lower = name.toLowerCase();
  const known: Array<[string, string]> = [
    ['flt. prep', 'FP'],
    ['flight prep', 'FP'],
    ['ground ops', 'FP'],
    ['airmanship', 'HF'],
    ['effects of controls', 'EC'],
    ['straight', 'SL'],
    ['climbing', 'CL'],
    ['descending', 'DS'],
    ['basic turning', 'BT'],
    ['slow flight', 'ST'],
    ['stalls', 'ST'],
    ['take-off', 'TO'],
    ['take off', 'TO'],
    ['landing', 'LD'],
    ['e.f.i.c', 'EF'],
    ['efic', 'EF'],
    ['advanced turning', 'AT'],
    ['scenario', 'SS'],
    ['equipment', 'EQ'],
    ['forced landings', 'FL'],
    ['operation in ta', 'TA'],
    ['training area', 'TA'],
    ['unexpected', 'US'],
    ['practice flight test', 'PF'],
    ['consolidation', 'CN'],
    ['flight test', 'FT'],
  ];
  return known.find(([needle]) => lower.includes(needle))?.[1] || `C${index + 1}`;
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

const wrapText = (text: string, font: any, size: number, maxWidth: number) => {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
};

const stripHtml = (value: string) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const downloadBlob = (bytes: Uint8Array, filename: string) => {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export async function exportCoursePdf({
  student,
  course,
  records,
  exams,
  users,
}: ExportCoursePdfInput) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const dark = rgb(0.12, 0.13, 0.15);
  const grey = rgb(0.42, 0.45, 0.5);
  const lightGrey = rgb(0.94, 0.95, 0.96);
  const borderGrey = rgb(0.78, 0.8, 0.84);
  const blue = rgb(0.05, 0.3, 0.65);
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

  const addFooter = () => {
    page.drawText(`Generated ${formatDate(new Date())} - Page ${pageNo}`, {
      x: margin,
      y: 18,
      size: 7,
      font: regular,
      color: grey,
    });
  };

  const newPage = () => {
    addFooter();
    page = pdfDoc.addPage(pageSize);
    ({ width, height } = page.getSize());
    cursor = height - margin;
    pageNo += 1;
  };

  const ensureSpace = (required: number) => {
    if (cursor - required < margin) newPage();
  };

  const drawText = (text: string, at: Point, options: { size?: number; font?: any; color?: any; maxWidth?: number; lineHeight?: number } = {}) => {
    const size = options.size ?? 9;
    const font = options.font ?? regular;
    const color = options.color ?? dark;
    const lineHeight = options.lineHeight ?? size + 3;
    const lines = options.maxWidth ? wrapText(text, font, size, options.maxWidth) : [text];
    lines.forEach((line, index) => {
      page.drawText(line, { x: at.x, y: at.y - index * lineHeight, size, font, color });
    });
    return lines.length * lineHeight;
  };

  const drawSectionTitle = (title: string) => {
    ensureSpace(34);
    page.drawRectangle({ x: margin, y: cursor - 22, width: width - margin * 2, height: 22, color: dark });
    page.drawText(title, { x: margin + 10, y: cursor - 15, size: 10, font: bold, color: rgb(1, 1, 1) });
    cursor -= 32;
  };

  const drawInfoBox = (title: string, value: string, x: number, y: number, boxWidth: number, boxHeight = 46) => {
    page.drawRectangle({ x, y: y - boxHeight, width: boxWidth, height: boxHeight, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.8 });
    page.drawText(title, { x: x + 8, y: y - 14, size: 7, font: bold, color: grey });
    drawText(value || 'Not recorded', { x: x + 8, y: y - 29 }, { size: 10, font: bold, maxWidth: boxWidth - 16, lineHeight: 11 });
  };

  const drawLabelValueGrid = (
    rows: Array<[string, string]>,
    options: { columns?: number; labelWidth?: number; rowHeight?: number; valueSize?: number } = {}
  ) => {
    const columns = options.columns ?? 2;
    const rowHeight = options.rowHeight ?? 24;
    const valueSize = options.valueSize ?? 8;
    const columnWidth = (width - margin * 2) / columns;
    const rowCount = Math.ceil(rows.length / columns);
    ensureSpace(rowCount * rowHeight + 8);

    rows.forEach(([label, value], index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      const x = margin + col * columnWidth;
      const y = cursor - row * rowHeight;
      drawText(label, { x, y }, { size: 7, font: bold, color: grey, maxWidth: columnWidth - 10 });
      drawText(value || 'Not recorded', { x, y: y - 11 }, { size: valueSize, color: dark, maxWidth: columnWidth - 10, lineHeight: valueSize + 2 });
    });
    cursor -= rowCount * rowHeight + 8;
  };

  const drawParagraphBlock = (title: string, value: string, maxLines = 7) => {
    const text = stripHtml(value);
    if (!text) return;
    const lines = wrapText(text, regular, 8, width - margin * 2 - 20).slice(0, maxLines);
    ensureSpace(18 + lines.length * 10);
    page.drawText(title, { x: margin, y: cursor, size: 8, font: bold, color: grey });
    cursor -= 12;
    lines.forEach((line) => {
      page.drawText(line, { x: margin, y: cursor, size: 8, font: regular, color: dark });
      cursor -= 10;
    });
    cursor -= 4;
  };

  const drawSignatureLines = (labels: string[]) => {
    ensureSpace(48);
    const columnWidth = (width - margin * 2 - 16) / labels.length;
    labels.forEach((label, index) => {
      const x = margin + index * (columnWidth + 8);
      page.drawLine({ start: { x, y: cursor - 24 }, end: { x: x + columnWidth, y: cursor - 24 }, thickness: 0.6, color: borderGrey });
      page.drawText(label, { x, y: cursor - 38, size: 7, font: bold, color: grey });
    });
    cursor -= 52;
  };

  const courseRecords = records
    .filter((record) => record.courseId === course.id)
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
  const resolveLessonName = (record: TrainingRecord) => {
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
    return lesson?.name || fallbackLesson?.name || byName?.name || recordedCode || record.registration || 'Flight';
  };
  const courseExamDefinitions = course.exams || [];
  const courseExams = exams
    .filter((exam) => (
      exam.courseId === course.id ||
      courseExamDefinitions.some((definition) =>
        definition.id === exam.examId ||
        definition.name.trim().toLowerCase() === exam.examName.trim().toLowerCase()
      )
    ))
    .sort((a, b) => b.examDate.getTime() - a.examDate.getTime());

  const [matrixRows, matrixRequirements, matrixAssessments] = await Promise.all([
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

  const isRplSyllabusCourse = matrixRequirements.length > 0 || /rpl|casa/i.test(`${course.title} ${course.category}`);
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

    const notMet = assessments
      .map((assessment: any) => {
        const requirement = requirementByRow.get(assessment.matrix_row_id);
        const row = matrixRowById.get(assessment.matrix_row_id);
        const achieved = assessment.achieved_standard;
        if (!row || !requirement || achievedMeetsRequired(achieved, requirement.required_standard)) return null;
        return { assessment, requirement, row };
      })
      .filter(Boolean);

    return {
      assessed: assessments.length,
      met: assessments.length - notMet.length,
      notMet,
    };
  };

  const dualMinutes = courseRecords.reduce((sum, record) => sum + (record.dualTimeMin || 0), 0);
  const soloMinutes = courseRecords.reduce((sum, record) => sum + (record.soloTimeMin || 0), 0);
  const latestRecord = courseRecords[0];

  page.drawRectangle({ x: 0, y: height - 86, width, height: 86, color: dark });
  page.drawText(student.name, { x: margin, y: height - 38, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText(course.title, { x: margin, y: height - 60, size: 12, font: regular, color: rgb(0.88, 0.91, 0.95) });
  page.drawText(isRplSyllabusCourse ? 'RPL(A) syllabus completion pack' : 'Student course file export', { x: width - 226, y: height - 38, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`Status: ${course.status}`, { x: width - 190, y: height - 56, size: 9, font: regular, color: rgb(0.88, 0.91, 0.95) });
  cursor = height - 112;

  const boxWidth = (width - margin * 2 - 32) / 5;
  drawInfoBox('Dual', `${minutesToHours(dualMinutes)} hr`, margin, cursor, boxWidth);
  drawInfoBox('Solo', `${minutesToHours(soloMinutes)} hr`, margin + (boxWidth + 8), cursor, boxWidth);
  drawInfoBox('Total', `${minutesToHours(dualMinutes + soloMinutes)} hr`, margin + (boxWidth + 8) * 2, cursor, boxWidth);
  drawInfoBox('Records', String(courseRecords.length), margin + (boxWidth + 8) * 3, cursor, boxWidth);
  drawInfoBox('Latest', latestRecord ? formatDate(latestRecord.bookingStartTime || latestRecord.date) : 'No flights', margin + (boxWidth + 8) * 4, cursor, boxWidth);
  cursor -= 70;

  drawSectionTitle(isRplSyllabusCourse ? 'Student and Course Details' : 'Details');
  const detailRows = [
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

  if (isRplSyllabusCourse) {
    drawSectionTitle('RPL(A) Syllabus Overview');
    drawParagraphBlock('Course description', course.description, 5);
    if (course.prerequisites.length > 0 || course.objectives.length > 0 || course.evaluationCriteria.length > 0) {
      const overviewRows: Array<[string, string]> = [
        ['Prerequisites', course.prerequisites.length > 0 ? course.prerequisites.join(', ') : 'No mandatory prerequisites recorded'],
        ['Objectives', course.objectives.length > 0 ? course.objectives.join('; ') : 'Objectives are managed in the course lesson library'],
        ['Evaluation focus', course.evaluationCriteria.length > 0 ? course.evaluationCriteria.join('; ') : 'Evaluation is recorded against the CASA planning matrix'],
        ['Course resources', course.resources.length > 0 ? course.resources.map((resource) => resource.title).join(', ') : 'Aircraft, briefing material and flight training records'],
      ];
      drawLabelValueGrid(overviewRows, { columns: 2, rowHeight: 34, valueSize: 8 });
    }

    drawSectionTitle('Performance Standard Key');
    ensureSpace(54);
    const standardWidth = (width - margin * 2 - 16) / 3;
    [
      ['3', 'Training received', 'Has received training in the element but is not yet consistently competent.'],
      ['2', 'Supervised solo standard', 'Developing proficiency and considered safe for supervised solo practice.'],
      ['1', 'Qualification standard', 'Competent to the standard required for qualification issue.'],
    ].forEach(([standard, title, description], index) => {
      const x = margin + index * (standardWidth + 8);
      page.drawRectangle({ x, y: cursor - 48, width: standardWidth, height: 48, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.8 });
      page.drawText(standard, { x: x + 9, y: cursor - 20, size: 16, font: bold, color: blue });
      page.drawText(title, { x: x + 30, y: cursor - 16, size: 8, font: bold, color: dark });
      drawText(description, { x: x + 30, y: cursor - 28 }, { size: 7, color: grey, maxWidth: standardWidth - 38, lineHeight: 8 });
    });
    cursor -= 62;

    drawSectionTitle('Flight Training and Theory Summary');
    const lessonSummaryColumns = [74, 188, 42, 42, 52, 52, 86, 112];
    const lessonHeader = ['Lesson #', 'Lesson description', 'Dual', 'Solo', 'Prog dual', 'Prog solo', 'Matrix', 'Records'];
    let x = margin;
    page.drawRectangle({ x: margin, y: cursor - 20, width: width - margin * 2, height: 20, color: lightGrey, borderColor: borderGrey, borderWidth: 0.5 });
    lessonHeader.forEach((header, index) => {
      page.drawText(header, { x: x + 4, y: cursor - 13, size: 7, font: bold, color: dark });
      x += lessonSummaryColumns[index];
    });
    cursor -= 20;

    let progressiveDual = 0;
    let progressiveSolo = 0;
    for (const lesson of course.lessons) {
      ensureSpace(18);
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
      x = margin;
      page.drawRectangle({ x: margin, y: cursor - 18, width: width - margin * 2, height: 18, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.35 });
      [
        lesson.sequenceCode || lesson.sequenceTitle || '',
        lesson.name,
        lessonDual ? minutesToHours(lessonDual) : '-',
        lessonSolo ? minutesToHours(lessonSolo) : '-',
        minutesToHours(progressiveDual),
        minutesToHours(progressiveSolo),
        lessonRequirements.length > 0 ? `${lessonMet}/${lessonRequirements.length}` : '-',
        lessonRecords.length ? `${lessonRecords.length} attempt${lessonRecords.length === 1 ? '' : 's'}` : 'Not yet logged',
      ].forEach((value, index) => {
        page.drawText(String(value).slice(0, index === 1 ? 34 : 18), { x: x + 4, y: cursor - 12, size: 7, font: index === 0 || index === 1 ? bold : regular, color: dark });
        x += lessonSummaryColumns[index];
      });
      cursor -= 18;
    }
    cursor -= 12;
  }

  drawSectionTitle('Exams');
  if (courseExams.length === 0) {
    drawText('No exam results recorded for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
    cursor -= 20;
  } else {
    const columns = [70, 70, 90, 320, 150];
    const headers = ['Score', 'Result', 'Date', 'Exam', 'Uploaded evidence'];
    let x = margin;
    page.drawRectangle({ x: margin, y: cursor - 18, width: width - margin * 2, height: 18, color: lightGrey, borderColor: borderGrey, borderWidth: 0.5 });
    headers.forEach((header, i) => {
      page.drawText(header, { x: x + 4, y: cursor - 12, size: 7.5, font: bold, color: dark });
      x += columns[i];
    });
    cursor -= 18;

    for (const exam of courseExams) {
      ensureSpace(22);
      x = margin;
      const rowText = [
        `${exam.score}%`,
        exam.result === 'pass' ? 'Pass' : 'Fail',
        formatDate(exam.examDate),
        exam.examName,
        exam.fileName || 'No file attached',
      ];
      const rowColor = exam.result === 'pass' ? green : amber;
      page.drawRectangle({ x: margin, y: cursor - 18, width: width - margin * 2, height: 18, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.35 });
      rowText.forEach((text, i) => {
        page.drawText(text.slice(0, i === 3 ? 56 : 28), { x: x + 4, y: cursor - 12, size: 8, font: i === 1 ? bold : regular, color: i === 1 ? rowColor : dark });
        x += columns[i];
      });
      cursor -= 18;
    }
    cursor -= 12;
  }

  if (matrixRequirements.length > 0) {
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
        ensureSpace(22);
        const row = item.row;
        const achieved = item.achieved ? String(item.achieved) : '-';
        const required = String(item.requirement.required_standard);
        const label = `${row.element_code || row.unit_code || row.code} ${achieved}/${required}`;
        page.drawText(label.slice(0, 24), { x: margin, y: cursor - 8, size: 7, font: bold, color: amber });
        drawText(formatSyllabusMatrixText(row.description).slice(0, 150), { x: margin + 88, y: cursor - 8 }, { size: 7, color: dark, maxWidth: width - margin * 2 - 98, lineHeight: 8 });
        cursor -= 18;
      }
      cursor -= 8;
    } else {
      drawText('All matrix requirements recorded for this course currently meet the required standards.', { x: margin, y: cursor }, { size: 9, color: green });
      cursor -= 18;
    }
  }

  drawSectionTitle('Course Progress Matrix');
  if (course.lessons.length === 0) {
    drawText('No lessons are configured for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
  } else {
    const criteria = course.assessmentCriteria;
    if (criteria.length > 0) {
      ensureSpace(42);
      drawText('Criteria key', { x: margin, y: cursor }, { size: 8, font: bold, color: grey });
      const keyLines = criteria.map((criterion, index) =>
        `${criterionCode(criterion.name, index)} = ${criterion.name} (${criterion.gradingSystem}, pass ${criterion.passingGrade})`
      );
      const keyColumnWidth = (width - margin * 2) / 3;
      keyLines.forEach((line, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        drawText(line, { x: margin + col * keyColumnWidth, y: cursor - 14 - row * 10 }, { size: 6.5, maxWidth: keyColumnWidth - 8, lineHeight: 8 });
      });
      cursor -= 16 + Math.ceil(keyLines.length / 3) * 10;
    }

    const leftWidths = [42, 92, 58, 46];
    const improvedLeftWidths = [150, 92, 50, 34];
    const matrixWidth = width - margin * 2 - improvedLeftWidths.reduce((a, b) => a + b, 0) - 54;
    const criterionWidth = criteria.length > 0 ? Math.max(18, Math.min(34, matrixWidth / criteria.length)) : 0;
    const rowHeight = 20;
    const headerHeight = 46;

    ensureSpace(headerHeight + rowHeight * Math.min(courseRecords.length + 1, 12));
    page.drawRectangle({ x: margin, y: cursor - headerHeight, width: width - margin * 2, height: headerHeight, color: lightGrey, borderColor: borderGrey, borderWidth: 0.5 });
    let x = margin;
    ['Lesson', 'Instructor', 'Date', 'Brief'].forEach((header, i) => {
      page.drawText(header, { x: x + 4, y: cursor - headerHeight + 8, size: 7, font: bold, color: dark });
      x += improvedLeftWidths[i];
    });
    criteria.forEach((criterion, index) => {
      const label = criterionCode(criterion.name, index);
      page.drawText(label, { x: x + Math.max(2, criterionWidth / 2 - 5), y: cursor - headerHeight + 8, size: 6.5, font: bold, color: dark });
      x += criterionWidth;
    });
    page.drawText('Dual', { x: width - margin - 50, y: cursor - headerHeight + 8, size: 7, font: bold, color: dark });
    page.drawText('Solo', { x: width - margin - 24, y: cursor - headerHeight + 8, size: 7, font: bold, color: dark });
    cursor -= headerHeight;

    for (const record of chronologicalCourseRecords) {
      ensureSpace(rowHeight + 24);
      x = margin;
      const instructor = users.find((u) => u.id === record.instructorId)?.name || 'Unknown';
      const cells = [
        resolveLessonName(record),
        abbreviateName(instructor),
        formatShortDate(record.bookingStartTime || record.date),
        record.formalBriefing ? 'Yes' : 'No',
      ];
      page.drawRectangle({ x: margin, y: cursor - rowHeight, width: width - margin * 2, height: rowHeight, color: rgb(1, 1, 1), borderColor: borderGrey, borderWidth: 0.35 });
      cells.forEach((cell, i) => {
        page.drawText(cell.slice(0, i === 0 ? 32 : 18), { x: x + 4, y: cursor - 13, size: 7, font: regular, color: dark });
        x += improvedLeftWidths[i];
      });
      criteria.forEach((criterion) => {
        const grade = record.criteriaGrades?.[criterion.id] || '-';
        const label = matrixGradeLabel(grade, criterion.gradingSystem);
        const color = matrixGradeColor(grade, criterion.gradingSystem, { green, blue, amber, red, dark, grey }) || grey;
        page.drawText(label.slice(0, 5), { x: x + Math.max(2, criterionWidth / 2 - 8), y: cursor - 13, size: 7, font: mono, color });
        x += criterionWidth;
      });
      page.drawText(minutesToHours(record.dualTimeMin), { x: width - margin - 50, y: cursor - 13, size: 7, font: regular, color: dark });
      page.drawText(minutesToHours(record.soloTimeMin), { x: width - margin - 24, y: cursor - 13, size: 7, font: regular, color: dark });
      cursor -= rowHeight;
    }
  }

  if (isRplSyllabusCourse && course.lessons.length > 0) {
    drawSectionTitle('Lesson Syllabus Reference');
    for (const lesson of course.lessons) {
      const contentBlocks = [
        ['Lesson overview', lesson.objective],
        ['Pre-flight knowledge / theory focus', lesson.theory || lesson.studentPreparation],
        ['Flight training exercises', lesson.flightExercises || lesson.keyExercises.join('; ')],
        ['Instructor notes', lesson.instructorNotes],
      ].filter(([, value]) => stripHtml(value).length > 0);
      const estimatedLines = contentBlocks.reduce((sum, [, value]) => sum + Math.min(wrapText(stripHtml(value), regular, 7.2, width - margin * 2 - 24).length, 3), 0);
      const cardHeight = 42 + estimatedLines * 8 + contentBlocks.length * 12;
      ensureSpace(Math.min(cardHeight, height - margin * 2));
      const cardTop = cursor;
      page.drawRectangle({
        x: margin,
        y: cardTop - cardHeight,
        width: width - margin * 2,
        height: cardHeight,
        color: rgb(1, 1, 1),
        borderColor: borderGrey,
        borderWidth: 0.6,
      });
      page.drawRectangle({
        x: margin,
        y: cardTop - 25,
        width: width - margin * 2,
        height: 25,
        color: lightGrey,
      });
      page.drawText(`${lesson.sequenceCode || lesson.sequenceTitle || 'Lesson'} - ${lesson.name}`.slice(0, 110), {
        x: margin + 10,
        y: cardTop - 16,
        size: 9,
        font: bold,
        color: dark,
      });
      page.drawText(`${lesson.durationMinutes || 0} min`, {
        x: width - margin - 58,
        y: cardTop - 16,
        size: 7,
        font: bold,
        color: grey,
      });

      let y = cardTop - 39;
      contentBlocks.forEach(([label, value]) => {
        page.drawText(label, { x: margin + 10, y, size: 7, font: bold, color: grey });
        y -= 9;
        wrapText(stripHtml(value), regular, 7.2, width - margin * 2 - 24).slice(0, 3).forEach((line) => {
          page.drawText(line, { x: margin + 10, y, size: 7.2, font: regular, color: dark });
          y -= 8;
        });
        y -= 4;
      });
      cursor -= cardHeight + 8;
    }
  }

  drawSectionTitle(isRplSyllabusCourse ? 'Training Record Evidence and Comments' : 'Lesson Notes and Record Cards');
  if (courseRecords.length === 0) {
    drawText('No lesson comments recorded for this course.', { x: margin, y: cursor }, { size: 9, color: grey });
  } else {
    for (const record of chronologicalCourseRecords) {
      const instructor = users.find((u) => u.id === record.instructorId)?.name || 'Unknown';
      const lessonName = resolveLessonName(record);
      const comments = stripHtml(record.comments);
      const briefing = stripHtml(record.briefingComments);
      const reviewNotes = stripHtml(record.flightReviewNotes || '');
      const matrixSummary = getRecordMatrixSummary(record);
      const cardHeightBase = 74;
      const commentsLines = comments ? wrapText(comments, regular, 8, width - margin * 2 - 24).slice(0, 7) : [];
      const briefingLines = briefing ? wrapText(briefing, regular, 8, width - margin * 2 - 24).slice(0, 4) : [];
      const reviewLines = reviewNotes ? wrapText(reviewNotes, regular, 8, width - margin * 2 - 24).slice(0, 4) : [];
      const matrixLines = isRplSyllabusCourse && matrixSummary.assessed > 0
        ? [
            `CASA matrix: ${matrixSummary.met}/${matrixSummary.assessed} assessed items met for this lesson attempt.`,
            ...matrixSummary.notMet.slice(0, 4).map((item: any) => {
              const row = item.row;
              return `${row.element_code || row.unit_code || row.code}: achieved ${item.assessment.achieved_standard}, required ${item.requirement.required_standard} - ${formatSyllabusMatrixText(row.description)}`;
            }),
          ]
        : [];
      const cardHeight = cardHeightBase
        + (commentsLines.length + briefingLines.length + reviewLines.length) * 10
        + matrixLines.length * 10
        + (briefingLines.length ? 18 : 0)
        + (reviewLines.length ? 18 : 0)
        + (matrixLines.length ? 18 : 0);

      ensureSpace(Math.min(cardHeight, height - margin * 2));
      const cardTop = cursor;
      page.drawRectangle({
        x: margin,
        y: cardTop - cardHeight,
        width: width - margin * 2,
        height: cardHeight,
        color: rgb(1, 1, 1),
        borderColor: borderGrey,
        borderWidth: 0.6,
      });
      page.drawRectangle({
        x: margin,
        y: cardTop - 26,
        width: width - margin * 2,
        height: 26,
        color: lightGrey,
      });
      page.drawText(lessonName.slice(0, 84), { x: margin + 10, y: cardTop - 17, size: 10, font: bold, color: dark });
      page.drawText(formatDate(record.bookingStartTime || record.date), { x: width - margin - 98, y: cardTop - 17, size: 8, font: bold, color: grey });

      let y = cardTop - 43;
      const meta = [
        `Instructor: ${instructor}`,
        `Aircraft: ${record.registration || record.aircraftType || 'Not recorded'}`,
        `Dual: ${minutesToHours(record.dualTimeMin)} hr`,
        `Solo: ${minutesToHours(record.soloTimeMin)} hr`,
        `Briefing: ${record.formalBriefing ? 'Yes' : 'No'}`,
        `Student ack: ${record.studentAck ? formatDate(record.studentAckTimestamp) : 'No'}`,
      ].join('   ');
      drawText(meta, { x: margin + 10, y }, { size: 7.5, color: grey, maxWidth: width - margin * 2 - 20, lineHeight: 9 });
      y -= 18;

      if (commentsLines.length > 0) {
        page.drawText('Instructor comments', { x: margin + 10, y, size: 7, font: bold, color: grey });
        y -= 11;
        commentsLines.forEach((line) => {
          page.drawText(line, { x: margin + 10, y, size: 8, font: regular, color: dark });
          y -= 10;
        });
      } else {
        page.drawText('No instructor comments recorded.', { x: margin + 10, y, size: 8, font: regular, color: grey });
        y -= 12;
      }

      if (briefingLines.length > 0) {
        y -= 4;
        page.drawText('Briefing comments', { x: margin + 10, y, size: 7, font: bold, color: grey });
        y -= 11;
        briefingLines.forEach((line) => {
          page.drawText(line, { x: margin + 10, y, size: 8, font: regular, color: dark });
          y -= 10;
        });
      }

      if (record.isFlightReview || reviewLines.length > 0) {
        y -= 4;
        page.drawText(`Flight review / test: ${record.flightReviewResult || 'not assessed'}`, { x: margin + 10, y, size: 7, font: bold, color: record.flightReviewResult === 'pass' ? green : amber });
        y -= 11;
        reviewLines.forEach((line) => {
          page.drawText(line, { x: margin + 10, y, size: 8, font: regular, color: dark });
          y -= 10;
        });
      }

      if (matrixLines.length > 0) {
        y -= 4;
        page.drawText('CASA matrix evidence', { x: margin + 10, y, size: 7, font: bold, color: grey });
        y -= 11;
        matrixLines.forEach((line, index) => {
          page.drawText(line.slice(0, index === 0 ? 150 : 132), {
            x: margin + 10,
            y,
            size: 7.4,
            font: index === 0 ? bold : regular,
            color: index === 0 ? green : amber,
          });
          y -= 10;
        });
      }

      cursor -= cardHeight + 10;
    }
  }

  if (isRplSyllabusCourse) {
    drawSectionTitle('Certification and Completion');
    const completionRows: Array<[string, string]> = [
      ['Matrix completion', matrixRequirements.length > 0 ? `${metMatrixRequirements.length} of ${matrixRequirements.length} required items met` : 'No CASA matrix configured'],
      ['Remaining items', remainingMatrixRequirements.length > 0 ? String(remainingMatrixRequirements.length) : 'None recorded'],
      ['Flight test lesson', course.lessons.find((lesson) => lesson.isFlightTest)?.name || 'Not designated in course editor'],
      ['Course endorsement', course.completionEndorsementEnabled && course.completionEndorsementType ? course.completionEndorsementType : 'No automatic endorsement configured'],
    ];
    drawLabelValueGrid(completionRows, { columns: 4, rowHeight: 30, valueSize: 8 });
    drawText(
      'This export summarises the CRM record for the student course, including lesson records, comments, CASA matrix assessments and uploaded exam evidence available at the time of export.',
      { x: margin, y: cursor },
      { size: 8, color: grey, maxWidth: width - margin * 2, lineHeight: 10 }
    );
    cursor -= 26;
    drawSignatureLines(['Instructor / Head of Operations', 'Student / Trainee', 'Date']);
  }

  addFooter();

  for (const exam of courseExams.filter((item) => item.storagePath)) {
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
          copiedPage.drawText(`${exam.examName} evidence - ${exam.fileName || 'uploaded PDF'} - page ${index + 1}`, {
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
        evidencePage.drawText(`${exam.examName} evidence`, { x: margin, y: pageH - 28, size: 14, font: bold, color: rgb(1, 1, 1) });
        evidencePage.drawText(exam.fileName || 'Uploaded exam image', { x: pageW - 260, y: pageH - 28, size: 8, font: regular, color: rgb(0.9, 0.92, 0.95) });
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
  downloadBlob(pdfBytes, `${safeFilename(student.name)}-${safeFilename(course.title)}.pdf`);
}
