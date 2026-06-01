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
    <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto max-w-7xl px-3 pl-16 sm:px-6 lg:px-8">
        <div className="grid min-h-[4.75rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 sm:min-h-16 lg:py-0">
          <div className="flex min-w-0 items-center gap-3">
            {settings?.logo_url ? (
              <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
                <img
                  src={settings.logo_url}
                  alt={`${businessName} logo`}
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-sm">
                <Plane className="h-6 w-6 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight text-gray-950 sm:text-xl">{businessName}</h1>
              <p className="hidden text-xs text-gray-500 sm:block">Flight Training Management System</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 sm:gap-3">
            <NotificationBell />

            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
              <div className="hidden min-w-0 text-right sm:block">
                <p className="max-w-52 truncate text-sm font-semibold leading-tight text-gray-900">{user?.name}</p>
                <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getRoleBadgeColor(user?.role || '')}`}>
                  {user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
                </span>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 shadow-sm ring-2 ring-white">
                <User className="h-5 w-5 text-white" />
              </div>
            </div>

            <button
              onClick={logout}
              className="rounded-full border border-transparent p-2 text-gray-400 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-700"
              title="Logout"
              aria-label="Logout"
            >
              <LogOut className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          </div>

          <div className="col-span-2 min-w-0 sm:hidden">
            <div className="flex min-w-0 items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
              <p className="min-w-0 truncate text-sm font-semibold text-gray-900">{user?.name}</p>
              <span className={`ml-3 inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getRoleBadgeColor(user?.role || '')}`}>
                {user?.role?.charAt(0).toUpperCase() + user?.role?.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
