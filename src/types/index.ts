export type UserRole = 'admin' | 'cfi' | 'senior_instructor' | 'instructor' | 'pilot' | 'student';

export type PortalAccessScope = 'full' | 'trial_voucher' | 'guest_placeholder';

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
  portalAccessScope?: PortalAccessScope;
  xeroContactId?: string;
  xeroContactName?: string;
  xeroContactEmail?: string;
  xeroContactSyncStatus?: 'not_linked' | 'linked' | 'queued' | 'syncing' | 'synced' | 'needs_review' | 'failed';
  xeroContactSyncError?: string | null;
  xeroContactLastSyncedAt?: string | null;
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
  endorsements: Endorsement[];
  licences: Licence[];
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
  requiredEndorsementTypes?: string[];
  requiredAllEndorsementTypes?: string[];
  requiredLicenceTypes?: string[];
  requiredAllLicenceTypes?: string[];
  iconKey?: 'tecnam' | 'piper' | 'cessna' | 'sling' | 'twin' | string | null;
  xeroTrackingCategoryId?: string | null;
  xeroTrackingCategoryName?: string | null;
  xeroTrackingOptionId?: string | null;
  xeroTrackingOptionName?: string | null;
  xeroTrackingLastSyncedAt?: Date;
  xeroTrackingSyncError?: string | null;
  autoGroundedUntil?: Date;
  autoGroundedByDefectId?: string | null;
  isAvailable?: boolean;
  isArchived?: boolean;
  archivedAt?: Date;
  archivedBy?: string | null;
  archiveReason?: string | null;
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
  aircraftId?: string;
  startTime: Date;
  endTime: Date;
  paymentType: string;
  notes?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show' | 'pending_approval';
  bookingKind?: 'flight' | 'ground';
  hasConflict?: boolean;
  deletedAt?: Date;
  flightLog?: FlightLog;
  flight_logged?: boolean;
  groundSessionLog?: GroundSessionLog;
  ground_session_logged?: boolean;
  flightTypeId?: string;
  trialFlightVoucherId?: string;
  cancellationReasonId?: string;
  cancellationReasonName?: string;
  cancellationNotes?: string;
  cancellationFeeType?: 'none' | 'late_cancel' | 'no_show';
  cancellationFeeAmount?: number;
  cancelledAt?: Date;
  cancelledBy?: string;
  waitlistReason?: 'resource_conflict' | 'aircraft_grounding' | string;
  waitlistedByDefectId?: string;
  hirerName?: string;
  instructorName?: string;
  isGuestBooking?: boolean;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
}

export type TrialFlightVoucherAircraftMode = 'tecnam' | 'archer' | 'specific';
export type TrialFlightVoucherStatus = 'draft' | 'issued' | 'redeemed' | 'booked' | 'expired' | 'cancelled';
export type TrialFlightVoucherPaymentStatus = 'manual' | 'pending' | 'paid' | 'failed' | 'refunded' | 'waived';

