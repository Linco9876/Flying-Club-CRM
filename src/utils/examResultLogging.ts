export const EXAM_ANSWER_SHEET_MAX_FILE_SIZE = 25 * 1024 * 1024;

type ExamResultDraft = {
  score: string | number;
  examDate: string;
  passMark: number;
  answerSheet?: { size: number } | null;
};

type ExamSaveStage = 'answer-sheet-upload' | 'result-save' | 'result-update' | 'result-delete';

type ErrorDetails = {
  code: string;
  message: string;
  status: string;
};

const errorDetails = (error: unknown): ErrorDetails => {
  if (!error || typeof error !== 'object') {
    return {
      code: '',
      message: error instanceof Error ? error.message : String(error || ''),
      status: '',
    };
  }

  const value = error as Record<string, unknown>;
  const stringValue = (key: string) => typeof value[key] === 'string' ? String(value[key]).trim() : '';
  const code = stringValue('code') || stringValue('error_code');
  const message = [stringValue('message'), stringValue('details'), stringValue('error')]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rawStatus = value.statusCode ?? value.status;

  return {
    code,
    message,
    status: typeof rawStatus === 'number' || typeof rawStatus === 'string' ? String(rawStatus) : '',
  };
};

const isRealIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const examAnswerSheetValidationError = (file: { size: number } | null | undefined) => {
  if (!file) return null;
  if (!Number.isFinite(file.size) || file.size <= 0) return 'The selected answer sheet is empty';
  if (file.size > EXAM_ANSWER_SHEET_MAX_FILE_SIZE) return 'Answer sheets must be no larger than 25 MB';
  return null;
};

export const examResultDraftValidationError = ({
  score,
  examDate,
  passMark,
  answerSheet,
}: ExamResultDraft) => {
  const scoreText = String(score).trim();
  if (!scoreText) return 'Enter the exam score';

  const numericScore = Number(scoreText);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
    return 'Enter an exam score between 0 and 100';
  }

  if (!Number.isFinite(passMark) || passMark < 0 || passMark > 100) {
    return 'This exam has an invalid pass mark. Update the course exam settings before logging a result';
  }

  if (!isRealIsoDate(examDate)) return 'Enter a valid exam date';

  return examAnswerSheetValidationError(answerSheet);
};

export const examResultSaveFailureMessage = (error: unknown, stage: ExamSaveStage) => {
  const { code, message, status } = errorDetails(error);
  const combined = `${code} ${status} ${message}`.toLowerCase();
  const isUpload = stage === 'answer-sheet-upload';
  const operation = stage === 'result-update'
    ? 'updated'
    : stage === 'result-delete'
      ? 'deleted'
      : 'saved';

  if (code === 'NO_ROWS_CHANGED') {
    return `The exam result was not ${operation} because your access changed. Refresh the page and try again`;
  }

  if (/failed to fetch|network|fetch failed|load failed|connection/.test(combined)) {
    return isUpload
      ? 'The answer sheet could not be uploaded. Check your connection and try again'
      : `The exam result could not be ${operation}. Check your connection and try again`;
  }

  if (
    code === '42501'
    || status === '401'
    || status === '403'
    || /row.level security|permission denied|not authori[sz]ed|unauthori[sz]ed|invalid.*jwt|jwt.*expired/.test(combined)
  ) {
    return isUpload
      ? 'The secure answer sheet upload could not verify your staff access. Reload the page, complete the authenticator check if prompted, then retry'
      : 'Your instructor access could not be verified. Reload the page, complete the authenticator check if prompted, then retry. If this continues, ask an administrator to check your staff role';
  }

  if (code === '23503' || /foreign key/.test(combined)) {
    return 'The student, course, or instructor changed while this form was open. Refresh the page and enter the result again';
  }

  if (code === '23514' || code === '22003' || code === '22P02' || /check constraint|out of range|invalid input syntax/.test(combined)) {
    return 'The exam details were rejected. Check the score, date, course and exam, then try again';
  }

  if (status === '413' || /payload too large|maximum.*size|exceeded.*size|too large/.test(combined)) {
    return 'The answer sheet is larger than the 25 MB upload limit';
  }

  if (code === '23505' || /already exists|duplicate/.test(combined)) {
    return isUpload
      ? 'That answer sheet upload already exists. Remove it from the form, select it again and retry'
      : `That exam result could not be ${operation} because it conflicts with an existing record`;
  }

  const reference = code || (status && !/^2\d\d$/.test(status) ? status : '');
  return `The exam result could not be ${operation}. Refresh the page and try again${reference ? ` (error ${reference})` : ''}`;
};
