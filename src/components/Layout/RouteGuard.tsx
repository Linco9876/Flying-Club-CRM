import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { can, Action, getAuthorizedMenuItems } from '../../utils/rbac';

interface RouteGuardProps {
  children: React.ReactNode;
  requiredAction: Action;
  resource?: 'all' | 'own';
  fallback?: React.ReactNode;
}

export const RouteGuard: React.FC<RouteGuardProps> = ({
  children,
  requiredAction,
  resource = 'all',
  fallback
}) => {
  const { user } = useAuth();

  if (!can(user, requiredAction, resource)) {
    if (fallback) {
      return <>{fallback}</>;
    }

    const fallbackView = getAuthorizedMenuItems(user)[0]?.id || 'profile';
    const fallbackPath = fallbackView === 'dashboard'
      ? '/'
      : fallbackView === 'profile'
        ? '/profile'
        : `/${fallbackView.replace('mylogbook', 'my-logbook')}`;

    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
};
