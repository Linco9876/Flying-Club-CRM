import React from 'react';
import { X, Download } from 'lucide-react';
import toast from 'react-hot-toast';

interface PilotAccount {
  id: string;
  name: string;
  email: string;
  balance: number;
  lastTransactionDate: Date;
  totalTransactions: number;
}

interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number;
  paymentType: string;
  balanceAfter: number;
  type: 'debit' | 'credit';
}

interface AccountHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: PilotAccount;
}

export const AccountHistoryModal: React.FC<AccountHistoryModalProps> = ({
  isOpen,
  onClose,
  account
}) => {
  if (!isOpen) return null;

  // Mock transaction history for the selected account
  const transactions: Transaction[] = [
    {
      id: '1',
      date: new Date('2024-01-25'),
      description: 'Flight Training - VH-ABC (1.5 hrs)',
      amount: -547.50,
      paymentType: 'prepaid',
      balanceAfter: account.balance + 547.50,
      type: 'debit'
    },
    {
      id: '2',
      date: new Date('2024-01-20'),
      description: 'Account Top-up',
      amount: 1000.00,
      paymentType: 'deposit',
      balanceAfter: account.balance + 1547.50,
      type: 'credit'
    },
    {
      id: '3',
      date: new Date('2024-01-15'),
      description: 'Solo Flight - VH-DEF (1.2 hrs)',
      amount: -312.00,
      paymentType: 'prepaid',
      balanceAfter: account.balance + 859.50,
      type: 'debit'
    },
    {
      id: '4',
      date: new Date('2024-01-10'),
      description: 'Initial Deposit',
      amount: 850.00,
      paymentType: 'deposit',
      balanceAfter: account.balance + 1171.50,
      type: 'credit'
    }
  ];

  const handleExport = () => {
    toast.success(`Exporting ${account.name}'s transaction history...`);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Account History</h2>
            <p className="text-gray-600">{account.name} - {account.email}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Account Summary */}
        <div className="p-6 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-600">Current Balance</p>
              <p className="text-2xl font-bold text-blue-600">${account.balance.toFixed(2)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-600">Total Transactions</p>
              <p className="text-2xl font-bold text-gray-900">{account.totalTransactions}</p>
            </div>
            <div className="bg-white p-4 rounded-lg">
              <p className="text-sm font-medium text-gray-600">Last Transaction</p>
              <p className="text-2xl font-bold text-gray-900">{account.lastTransactionDate.toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Transaction History</h3>
              <button
                onClick={handleExport}
                className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>Export</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Payment Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Balance After
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map(transaction => (
                    <tr key={transaction.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {transaction.date.toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {transaction.description}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <span className={transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {transaction.amount >= 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                        {transaction.paymentType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        ${transaction.balanceAfter.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};