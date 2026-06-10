export type UserRole = 'admin' | 'senior_instructor' | 'instructor' | 'pilot' | 'student';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roles?: UserRole[];
  phone?: string;
  mobilePhone?: string;
  homePhone?: string;
  workPhone?: string;
  address?: string;
  dateOfBirth?: Date;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  preferredAircraftId?: string;
  avatar?: string;
  coverPhoto?: string;
  isAvailable?: boolean;
  isSeniorInstructor?: boolean;
  isActive?: boolean;
  portalAccessScope?: 'full' | 'trial_voucher';
}

export interface Student extends User {
  raausId?: string;
  casaId?: string;
  medicalType?: string;
  medicalExpiry?: Date;
  licenceExpiry?: Date;
  lastFlightReview?: Date;
  occupation?: string;
  alternatePhone?: string;
  prepaidBalance: number;
  endorsements: Endorsement[];
}

export interface AircraftRate {
  id: string;
  aircraftId: string;
  flightTypeId: string;
  flightTypeName?: string;
  chargeType: 'tach' | 'flat' | 'per_pax' | 'free' | 'not_used';
  soloRate: number;
  dualRate: number;
  flatSurcharge: number;
  weekendSurcharge: number;
  defaultPaymentMethodId: string | null;
  defaultPaymentMethodName?: string;
  includedTaxes: number;
}

export interface Aircraft {
  id: string;
  registration: string;
  make: string;
  model: string;
  type: 'single-engine' | 'multi-engine' | 'helicopter';
  status: 'serviceable' | 'unserviceable' | 'maintenance';
  hourlyRate: number;
  totalHours: number;
  lastMaintenance?: Date;
  nextMaintenance?: Date;
  seatCapacity?: number;
  fuelCapacity?: number;
  emptyWeight?: number;
  maxWeight?: number;
  tachStart?: number;
  requiredEndorsementType?: string | null;
  isAvailable?: boolean;
  defects: Defect[];
  rates?: AircraftRate[];
  aircraftRates?: {
    prepaid: number;
    payg: number;
    account: number;
  };
  instructorRates?: {
    prepaid: number;
    payg: number;
    account: number;
  };
}

export interface Booking {
  id: string;
  pilotId: string;
  studentId?: string;
  instructorId?: string;
  aircraftId: string;
  startTime: Date;
  endTime: Date;
  paymentType: 'prepaid' | 'payg' | 'account';
  notes?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show' | 'pending_approval';
  hasConflict?: boolean;
  deletedAt?: Date;
  flightLog?: FlightLog;
  flight_logged?: boolean;
  flightTypeId?: string;
  trialFlightVoucherId?: string;
}

export type TrialFlightVoucherAircraftMode = 'tecnam' | 'archer' | 'specific';
export type TrialFlightVoucherStatus = 'draft' | 'issued' | 'redeemed' | 'booked' | 'expired' | 'cancelled';

