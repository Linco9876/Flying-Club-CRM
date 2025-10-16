export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'instructor' | 'student';
  phone?: string;
  avatar?: string;
  isAvailable?: boolean;
}

export interface Student extends User {
  role: 'student';
  raausId?: string;
  casaId?: string;
  medicalType?: string;
  medicalExpiry?: Date;
  licenceExpiry?: Date;
  occupation?: string;
  alternatePhone?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  dateOfBirth?: Date;
  prepaidBalance: number;
  endorsements: Endorsement[];
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
  isAvailable?: boolean;
  defects: Defect[];
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
  studentId: string;
  instructorId?: string;
  aircraftId: string;
  startTime: Date;
  endTime: Date;
  paymentType: 'prepaid' | 'payg' | 'account';
  notes?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no-show';
  hasConflict?: boolean;
  flightLog?: FlightLog;
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
  type: 'PC' | 'passenger' | 'cross-country' | 'radio' | 'manual-pitch-prop' | 'retractable-gear' | 'navigation';
  dateObtained: Date;
  expiryDate?: Date;
  instructorId: string;
  isActive: boolean;
}

export interface TrainingRecord {
  id: string;
  studentId: string;
  bookingId?: string;
  date: Date;
  aircraftId: string;
  aircraftType: string;
  registration: string;
  instructorId: string;
  dualTimeMin: number;
  soloTimeMin: number;
  comments: string;
  formalBriefing: boolean;
  lessonCodes: string[];
  nextLesson?: string;
  status: 'draft' | 'submitted' | 'locked';
  instructorSignatureUrl?: string;
  studentAck: boolean;
  studentAckName?: string;
  instructorSignTimestamp?: Date;
  studentAckTimestamp?: Date;
  attachments: string[];
  auditLog: TrainingAuditEntry[];
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
  description: string;
  status: 'open' | 'mel' | 'fixed' | 'deferred';
  photos?: string[];
  melNotes?: string;
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
  type: 'conflict' | 'cancellation' | 'reminder' | 'system';
  title: string;
  message: string;
  bookingId?: string;
  isRead: boolean;
  createdAt: Date;
}

export interface BookingConflict {
  conflictType: 'aircraft' | 'instructor';
  conflictWith: string;
  conflictingBookingId: string;
}