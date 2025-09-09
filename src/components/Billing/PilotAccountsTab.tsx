import React, { useState } from 'react';
import { mockStudents } from '../../data/mockData';
import { User, ArrowUpDown, Eye } from 'lucide-react';
import { AccountHistoryModal } from './AccountHistoryModal';

interface PilotAccount {
  id: string;
  name: string;
  email: string;
  balance: number;
  lastTransactionDate: Date;
  totalTransactions: number;
}

export const PilotAccountsTab: React.FC = () => {
  const [sortField, setSortField] = useState<'name' | 'balance' | 'lastTransactionDate'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedAccount, setSelectedAccount] = useState<PilotAccount | null>(null);
  const [showAccountHistory, setShowAccountHistory] = useState(false);

  // Mock pilot accounts data
  const pilotAccounts: PilotAccount[] = mockStudents.map(student => ({
    id: student.id,
    name: student.name,
    email: student.email,
    balance: student.prepaidBalance,
    lastTransactionDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date within last 30 days
    totalTransactions: Math.floor(Math.random() * 20) + 5 // Random number of transactions
  }));

  const handleSort = (field: 'name' | 'balance' | 'lastTransactionDate') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAccounts = [...pilotAccounts].sort((a, b) => {
    let aValue: any = a[sortField];
    let bValue: any = b[sortField];

    if (sortField === 'name') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (sortField === 'lastTransactionDate') {
      aValue = aValue.getTime();
      bValue = bValue.getTime();
    }

    if (sortDirection === 'asc') {
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    } else {
      return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
    }
  });

  const handleViewAccount = (account: PilotAccount) => {
    setSelectedAccount(account);
    setShowAccountHistory(true);
  };

  const getBalanceColor = (balance: number) => {
    if (balance > 500) return 'text-green-600';
    if (balance > 100) return 'text-blue-600';
    if (balance > 0) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSortIcon = (field: string) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
    return (
      <ArrowUpDown 
        className={`h-4 w-4 ${sortDirection === 'asc' ? 'text-blue-600 rotate-180' : 'text-blue-600'}`} 
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <User className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Pilots</p>
              <p className="text-2xl font-bold text-gray-900">{pilotAccounts.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <User className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Balance</p>
              <p className="text-2xl font-bold text-gray-900">
                ${pilotAccounts.reduce((sum, account) => sum + account.balance, 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <User className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Low Balance</p>
              <p className="text-2xl font-bold text-gray-900">
                {pilotAccounts.filter(account => account.balance < 100).length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <User className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg Balance</p>
              <p className="text-2xl font-bold text-gray-900">
                ${(pilotAccounts.reduce((sum, account) => sum + account.balance, 0) / pilotAccounts.length).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Student Name</span>
                    {getSortIcon('name')}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('balance')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Account Balance</span>
                    {getSortIcon('balance')}
                  </div>
                </th>
                <th 
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('lastTransactionDate')}
                >
                  <div className="flex items-center space-x-1">
                    <span>Last Transaction</span>
                    {getSortIcon('lastTransactionDate')}
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Transactions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedAccounts.map(account => (
                <tr key={account.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="h-8 w-8 bg-blue-600 rounded-full flex items-center justify-center">
                        <User className="h-4 w-4 text-white" />
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">{account.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {account.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <span className={getBalanceColor(account.balance)}>
                      ${account.balance.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {account.lastTransactionDate.toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {account.totalTransactions}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => handleViewAccount(account)}
                      className="flex items-center space-x-1 text-blue-600 hover:text-blue-900"
                    >
                      <Eye className="h-4 w-4" />
                      <span>View History</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Account History Modal */}
      {selectedAccount && (
        <AccountHistoryModal
          isOpen={showAccountHistory}
          onClose={() => {
            setShowAccountHistory(false);
            setSelectedAccount(null);
          }}
          account={selectedAccount}
        />
      )}
    </div>
  );
};