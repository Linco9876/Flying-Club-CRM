import { Aircraft, Booking, Student, TrainingRecord, Defect, Invoice, SyllabusSequence } from '../types';

export const mockAircraft: Aircraft[] = [
  {
    id: '1',
    registration: 'VH-ABC',
    make: 'Cessna',
    model: '172',
    type: 'single-engine',
    status: 'serviceable',
    hourlyRate: 280,
    totalHours: 2450,
    lastMaintenance: new Date('2024-01-15'),
    nextMaintenance: new Date('2024-04-15'),
    defects: []
  },
  {
    id: '2',
    registration: 'VH-DEF',
    make: 'Piper',
    model: 'Cherokee',
    type: 'single-engine',
    status: 'serviceable',
    hourlyRate: 260,
    totalHours: 1890,
    defects: []
  },
  {
    id: '3',
    registration: 'VH-GHI',
    make: 'Cessna',
    model: '152',
    type: 'single-engine',
    status: 'unserviceable',
    hourlyRate: 220,
    totalHours: 3200,
    defects: [
      {
        id: '1',
        aircraftId: '3',
        reportedBy: 'John Instructor',
        dateReported: new Date('2024-01-20'),
        description: 'Radio intermittent on frequency 118.1',
        status: 'open'
      }
    ]
  }
];

export const mockStudents: Student[] = [
  {
    id: '3',
    email: 'student@flyingclub.com',
    name: 'John Pilot',
    role: 'student',
    phone: '+61 400 345 678',
    raausId: 'RA12345',
    medicalType: 'Recreational',
    medicalExpiry: new Date('2024-08-15'),
    licenceExpiry: new Date('2026-03-20'),
    dateOfBirth: new Date('1995-06-15'),
    prepaidBalance: 1250.00,
    emergencyContact: {
      name: 'Jane Pilot',
      phone: '+61 400 987 654',
      relationship: 'Spouse'
    },
    endorsements: [
      {
        id: '1',
        type: 'PC',
        dateObtained: new Date('2023-09-15'),
        instructorId: '2',
        isActive: true
      },
      {
        id: '2',
        type: 'passenger',
        dateObtained: new Date('2023-10-20'),
        instructorId: '2',
        isActive: true
      }
    ]
  },
  {
    id: '2',
    email: 'instructor@flyingclub.com',
    name: 'Chief Flying Instructor',
    role: 'instructor',
    phone: '+61 400 789 012',
    prepaidBalance: 0,
    endorsements: []
  },
  {
    id: '4',
    email: 'sarah@flyingclub.com',
    name: 'Sarah Wings',
    role: 'student',
    phone: '+61 400 555 123',
    raausId: 'RA67890',
    medicalType: 'Class 2',
    medicalExpiry: new Date('2024-12-20'),
    licenceExpiry: new Date('2025-08-15'),
    dateOfBirth: new Date('1992-03-22'),
    prepaidBalance: 850.00,
    endorsements: [
      {
        id: '3',
        type: 'PC',
        dateObtained: new Date('2023-11-10'),
        instructorId: '2',
        isActive: true
      }
    ]
  }
];

