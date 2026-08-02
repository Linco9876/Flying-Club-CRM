export type StudentProfilePortalSection = 'training' | 'documents' | undefined;

export const shouldUseTrainingSubtab = ({
  tabId,
  activeTab,
  isOwnStudentPortal,
  portalSection,
}: {
  tabId: string;
  activeTab: string;
  isOwnStudentPortal: boolean;
  portalSection: StudentProfilePortalSection;
}) => {
  if (activeTab !== 'training') return false;
  if (tabId === 'training' || tabId === 'reviews') return true;

  return isOwnStudentPortal
    && portalSection === 'training'
    && (tabId === 'exams' || tabId === 'courses');
};
