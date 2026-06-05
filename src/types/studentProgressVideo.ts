export interface StudentProgressVideoCourse {
  title: string;
  category: string;
  percentage: number;
  completedLessons: number;
  totalLessons: number;
  isComplete: boolean;
}

export interface StudentProgressVideoActivity {
  date: string;
  title: string;
  detail: string;
  status?: string;
}

export interface StudentProgressVideoExam {
  name: string;
  score: number;
  passMark: number;
  result: 'pass' | 'fail';
  date: string;
}

export interface StudentProgressVideoProps {
  clubName: string;
  generatedAt: string;
  student: {
    name: string;
    email?: string;
    role: string;
    raausId?: string;
    casaId?: string;
  };
  stats: {
    totalHours: number;
    dualHours: number;
    soloHours: number;
    recordsCount: number;
    competentSequences: number;
    examsPassed: number;
    coursesCompleted: number;
    coursesInProgress: number;
  };
  courses: StudentProgressVideoCourse[];
  recentActivity: StudentProgressVideoActivity[];
  exams: StudentProgressVideoExam[];
}

export const defaultStudentProgressVideoProps: StudentProgressVideoProps = {
  clubName: 'Bendigo Flying Club',
  generatedAt: new Date().toISOString(),
  student: {
    name: 'Student Pilot',
    role: 'student',
  },
  stats: {
    totalHours: 12.4,
    dualHours: 10.8,
    soloHours: 1.6,
    recordsCount: 9,
    competentSequences: 18,
    examsPassed: 2,
    coursesCompleted: 0,
    coursesInProgress: 1,
  },
  courses: [
    {
      title: 'RAAus Ab-Initio RPC',
      category: 'Flight Training',
      percentage: 58,
      completedLessons: 9,
      totalLessons: 19,
      isComplete: false,
    },
  ],
  recentActivity: [
    {
      date: '2026-06-05',
      title: 'Training flight',
      detail: '24-4851 - 1.2h dual',
      status: 'submitted',
    },
  ],
  exams: [
    {
      name: 'Pre-solo exam',
      score: 88,
      passMark: 80,
      result: 'pass',
      date: '2026-06-01',
    },
  ],
};