export const mockBookings: Booking[] = [
  {
    id: '1',
    studentId: '3',
    instructorId: '2',
    aircraftId: '1',
    startTime: new Date('2024-01-25T09:00:00'),
    endTime: new Date('2024-01-25T11:00:00'),
    paymentType: 'prepaid',
    notes: 'Lesson 15 - Navigation exercise',
    status: 'confirmed'
  },
  {
    id: '2',
    studentId: '3',
    aircraftId: '2',
    startTime: new Date('2024-01-26T14:00:00'),
    endTime: new Date('2024-01-26T16:00:00'),
    paymentType: 'prepaid',
    notes: 'Solo practice - circuits',
    status: 'confirmed'
  },
  {
    id: '3',
    studentId: '3',
    instructorId: '2',
    aircraftId: '1',
    startTime: new Date('2024-01-22T10:30:00'),
    endTime: new Date('2024-01-22T12:00:00'),
    paymentType: 'prepaid',
    notes: 'Lesson 13 - Stalls and recovery',
    status: 'completed'
  },
  {
    id: '4',
    studentId: '3',
    aircraftId: '2',
    startTime: new Date('2024-01-23T08:00:00'),
    endTime: new Date('2024-01-23T09:30:00'),
    paymentType: 'prepaid',
    notes: 'Solo circuits',
    status: 'completed'
  },
  {
    id: '5',
    studentId: '3',
    instructorId: '2',
    aircraftId: '1',
    startTime: new Date('2024-01-24T13:30:00'),
    endTime: new Date('2024-01-24T15:30:00'),
    paymentType: 'prepaid',
    notes: 'Lesson 14 - Cross country planning',
    status: 'completed'
  },
  {
    id: '6',
    studentId: '3',
    aircraftId: '2',
    startTime: new Date('2024-01-27T09:30:00'),
    endTime: new Date('2024-01-27T11:00:00'),
    paymentType: 'prepaid',
    notes: 'Solo navigation exercise',
    status: 'confirmed'
  },
  {
    id: '7',
    studentId: '4',
    instructorId: '2',
    aircraftId: '1',
    startTime: new Date('2024-01-25T14:30:00'),
    endTime: new Date('2024-01-25T16:00:00'),
    paymentType: 'prepaid',
    notes: 'Lesson 8 - Emergency procedures',
    status: 'confirmed'
  },
  {
    id: '8',
    studentId: '4',
    aircraftId: '2',
    startTime: new Date('2024-01-26T10:00:00'),
    endTime: new Date('2024-01-26T11:30:00'),
    paymentType: 'prepaid',
    notes: 'Solo circuits practice',
    status: 'confirmed'
  },
  {
    id: '9',
    studentId: '3',
    instructorId: '2',
    aircraftId: '1',
    startTime: new Date('2024-01-28T08:30:00'),
    endTime: new Date('2024-01-28T10:00:00'),
    paymentType: 'prepaid',
    notes: 'Lesson 16 - Area solo preparation',
    status: 'confirmed'
  },
  {
    id: '10',
    studentId: '4',
    aircraftId: '2',
    startTime: new Date('2024-01-29T15:00:00'),
    endTime: new Date('2024-01-29T16:30:00'),
    paymentType: 'prepaid',
    notes: 'Solo practice - steep turns',
    status: 'confirmed'
  }
];

export const mockTrainingRecords: TrainingRecord[] = [
  {
    id: '1',
    studentId: '3',
    bookingId: '3',
    date: new Date('2024-01-20'),
    aircraftId: '1',
    aircraftType: 'single-engine',
    registration: 'VH-ABC',
    instructorId: '2',
    dualTimeMin: 90,
    soloTimeMin: 0,
    comments: 'Good progress on forced landings. Practice radio work.',
    formalBriefing: true,
    lessonCodes: ['FL', 'RA'],
    nextLesson: 'Cross-country preparation',
    status: 'submitted',
    studentAck: true,
    studentAckName: 'John Pilot',
    instructorSignTimestamp: new Date('2024-01-20T15:30:00'),
    studentAckTimestamp: new Date('2024-01-20T15:35:00'),
    attachments: [],
    auditLog: [],
    sequences: [
      {
        id: '1',
        trainingRecordId: '1',
        sequenceId: 'FL001',
        sequenceCode: 'FL',
        sequenceTitle: 'Forced Landings',
        competence: 'S'
      },
      {
        id: '2',
        trainingRecordId: '1',
        sequenceId: 'RA001',
        sequenceCode: 'RA',
        sequenceTitle: 'Radio Procedures',
        competence: 'C'
      }
    ]
  },
  {
    id: '2',
    studentId: '3',
    bookingId: '4',
    date: new Date('2024-01-18'),
    aircraftId: '2',
    aircraftType: 'single-engine',
    registration: 'VH-DEF',
    instructorId: '2',
    dualTimeMin: 0,
    soloTimeMin: 72,
    comments: 'Excellent solo circuits. Ready for cross-country preparation.',
    formalBriefing: true,
    lessonCodes: ['TC', 'TL'],
    status: 'submitted',
    studentAck: true,
    studentAckName: 'John Pilot',
    instructorSignTimestamp: new Date('2024-01-18T10:30:00'),
    studentAckTimestamp: new Date('2024-01-18T10:35:00'),
    attachments: [],
    auditLog: [],
    sequences: [
      {
        id: '3',
        trainingRecordId: '2',
        sequenceId: 'TC001',
        sequenceCode: 'TC',
        sequenceTitle: 'Traffic Circuit',
        competence: 'C'
      },
      {
        id: '4',
        trainingRecordId: '2',
        sequenceId: 'TL001',
        sequenceCode: 'TL',
        sequenceTitle: 'Touch and Go Landings',
        competence: 'C'
      }
    ]
  }
];

