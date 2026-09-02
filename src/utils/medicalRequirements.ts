import type { TrainingModule, UserRole } from '../types';

export type MedicalValidityMode = 'expiry_date' | 'until_age';
export type CourseMedicalRequirementMode = 'none' | 'required' | 'age_threshold';

export interface MedicalTypeDefinition {
  id: string;
  name: string;
  validityMode: MedicalValidityMode;
  validUntilAge?: number | null;
  isActive: boolean;
}

export interface MedicalRequirement {
  required: boolean;
  reason: 'operating_role' | 'course' | 'not_required';
  courseTitle?: string;
}

export type MedicalCurrencyState =
  | 'not_required'
  | 'missing_type'
  | 'missing_expiry'
  | 'missing_date_of_birth'
  | 'current'
  | 'expiring'
  | 'expired';

export interface MedicalCurrencyStatus {
  state: MedicalCurrencyState;
  label: string;
  effectiveExpiry: Date | null;
  daysRemaining: number | null;
  definition: MedicalTypeDefinition | null;
}

export const DEFAULT_MEDICAL_TYPES: MedicalTypeDefinition[] = [
  {
    id: 'raaus-medical-declaration',
    name: 'RAAus Medical Declaration',
    validityMode: 'until_age',
    validUntilAge: 75,
    isActive: true,
  },
  { id: 'driver-licence-medical', name: 'Driver Licence Medical', validityMode: 'expiry_date', isActive: true },
  { id: 'raaus-instructor-medical-med003', name: 'RAAus Instructor Medical (MED003)', validityMode: 'expiry_date', isActive: true },
  { id: 'casa-class-5', name: 'CASA Class 5', validityMode: 'expiry_date', isActive: true },
  { id: 'casa-basic-class-2', name: 'CASA Basic Class 2', validityMode: 'expiry_date', isActive: true },
  { id: 'casa-class-2', name: 'CASA Class 2', validityMode: 'expiry_date', isActive: true },
  { id: 'casa-class-1', name: 'CASA Class 1', validityMode: 'expiry_date', isActive: true },
];

const cleanName = (value: unknown) => String(value || '').trim();
const normaliseName = (value: unknown) => cleanName(value).toLocaleLowerCase();

const medicalTypeId = (name: string) => name
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || `medical-${crypto.randomUUID()}`;

export const normaliseMedicalTypes = (value: unknown): MedicalTypeDefinition[] => {
  const source = Array.isArray(value) ? value : DEFAULT_MEDICAL_TYPES;
  const seen = new Set<string>();
  const result: MedicalTypeDefinition[] = [];

  source.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const record = raw as Record<string, unknown>;
    const name = cleanName(record.name);
    const key = normaliseName(name);
    if (!name || seen.has(key)) return;
    seen.add(key);

    const validityMode: MedicalValidityMode = record.validityMode === 'until_age'
      ? 'until_age'
      : 'expiry_date';
    const rawAge = Number(record.validUntilAge);
    const validUntilAge = validityMode === 'until_age' && Number.isInteger(rawAge) && rawAge >= 1 && rawAge <= 120
      ? rawAge
      : validityMode === 'until_age' && /medical declaration/i.test(name)
        ? 75
        : null;

    result.push({
      id: cleanName(record.id) || `${medicalTypeId(name)}-${index}`,
      name,
      validityMode,
      validUntilAge,
      isActive: record.isActive !== false,
    });
  });

  return result.length > 0 ? result : DEFAULT_MEDICAL_TYPES;
};

export const findMedicalTypeDefinition = (
  medicalType: string | null | undefined,
  definitions: MedicalTypeDefinition[],
) => {
  const key = normaliseName(medicalType);
  if (!key) return null;
  const configured = definitions.find(definition => normaliseName(definition.name) === key);
  if (configured) return configured;

  // Preserve the established behaviour for legacy declarations that pre-date
  // settings-managed medical types.
  if (/\b(?:self[-\s]?declar\w*|medical declaration)\b/i.test(medicalType || '')) {
    return {
      id: `legacy-${medicalTypeId(medicalType || 'medical-declaration')}`,
      name: medicalType || 'Medical declaration',
      validityMode: 'until_age' as const,
      validUntilAge: 75,
      isActive: true,
    };
  }

  return {
    id: `legacy-${medicalTypeId(medicalType || 'medical')}`,
    name: medicalType || 'Medical',
    validityMode: 'expiry_date' as const,
    validUntilAge: null,
    isActive: true,
  };
};

