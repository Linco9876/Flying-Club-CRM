import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Plane, User, LogOut } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useOrganisationSettings } from '../../hooks/useSettings';

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const { settings } = useOrganisationSettings();
  const businessName = settings?.club_name?.trim() || 'Bendigo Flying Club';

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'instructor': return 'bg-blue-100 text-blue-800';
      case 'student': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <header className="bg-white shadow-md border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-4 pl-16 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3 lg:flex-nowrap lg:py-0">
          <div className="flex min-w-0 items-center space-x-3">
            {settings?.logo_url ? (
              <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
                <img
                  src={settings.logo_url}
                  alt={`${businessName} logo`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex-shrink-0 bg-blue-600 p-2 rounded-lg">
                <Plane className="h-6 w-6 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold text-gray-900 sm:text-xl">{businessName}</h1>
              <p className="hidden text-xs text-gray-500 sm:block">Flight Training Management System</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center space-x-2 sm:space-x-4">
            <NotificationBell />

            <div className="flex min-w-0 items-center space-x-2 sm:space-x-3">
              <div className="min-w-0 text-right">
                <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getRoleBadgeColor(user?.role || '')}`}>
                  {user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-white" />
                </div>
                <button
                  onClick={logout}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
