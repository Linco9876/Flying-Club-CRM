import React, { useState } from 'react';
import { User, ArrowUpDown, Eye, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { AccountHistoryModal } from './AccountHistoryModal';

type BillingHook = ReturnType<typeof useBillingAccounts>;

interface TopUpModalProps {
  userId: string;
  userName: string;
  onClose: () => void;
  onConfirm: (amount: number, description: string, paymentMethodId?: string, transactionDate?: string) => Promise<void>;
  paymentMethods: { id: string; name: string; active: boolean; allowAccountTopup?: boolean }[];
}

const TopUpModal: React.FC<TopUpModalProps> = ({ userId, userName, onClose, onConfirm, paymentMethods }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('Account top-up');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed < 1000 || parsed % 1000 !== 0) return;
    setSaving(true);
    try {
      await onConfirm(parsed, description, paymentMethodId || undefined, transactionDate);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Add Top-up</h3>
          <p className="text-sm text-gray-500 mt-0.5">{userName}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
            <input
              type="number"
              min="1000"
              step="1000"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="1000"
              required
              autoFocus
            />
          </div>
          <p className="text-xs text-gray-500">Prepaid clients need positive Xero credit. Top-ups can only be recorded in $1,000 increments.</p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Top-up Date</label>
            <input
              type="date"
              value={transactionDate}
              onChange={e => setTransactionDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="mt-1 text-xs text-gray-500">Use this to backdate historical payments.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
            <select
              value={paymentMethodId}
              onChange={e => setPaymentMethodId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Select —</option>
              {paymentMethods.filter(pm => pm.active && pm.allowAccountTopup !== false).map(pm => (
                <option key={pm.id} value={pm.id}>{pm.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !Number(amount) || Number(amount) < 1000 || Number(amount) % 1000 !== 0}
              className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Adding...' : 'Add Top-up'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const PilotAccountsTab: React.FC<{ billing: BillingHook }> = ({ billing }) => {
  const { pilotAccounts, loading, addTopUp, xeroConnected } = billing;
  const { paymentMethods } = useBillingSettings();
  const [sortField, setSortField] = useState<'name' | 'balance' | 'unpaidFlightCount'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [topUpUserId, setTopUpUserId] = useState<string | null>(null);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = [...pilotAccounts].sort((a, b) => {
    let av: any = a[sortField];
    let bv: any = b[sortField];
    if (sortField === 'name') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalBalance = pilotAccounts.reduce((s, a) => s + a.balance, 0);
  const lowBalanceCount = pilotAccounts.filter(a => a.balance < 100 && a.balance >= 0).length;
  const negativeCount = pilotAccounts.filter(a => a.balance < 0).length;
  const totalUnpaidFlights = pilotAccounts.reduce((s, a) => s + a.unpaidFlightCount, 0);

  const SortIcon = ({ field }: { field: typeof sortField }) => (
    <ArrowUpDown className={`h-3.5 w-3.5 ml-1 ${sortField === field ? 'text-blue-500' : 'text-gray-300'}`} />
  );

  const topUpAccount = pilotAccounts.find(a => a.userId === topUpUserId);
  const selectedAccount = pilotAccounts.find(a => a.userId === selectedUserId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Pilots</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{pilotAccounts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{xeroConnected ? 'Xero Credit Held' : 'Xero Credit Unavailable'}</p>
          <p className={`text-2xl font-bold mt-1 ${totalBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
            ${totalBalance.toFixed(2)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Low / Negative</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            <span className="text-amber-500">{lowBalanceCount}</span>
            <span className="text-gray-300 mx-1">/</span>
            <span className="text-red-500">{negativeCount}</span>
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Unpaid Flights</p>
          <p className={`text-2xl font-bold mt-1 ${totalUnpaidFlights > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
            {totalUnpaidFlights}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50">
                <th
                  className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                  onClick={() => handleSort('name')}
                >
                  <span className="flex items-center">Student <SortIcon field="name" /></span>
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</th>
                <th
                  className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                  onClick={() => handleSort('balance')}
                >
                  <span className="flex items-center">{xeroConnected ? 'Xero Credit' : 'Xero Credit'} <SortIcon field="balance" /></span>
                </th>
                <th
                  className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                  onClick={() => handleSort('unpaidFlightCount')}
                >
                  <span className="flex items-center">Unpaid Flights <SortIcon field="unpaidFlightCount" /></span>
                </th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Transactions</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">No pilots found</td>
                </tr>
              ) : (
                sorted.map(account => (
                  <tr key={account.userId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                          <User className="h-4 w-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-900">{account.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-500">{account.email}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className={`text-sm font-semibold ${
                        account.balance < 0 ? 'text-red-600' :
                        account.balance <= 0 ? 'text-amber-600' :
                        'text-green-600'
                      }`}>
                        ${account.balance.toFixed(2)}
                      </span>
                      {account.balance < 0 && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-red-500">
                          <AlertCircle className="h-3 w-3" /> Overdrawn
                        </span>
                      )}
                      {account.balance <= 0 && (
                        <span className="ml-2 text-xs text-amber-500">{xeroConnected ? 'Needs positive Xero credit' : 'Xero credit unavailable'}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {account.unpaidFlightCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          <AlertCircle className="h-3 w-3" />
                          {account.unpaidFlightCount} unpaid
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="h-3 w-3" /> All clear
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-600">
                      {account.totalTransactions}
                      {account.lastTransactionDate && (
                        <div className="text-xs text-gray-400">
                          Last: {new Date(account.lastTransactionDate).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTopUpUserId(account.userId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Top-up
                        </button>
                        <button
                          onClick={() => setSelectedUserId(account.userId)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          History
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top-up modal */}
      {topUpUserId && topUpAccount && (
        <TopUpModal
          userId={topUpUserId}
          userName={topUpAccount.name}
          paymentMethods={paymentMethods}
          onClose={() => setTopUpUserId(null)}
          onConfirm={(amount, description, pmId, transactionDate) => addTopUp(topUpUserId, amount, description, pmId, transactionDate, { autoVerify: true })}
        />
      )}

      {/* Account history modal */}
      {selectedUserId && selectedAccount && (
        <AccountHistoryModal
          isOpen
          userId={selectedUserId}
          userName={selectedAccount.name}
          userEmail={selectedAccount.email}
          currentBalance={selectedAccount.balance}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
};
