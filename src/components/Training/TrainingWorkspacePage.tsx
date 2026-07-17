import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { BookOpenCheck, ClipboardCheck, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { hasAnyRole } from '../../utils/rbac';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';

const TrainingCourseCatalog = lazy(() =>
  import('./TrainingCourseCatalog').then(module => ({ default: module.TrainingCourseCatalog }))
);
const FlightReviewWorkspace = lazy(() =>
  import('./FlightReviewWorkspace').then(module => ({ default: module.FlightReviewWorkspace }))
);
const InstructorApprovalsTab = lazy(() =>
  import('../Safety/InstructorApprovalsTab').then(module => ({ default: module.InstructorApprovalsTab }))
);

type TrainingWorkspace = 'courses' | 'reviews' | 'instructor-standards';

export const TrainingWorkspacePage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canSeeInstructorStandards = hasAnyRole(user, ['cfi']);
  const requestedWorkspace = searchParams.get('workspace');
  const activeWorkspace: TrainingWorkspace = useMemo(() => {
    if (requestedWorkspace === 'reviews') return 'reviews';
    if (requestedWorkspace === 'instructor-standards' && canSeeInstructorStandards) {
      return 'instructor-standards';
    }
    return 'courses';
  }, [canSeeInstructorStandards, requestedWorkspace]);

  useEffect(() => {
    if (requestedWorkspace === 'instructor-standards' && !canSeeInstructorStandards) {
      const next = new URLSearchParams(searchParams);
      next.set('workspace', 'courses');
      setSearchParams(next, { replace: true });
    }
  }, [canSeeInstructorStandards, requestedWorkspace, searchParams, setSearchParams]);

  const selectWorkspace = (workspace: TrainingWorkspace) => {
    const next = new URLSearchParams(searchParams);
    next.set('workspace', workspace);
    setSearchParams(next);
  };

  const tabs = [
    { id: 'courses' as const, label: 'Training Courses', icon: BookOpenCheck },
    { id: 'reviews' as const, label: 'Flight Reviews & Tests', icon: ClipboardCheck },
    ...(canSeeInstructorStandards
      ? [{ id: 'instructor-standards' as const, label: 'Instructor Standards', icon: ShieldCheck }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <nav
        aria-label="Training workspace"
        className="grid gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm dark:border-[#2c3440] dark:bg-[#171a21] sm:grid-cols-2 lg:grid-cols-3"
      >
        {tabs.map(tab => {
          const Icon = tab.icon;
          const selected = activeWorkspace === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectWorkspace(tab.id)}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${
                selected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-[#232832] dark:hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <Suspense fallback={<PortalSectionLoader message="Preparing training workspace" />}>
        {activeWorkspace === 'courses' && <TrainingCourseCatalog />}
        {activeWorkspace === 'reviews' && <FlightReviewWorkspace />}
        {activeWorkspace === 'instructor-standards' && canSeeInstructorStandards && (
          <InstructorApprovalsTab />
        )}
      </Suspense>
    </div>
  );
};