export const mockDefects: Defect[] = [
  {
    id: '1',
    aircraftId: '3',
    reportedBy: 'John Instructor',
    dateReported: new Date('2024-01-20'),
    description: 'Radio intermittent on frequency 118.1',
    status: 'open'
  },
  {
    id: '2',
    aircraftId: '1',
    reportedBy: 'Jane Student',
    dateReported: new Date('2024-01-18'),
    description: 'Left brake feels spongy',
    status: 'mel',
    melNotes: 'Aircraft serviceable for local flights only'
  }
];

export const mockInvoices: Invoice[] = [
  {
    id: 'INV-001',
    studentId: '3',
    date: new Date('2024-01-20'),
    items: [
      { description: 'Aircraft Hire - VH-ABC (1.5 hrs)', quantity: 1.5, rate: 280, total: 420 },
      { description: 'Instructor Time - CFI (1.5 hrs)', quantity: 1.5, rate: 85, total: 127.5 }
    ],
    total: 547.5,
    status: 'paid'
  }
];

export const mockTransactions = [
  {
    id: '1',
    date: new Date('2024-01-25'),
    studentId: '3',
    studentName: 'John Pilot',
    description: 'Flight Training - VH-ABC (1.5 hrs)',
    amount: -547.50,
    paymentType: 'prepaid',
    balanceAfter: 702.50,
    type: 'debit'
  },
  {
    id: '2',
    date: new Date('2024-01-20'),
    studentId: '3',
    studentName: 'John Pilot',
    description: 'Account Top-up',
    amount: 1000.00,
    paymentType: 'deposit',
    balanceAfter: 1250.00,
    type: 'credit'
  }
];

export const mockSyllabusSequences: SyllabusSequence[] = [
  // Pre-Solo Sequences
  { id: 'PS001', code: 'PS', title: 'Pre-flight Inspection', group: 'Pre-Solo', order: 1, active: true },
  { id: 'PS002', code: 'TC', title: 'Traffic Circuit', group: 'Pre-Solo', order: 2, active: true },
  { id: 'PS003', code: 'TL', title: 'Touch and Go Landings', group: 'Pre-Solo', order: 3, active: true },
  { id: 'PS004', code: 'ST', title: 'Stalls and Recovery', group: 'Pre-Solo', order: 4, active: true },
  { id: 'PS005', code: 'FL', title: 'Forced Landings', group: 'Pre-Solo', order: 5, active: true },
  
  // Navigation Sequences
  { id: 'NAV001', code: 'NAV', title: 'Navigation Planning', group: 'Navigation', order: 6, active: true },
  { id: 'NAV002', code: 'XC', title: 'Cross Country Flight', group: 'Navigation', order: 7, active: true },
  { id: 'NAV003', code: 'DR', title: 'Dead Reckoning', group: 'Navigation', order: 8, active: true },
  
  // Radio Procedures
  { id: 'RA001', code: 'RA', title: 'Radio Procedures', group: 'Radio', order: 9, active: true },
  { id: 'RA002', code: 'CTR', title: 'Controlled Airspace', group: 'Radio', order: 10, active: true },
  
  // Emergency Procedures
  { id: 'EP001', code: 'EP', title: 'Emergency Procedures', group: 'Emergency', order: 11, active: true },
  { id: 'EP002', code: 'EL', title: 'Emergency Landing', group: 'Emergency', order: 12, active: true },
  
  // Advanced Sequences
  { id: 'ADV001', code: 'IF', title: 'Instrument Flying', group: 'Advanced', order: 13, active: true },
  { id: 'ADV002', code: 'NF', title: 'Night Flying', group: 'Advanced', order: 14, active: true },
  { id: 'ADV003', code: 'AER', title: 'Aerobatics', group: 'Advanced', order: 15, active: true }
];