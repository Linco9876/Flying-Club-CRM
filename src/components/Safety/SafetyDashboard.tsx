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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Safety</h1>
        <p className="text-gray-600">Manage pilot currency, instructor approvals, and safety documentation</p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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