import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { can, Action } from '../../utils/rbac';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

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

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
          <div className="mb-6">
            <div className="mx-auto h-16 w-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">403 - Not Authorized</h1>
            <p className="text-gray-600">
              You don't have permission to access this page.
            </p>
          </div>
          
          <button
            onClick={() => window.history.back()}
            className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors mx-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};