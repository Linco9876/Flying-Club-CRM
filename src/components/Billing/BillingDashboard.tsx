import React, { useState } from 'react';
import { TransactionsTab } from './TransactionsTab';
import { PilotAccountsTab } from './PilotAccountsTab';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { CreditCard, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortalUxSettings } from '../../hooks/useSettings';

export const BillingDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('transactions');
  const billing = useBillingAccounts();
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const isStudentPortal = user?.role === 'student' || user?.role === 'pilot';

  if (isStudentPortal) {
    if (!portalSettings.show_invoices_in_portal) {
      return <div className="p-3 text-sm text-gray-500 sm:p-6">Billing history is not available in the student portal.</div>;
    }

    const account = billing.pilotAccounts.find(item => item.userId === user?.id);
    const transactions = billing.transactions.filter(item => item.userId === user?.id);
    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Billing</h1>
          <p className="text-gray-600">Review your account balance and billing history.</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Pre-paid account balance</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">${(account?.balance ?? 0).toFixed(portalSettings.currency_decimals)}</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Billing history</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">No billing transactions recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {transactions.map(transaction => (
                <div key={transaction.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{transaction.description || transaction.type}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(transaction.createdAt).toLocaleDateString(portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU')}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold ${transaction.amount >= 0 ? 'text-emerald-700' : 'text-gray-900'}`}>
                    {transaction.amount >= 0 ? '+' : '-'}${Math.abs(transaction.amount).toFixed(portalSettings.currency_decimals)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'transactions', label: 'Transactions', icon: <CreditCard className="h-4 w-4" /> },
    { id: 'accounts', label: 'Pilot Accounts', icon: <Users className="h-4 w-4" /> }
  ];

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Billing</h1>
        <p className="text-gray-600">Manage transactions and pilot accounts</p>
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
        {activeTab === 'transactions' && <TransactionsTab billing={billing} />}
        {activeTab === 'accounts' && <PilotAccountsTab billing={billing} />}
      </div>
    </div>
  );
};
