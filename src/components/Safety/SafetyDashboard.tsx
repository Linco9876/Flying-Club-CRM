import React, { Suspense, lazy, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedSafetyTabs } from '../../utils/rbac';
import { Users, UserCheck, AlertTriangle, FileText, ShieldCheck, ClipboardCheck } from 'lucide-react';
import { hasAnyRole } from '../../utils/rbac';
import { PortalSectionLoader } from '../Layout/PortalSectionLoader';

const PilotCurrencyTab = lazy(() => import('./PilotCurrencyTab').then(module => ({ default: module.PilotCurrencyTab })));
const InstructorApprovalsTab = lazy(() => import('./InstructorApprovalsTab').then(module => ({ default: module.InstructorApprovalsTab })));
const SafetyReportsTab = lazy(() => import('./SafetyReportsTab').then(module => ({ default: module.SafetyReportsTab })));
const ChecklistsDocsTab = lazy(() => import('./ChecklistsDocsTab').then(module => ({ default: module.ChecklistsDocsTab })));

export const SafetyDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pilot-currency');
  const isStudentOrPilot = user?.role === 'student' || user?.role === 'pilot' || user?.roles?.some(role => role === 'student' || role === 'pilot');
  const isStaff = hasAnyRole(user, ['admin', 'instructor', 'senior_instructor']);
  const isMemberSafetyView = Boolean(isStudentOrPilot && !isStaff);

  const allTabs = [
    { id: 'pilot-currency', label: isMemberSafetyView ? 'My Currency' : 'Pilot Currency', icon: <Users className="h-4 w-4" /> },
    { id: 'instructor-approvals', label: 'Instructor Approvals', icon: <UserCheck className="h-4 w-4" /> },
    { id: 'safety-reports', label: isMemberSafetyView ? 'My Reports' : 'Safety Reports', icon: <AlertTriangle className="h-4 w-4" /> },
    { id: 'checklists-docs', label: isMemberSafetyView ? 'Checklists & Docs' : 'Checklists / Docs', icon: <FileText className="h-4 w-4" /> }
  ];

  // Get authorized tabs using RBAC
  const authorizedTabs = getAuthorizedSafetyTabs(user);
  const tabs = allTabs.filter(tab => 
    authorizedTabs.some(authTab => authTab.id === tab.id)
  );

  // Set default tab based on available tabs
  React.useEffect(() => {
    if (tabs.length > 0 && !tabs.find(tab => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  if (isMemberSafetyView) {
    const quickCards = [
      {
        id: 'pilot-currency',
        title: 'Currency',
        description: 'Medical, membership, flight review and recent flying status.',
        icon: <ShieldCheck className="h-5 w-5" />
      },
      {
        id: 'safety-reports',
        title: 'Reports',
        description: 'Submit a report and review reports that involve you.',
        icon: <AlertTriangle className="h-5 w-5" />
      },
      {
        id: 'checklists-docs',
        title: 'Resources',
        description: 'Checklists and safety documents for flying at the club.',
        icon: <ClipboardCheck className="h-5 w-5" />
      }
    ];

    return (
      <div className="space-y-5 p-3 sm:p-6">
        <section className="overflow-hidden rounded-2xl border border-blue-900/10 bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 text-white shadow-sm">
          <div className="p-5 sm:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Safety</p>
                <h1 className="mt-2 text-2xl font-bold sm:text-3xl">My Safety & Currency</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
                  Keep your flying status visible, update anything that needs attention, and access the reports or documents that apply to you.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {quickCards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setActiveTab(card.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    activeTab === card.id
                      ? 'border-blue-300 bg-white text-slate-950 shadow-lg'
                      : 'border-white/10 bg-white/10 text-white hover:bg-white/15'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={activeTab === card.id ? 'text-blue-700' : 'text-blue-200'}>{card.icon}</span>
                    <span className="font-semibold">{card.title}</span>
                  </div>
                  <p className={`mt-2 text-xs leading-5 ${activeTab === card.id ? 'text-slate-600' : 'text-blue-100'}`}>{card.description}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <nav className="grid grid-cols-3 gap-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div>
          <Suspense fallback={<PortalSectionLoader message="Loading safety section" detail="Preparing this safety view..." />}>
            {activeTab === 'pilot-currency' && <PilotCurrencyTab />}
            {activeTab === 'safety-reports' && <SafetyReportsTab />}
            {activeTab === 'checklists-docs' && <ChecklistsDocsTab />}
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Safety</h1>
        <p className="text-gray-600">Manage pilot currency, instructor approvals, and safety documentation</p>
      </div>

      {/* Tab Navigation */}
      <div className="app-tab-scroller">
        <nav className="app-tab-list">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`app-tab-button ${
                activeTab === tab.id
                  ? 'app-tab-button-active'
                  : ''
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        <Suspense fallback={<PortalSectionLoader message="Loading safety section" detail="Preparing this safety view..." />}>
          {activeTab === 'pilot-currency' && <PilotCurrencyTab />}
          {activeTab === 'instructor-approvals' && <InstructorApprovalsTab />}
          {activeTab === 'safety-reports' && <SafetyReportsTab />}
          {activeTab === 'checklists-docs' && <ChecklistsDocsTab />}
        </Suspense>
      </div>
    </div>
  );
};
