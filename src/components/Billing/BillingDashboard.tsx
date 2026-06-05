import React, { useState } from 'react';
import { TransactionsTab } from './TransactionsTab';
import { PilotAccountsTab } from './PilotAccountsTab';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { CreditCard, Plus, Users, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useBillingSettings } from '../../hooks/useBillingSettings';

const creditTypes = new Set(['topup', 'refund']);

const getSignedTransactionAmount = (type: string, amount: number) =>
  creditTypes.has(type) ? Math.abs(amount) : -Math.abs(amount);

interface BillingDashboardProps {
  mode?: 'auto' | 'own' | 'financial';
}

export const BillingDashboard: React.FC<BillingDashboardProps> = ({ mode = 'auto' }) => {
  const [activeTab, setActiveTab] = useState('transactions');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpPaymentMethodId, setTopUpPaymentMethodId] = useState('');
  const [topUpReference, setTopUpReference] = useState('');
  const [topUpDate, setTopUpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submittingTopUp, setSubmittingTopUp] = useState(false);
  const billing = useBillingAccounts();
  const { user } = useAuth();
  const { settings: portalSettings } = usePortalUxSettings();
  const { paymentMethods } = useBillingSettings();
  const userRoles = user?.roles && user.roles.length > 0 ? user.roles : (user?.role ? [user.role] : []);
  const isAdminBilling = userRoles.includes('admin');
  const isStudentOrPilotOnly = userRoles.some(role => ['student', 'pilot'].includes(role)) &&
    !userRoles.some(role => ['admin', 'instructor', 'senior_instructor'].includes(role));
  const showOwnBillingOnly = mode === 'own' || (mode === 'auto' && !isAdminBilling);

  if (showOwnBillingOnly) {
    if (isStudentOrPilotOnly && !portalSettings.show_invoices_in_portal) {
      return <div className="p-3 text-sm text-gray-500 sm:p-6">Billing history is not available in the student portal.</div>;
    }

    const account = billing.pilotAccounts.find(item => item.userId === user?.id);
    const transactions = billing.transactions.filter(item => item.userId === user?.id);
    const accountTopUpPaymentMethods = paymentMethods.filter(method => method.active && method.allowAccountTopup !== false);
    const approvedBalance = account?.balance ?? 0;
    const pendingTopUpAmount = transactions
      .filter(transaction => transaction.type === 'topup' && transaction.verifiedStatus === 'pending')
      .reduce((total, transaction) => total + Math.abs(transaction.amount), 0);
    const theoreticalBalance = approvedBalance + pendingTopUpAmount;
    const currencyFormatter = (amount: number) =>
      `$${amount.toFixed(portalSettings.currency_decimals)}`;
    const dateLocale = portalSettings.date_format === 'MM/dd/yyyy' ? 'en-US' : 'en-AU';

    const handleTopUpSubmit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!user?.id) return;

      const amount = Number(topUpAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return;
      }

      setSubmittingTopUp(true);
      try {
        const methodName = accountTopUpPaymentMethods.find(method => method.id === topUpPaymentMethodId)?.name;
        const description = topUpReference.trim()
          ? `Funds added by member: ${topUpReference.trim()}`
          : methodName
            ? `Funds added by member via ${methodName}`
            : 'Funds added by member';
        await billing.addTopUp(user.id, amount, description, topUpPaymentMethodId || undefined, topUpDate);
        setTopUpAmount('');
        setTopUpPaymentMethodId('');
        setTopUpReference('');
        setTopUpDate(new Date().toISOString().slice(0, 10));
      } finally {
        setSubmittingTopUp(false);
      }
    };

    return (
      <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Billing</h1>
          <p className="text-gray-600 dark:text-gray-400">Review your account balance and billing history.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
            <p className="text-sm text-gray-500 dark:text-gray-400">Approved balance</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{currencyFormatter(approvedBalance)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">Pending approval</p>
            <p className="mt-1 text-2xl font-bold text-amber-900 dark:text-amber-100">{currencyFormatter(pendingTopUpAmount)}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/20">
            <p className="text-sm text-blue-700 dark:text-blue-300">Theoretical balance</p>
            <p className="mt-1 text-2xl font-bold text-blue-900 dark:text-blue-100">{currencyFormatter(theoreticalBalance)}</p>
          </div>
        </div>

        <form onSubmit={handleTopUpSubmit} className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Add funds</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Submitted funds appear as pending until an admin approves the payment.</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(9rem,0.7fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Amount</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={topUpAmount}
                onChange={event => setTopUpAmount(event.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment method</span>
              <select
                value={topUpPaymentMethodId}
                onChange={event => setTopUpPaymentMethodId(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
              >
                <option value="">Select method</option>
                {accountTopUpPaymentMethods.map(method => (
                  <option key={method.id} value={method.id}>{method.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Payment date</span>
              <input
                type="date"
                value={topUpDate}
                onChange={event => setTopUpDate(event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Reference or note</span>
              <input
                type="text"
                value={topUpReference}
                onChange={event => setTopUpReference(event.target.value)}
                placeholder="Receipt number, bank reference..."
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:text-gray-100"
              />
            </label>
            <button
              type="submit"
              disabled={submittingTopUp || !Number(topUpAmount) || Number(topUpAmount) <= 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-[#363b45]"
            >
              <Plus className="h-4 w-4" />
              Add funds
            </button>
          </div>
        </form>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36]">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Billing history</h2>
          </div>
          {transactions.length === 0 ? (
            <p className="p-5 text-sm text-gray-500 dark:text-gray-400">No billing transactions recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-[#2c2f36]">
              {transactions.map(transaction => {
                const signedAmount = getSignedTransactionAmount(transaction.type, transaction.amount);
                return (
                  <div key={transaction.id} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{transaction.description || transaction.type}</p>
                        {transaction.verifiedStatus !== 'verified' && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            transaction.verifiedStatus === 'pending'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                              : 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                          }`}>
                            {transaction.verifiedStatus}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {new Date(transaction.createdAt).toLocaleDateString(dateLocale)}
                        {transaction.paymentMethodName ? ` · ${transaction.paymentMethodName}` : ''}
                      </p>
                    </div>
                    <p className={`text-sm font-semibold ${signedAmount >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                      {signedAmount >= 0 ? '+' : '-'}{currencyFormatter(Math.abs(signedAmount))}
                    </p>
                  </div>
                );
              })}
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
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Financial Dashboard</h1>
        <p className="text-gray-600">Manage organisation transactions and pilot accounts</p>
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
