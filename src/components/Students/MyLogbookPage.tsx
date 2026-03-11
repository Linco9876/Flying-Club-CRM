import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { LogbookTab } from './LogbookTab';

export const MyLogbookPage: React.FC = () => {
  const { user } = useAuth();

  if (!user) return null;

  const isInstructor = user.role === 'instructor' || user.role === 'admin';

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Logbook</h1>
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
