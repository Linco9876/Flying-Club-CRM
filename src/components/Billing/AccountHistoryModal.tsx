import React, { useState, useEffect } from 'react';
import { X, Download, AlertCircle, TrendingUp, TrendingDown, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

interface AccountHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  userEmail: string;
  currentBalance: number;
}

interface HistoryRow {
  id: string;
  flightLogId: string | null;
  date: string;
  description: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  rowType: 'credit' | 'debit' | 'unpaid';
  aircraftRegistration?: string;
  flightDuration?: number;
  paymentType?: string | null;
}

export const AccountHistoryModal: React.FC<AccountHistoryModalProps> = ({
  isOpen,
  onClose,
  userId,
  userName,
  userEmail,
  currentBalance,
}) => {
  const { markFlightPaid } = useBillingAccounts();
  const { paymentMethods } = useBillingSettings();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingPaid, setMarkingPaid] = useState<{ flightLogId: string; amount: number; paymentType: string | null } | null>(null);
  const [markPaymentMethodId, setMarkPaymentMethodId] = useState('');
  const [markSaving, setMarkSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !userId) return;
    fetchHistory();
  }, [isOpen, userId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const [txResult, flightResult] = await Promise.all([
        supabase
          .from('account_transactions')
          .select('id, type, amount, description, balance_after, created_at, payment_methods(name)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('flight_logs')
          .select('id, start_time, flight_duration, calculated_cost, payment_status, payment_type, aircraft!flight_logs_aircraft_id_fkey(registration), users!flight_logs_student_id_fkey(name, email), flight_types(name)')
          .eq('student_id', userId)
          .or('payment_status.is.null,payment_status.eq.unpaid')
          .order('start_time', { ascending: false }),
      ]);

      const txRows: HistoryRow[] = (txResult.data || []).map((t: any) => ({
        id: t.id,
        flightLogId: null,
        date: t.created_at,
        description: t.description ?? '',
        amount: (t.type === 'topup' || t.type === 'refund') ? parseFloat(t.amount) : -parseFloat(t.amount),
        paymentMethod: t.payment_methods?.name ?? null,
        balanceAfter: t.balance_after != null ? parseFloat(t.balance_after) : null,
        rowType: (t.type === 'topup' || t.type === 'refund' ? 'credit' : 'debit') as 'credit' | 'debit',
      }));

      const unpaidRows: HistoryRow[] = (flightResult.data || []).map((f: any) => ({
        id: `unpaid-${f.id}`,
        flightLogId: f.id,
        date: f.start_time,
        description: `Flight${f.flight_types?.name ? ` · ${f.flight_types.name}` : ''}`,
        amount: f.calculated_cost != null ? -parseFloat(f.calculated_cost) : 0,
        paymentMethod: null,
        balanceAfter: null,
        rowType: 'unpaid' as const,
        aircraftRegistration: f.aircraft?.registration,
        flightDuration: parseFloat(f.flight_duration ?? 0),
        paymentType: f.payment_type ?? null,
      }));

      const merged = [...txRows, ...unpaidRows].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      setRows(merged);
    } catch (err) {
      console.error('Error fetching account history:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!markingPaid || !markPaymentMethodId) return;
    const selected = paymentMethods.find(pm => pm.id === markPaymentMethodId);
    if (!selected) return;
    setMarkSaving(true);
    try {
      await markFlightPaid(markingPaid.flightLogId, selected.name);
      setMarkingPaid(null);
      setMarkPaymentMethodId('');
      await fetchHistory();
    } finally {
      setMarkSaving(false);
    }
  };

  const handleExport = () => {
    const csvRows = [
      ['Date', 'Description', 'Amount', 'Payment Method', 'Balance After', 'Status'],
      ...rows.map(r => [
        format(parseISO(r.date), 'dd/MM/yyyy HH:mm'),
        r.description + (r.aircraftRegistration ? ` (${r.aircraftRegistration})` : ''),
        r.amount.toFixed(2),
        r.paymentMethod ?? '',
        r.balanceAfter != null ? r.balanceAfter.toFixed(2) : '',
        r.rowType === 'unpaid' ? 'Unpaid' : r.rowType === 'credit' ? 'Top-up' : 'Payment',
      ]),
    ];
    const csv = csvRows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${userName.replace(/\s+/g, '-')}-account-history.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported');
  };

  if (!isOpen) return null;

  const totalCredits = rows.filter(r => r.rowType === 'credit').reduce((s, r) => s + Math.abs(r.amount), 0);
  const totalDebits = rows.filter(r => r.rowType === 'debit').reduce((s, r) => s + Math.abs(r.amount), 0);
  const unpaidCount = rows.filter(r => r.rowType === 'unpaid').length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Account History</h2>
            <p className="text-sm text-gray-500 mt-0.5">{userName} · {userEmail}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 bg-gray-50 border-b border-gray-100">
          <div className="px-6 py-4 text-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Balance</p>
            <p className={`text-xl font-bold mt-0.5 ${currentBalance < 0 ? 'text-red-600' : currentBalance < 100 ? 'text-amber-600' : 'text-gray-900'}`}>
              ${currentBalance.toFixed(2)}
            </p>
          </div>
          <div className="px-6 py-4 text-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Topped Up</p>
            <p className="text-xl font-bold text-green-600 mt-0.5">${totalCredits.toFixed(2)}</p>
          </div>
          <div className="px-6 py-4 text-center">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Charged</p>
            <p className="text-xl font-bold text-gray-800 mt-0.5">${totalDebits.toFixed(2)}</p>
          </div>
        </div>

        {unpaidCount > 0 && (
          <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{unpaidCount} unpaid flight{unpaidCount !== 1 ? 's' : ''} shown below. These have been flown but not yet paid.</span>
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-blue-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-400">No transactions yet</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-100">
              <thead>
                <tr className="text-left">
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Method</th>
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                  <th className="pb-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.id} className={`${row.rowType === 'unpaid' ? 'bg-amber-50/50' : ''}`}>
                    <td className="py-3 pr-4 whitespace-nowrap text-sm text-gray-600">
                      {format(parseISO(row.date), 'dd MMM yyyy')}
                      <div className="text-xs text-gray-400">{format(parseISO(row.date), 'HH:mm')}</div>
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-700">
                      <div className="flex items-start gap-1.5">
                        {row.rowType === 'unpaid' && <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                        {row.rowType === 'credit' && <TrendingUp className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />}
                        {row.rowType === 'debit' && <TrendingDown className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />}
                        <span>
                          {row.description}
                          {row.aircraftRegistration && (
                            <span className="text-gray-400 ml-1">({row.aircraftRegistration}{row.flightDuration ? `, ${row.flightDuration.toFixed(1)} hrs` : ''})</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-sm font-semibold">
                      <span className={
                        row.rowType === 'credit' ? 'text-green-600' :
                        row.rowType === 'unpaid' ? 'text-amber-600' :
                        'text-gray-800'
                      }>
                        {row.amount >= 0 ? '+' : ''}${Math.abs(row.amount).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-sm text-gray-500">
                      {row.paymentMethod ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap text-sm">
                      {row.balanceAfter != null ? (
                        <span className={row.balanceAfter < 0 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          ${row.balanceAfter.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        row.rowType === 'credit' ? 'bg-green-100 text-green-800' :
                        row.rowType === 'unpaid' ? 'bg-amber-100 text-amber-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {row.rowType === 'credit' ? 'Top-up' : row.rowType === 'unpaid' ? 'Unpaid' : 'Payment'}
                      </span>
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {row.rowType === 'unpaid' && row.flightLogId && (
                        markingPaid?.flightLogId === row.flightLogId ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={markPaymentMethodId}
                              onChange={e => setMarkPaymentMethodId(e.target.value)}
                              className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                              autoFocus
                            >
                              <option value="">— Method —</option>
                              {paymentMethods.filter(pm => pm.active).map(pm => (
                                <option key={pm.id} value={pm.id}>{pm.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={handleMarkPaid}
                              disabled={markSaving || !markPaymentMethodId}
                              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              {markSaving ? '...' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { setMarkingPaid(null); setMarkPaymentMethodId(''); }}
                              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const preselected = paymentMethods.find(pm => pm.name === row.paymentType);
                              setMarkingPaid({ flightLogId: row.flightLogId!, amount: Math.abs(row.amount), paymentType: row.paymentType ?? null });
                              setMarkPaymentMethodId(preselected?.id ?? '');
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <CheckCircle className="h-3 w-3" />
                            Mark Paid
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleExport}
            disabled={loading || rows.length === 0}
            className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white disabled:opacity-40 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
