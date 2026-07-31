export interface StudentProfileLoadPlan {
  userDirectory: boolean;
  safetyReports: boolean;
  examResults: boolean;
  invoices: boolean;
}

export const getStudentProfileLoadPlan = (
  activeTab: string,
  trainingSubtab: string,
): StudentProfileLoadPlan => ({
  // Instructor names appear in the Overview's recent activity, but this request
  // remains non-blocking so the member identity can render first.
  userDirectory: activeTab === 'profile'
    || activeTab === 'training'
    || activeTab === 'exams'
    || activeTab === 'courses'
    || activeTab === 'timeline',
  safetyReports: activeTab === 'safety' || activeTab === 'timeline',
  examResults: activeTab === 'exams'
    || activeTab === 'timeline'
    || (activeTab === 'training' && trainingSubtab === 'exams'),
  invoices: activeTab === 'billing',
});