export const ageOnDate = (dateOfBirth?: Date | null, at = new Date()) => {
  if (!dateOfBirth || Number.isNaN(dateOfBirth.getTime())) return null;
  let age = at.getFullYear() - dateOfBirth.getFullYear();
  const birthdayThisYear = new Date(at.getFullYear(), dateOfBirth.getMonth(), dateOfBirth.getDate());
  if (at < birthdayThisYear) age -= 1;
  return Math.max(0, age);
};

export const birthdayAtAge = (dateOfBirth: Date, age: number) =>
  new Date(dateOfBirth.getFullYear() + age, dateOfBirth.getMonth(), dateOfBirth.getDate());

const hasOperatingRole = (roles: UserRole[]) =>
  roles.some(role => ['pilot', 'instructor', 'senior_instructor', 'cfi'].includes(role));

export const resolveMedicalRequirement = ({
  roles,
  dateOfBirth,
  activeCourses,
  at = new Date(),
}: {
  roles: UserRole[];
  dateOfBirth?: Date | null;
  activeCourses: Array<Pick<TrainingModule, 'title' | 'medicalRequirementMode' | 'medicalRequirementAge'>>;
  at?: Date;
}): MedicalRequirement => {
  if (hasOperatingRole(roles)) {
    return { required: true, reason: 'operating_role' };
  }

  const age = ageOnDate(dateOfBirth, at);
  for (const course of activeCourses) {
    const mode = course.medicalRequirementMode ?? 'none';
    if (mode === 'required') {
      return { required: true, reason: 'course', courseTitle: course.title };
    }
    if (mode === 'age_threshold' && age !== null && age >= Number(course.medicalRequirementAge)) {
      return { required: true, reason: 'course', courseTitle: course.title };
    }
  }

  return { required: false, reason: 'not_required' };
};

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const evaluateMedicalCurrency = ({
  required,
  medicalType,
  medicalExpiry,
  dateOfBirth,
  definitions,
  warningDays = 60,
  at = new Date(),
}: {
  required: boolean;
  medicalType?: string | null;
  medicalExpiry?: Date | null;
  dateOfBirth?: Date | null;
  definitions: MedicalTypeDefinition[];
  warningDays?: number;
  at?: Date;
}): MedicalCurrencyStatus => {
  if (!required) {
    return { state: 'not_required', label: 'Not required', effectiveExpiry: null, daysRemaining: null, definition: null };
  }

  const definition = findMedicalTypeDefinition(medicalType, definitions);
  if (!definition) {
    return { state: 'missing_type', label: 'Operating medical not selected', effectiveExpiry: null, daysRemaining: null, definition: null };
  }

  let effectiveExpiry: Date | null = null;
  if (definition.validityMode === 'until_age') {
    if (!dateOfBirth || !definition.validUntilAge) {
      return { state: 'missing_date_of_birth', label: 'Date of birth required', effectiveExpiry: null, daysRemaining: null, definition };
    }
    effectiveExpiry = birthdayAtAge(dateOfBirth, definition.validUntilAge);
  } else {
    if (!medicalExpiry || Number.isNaN(medicalExpiry.getTime())) {
      return { state: 'missing_expiry', label: 'Medical expiry required', effectiveExpiry: null, daysRemaining: null, definition };
    }
    effectiveExpiry = medicalExpiry;
  }

  const daysRemaining = Math.ceil(
    (startOfDay(effectiveExpiry).getTime() - startOfDay(at).getTime()) / MS_PER_DAY
  );
  const isExpired = definition.validityMode === 'until_age'
    ? daysRemaining <= 0
    : daysRemaining < 0;
  if (isExpired) {
    return { state: 'expired', label: 'Expired', effectiveExpiry, daysRemaining, definition };
  }
  if (daysRemaining <= warningDays) {
    return { state: 'expiring', label: 'Due soon', effectiveExpiry, daysRemaining, definition };
  }

  return {
    state: 'current',
    label: definition.validityMode === 'until_age'
      ? `Current until age ${definition.validUntilAge}`
      : 'Current',
    effectiveExpiry,
    daysRemaining,
    definition,
  };
};

export const medicalRequirementDescription = (
  mode: CourseMedicalRequirementMode,
  age?: number | null,
) => {
  if (mode === 'required') return 'Medical required for every enrolled student';
  if (mode === 'age_threshold') return `Medical required from age ${age || 'not set'}`;
  return 'No medical required for enrolled students';
};
