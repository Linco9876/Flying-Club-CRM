import React, { useState, useMemo } from 'react';
import { Download, Search, AlertCircle, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, ShieldCheck, ShieldAlert, ShieldX, CreditCard, Loader2 } from 'lucide-react';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

type BillingHook = ReturnType<typeof useBillingAccounts>;

const XERO_SALES_INVOICE_HEADERS = [
  '*ContactName',
  'EmailAddress',
  'POAddressLine1',
  'POAddressLine2',
  'POAddressLine3',
  'POAddressLine4',
  'POCity',
  'PORegion',
  'POPostalCode',
  'POCountry',
  '*InvoiceNumber',
  'Reference',
  '*InvoiceDate',
  '*DueDate',
  'InventoryItemCode',
  '*Description',
  '*Quantity',
  '*UnitAmount',
  'Discount',
  '*AccountCode',
  '*TaxType',
  'TrackingName1',
  'TrackingOption1',
  'TrackingName2',
  'TrackingOption2',
  'Currency',
  'BrandingTheme',
];

const escapeCsvValue = (value: string | number | null | undefined) => {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const makeInvoiceNumber = (rowId: string, index: number) => {
  const cleanId = rowId.replace(/^unpaid-/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  return `BFC-${format(new Date(), 'yyyyMMdd')}-${String(index + 1).padStart(3, '0')}${cleanId ? `-${cleanId}` : ''}`;
};

const MarkPaidModal: React.FC<{
  flightId: string;
  description: string;
  amount: number | null;
  preselectedPaymentType: string | null;
  paymentMethods: { id: string; name: string }[];
  onClose: () => void;
  onConfirm: (flightLogId: string, paymentType: string) => Promise<void>;
}> = ({ flightId, description, amount, preselectedPaymentType, paymentMethods, onClose, onConfirm }) => {
  const preselected = paymentMethods.find(pm => pm.name === preselectedPaymentType);
  const [paymentMethodId, setPaymentMethodId] = useState(preselected?.id ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentMethodId) return;
    const selected = paymentMethods.find(pm => pm.id === paymentMethodId);
    if (!selected) return;
    setSaving(true);
    try {
      await onConfirm(flightId, selected.name);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Mark as Paid</h3>
          <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{description}</p>
          {amount != null && (
            <p className="text-sm font-semibold text-gray-800 mt-1">${Math.abs(amount).toFixed(2)}</p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method <span className="text-red-500">*</span></label>
            <select
              value={paymentMethodId}
              onChange={e => setPaymentMethodId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            >
              <option value="">— Select —</option>
              {paymentMethods.filter(pm => pm.active).map(pm => (
                <option key={pm.id} value={pm.id}>{pm.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !paymentMethodId} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors">
              {saving ? 'Saving...' : 'Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const RejectModal: React.FC<{
  transactionId: string;
  userName: string;
  amount: number;
  description: string;
  onClose: () => void;
  onConfirm: (transactionId: string, notes: string) => Promise<void>;
}> = ({ transactionId, userName, amount, description, onClose, onConfirm }) => {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim()) return;
    setSaving(true);
    try {
      await onConfirm(transactionId, notes.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <XCircle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Reject Payment</h3>
              <p className="text-sm text-gray-500 mt-0.5">{userName} · ${amount.toFixed(2)}</p>
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3 bg-gray-50 rounded-lg px-3 py-2">{description}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason for rejection <span className="text-red-500">*</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Bank transfer reference not found, incorrect amount received..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              required
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">This note will be visible to the pilot.</p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !notes.trim()}
              className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {saving ? 'Rejecting...' : 'Reject & Reverse Balance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const TransactionsTab: React.FC<{ billing: BillingHook }> = ({ billing }) => {
  const { transactions, unpaidFlights, loading, markFlightPaid, createFlightPaymentCheckout, verifyTransaction, rejectTransaction } = billing;
  const { paymentMethods } = useBillingSettings();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit' | 'unpaid'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [markingPaid, setMarkingPaid] = useState<{ flightId: string; description: string; amount: number | null; paymentType: string | null } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [creatingStripeCheckoutId, setCreatingStripeCheckoutId] = useState<string | null>(null);
  const itemsPerPage = 25;

  const allRows = useMemo(() => {
    const rows: Array<{
      id: string;
      flightLogId: string | null;
      date: string;
      userName: string;
      userEmail: string;
      description: string;
      amount: number | null;
      paymentMethod: string | null;
      balanceAfter: number | null;
      rowType: 'credit' | 'debit' | 'unpaid';
      paymentType: string | null;
      isTopup: boolean;
      verifiedStatus: 'pending' | 'verified' | 'rejected' | null;
      rejectionNotes: string | null;
    }> = [
      ...transactions.map(t => ({
        id: t.id,
        flightLogId: null,
        date: t.createdAt,
        userName: t.userName,
        userEmail: t.userEmail,
        description: t.description,
        amount: t.type === 'topup' || t.type === 'refund' ? t.amount : -t.amount,
        paymentMethod: t.paymentMethodName,
        balanceAfter: t.balanceAfter,
        rowType: (t.type === 'topup' || t.type === 'refund' ? 'credit' : 'debit') as 'credit' | 'debit',
        paymentType: null,
        isTopup: t.type === 'topup',
        verifiedStatus: t.verifiedStatus,
        rejectionNotes: t.rejectionNotes,
      })),
      ...unpaidFlights.map(f => ({
        id: `unpaid-${f.id}`,
        flightLogId: f.id,
        date: f.flightDate,
        userName: f.userName,
        userEmail: f.userEmail,
        description: `Flight – ${f.aircraftRegistration} (${f.flightDuration.toFixed(1)} hrs)${f.flightTypeName ? ` · ${f.flightTypeName}` : ''}`,
        amount: f.calculatedCost != null ? -f.calculatedCost : null,
        paymentMethod: null,
        balanceAfter: null,
        rowType: 'unpaid' as const,
        paymentType: f.paymentType,
        isTopup: false,
        verifiedStatus: null,
        rejectionNotes: null,
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

  const totalCredits = transactions
    .filter(t => t.type === 'topup' || t.type === 'refund')
    .reduce((s, t) => s + t.amount, 0);
  const totalDebits = transactions
    .filter(t => t.type === 'flight_charge' || t.type === 'adjustment')
    .reduce((s, t) => s + t.amount, 0);
  const totalUnpaidValue = unpaidFlights.reduce((s, f) => s + (f.calculatedCost ?? 0), 0);
  const pendingCount = transactions.filter(t => t.type === 'topup' && t.verifiedStatus === 'pending').length;

  const handleExport = () => {
    const rows = [
      XERO_SALES_INVOICE_HEADERS,
      ...filtered.map((r, index) => [
        r.userName,
        r.userEmail,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'Australia',
        makeInvoiceNumber(r.id, index),
        [
          r.rowType === 'unpaid' ? 'Outstanding flight' : r.isTopup ? 'Account top-up' : 'CRM transaction',
          r.paymentMethod ? `Payment method: ${r.paymentMethod}` : null,
          r.balanceAfter != null ? `Balance after: $${r.balanceAfter.toFixed(2)}` : null,
        ].filter(Boolean).join(' | '),
        format(parseISO(r.date), 'dd/MM/yyyy'),
        format(parseISO(r.date), 'dd/MM/yyyy'),
        r.isTopup ? 'TOPUP' : r.rowType === 'unpaid' || r.rowType === 'debit' ? 'FLIGHT' : 'CRM',
        r.description,
        '1',
        r.amount != null ? Math.abs(r.amount).toFixed(2) : '',
        '',
        '200',
        'OUTPUT',
        'CRM Type',
        r.rowType === 'unpaid' ? 'Outstanding' : r.isTopup ? 'Top-up' : r.rowType === 'debit' ? 'Flight charge' : 'Credit',
        'Payment Status',
        r.rowType === 'unpaid' ? 'Outstanding' :
        r.isTopup ? (r.verifiedStatus === 'verified' ? 'Verified' : r.verifiedStatus === 'rejected' ? 'Rejected' : 'Pending') :
        'Recorded',
        'AUD',
        '',
      ]),
    ];
    const csv = rows.map(r => r.map(escapeCsvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xero-sales-invoices-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported Xero sales invoice CSV');
  };

  const handleVerify = async (id: string) => {
    setVerifyingId(id);
    try {
      await verifyTransaction(id);
    } finally {
      setVerifyingId(null);
    }
  };

  const handleCreateStripeCheckout = async (flightLogId: string) => {
    setCreatingStripeCheckoutId(flightLogId);
    try {
      const checkout = await createFlightPaymentCheckout(flightLogId);
      window.open(checkout.checkoutUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setCreatingStripeCheckoutId(null);
    }
  };

  const rejectingRow = rejectingId ? allRows.find(r => r.id === rejectingId) : null;

  const statusBadge = (row: typeof allRows[0]) => {
    if (row.rowType === 'unpaid') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          <AlertCircle className="h-3 w-3" /> Outstanding
        </span>
      );
    }
    if (row.isTopup) {
      if (row.verifiedStatus === 'verified') {
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <ShieldCheck className="h-3 w-3" /> Verified
          </span>
        );
      }
      if (row.verifiedStatus === 'rejected') {
        return (
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
              <ShieldX className="h-3 w-3" /> Rejected
            </span>
            {row.rejectionNotes && (
              <p className="text-xs text-red-600 max-w-[180px] leading-tight">{row.rejectionNotes}</p>
            )}
          </div>
        );
      }
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
          <ShieldAlert className="h-3 w-3" /> Unverified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        Payment
      </span>
    );
  };

  const rowActions = (row: typeof allRows[0], compact = false) => (
    <>
      {row.rowType === 'unpaid' && row.flightLogId && (
        <div className={`flex items-center gap-1.5 ${compact ? 'w-full' : ''}`}>
          {row.paymentType?.toLowerCase().includes('stripe') && (
            <button
              onClick={() => handleCreateStripeCheckout(row.flightLogId!)}
              disabled={creatingStripeCheckoutId === row.flightLogId}
              className={`flex items-center justify-center gap-1 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors ${
                compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
              }`}
            >
              {creatingStripeCheckoutId === row.flightLogId ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CreditCard className="h-3.5 w-3.5" />
              )}
              Stripe Link
            </button>
          )}
          <button
            onClick={() => setMarkingPaid({ flightId: row.flightLogId!, description: row.description, amount: row.amount, paymentType: row.paymentType })}
            className={`flex items-center justify-center gap-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors ${
              compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
            }`}
          >
            <CheckCircle className="h-3.5 w-3.5" />
            Mark Paid
          </button>
        </div>
      )}
      {row.isTopup && row.verifiedStatus === 'pending' && (
        <div className={`flex items-center gap-1.5 ${compact ? 'w-full' : ''}`}>
          <button
            onClick={() => handleVerify(row.id)}
            disabled={verifyingId === row.id}
            className={`flex items-center justify-center gap-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors ${
              compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {verifyingId === row.id ? '...' : 'Confirm'}
          </button>
          <button
            onClick={() => setRejectingId(row.id)}
            className={`flex items-center justify-center gap-1 text-xs font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors ${
              compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
            }`}
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </button>
        </div>
      )}
    </>
  );

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
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        <div className={`rounded-xl border shadow-sm p-5 flex items-center gap-4 ${pendingCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <div className={`p-2.5 rounded-lg ${pendingCount > 0 ? 'bg-amber-100' : 'bg-gray-100'}`}>
            <ShieldAlert className={`h-5 w-5 ${pendingCount > 0 ? 'text-amber-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Awaiting Verification</p>
            <p className={`text-xl font-bold mt-0.5 ${pendingCount > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{pendingCount}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,1fr)_150px_150px_170px] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
            <span className="relative block">
              <Search className="h-4 w-4 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                placeholder="Student or description"
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">From</span>
            <input
              type="date"
              value={dateStart}
              onChange={e => { setDateStart(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">To</span>
            <input
              type="date"
              value={dateEnd}
              onChange={e => { setDateEnd(e.target.value); setCurrentPage(1); }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Type</span>
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value as any); setCurrentPage(1); }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="credit">Top-ups only</option>
              <option value="debit">Charges only</option>
              <option value="unpaid">Outstanding flights</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          <button
            onClick={handleExport}
            className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors sm:w-auto sm:py-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export Xero CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="space-y-3 p-4 md:hidden">
          {paginated.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
              No transactions found
            </div>
          ) : (
            paginated.map(row => (
              <article
                key={row.id}
                className={`rounded-xl border p-4 shadow-sm ${
                  row.rowType === 'unpaid' ? 'border-amber-200 bg-amber-50/70' :
                  row.isTopup && row.verifiedStatus === 'pending' ? 'border-amber-200 bg-amber-50/50' :
                  row.isTopup && row.verifiedStatus === 'rejected' ? 'border-red-200 bg-red-50/50' :
                  'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      {format(parseISO(row.date), 'dd MMM yyyy')} - {format(parseISO(row.date), 'HH:mm')}
                    </p>
                    <h4 className="mt-1 truncate text-base font-semibold text-gray-900">{row.userName}</h4>
                    <p className="truncate text-xs text-gray-500">{row.userEmail}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {row.amount != null ? (
                      <p className={`text-base font-bold ${
                        row.isTopup && row.verifiedStatus === 'rejected' ? 'text-red-400 line-through' :
                        row.amount >= 0 ? 'text-green-600' :
                        row.rowType === 'unpaid' ? 'text-amber-700' :
                        'text-gray-900'
                      }`}>
                        {row.amount >= 0 ? '+' : '-'}${Math.abs(row.amount).toFixed(2)}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold italic text-gray-400">TBD</p>
                    )}
                    {row.balanceAfter != null && (
                      <p className={`text-xs ${row.balanceAfter < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        Balance ${row.balanceAfter.toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-gray-700">{row.description}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {statusBadge(row)}
                  {row.paymentMethod && (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {row.paymentMethod}
                    </span>
                  )}
                </div>

                {(row.rowType === 'unpaid' || (row.isTopup && row.verifiedStatus === 'pending')) && (
                  <div className="mt-3">
                    {rowActions(row, true)}
                  </div>
                )}
              </article>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
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
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-gray-400">
                    No transactions found
                  </td>
                </tr>
              ) : (
                paginated.map(row => (
                  <tr
                    key={row.id}
                    className={`hover:bg-gray-50/80 transition-colors ${
                      row.rowType === 'unpaid' ? 'bg-amber-50/40' :
                      row.isTopup && row.verifiedStatus === 'pending' ? 'bg-amber-50/20' :
                      row.isTopup && row.verifiedStatus === 'rejected' ? 'bg-red-50/20' :
                      ''
                    }`}
                  >
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
                        {row.rowType === 'unpaid' && <AlertCircle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
                        {row.description}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-sm font-semibold">
                      {row.amount != null ? (
                        <span className={
                          row.isTopup && row.verifiedStatus === 'rejected' ? 'text-red-400 line-through' :
                          row.amount >= 0 ? 'text-green-600' :
                          row.rowType === 'unpaid' ? 'text-amber-600' :
                          'text-gray-800'
                        }>
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
                      {statusBadge(row)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {rowActions(row)}
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

      {markingPaid && (
        <MarkPaidModal
          flightId={markingPaid.flightId}
          description={markingPaid.description}
          amount={markingPaid.amount}
          preselectedPaymentType={markingPaid.paymentType}
          paymentMethods={paymentMethods}
          onClose={() => setMarkingPaid(null)}
          onConfirm={markFlightPaid}
        />
      )}

      {rejectingId && rejectingRow && (
        <RejectModal
          transactionId={rejectingId}
          userName={rejectingRow.userName}
          amount={Math.abs(rejectingRow.amount ?? 0)}
          description={rejectingRow.description}
          onClose={() => setRejectingId(null)}
          onConfirm={rejectTransaction}
        />
      )}
    </div>
  );
};