export interface TrialFlightVoucherProduct {
  id: string;
  name: string;
  description: string;
  aircraftMode: TrialFlightVoucherAircraftMode;
  aircraftIds: string[];
  instructorIds: string[];
  durationMinutes: number;
  price: number;
  addons?: TrialFlightVoucherAddon[];
  stripePriceId?: string;
  stripeTestPriceId?: string;
  stripeLivePriceId?: string;
  emailSubject: string;
  emailBody: string;
  bookingInstructions: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TrialFlightVoucherAddon {
  id: string;
  name: string;
  description: string;
  price: number;
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
  paymentStatus?: TrialFlightVoucherPaymentStatus;
  paymentAmount?: number;
  paymentCurrency?: string;
  selectedAddons?: TrialFlightVoucherAddon[];
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  paidAt?: Date;
  expiresAt?: Date;
  redeemedAt?: Date;
  redeemedByUserId?: string;
  redeemedByName?: string;
  redeemedByEmail?: string;
  bookedBookingId?: string;
  bookedBooking?: {
    id: string;
    startTime: Date;
    endTime: Date;
    status: Booking['status'];
    flightLogged?: boolean;
    aircraftRegistration?: string;
    aircraftType?: string;
    instructorName?: string;
  };
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
  answerSheetOnly?: boolean;
  kdrRequired?: boolean;
  kdrCompleted?: boolean;
  kdrCompletionMethod?: 'verbal' | 'written' | 'not_required';
  kdrNotes?: string;
  kdrSignedOffBy?: string;
  kdrSignedOffAt?: Date;
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

export type LessonStudyAssetType = 'document' | 'image';

export interface LessonStudyAsset {
  id: string;
  type: LessonStudyAssetType;
  title: string;
  storagePath: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes?: number;
  notes?: string;
}

export interface GroundSessionDescriptionOption {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  displayOrder: number;
  pricingMode: 'fixed' | 'flight_type_hourly';
  fixedRate: number;
  flightTypeId?: string | null;
}
// CFI is an additive authority role; the primary portal role remains admin/instructor.
export interface Licence {
  id: string;
  type: string;
  licenceNumber?: string;
  dateObtained?: Date;
  expiryDate?: Date;
  issuingAuthority?: string;
  instructorId?: string | null;
  sourceCourseId?: string | null;
  isActive: boolean;
  verificationStatus?: 'pending' | 'verified' | 'rejected';
  proofDocumentId?: string | null;
  submittedBy?: string | null;
  verifiedBy?: string | null;
  verifiedAt?: Date;
  rejectionReason?: string | null;
}

export interface GroundSessionLog {
  id: string;
  bookingId?: string;
  studentId: string;
  instructorId: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  flightTypeId?: string;
  paymentType: string;
  descriptionOptionId?: string;
  descriptionText?: string;
  notes?: string;
  calculatedCost: number;
  paymentStatus: 'free' | 'pending' | 'paid';
  xeroInvoiceId?: string | null;
  xeroInvoiceNumber?: string | null;
  xeroInvoiceStatus?: string | null;
  xeroSyncStatus?: string | null;
  xeroSyncError?: string | null;
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
  studyGuide?: string;
  studyAssets?: LessonStudyAsset[];
  /** Legacy per-lesson criteria — kept for backwards compat, prefer course.assessmentCriteria */
  assessmentCriteria: LessonAssessmentCriterion[];
  /** Map of course criterion id → passing grade for this specific lesson */
  passMarks: Record<string, string>;
  /** Map of course criterion id → whether this lesson requires two consecutive passing records before advancing */
  passMarkRepeatRequirements?: Record<string, boolean>;
  isFlightTest?: boolean;
}

export type CoursePurpose = 'training' | 'flight_review' | 'flight_test' | 'proficiency_check' | 'instructor_compliance';

export interface ReviewChecklistTemplateItem {
  key: string;
  section: string;
  code: string;
  title: string;
  guidance: string;
  required: boolean;
}

export interface FlightReviewConfiguration {
  review_type: string;
  authority: 'raaus' | 'casa' | 'club' | 'other';
  outcome_scheme: 'completion' | 'pass_fail';
  minimum_ground_minutes: number;
  minimum_flight_minutes: number;
  validity_months: number;
  resets_flight_review: boolean;
  candidate_ack_required: boolean;
  aircraft_group_alternation_warning?: boolean;
  allowed_reviewer_roles: string[];
  required_evidence: Array<'logbook_entry' | 'authority_form' | 'external_test_report' | 'certificate' | 'other'>;
  source_documents: string[];
  checklist: ReviewChecklistTemplateItem[];
  legacy_import?: boolean;
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
  coursePurpose?: CoursePurpose;
  reviewConfiguration?: FlightReviewConfiguration | null;
  /** Course-level criteria shared across all lessons */
  assessmentCriteria: LessonAssessmentCriterion[];
  /** Whether this course normally asks students to acknowledge submitted lesson records */
  requiresStudentAcknowledgement?: boolean;
  /** Require repeated competency evidence before recommending solo or flight-test gate lessons */
  twoOccasionCompetencyRuleEnabled?: boolean;
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
  completionLicenceEnabled?: boolean;
  completionLicenceType?: string;
  completionLicenceExpiryMonths?: number | null;
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
  changes: Record<string, unknown>;
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
