import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAuthorizedSafetyTabs } from '../../utils/rbac';
import { PilotCurrencyTab } from './PilotCurrencyTab';
import { InstructorApprovalsTab } from './InstructorApprovalsTab';
import { SafetyReportsTab } from './SafetyReportsTab';
import { ChecklistsDocsTab } from './ChecklistsDocsTab';
import { Users, UserCheck, AlertTriangle, FileText } from 'lucide-react';

export const SafetyDashboard: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pilot-currency');
  const isStudentOrPilot = user?.role === 'student' || user?.role === 'pilot' || user?.roles?.some(role => role === 'student' || role === 'pilot');

  const allTabs = [
    { id: 'pilot-currency', label: 'Pilot Currency', icon: <Users className="h-4 w-4" /> },
    { id: 'instructor-approvals', label: 'Instructor Approvals', icon: <UserCheck className="h-4 w-4" /> },
    { id: 'safety-reports', label: 'Safety Reports', icon: <AlertTriangle className="h-4 w-4" /> },
    { id: 'checklists-docs', label: 'Checklists / Docs', icon: <FileText className="h-4 w-4" /> }
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

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Safety</h1>
        <p className="text-gray-600">
          {isStudentOrPilot
            ? 'Review your currency, safety reports involving you, and club safety documents'
            : 'Manage pilot currency, instructor approvals, and safety documentation'}
        </p>
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
        {activeTab === 'pilot-currency' && <PilotCurrencyTab />}
        {activeTab === 'instructor-approvals' && <InstructorApprovalsTab />}
        {activeTab === 'safety-reports' && <SafetyReportsTab />}
        {activeTab === 'checklists-docs' && <ChecklistsDocsTab />}
      </div>
    </div>
  );
};
