import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedMenuItems } from '../../utils/rbac';
import {
  Users,
  Plane,
  FileText,
  Settings,
  Wrench,
  BookOpen,
  Shield,
  AlertCircle,
  DollarSign,
  Gift,
  FolderOpen,
  GraduationCap,
  X,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  BadgeCheck,
  Home,
  CalendarDays,
  MoreHorizontal,
  LogOut,
  User
} from 'lucide-react';
import { useFinancialProviders } from '../../context/financialProviderState';
import { useOrganisationSettings } from '../../hooks/useSettings';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const { user, logout } = useAuth();
  const { capabilities, loading: providersLoading } = useFinancialProviders();
  const { settings: organisationSettings } = useOrganisationSettings();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('crm-sidebar-collapsed') === 'true';
  });

  const userRoles = user?.roles?.length ? user.roles : (user?.role ? [user.role] : []);
  const isStaffUser = userRoles.some(role => ['admin', 'senior_instructor', 'instructor'].includes(role));

  const allMenuItems = [
    { id: 'students', label: 'Members', icon: Users, roles: ['admin', 'instructor'] },
    { id: 'membership', label: 'Club Membership', icon: BadgeCheck, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'] },
    { id: 'aircraft', label: 'Aircraft', icon: Plane, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'] },
    { id: 'duty', label: 'Duty', icon: Clock3, roles: ['admin', 'senior_instructor', 'instructor'] },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, roles: ['admin', 'senior_instructor', 'instructor'] },
    ...(isStaffUser ? [{ id: 'training', label: 'Training Courses', icon: BookOpen, roles: ['admin', 'senior_instructor', 'instructor'] }] : []),
    { id: 'learning-centre', label: 'Learning Centre', icon: GraduationCap, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'] },
    { id: 'pilot-file', label: 'Pilot File', icon: FileText, roles: ['admin', 'senior_instructor', 'instructor', 'pilot', 'student'] },
    { id: 'documents', label: 'Documents', icon: FolderOpen, roles: ['pilot', 'student'] },
    { id: 'outstanding-records', label: 'Outstanding Records', icon: AlertCircle, roles: ['admin', 'cfi', 'senior_instructor', 'instructor'] },
    { id: 'mylogbook', label: 'My Logbook', icon: BookOpen, roles: ['instructor', 'admin', 'pilot', 'student'] },
    { id: 'financial-dashboard', label: 'Financial Dashboard', icon: DollarSign, roles: ['admin'] },
    { id: 'gift-vouchers', label: 'Gift Vouchers', icon: Gift, roles: ['admin'] },
    { id: 'reports', label: 'Reports', icon: FileText, roles: ['admin', 'instructor'] },
    { id: 'safety', label: 'Safety', icon: Shield, roles: ['admin', 'instructor', 'student'] },
    { id: 'settings', label: 'Settings', icon: Settings, roles: ['admin'] }
  ];

  // Get authorized menu items using RBAC
  const authorizedItems = getAuthorizedMenuItems(user);
  const filteredMenuItems = allMenuItems.filter(item => {
    if (!providersLoading && !capabilities.financeEnabled &&
        ['financial-dashboard', 'gift-vouchers'].includes(item.id)) {
      return false;
    }
    if (!providersLoading && !capabilities.stripe.paymentsAvailable && item.id === 'gift-vouchers') {
      return false;
    }
    return authorizedItems.some(authItem => authItem.id === item.id);
  });

  const handleMenuItemClick = (itemId: string) => {
    onViewChange(itemId);
    setIsMobileMenuOpen(false);
  };

  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMobileMenuOpen]);

  const mobilePrimaryItems = useMemo(() => {
    const firstAvailable = (...ids: string[]) => ids.find(id => filteredMenuItems.some(item => item.id === id));
    const contextualPrimary = firstAvailable('students', 'aircraft', 'membership');
    const contextualSecondary = firstAvailable('duty', 'mylogbook', 'training', 'learning-centre');
    const mobileItem = (id?: string) => {
      const item = id ? filteredMenuItems.find(candidate => candidate.id === id) : undefined;
      if (!item) return undefined;
      const compactLabels: Record<string, string> = {
        membership: 'Membership',
        mylogbook: 'Logbook',
        training: 'Training',
        'learning-centre': 'Learn',
      };
      return { ...item, label: compactLabels[item.id] || item.label };
    };
    const candidates = [
      { id: 'dashboard', label: 'Home', icon: Home },
      { id: 'calendar', label: 'Calendar', icon: CalendarDays },
      mobileItem(contextualPrimary),
      mobileItem(contextualSecondary),
    ].filter(Boolean) as Array<{ id: string; label: string; icon: React.ElementType }>;
    return candidates
      .filter((item, index) => candidates.findIndex(candidate => candidate.id === item.id) === index)
      .slice(0, 4);
  }, [filteredMenuItems]);

  const mobilePrimaryIds = new Set(mobilePrimaryItems.map(item => item.id));
  const moreIsActive = !mobilePrimaryIds.has(activeView) && activeView !== 'profile';

  const toggleCollapsed = () => {
    setIsCollapsed(current => {
      const next = !current;
      window.localStorage.setItem('crm-sidebar-collapsed', String(next));
      return next;
    });
  };

  const renderMenuItems = (collapsed = false) => (
    <ul className="space-y-2">
      {filteredMenuItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeView === item.id;
        
        return (
          <li key={item.id}>
            <button
              onClick={() => handleMenuItemClick(item.id)}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              className={`flex w-full items-center rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              } ${collapsed ? 'justify-center px-3 py-3' : 'px-4 py-3'}`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${collapsed ? '' : 'mr-3'} ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className={`app-sidebar sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto overscroll-contain border-r border-gray-200 bg-white shadow-md transition-[width] duration-200 lg:block ${isCollapsed ? 'w-20' : 'w-64'}`}>
        <nav className={`${isCollapsed ? 'px-3' : 'px-4'} py-5`}>
          <div className={`mb-4 flex ${isCollapsed ? 'justify-center' : 'justify-end'}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
              aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {isCollapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </button>
          </div>
          {renderMenuItems(isCollapsed)}
        </nav>
      </aside>

      {/* Mobile app navigation */}
      <nav className="app-mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/90 bg-white/95 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-slate-700 dark:bg-slate-950/95 lg:hidden" aria-label="Primary navigation">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-1 pt-1.5">
          {mobilePrimaryItems.map(item => {
            const Icon = item.icon;
            const isActive = activeView === item.id || (item.id === 'dashboard' && activeView === 'profile');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleMenuItemClick(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`app-mobile-nav-item relative flex min-h-[3.5rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.68rem] font-semibold transition-colors ${isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
              >
                {isActive && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-600" aria-hidden="true" />}
                <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                <span className="max-w-full truncate">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-current={moreIsActive ? 'page' : undefined}
            className={`app-mobile-nav-item relative flex min-h-[3.5rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.68rem] font-semibold transition-colors ${moreIsActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}
          >
            {moreIsActive && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-blue-600" aria-hidden="true" />}
            <MoreHorizontal className={`h-5 w-5 ${moreIsActive ? 'stroke-[2.5]' : ''}`} />
            <span>More</span>
          </button>
        </div>
      </nav>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="app-mobile-drawer-overlay fixed inset-0 z-[110] flex lg:hidden">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Sidebar */}
          <div className="app-sidebar app-mobile-drawer relative flex h-dvh max-h-dvh w-[min(21rem,88vw)] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-950" role="dialog" aria-modal="true" aria-label="App navigation">
            <div className="app-drawer-safe-area flex shrink-0 items-center justify-between border-b border-gray-200 px-4 pb-3 pt-4 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-3">
                {organisationSettings?.logo_url ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700">
                    <img src={organisationSettings.logo_url} alt="" className="h-full w-full object-contain" />
                  </span>
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm"><Plane className="h-5 w-5" /></span>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-gray-900 dark:text-white">{organisationSettings?.club_name?.trim() || 'BFC Portal'}</h2>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.name}</p>
                </div>
              </div>
              <button
                autoFocus
                onClick={() => setIsMobileMenuOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-gray-100 dark:hover:bg-slate-800"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {renderMenuItems(false)}
            </nav>
            <div className="app-drawer-bottom-safe-area shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
              <button type="button" onClick={() => handleMenuItemClick('profile')} className="mb-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                <User className="h-5 w-5 text-slate-400" /> My profile
              </button>
              <button type="button" onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30">
                <LogOut className="h-5 w-5" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
