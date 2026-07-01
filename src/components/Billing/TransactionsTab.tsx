import React, { useState, useMemo } from 'react';
import { Download, Search, AlertCircle, TrendingUp, TrendingDown, Clock, XCircle, ShieldCheck, ShieldAlert, ShieldX, CreditCard, Loader2, FileText, ExternalLink } from 'lucide-react';
import { useBillingAccounts } from '../../hooks/useBillingAccounts';
import { writeStripeLoadingPage } from '../../utils/stripePopup';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';

type BillingHook = ReturnType<typeof useBillingAccounts>;

interface XeroMatchCandidate {
  id: string;
  kind: 'overpayment' | 'prepayment';
  amount: number;
  status: string;
  date: string | null;
  reference: string | null;
  exactAmount: boolean;
}

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

const getXeroInvoiceUrl = (invoiceId: string) =>
  `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(invoiceId)}`;

const SplitPaymentModal: React.FC<{
  flightId: string;
  description: string;
  userName: string;
  totalAmount: number;
  amountPaid: number;
  amountRemaining: number;
  pilotBalance: number;
  onClose: () => void;
  onPilotAccountPayment: (flightLogId: string, amount: number) => Promise<void>;
  onStripeCheckout: (flightLogId: string, amount: number) => Promise<{ checkoutUrl: string }>;
  onSavedCardPayment: (flightLogId: string, amount: number) => Promise<unknown>;
}> = ({
  flightId,
  description,
  userName,
  totalAmount,
  amountPaid,
  amountRemaining,
  pilotBalance,
  onClose,
  onPilotAccountPayment,
  onStripeCheckout,
  onSavedCardPayment,
}) => {
  const [pilotAmount, setPilotAmount] = useState('');
  const [checkoutAmount, setCheckoutAmount] = useState(amountRemaining.toFixed(2));
  const [savedCardAmount, setSavedCardAmount] = useState(amountRemaining.toFixed(2));
  const [busyAction, setBusyAction] = useState<'pilot' | 'checkout' | 'card' | null>(null);

  const normaliseAmount = (value: string) => {
    const amount = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than $0');
    if (amount > amountRemaining + 0.005) throw new Error(`Amount cannot exceed the remaining $${amountRemaining.toFixed(2)}`);
    return amount;
  };

  const runAction = async (action: 'pilot' | 'checkout' | 'card') => {
    try {
      setBusyAction(action);
      if (action === 'pilot') {
        const amount = normaliseAmount(pilotAmount);
        await onPilotAccountPayment(flightId, amount);
        onClose();
        return;
      }

      if (action === 'checkout') {
        const amount = normaliseAmount(checkoutAmount);
        const checkoutWindow = window.open('about:blank', '_blank');
        if (checkoutWindow) {
          checkoutWindow.opener = null;
          writeStripeLoadingPage(checkoutWindow, {
            title: 'Opening secure checkout',
            message: 'Preparing the Stripe payment page for this flight charge.',
          });
        }
        try {
          const checkout = await onStripeCheckout(flightId, amount);
          if (checkoutWindow) {
            checkoutWindow.location.href = checkout.checkoutUrl;
          } else {
            window.location.href = checkout.checkoutUrl;
          }
          onClose();
        } catch (error) {
          checkoutWindow?.close();
          throw error;
        }
        return;
      }

      const amount = normaliseAmount(savedCardAmount);
      if (!window.confirm(`Charge ${userName}'s saved card $${amount.toFixed(2)}?`)) return;
      await onSavedCardPayment(flightId, amount);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Split payment failed');
    } finally {
      setBusyAction(null);
    }
  };

  const progress = totalAmount > 0 ? Math.min(100, (amountPaid / totalAmount) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Split Payment</h3>
          <p className="text-sm text-gray-500 mt-0.5">{userName}</p>
          <p className="text-sm text-gray-600 mt-2 line-clamp-2">{description}</p>
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Total</p>
                <p className="text-lg font-bold text-gray-900">${totalAmount.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Paid</p>
                <p className="text-lg font-bold text-green-700">${amountPaid.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Remaining</p>
                <p className="text-lg font-bold text-amber-700">${amountRemaining.toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-green-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <section className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-gray-900">Prepaid credit</h4>
                <p className="text-xs text-gray-500">Available verified prepaid balance: ${pilotBalance.toFixed(2)}</p>
              </div>
              <button
                type="button"
                onClick={() => setPilotAmount(Math.min(pilotBalance, amountRemaining).toFixed(2))}
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                Use available
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={pilotAmount}
                onChange={event => setPilotAmount(event.target.value)}
                placeholder="0.00"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={busyAction !== null || !pilotAmount}
                onClick={() => runAction('pilot')}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busyAction === 'pilot' ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900">Stripe checkout link</h4>
            <p className="text-xs text-gray-500">Use this for one card now, or repeat it later for a second card.</p>
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={checkoutAmount}
                onChange={event => setCheckoutAmount(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={busyAction !== null || !checkoutAmount}
                onClick={() => runAction('checkout')}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {busyAction === 'checkout' ? 'Opening...' : 'Open Stripe'}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 p-4">
            <h4 className="text-sm font-semibold text-gray-900">Saved Stripe card</h4>
            <p className="text-xs text-gray-500">Only works if the member has saved a card and accepted the card-on-file authority.</p>
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={savedCardAmount}
                onChange={event => setSavedCardAmount(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                disabled={busyAction !== null || !savedCardAmount}
                onClick={() => runAction('card')}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {busyAction === 'card' ? 'Charging...' : 'Charge'}
              </button>
            </div>
          </section>
        </div>

        <div className="flex justify-end border-t border-gray-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const PaymentChoiceModal: React.FC<{
  row: {
    flightLogId: string | null;
    userId: string;
    userName: string;
    description: string;
    totalAmount: number | null;
    amount: number | null;
    amountPaid: number;
    amountRemaining: number | null;
  };
  charging: boolean;
  creatingLink: boolean;
  onClose: () => void;
  onChargeCard: () => Promise<void>;
  onStripeLink: () => Promise<void>;
  onSplitPayment: () => void;
}> = ({ row, charging, creatingLink, onClose, onChargeCard, onStripeLink, onSplitPayment }) => {
  const remaining = row.amountRemaining ?? Math.abs(row.amount ?? 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900">Take payment</h3>
          <p className="mt-1 text-sm text-gray-500">{row.userName}</p>
          <p className="mt-2 line-clamp-2 text-sm text-gray-600">{row.description}</p>
          <p className="mt-3 text-sm font-semibold text-amber-700">Remaining ${remaining.toFixed(2)}</p>
        </div>
        <div className="space-y-3 p-5">
          <button
            type="button"
            onClick={onChargeCard}
            disabled={charging}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-60"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-900">Charge saved card</span>
              <span className="block text-xs text-gray-500">Uses the member's stored Stripe card authority.</span>
            </span>
            {charging ? <Loader2 className="h-4 w-4 animate-spin text-indigo-600" /> : <CreditCard className="h-4 w-4 text-indigo-600" />}
          </button>
          <button
            type="button"
            onClick={onStripeLink}
            disabled={creatingLink}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-60"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-900">Open Stripe payment link</span>
              <span className="block text-xs text-gray-500">Pay now by card, including a different card.</span>
            </span>
            {creatingLink ? <Loader2 className="h-4 w-4 animate-spin text-blue-600" /> : <ExternalLink className="h-4 w-4 text-blue-600" />}
          </button>
          <button
            type="button"
            onClick={onSplitPayment}
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left hover:bg-gray-50"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-900">Split payment</span>
              <span className="block text-xs text-gray-500">Use prepaid credit plus one or more card payments.</span>
            </span>
            <CreditCard className="h-4 w-4 text-slate-700" />
          </button>
        </div>
        <div className="flex justify-end border-t border-gray-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Close
          </button>
        </div>
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

const XeroMatchModal: React.FC<{
  row: {
    id: string;
    userName: string;
    amount: number | null;
    description: string;
  };
  loading: boolean;
  candidates: XeroMatchCandidate[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onMatch: (candidate: XeroMatchCandidate) => Promise<void>;
}> = ({ row, loading, candidates, onClose, onRefresh, onMatch }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 p-5">
          <h3 className="text-base font-semibold text-gray-900">Match top-up to Xero credit</h3>
          <p className="mt-1 text-sm text-gray-500">{row.userName}</p>
          <p className="mt-2 text-sm text-gray-600">{row.description}</p>
          <p className="mt-1 text-sm font-semibold text-emerald-700">Amount ${Math.abs(row.amount ?? 0).toFixed(2)}</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-5">
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Refresh matches
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-gray-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Looking for matching Xero credits...
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
              No matching Xero overpayments or prepayments were found yet.
            </div>
          ) : (
            <div className="space-y-3">
              {candidates.map(candidate => (
                <div key={`${candidate.kind}-${candidate.id}`} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {candidate.kind === 'overpayment' ? 'Overpayment' : 'Prepayment'}
                        </span>
                        {candidate.exactAmount && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Exact amount
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-gray-900">${candidate.amount.toFixed(2)}</p>
                      <p className="text-xs text-gray-500">
                        {[candidate.date ? format(parseISO(candidate.date), 'dd MMM yyyy') : null, candidate.reference].filter(Boolean).join(' • ') || candidate.id}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onMatch(candidate)}
                      className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Link this credit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-gray-100 p-5">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const TransactionsTab: React.FC<{ billing: BillingHook }> = ({ billing }) => {
  const {
    transactions,
    unpaidFlights,
    pilotAccounts,
    loading,
    createFlightPaymentCheckout,
    chargeFlightSavedCard,
    applyPilotAccountPayment,
    verifyTransaction,
    rejectTransaction,
    retryTransactionXeroSync,
    listTransactionXeroMatches,
    matchTransactionToXeroCredit,
    unlinkTransactionXeroCredit,
  } = billing;
  const [searchTerm, setSearchTerm] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'credit' | 'debit' | 'unpaid'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [creatingStripeCheckoutId, setCreatingStripeCheckoutId] = useState<string | null>(null);
  const [chargingSavedCardId, setChargingSavedCardId] = useState<string | null>(null);
  const [xeroMatchRowId, setXeroMatchRowId] = useState<string | null>(null);
  const [xeroMatchLoading, setXeroMatchLoading] = useState(false);
  const [xeroMatchCandidates, setXeroMatchCandidates] = useState<XeroMatchCandidate[]>([]);
  const [paymentChoice, setPaymentChoice] = useState<{
    flightLogId: string | null;
    userId: string;
    userName: string;
    description: string;
    totalAmount: number | null;
    amount: number | null;
    amountPaid: number;
    amountRemaining: number | null;
  } | null>(null);
  const [splitPayment, setSplitPayment] = useState<{
    flightId: string;
    userId: string;
    userName: string;
    description: string;
    totalAmount: number;
    amountPaid: number;
    amountRemaining: number;
  } | null>(null);
  const itemsPerPage = 25;

  const allRows = useMemo(() => {
    const rows: Array<{
      id: string;
      flightLogId: string | null;
      userId: string;
      date: string;
      userName: string;
      userEmail: string;
      description: string;
      amount: number | null;
      totalAmount: number | null;
      amountPaid: number;
      amountRemaining: number | null;
      paymentMethod: string | null;
      balanceAfter: number | null;
      rowType: 'credit' | 'debit' | 'unpaid';
      paymentType: string | null;
      isTopup: boolean;
      verifiedStatus: 'pending' | 'verified' | 'rejected' | null;
      rejectionNotes: string | null;
      xeroSyncStatus: string | null;
      xeroSyncError: string | null;
      xeroInvoiceId: string | null;
      xeroInvoiceNumber: string | null;
      xeroPaymentId: string | null;
    }> = [
      ...transactions.map(t => ({
        id: t.id,
        flightLogId: null,
        userId: t.userId,
        date: t.createdAt,
        userName: t.userName,
        userEmail: t.userEmail,
        description: t.description,
        amount: t.type === 'topup' || t.type === 'refund' ? t.amount : -t.amount,
        totalAmount: null,
        amountPaid: 0,
        amountRemaining: null,
        paymentMethod: t.paymentMethodName,
        balanceAfter: t.balanceAfter,
        rowType: (t.type === 'topup' || t.type === 'refund' ? 'credit' : 'debit') as 'credit' | 'debit',
        paymentType: null,
        isTopup: t.type === 'topup',
        verifiedStatus: t.verifiedStatus,
        rejectionNotes: t.rejectionNotes,
        xeroSyncStatus: t.xeroSyncStatus,
        xeroSyncError: t.xeroSyncError,
        xeroInvoiceId: null,
        xeroInvoiceNumber: t.xeroBankTransactionId,
        xeroPaymentId: null,
      })),
      ...unpaidFlights.map(f => ({
        id: `unpaid-${f.id}`,
        flightLogId: f.id,
        userId: f.userId,
        date: f.flightDate,
        userName: f.userName,
        userEmail: f.userEmail,
        description: `Flight – ${f.aircraftRegistration} (${f.flightDuration.toFixed(1)} hrs)${f.flightTypeName ? ` · ${f.flightTypeName}` : ''}`,
        amount: f.amountRemaining != null ? -f.amountRemaining : null,
        totalAmount: f.calculatedCost,
        amountPaid: f.amountPaid,
        amountRemaining: f.amountRemaining,
        paymentMethod: null,
        balanceAfter: null,
        rowType: 'unpaid' as const,
        paymentType: f.paymentType,
        isTopup: false,
        verifiedStatus: null,
        rejectionNotes: null,
        xeroSyncStatus: f.xeroSyncStatus,
        xeroSyncError: f.xeroSyncError,
        xeroInvoiceId: f.xeroInvoiceId,
        xeroInvoiceNumber: f.xeroInvoiceNumber,
        xeroPaymentId: f.xeroPaymentId,
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
  const totalUnpaidValue = unpaidFlights.reduce((s, f) => s + (f.amountRemaining ?? f.calculatedCost ?? 0), 0);
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

  const loadXeroMatches = async (rowId: string) => {
    setXeroMatchLoading(true);
    try {
      const result = await listTransactionXeroMatches(rowId);
      setXeroMatchCandidates(result.candidates || []);
    } finally {
      setXeroMatchLoading(false);
    }
  };

  const handleOpenXeroMatch = async (rowId: string) => {
    setXeroMatchRowId(rowId);
    await loadXeroMatches(rowId);
  };

  const handleCreateStripeCheckout = async (flightLogId: string) => {
    const checkoutWindow = window.open('about:blank', '_blank');
    if (checkoutWindow) {
      checkoutWindow.opener = null;
      writeStripeLoadingPage(checkoutWindow, {
        title: 'Opening secure checkout',
        message: 'Preparing the Stripe payment page for this flight charge.',
      });
    }

    setCreatingStripeCheckoutId(flightLogId);
    try {
      const checkout = await createFlightPaymentCheckout(flightLogId);
      if (checkoutWindow) {
        checkoutWindow.location.href = checkout.checkoutUrl;
      } else {
        window.location.href = checkout.checkoutUrl;
      }
    } catch (error) {
      checkoutWindow?.close();
      throw error;
    } finally {
      setCreatingStripeCheckoutId(null);
    }
  };

  const handleCreateSplitStripeCheckout = async (flightLogId: string, amount: number) => {
    return createFlightPaymentCheckout(flightLogId, amount);
  };

  const handleChargeSavedCard = async (flightLogId: string) => {
    if (!window.confirm('Charge this member’s saved Stripe card for the confirmed flight amount?')) return;
    setChargingSavedCardId(flightLogId);
    try {
      await chargeFlightSavedCard(flightLogId);
    } finally {
      setChargingSavedCardId(null);
    }
  };

  const rejectingRow = rejectingId ? allRows.find(r => r.id === rejectingId) : null;
  const xeroMatchRow = xeroMatchRowId ? allRows.find(r => r.id === xeroMatchRowId) : null;

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
        if (row.xeroSyncStatus === 'matched' || row.xeroSyncStatus === 'synced') {
          return (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                Xero linked
              </span>
            </div>
          );
        }
        if (row.xeroSyncStatus === 'awaiting_match' || row.xeroSyncStatus === 'needs_review' || row.xeroSyncStatus === 'queued') {
          return (
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Xero pending
              </span>
            </div>
          );
        }
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
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'w-full' : ''}`}>
          {row.xeroInvoiceId && (
            <a
              href={getXeroInvoiceUrl(row.xeroInvoiceId)}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center justify-center gap-1 text-xs font-medium bg-sky-700 text-white rounded-lg hover:bg-sky-800 transition-colors ${
                compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
              }`}
              title={row.xeroInvoiceNumber ? `Open Xero invoice ${row.xeroInvoiceNumber}` : 'Open Xero invoice'}
            >
              <FileText className="h-3.5 w-3.5" />
              View Invoice
            </a>
          )}
          {row.paymentType?.toLowerCase().includes('stripe') && (
            <button
              onClick={() => setPaymentChoice(row)}
              className={`flex items-center justify-center gap-1 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors ${
                compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              Take Payment
            </button>
          )}
          {!row.xeroInvoiceId && (
            <span className={`flex items-center justify-center gap-1 text-xs font-medium text-gray-500 ${
              compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
            }`}>
              Awaiting Xero invoice
            </span>
          )}
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
      {row.isTopup && row.verifiedStatus === 'verified' && (
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'w-full' : ''}`}>
          {(row.xeroSyncStatus === 'awaiting_match' || row.xeroSyncStatus === 'needs_review' || row.xeroSyncStatus === 'queued' || !row.xeroSyncStatus) && (
            <>
              <button
                onClick={() => handleOpenXeroMatch(row.id)}
                className={`flex items-center justify-center gap-1 rounded-lg bg-sky-700 text-xs font-medium text-white hover:bg-sky-800 transition-colors ${
                  compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Match Xero
              </button>
              <button
                onClick={() => retryTransactionXeroSync(row.id)}
                className={`flex items-center justify-center gap-1 rounded-lg bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors ${
                  compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
                }`}
              >
                Retry
              </button>
            </>
          )}
          {(row.xeroSyncStatus === 'matched' || row.xeroSyncStatus === 'synced') && (
            <button
              onClick={() => unlinkTransactionXeroCredit(row.id)}
              className={`flex items-center justify-center gap-1 rounded-lg bg-gray-100 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors ${
                compact ? 'flex-1 px-3 py-2' : 'px-2.5 py-1.5'
              }`}
            >
              Unlink Xero
            </button>
          )}
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
                  {row.xeroInvoiceId && (
                    <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
                      Xero {row.xeroInvoiceNumber || 'synced'}
                    </span>
                  )}
                  {row.xeroSyncStatus === 'failed' && (
                    <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      Xero failed
                    </span>
                  )}
                  {row.paymentMethod && (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {row.paymentMethod}
                    </span>
                  )}
                </div>

                {(row.rowType === 'unpaid' || row.isTopup) && (
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
                        <div>
                          <p>{row.description}</p>
                          {row.xeroInvoiceId && (
                            <p className="mt-1 text-xs text-sky-700">Xero invoice {row.xeroInvoiceNumber || row.xeroInvoiceId}</p>
                          )}
                          {row.xeroSyncStatus === 'failed' && row.xeroSyncError && (
                            <p className="mt-1 text-xs text-red-600">{row.xeroSyncError}</p>
                          )}
                        </div>
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

      {paymentChoice && (
        <PaymentChoiceModal
          row={paymentChoice}
          charging={chargingSavedCardId === paymentChoice.flightLogId}
          creatingLink={creatingStripeCheckoutId === paymentChoice.flightLogId}
          onClose={() => setPaymentChoice(null)}
          onChargeCard={async () => {
            if (!paymentChoice.flightLogId) return;
            await handleChargeSavedCard(paymentChoice.flightLogId);
            setPaymentChoice(null);
          }}
          onStripeLink={async () => {
            if (!paymentChoice.flightLogId) return;
            await handleCreateStripeCheckout(paymentChoice.flightLogId);
            setPaymentChoice(null);
          }}
          onSplitPayment={() => {
            if (!paymentChoice.flightLogId) return;
            setSplitPayment({
              flightId: paymentChoice.flightLogId,
              userId: paymentChoice.userId,
              userName: paymentChoice.userName,
              description: paymentChoice.description,
              totalAmount: paymentChoice.totalAmount ?? Math.abs(paymentChoice.amount ?? 0),
              amountPaid: paymentChoice.amountPaid,
              amountRemaining: paymentChoice.amountRemaining ?? Math.abs(paymentChoice.amount ?? 0),
            });
            setPaymentChoice(null);
          }}
        />
      )}

      {splitPayment && (
        <SplitPaymentModal
          flightId={splitPayment.flightId}
          description={splitPayment.description}
          userName={splitPayment.userName}
          totalAmount={splitPayment.totalAmount}
          amountPaid={splitPayment.amountPaid}
          amountRemaining={splitPayment.amountRemaining}
          pilotBalance={pilotAccounts.find(account => account.userId === splitPayment.userId)?.balance ?? 0}
          onClose={() => setSplitPayment(null)}
          onPilotAccountPayment={applyPilotAccountPayment}
          onStripeCheckout={handleCreateSplitStripeCheckout}
          onSavedCardPayment={chargeFlightSavedCard}
        />
      )}

      {xeroMatchRow && (
        <XeroMatchModal
          row={xeroMatchRow}
          loading={xeroMatchLoading}
          candidates={xeroMatchCandidates}
          onClose={() => {
            setXeroMatchRowId(null);
            setXeroMatchCandidates([]);
          }}
          onRefresh={() => loadXeroMatches(xeroMatchRow.id)}
          onMatch={async candidate => {
            await matchTransactionToXeroCredit(xeroMatchRow.id, candidate.id, candidate.kind);
            setXeroMatchRowId(null);
            setXeroMatchCandidates([]);
          }}
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
