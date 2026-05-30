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
      return <div className="p-6 text-sm text-gray-500">Billing history is not available in the student portal.</div>;
    }

    const account = billing.pilotAccounts.find(item => item.userId === user?.id);
    const transactions = billing.transactions.filter(item => item.userId === user?.id);
    return (
      <div className="space-y-6 p-6">
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
                <div key={transaction.id} className="flex items-center justify-between gap-4 px-5 py-4">
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
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-gray-600">Manage transactions and pilot accounts</p>
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
        {activeTab === 'transactions' && <TransactionsTab billing={billing} />}
        {activeTab === 'accounts' && <PilotAccountsTab billing={billing} />}
      </div>
    </div>
  );
};
