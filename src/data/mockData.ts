import { Aircraft, Booking, Student, TrainingRecord, Defect, Invoice, SyllabusSequence, TrainingModule } from '../types';

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

export const mockTrainingModules: TrainingModule[] = [
  {
    id: 'module-pre-solo',
    title: 'Pre-Solo Foundations',
    description: 'Structured pathway covering inspections, circuit work and safety procedures leading to first solo.',
    category: 'Recreational Pilot Certificate',
    version: '1.2',
    status: 'published',
    estimatedDurationHours: 12,
    prerequisites: ['Complete aviation medical', 'Passenger briefing competency'],
    objectives: [
      'Prepare students for first solo circuit by reinforcing threat and error management',
      'Validate aircraft handling, radio procedures and emergency responses',
      'Introduce independent decision making in the circuit environment'
    ],
    evaluationCriteria: [
      'Demonstrate consistent circuit spacing and height management',
      'Correctly execute go-around procedures when required',
      'Verbalise and apply emergency actions without prompting'
    ],
    tags: ['pre-solo', 'circuit', 'safety'],
    lessons: [
      {
        id: 'lesson-ps1',
        sequenceId: 'PS001',
        sequenceCode: 'PS',
        sequenceTitle: 'Pre-flight Inspection',
        stage: 'ground',
        durationMinutes: 60,
        minCompetency: 'Introduce',
        keyExercises: [
          'Conduct full RA-Aus daily inspection',
          'Identify unserviceable items and escalate appropriately'
        ],
        studentPreparation: 'Review aircraft POH limitations and abnormal procedures.',
        instructorNotes: 'Demonstrate propeller safety and highlight local airfield hazards.',
        name: 'Pre-flight Inspection',
        objective: 'Prepare students to conduct thorough RA-Aus daily inspections independently.',
        flightExercises:
          '• Conduct full RA-Aus daily inspection\n• Identify unserviceable items and escalate appropriately',
        theory:
          'Review aircraft POH limitations, abnormal procedures and local airfield hazards before dispatch.',
        assessmentCriteria: [
          {
            id: 'criterion-ps1-1',
            name: 'Inspection checklist completion',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'C'
          },
          {
            id: 'criterion-ps1-2',
            name: 'Hazard reporting accuracy',
            gradingSystem: 'Pass or Fail',
            passingGrade: 'Pass'
          }
        ]
      },
      {
        id: 'lesson-ps2',
        sequenceId: 'PS002',
        sequenceCode: 'TC',
        sequenceTitle: 'Traffic Circuit',
        stage: 'flight',
        durationMinutes: 90,
        minCompetency: 'Practice',
        keyExercises: [
          'Circuit planning and spacing in crosswind conditions',
          'Stabilised final approach with go-around decision points'
        ],
        studentPreparation: 'Listen to CTAF recordings and practise readbacks.',
        instructorNotes: 'Use touch drills to reinforce emergency actions before take-off.',
        name: 'Traffic Circuit',
        objective: 'Reinforce consistent circuit profiles and confident radio procedures before first solo.',
        flightExercises:
          '• Circuit planning and spacing in crosswind conditions\n• Stabilised final approach with go-around decision points',
        theory: 'Listen to CTAF recordings and practise readbacks to prepare for in-circuit workload.',
        assessmentCriteria: [
          {
            id: 'criterion-ps2-1',
            name: 'Circuit spacing',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'C'
          },
          {
            id: 'criterion-ps2-2',
            name: 'Go-around decision making',
            gradingSystem: 'Pass or Fail',
            passingGrade: 'Pass'
          }
        ]
      },
      {
        id: 'lesson-ps3',
        sequenceId: 'PS005',
        sequenceCode: 'FL',
        sequenceTitle: 'Forced Landings',
        stage: 'flight',
        durationMinutes: 75,
        minCompetency: 'Assess',
        keyExercises: [
          'Field selection under time pressure',
          'MAYDAY call and passenger brief in simulated engine failure'
        ],
        studentPreparation: 'Create kneeboard notes for engine failure checks.',
        instructorNotes: 'Introduce glide performance numbers for club aircraft types.',
        name: 'Forced Landings',
        objective: 'Build rapid decision making and adherence to forced landing procedures in the circuit area.',
        flightExercises:
          '• Field selection under time pressure\n• MAYDAY call and passenger brief in simulated engine failure',
        theory: 'Create kneeboard notes for engine failure checks and recite passenger briefs.',
        assessmentCriteria: [
          {
            id: 'criterion-ps3-1',
            name: 'Field selection',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'C'
          },
          {
            id: 'criterion-ps3-2',
            name: 'Emergency communications',
            gradingSystem: 'Pass or Fail',
            passingGrade: 'Pass'
          }
        ]
      }
    ],
    resources: [
      {
        id: 'resource-ps1',
        type: 'checklist',
        title: 'RA-Aus Daily Inspection Checklist',
        notes: 'Laminated copy kept in briefing room.'
      },
      {
        id: 'resource-ps2',
        type: 'video',
        title: 'Circuit Operations Briefing',
        url: 'https://training.flyingclub.example/circuit-briefing'
      }
    ],
    lastUpdated: new Date('2024-01-15')
  },
  {
    id: 'module-navigation',
    title: 'Navigation Essentials',
    description: 'Advanced module guiding students through planning, navigation techniques and controlled airspace operations.',
    category: 'Cross Country Endorsement',
    version: '2.0',
    status: 'draft',
    estimatedDurationHours: 16,
    prerequisites: ['Pre-solo foundations', 'Flight radio endorsement'],
    objectives: [
      'Develop repeatable navigation planning workflow incorporating fuel and weather checks',
      'Improve situational awareness using pilotage, dead reckoning and radio navigation aids',
      'Build confidence communicating with tower and centre frequencies'
    ],
    evaluationCriteria: [
      'Accurately compute flight logs within ±3 minutes ETA',
      'Manage diversions with in-flight replanning and fuel assessment',
      'Maintain CTAF and controlled airspace radio phraseology without prompting'
    ],
    tags: ['navigation', 'cross-country', 'advanced'],
    lessons: [
      {
        id: 'lesson-nav1',
        sequenceId: 'NAV001',
        sequenceCode: 'NAV',
        sequenceTitle: 'Navigation Planning',
        stage: 'ground',
        durationMinutes: 120,
        minCompetency: 'Practice',
        keyExercises: [
          'Prepare flight log with wind and fuel calculations',
          'Create weather and NOTAM briefing pack'
        ],
        studentPreparation: 'Download latest area forecasts and NOTAMs.',
        instructorNotes: 'Compare electronic and paper planning tools for redundancy.',
        name: 'Navigation Planning',
        objective: 'Build a consistent workflow for cross country planning and threat management.',
        flightExercises:
          '• Prepare flight log with wind and fuel calculations\n• Create weather and NOTAM briefing pack',
        theory: 'Download latest area forecasts and NOTAMs and review alternate requirements.',
        assessmentCriteria: [
          {
            id: 'criterion-nav1-1',
            name: 'Flight log accuracy',
            gradingSystem: 'Out of 100',
            passingGrade: '85'
          },
          {
            id: 'criterion-nav1-2',
            name: 'Weather briefing completeness',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'S'
          }
        ]
      },
      {
        id: 'lesson-nav2',
        sequenceId: 'NAV002',
        sequenceCode: 'XC',
        sequenceTitle: 'Cross Country Flight',
        stage: 'flight',
        durationMinutes: 180,
        minCompetency: 'Practice',
        keyExercises: [
          'Waypoint to waypoint timing checks',
          'Diversion planning and alternates'
        ],
        studentPreparation: 'Prepare 2 diversion legs including fuel burn estimates.',
        instructorNotes: 'Introduce in-cockpit checklists for lost procedure execution.',
        name: 'Cross Country Flight',
        objective: 'Execute flight plan while managing timing, navigation fixes and decision making in-flight.',
        flightExercises:
          '• Waypoint to waypoint timing checks\n• Diversion planning and alternates',
        theory: 'Prepare two diversion legs including fuel burn estimates and review lost procedure checklists.',
        assessmentCriteria: [
          {
            id: 'criterion-nav2-1',
            name: 'Leg timing management',
            gradingSystem: 'Out of 100',
            passingGrade: '80'
          },
          {
            id: 'criterion-nav2-2',
            name: 'Diversion planning',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'S'
          }
        ]
      },
      {
        id: 'lesson-nav3',
        sequenceId: 'RA002',
        sequenceCode: 'CTR',
        sequenceTitle: 'Controlled Airspace',
        stage: 'simulator',
        durationMinutes: 90,
        minCompetency: 'Introduce',
        keyExercises: [
          'Tower clearance requests and readbacks',
          'Transponder and CTAF changeover flows'
        ],
        studentPreparation: 'Practise CTAF and tower phraseology scripts.',
        instructorNotes: 'Use scenario-based training with multiple frequency changes.',
        name: 'Controlled Airspace',
        objective: 'Introduce controlled airspace communication standards and workload management.',
        flightExercises:
          '• Tower clearance requests and readbacks\n• Transponder and CTAF changeover flows',
        theory: 'Practise CTAF and tower phraseology scripts, focusing on readback standards.',
        assessmentCriteria: [
          {
            id: 'criterion-nav3-1',
            name: 'Clearance readbacks',
            gradingSystem: 'NC/S/C/-',
            passingGrade: 'S'
          },
          {
            id: 'criterion-nav3-2',
            name: 'Frequency management',
            gradingSystem: 'Pass or Fail',
            passingGrade: 'Pass'
          }
        ]
      }
    ],
    resources: [
      {
        id: 'resource-nav1',
        type: 'document',
        title: 'Flight Log Template',
        url: 'https://training.flyingclub.example/flight-log-template.pdf'
      },
      {
        id: 'resource-nav2',
        type: 'link',
        title: 'NAIPS Weather Briefing Portal',
        url: 'https://www.airservicesaustralia.com/naips'
      }
    ],
    lastUpdated: new Date('2024-02-05')
  }
];
