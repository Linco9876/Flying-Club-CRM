import React from 'react';
import { useState } from 'react';
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
  Menu,
  X,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  const { user } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('crm-sidebar-collapsed') === 'true';
  });

  const allMenuItems = [
    { id: 'students', label: 'Members', icon: Users, roles: ['admin', 'instructor'] },
    { id: 'aircraft', label: 'Aircraft', icon: Plane, roles: ['admin', 'instructor', 'student'] },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench, roles: ['admin', 'instructor'] },
    { id: 'training', label: 'Training Records', icon: BookOpen, roles: ['admin', 'instructor', 'pilot', 'student'] },
    { id: 'outstanding-records', label: 'Outstanding Records', icon: AlertCircle, roles: ['admin', 'instructor'] },
    { id: 'syllabus-management', label: 'Syllabus Management', icon: BookOpen, roles: ['admin', 'instructor'] },
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
    return authorizedItems.some(authItem => authItem.id === item.id);
  });

  const handleMenuItemClick = (itemId: string) => {
    onViewChange(itemId);
    setIsMobileMenuOpen(false);
  };

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
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="app-mobile-menu-button fixed left-4 top-4 z-50 rounded-lg border border-gray-200 bg-white p-2 shadow-md lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-6 w-6 text-gray-600" />
      </button>

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

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          
          {/* Sidebar */}
          <div className="app-sidebar relative flex h-dvh max-h-dvh w-[min(18rem,85vw)] flex-col overflow-hidden bg-white shadow-xl">
            <div className="shrink-0 flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {renderMenuItems(false)}
            </nav>
          </div>
        </div>
      )}
    </>
  );
};
