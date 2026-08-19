import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogbookTab } from './LogbookTab';
import { hasAnyRole } from '../../utils/rbac';

export const MyLogbookPage: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  const isInstructor = hasAnyRole(user, ['admin', 'cfi', 'senior_instructor', 'instructor']);

  return (
    <div className="pilot-logbook-page w-full max-w-none p-3 sm:p-6">
      <div className="logbook-page-heading mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">My Logbook</h1>
        <p className="text-gray-600 mt-1">Personal flight history and totals</p>
      </div>
      <LogbookTab
        userId={user.id}
        userName={user.name}
        isInstructor={isInstructor}
      />
    </div>
  );
};