export interface TrialFlightVoucherProduct {
  id: string;
  name: string;
  description: string;
  aircraftMode: TrialFlightVoucherAircraftMode;
  aircraftIds: string[];
  instructorIds: string[];
  durationMinutes: number;
  price: number;
  emailSubject: string;
  emailBody: string;
  bookingInstructions: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TrialFlightVoucher {
  id: string;
  productId: string;
  productName?: string;
  code: string;
  purchaserName: string;
  purchaserEmail: string;
  purchaserPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  sendToRecipient: boolean;
  recipientDeliveryAt?: Date;
  deliveredAt?: Date;
  status: TrialFlightVoucherStatus;
  expiresAt?: Date;
  redeemedAt?: Date;
  redeemedByUserId?: string;
  bookedBookingId?: string;
  notes?: string;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FlightLog {
  id: string;
  bookingId: string;
  landings: number;
  duration: number;
  tachStart: number;
  tachEnd: number;
  engineStart: number;
  engineEnd: number;
  totalCost: number;
  notes?: string;
}

export interface Endorsement {
  id: string;
  type: string;
  dateObtained: Date;
  expiryDate?: Date;
  instructorId?: string | null;
  isActive: boolean;
}

export interface TrainingRecord {
  id: string;
  studentId: string;
  bookingId?: string;
  flightLogId?: string;
  courseId?: string;
  lessonId?: string;
  date: Date;
  bookingStartTime?: Date;
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
  nextLesson?: string;
  status: 'draft' | 'submitted' | 'locked';
  instructorSignatureUrl?: string;
  studentAck: boolean;
  studentAckName?: string;
  studentComments: string;
  instructorSignTimestamp?: Date;
  studentAckTimestamp?: Date;
  attachments: string[];
  auditLog: TrainingAuditEntry[];
  isFlightReview?: boolean;
  flightReviewType?: string;
  flightReviewResult?: 'pass' | 'fail' | 'not_assessed';
  flightReviewNotes?: string;
  pilotRoleGranted?: boolean;
  sequences: TrainingSequenceResult[];
}

export interface TrainingSequenceResult {
  id: string;
  trainingRecordId: string;
  sequenceId: string;
  sequenceCode: string;
  sequenceTitle: string;
  competence: 'NC' | 'S' | 'C' | '-';
}

export interface SyllabusSequence {
  id: string;
  code: string;
  title: string;
  group: string;
  order: number;
  active: boolean;
}

export interface TrainingResource {
  id: string;
  type: 'document' | 'video' | 'link' | 'checklist';
  title: string;
  url?: string;
  notes?: string;
}

export interface TrainingExam {
  id: string;
  name: string;
  passMark: number;
}

export interface StudentExamResult {
  id: string;
  studentId: string;
  courseId?: string;
  examId: string;
  examName: string;
  score: number;
  passMark: number;
  result: 'pass' | 'fail';
  examDate: Date;
  notes: string;
  instructorId?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  storagePath?: string;
  createdAt: Date;
}

export type LessonGradingSystem = 'NC/S/C/-' | 'Pass or Fail' | 'Out of 100';

export interface LessonAssessmentCriterion {
  id: string;
  name: string;
  gradingSystem: LessonGradingSystem;
  /** Highest possible grade for this criterion (used for course-level display) */
  passingGrade: string;
}

export interface TrainingLesson {
  id: string;
  sequenceId: string;
  sequenceCode: string;
  sequenceTitle: string;
  stage: 'ground' | 'flight' | 'simulator';
  durationMinutes: number;
  minCompetency: 'Introduce' | 'Practice' | 'Assess';
  keyExercises: string[];
  studentPreparation: string;
  instructorNotes: string;
  name: string;
  objective: string;
  flightExercises: string;
  theory: string;
  /** Legacy per-lesson criteria — kept for backwards compat, prefer course.assessmentCriteria */
  assessmentCriteria: LessonAssessmentCriterion[];
  /** Map of course criterion id → passing grade for this specific lesson */
  passMarks: Record<string, string>;
  isFlightTest?: boolean;
}

export interface TrainingModule {
  id: string;
  title: string;
  description: string;
  category: string;
  version: string;
  status: 'draft' | 'published';
  estimatedDurationHours: number;
  prerequisites: string[];
  objectives: string[];
  evaluationCriteria: string[];
  tags: string[];
  /** Course-level criteria shared across all lessons */
  assessmentCriteria: LessonAssessmentCriterion[];
  /** Whether this course normally asks students to acknowledge submitted lesson records */
  requiresStudentAcknowledgement?: boolean;
  requiresFlyingDeclaration?: boolean;
  flyingDeclarationTitle?: string;
  flyingDeclarationText?: string;
  flyingDeclarationVersion?: number;
  requiresGuardianDeclarationForMinors?: boolean;
  guardianDeclarationTitle?: string;
  guardianDeclarationText?: string;
  completionEndorsementEnabled?: boolean;
  completionEndorsementType?: string;
  completionEndorsementExpiryMonths?: number | null;
  exams?: TrainingExam[];
  lessons: TrainingLesson[];
  resources: TrainingResource[];
  lastUpdated: Date;
  createdBy?: string;
}

export type SyllabusMatrixRowType = 'unit' | 'element' | 'criterion';
export type SyllabusMatrixStandard = 1 | 2 | 3;

export interface SyllabusMatrixRow {
  id: string;
  courseId: string;
  code: string;
  rowType: SyllabusMatrixRowType;
  unitCode?: string;
  elementCode?: string;
  parentCode?: string;
  description: string;
  sourceRowNumber?: number;
  sortOrder: number;
}

export interface SyllabusMatrixRequirement {
  id: string;
  courseId: string;
  lessonId?: string;
  matrixRowId: string;
  lessonSequenceCode: string;
  lessonColumnTitle: string;
  requiredStandard: SyllabusMatrixStandard;
  assessmentCriterionId?: string;
}

export interface StudentMatrixAssessment {
  id: string;
  studentId: string;
  courseId: string;
  lessonId?: string;
  trainingRecordId?: string;
  matrixRowId: string;
  achievedStandard?: SyllabusMatrixStandard;
  comments: string;
  instructorId?: string;
  assessedAt: Date;
}

export interface TrainingAuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  userName: string;
  action: string;
  changes: Record<string, any>;
}

export interface Defect {
  id: string;
  aircraftId: string;
  reportedBy: string;
  dateReported: Date;
  summary?: string;
  description: string;
  status: 'open' | 'mel' | 'fixed' | 'deferred';
  photos?: string[];
  melNotes?: string;
  fixNotes?: string;
  severity?: 'Minor' | 'Major' | 'Critical';
  location?: string;
  tachHours?: number;
  hobbsHours?: number;
}

export interface Invoice {
  id: string;
  studentId: string;
  date: Date;
  items: InvoiceItem[];
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  total: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'conflict' | 'cancellation' | 'reminder' | 'system' | 'training_record' | 'booking_approval';
  title: string;
  message: string;
  bookingId?: string;
  metadata?: Record<string, string>;
  isRead: boolean;
  createdAt: Date;
}

export interface BookingConflict {
  conflictType: 'aircraft' | 'instructor';
  conflictWith: string;
  conflictingBookingId: string;
}
