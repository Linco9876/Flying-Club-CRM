import React, { useState, useMemo } from 'react';
import { Download, Search, AlertCircle, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

export const TransactionsTab: React.FC = () => {
  const { transactions, unpaidFlights, loading } = useBillingAccounts();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit' | 'unpaid'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 25;

  // Merge account transactions + unpaid flights into a unified list
  const allRows = useMemo(() => {
    const rows: Array<{
      id: string;
      date: string;
      userName: string;
      userEmail: string;
      description: string;
      amount: number | null;
      paymentMethod: string | null;
      balanceAfter: number | null;
      rowType: 'credit' | 'debit' | 'unpaid';
    }> = [
      ...transactions.map(t => ({
        id: t.id,
        date: t.createdAt,
        userName: t.userName,
        userEmail: t.userEmail,
        description: t.description,
        amount: t.type === 'credit' ? t.amount : -t.amount,
        paymentMethod: t.paymentMethodName,
        balanceAfter: t.balanceAfter,
        rowType: t.type as 'credit' | 'debit',
      })),
      ...unpaidFlights.map(f => ({
        id: `unpaid-${f.id}`,
        date: f.flightDate,
        userName: f.userName,
        userEmail: f.userEmail,
        description: `Flight – ${f.aircraftRegistration} (${f.flightDuration.toFixed(1)} hrs)${f.flightTypeName ? ` · ${f.flightTypeName}` : ''}`,
        amount: f.calculatedCost != null ? -f.calculatedCost : null,
        paymentMethod: null,
        balanceAfter: null,
        rowType: 'unpaid' as const,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return rows;
  }, [transactions, unpaidFlights]);

  const filtered = useMemo(() => {
    return allRows.filter(row => {
      const matchSearch =
        !searchTerm ||
        row.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.description.toLowerCase().includes(searchTerm.toLowerCase());
      const rowDate = new Date(row.date);
      const matchStart = !dateStart || rowDate >= new Date(dateStart);
      const matchEnd = !dateEnd || rowDate <= new Date(dateEnd + 'T23:59:59');
      const matchType = typeFilter === 'all' || row.rowType === typeFilter;
      return matchSearch && matchStart && matchEnd && matchType;
    });
  }, [allRows, searchTerm, dateStart, dateEnd, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage));
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalCredits = transactions.reduce((s, t) => t.type === 'credit' ? s + t.amount : s, 0);
  const totalDebits = transactions.reduce((s, t) => t.type === 'debit' ? s + t.amount : s, 0);
  const totalUnpaidValue = unpaidFlights.reduce((s, f) => s + (f.calculatedCost ?? 0), 0);

  const handleExport = () => {
    const rows = [
      ['Date', 'Student', 'Description', 'Amount', 'Payment Method', 'Balance After', 'Status'],
      ...filtered.map(r => [
        format(parseISO(r.date), 'dd/MM/yyyy HH:mm'),
        r.userName,
        r.description,
        r.amount != null ? r.amount.toFixed(2) : '',
        r.paymentMethod ?? '',
        r.balanceAfter != null ? r.balanceAfter.toFixed(2) : '',
        r.rowType === 'unpaid' ? 'Unpaid' : r.rowType === 'credit' ? 'Top-up' : 'Payment',
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported to CSV');
  };

  const rowBadge = (type: 'credit' | 'debit' | 'unpaid') => {
    if (type === 'credit') return 'bg-green-100 text-green-800';
    if (type === 'debit') return 'bg-blue-100 text-blue-800';
    return 'bg-amber-100 text-amber-800';
  };

  const rowLabel = (type: 'credit' | 'debit' | 'unpaid') => {
    if (type === 'credit') return 'Top-up';
    if (type === 'debit') return 'Payment';
    return 'Unpaid';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-2.5 bg-green-100 rounded-lg">
            <TrendingUp className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Credits</p>
            <p className="text-xl font-bold text-gray-900">${totalCredits.toFixed(2)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-2.5 bg-blue-100 rounded-lg">
            <TrendingDown className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Charged</p>
            <p className="text-xl font-bold text-gray-900">${totalDebits.toFixed(2)}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-center gap-4">
          <div className="p-2.5 bg-amber-100 rounded-lg">
            <Clock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Outstanding ({unpaidFlights.length} flights)
            </p>
            <p className="text-xl font-bold text-gray-900">${totalUnpaidValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              placeholder="Search student or description..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <input
            type="date"
            value={dateStart}
            onChange={e => { setDateStart(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="date"
            value={dateEnd}
            onChange={e => { setDateEnd(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value as any); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Types</option>
            <option value="credit">Top-ups only</option>
            <option value="debit">Payments only</option>
            <option value="unpaid">Unpaid flights</option>
          </select>
        </div>
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Student</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Method</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance After</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">
                    No transactions found
                  </td>
                </tr>
              ) : (
                paginated.map(row => (
                  <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${row.rowType === 'unpaid' ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-600">
                      {format(parseISO(row.date), 'dd MMM yyyy')}
                      <div className="text-xs text-gray-400">{format(parseISO(row.date), 'HH:mm')}</div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{row.userName}</div>
                      <div className="text-xs text-gray-400">{row.userEmail}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-700 max-w-xs">
                      <div className="flex items-start gap-1.5">
                        {row.rowType === 'unpaid' && (
                          <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                        )}
                        {row.description}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold">
                      {row.amount != null ? (
                        <span className={row.amount >= 0 ? 'text-green-600' : row.rowType === 'unpaid' ? 'text-amber-600' : 'text-gray-800'}>
                          {row.amount >= 0 ? '+' : ''}${Math.abs(row.amount).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs italic">TBD</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm text-gray-600">
                      {row.paymentMethod ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm">
                      {row.balanceAfter != null ? (
                        <span className={row.balanceAfter < 0 ? 'text-red-600 font-medium' : 'text-gray-700'}>
                          ${row.balanceAfter.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${rowBadge(row.rowType)}`}>
                        {rowLabel(row.rowType)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-5 py-3 flex items-center justify-between border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">Page {currentPage} of {totalPages}</p>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white disabled:opacity-40 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-white disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
