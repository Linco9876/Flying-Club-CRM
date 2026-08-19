import type { NextLessonRule } from '../hooks/useTrainingSettings';
import type { TrainingSyllabusSettingsData } from '../hooks/useTrainingSettings';

const hasDuplicate = (values: string[]) => {
  const normalised = values.map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
  return new Set(normalised).size !== normalised.length;
};

export const getTrainingSettingsValidationError = (settings: TrainingSyllabusSettingsData): string | null => {
  if (settings.endorsementTypes.length === 0) return 'Keep at least one endorsement type.';
  if (settings.endorsementTypes.some(value => !value.trim())) return 'Endorsement names cannot be blank.';
  if (hasDuplicate(settings.endorsementTypes)) return 'Endorsement names must be unique.';
  if (settings.licenceTypes.length === 0) return 'Keep at least one licence type.';
  if (settings.licenceTypes.some(value => !value.trim())) return 'Licence names cannot be blank.';
  if (hasDuplicate(settings.licenceTypes)) return 'Licence names must be unique.';
  return null;
};

export const shouldAdvanceToNextLesson = (
  rule: NextLessonRule,
  lessonPassed: boolean,
  carryForwardApproved: boolean,
) => {
  if (rule === 'manual') return false;
  if (rule === 'always_advance') return true;
  return lessonPassed || carryForwardApproved;
};

export const canStaffEditTrainingRecord = ({
  isAdmin,
  isRecordInstructor,
  recordStatus,
  allowSubmittedRecordEditing,
}: {
  isAdmin: boolean;
  isRecordInstructor: boolean;
  recordStatus: string;
  allowSubmittedRecordEditing: boolean;
}) => Boolean(
  isAdmin || (
    isRecordInstructor && (
      recordStatus === 'draft' || allowSubmittedRecordEditing
    )
  ),
);
