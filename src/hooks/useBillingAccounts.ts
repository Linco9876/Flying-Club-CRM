import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';
import { fetchAllMemberXeroBalances, fetchUserXeroBalance } from '../lib/xeroMemberBalance';

export interface AccountTransaction {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: 'topup' | 'flight_charge' | 'refund' | 'adjustment';
  amount: number;
  description: string;
  flightLogId: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  balanceAfter: number | null;
  createdAt: string;
  verifiedStatus: 'pending' | 'verified' | 'rejected';
  rejectionNotes: string | null;
}

export interface UnpaidFlight {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  aircraftRegistration: string;
  flightDate: string;
  flightDuration: number;
  calculatedCost: number | null;
  amountPaid: number;
  amountRemaining: number | null;
  flightTypeId: string | null;
  flightTypeName: string | null;
  paymentType: string | null;
  xeroSyncStatus: string | null;
  xeroSyncError: string | null;
  xeroInvoiceId: string | null;
  xeroInvoiceNumber: string | null;
  xeroPaymentId: string | null;
}

export interface PilotAccount {
  userId: string;
  name: string;
  email: string;
  balance: number;
  lastTransactionDate: string | null;
  totalTransactions: number;
  unpaidFlightCount: number;
}

export const useBillingAccounts = () => {
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [unpaidFlights, setUnpaidFlights] = useState<UnpaidFlight[]>([]);
  const [pilotAccounts, setPilotAccounts] = useState<PilotAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [minimumPrepaidPack, setMinimumPrepaidPack] = useState(1000);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchTransactions(), fetchUnpaidFlights(), fetchPilotAccounts()]);
    setLoading(false);
  };

  const fetchTransactions = async () => {
    try {
      const { data, error } = await supabase
        .from('account_transactions')
        .select(`
          id,
          user_id,
          type,
          amount,
          description,
          flight_log_id,
          payment_method_id,
          balance_after,
          created_at,
          verified_status,
          rejection_notes,
          users!account_transactions_user_id_fkey(name, email),
          payment_methods(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setTransactions(
        (data || []).map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          userName: row.users?.name ?? 'Unknown',
          userEmail: row.users?.email ?? '',
          type: row.type,
          amount: parseFloat(row.amount ?? 0),
          description: row.description ?? '',
          flightLogId: row.flight_log_id ?? null,
          paymentMethodId: row.payment_method_id ?? null,
          paymentMethodName: row.payment_methods?.name ?? null,
          balanceAfter: row.balance_after != null ? parseFloat(row.balance_after) : null,
          createdAt: row.created_at,
          verifiedStatus: row.verified_status ?? 'pending',
          rejectionNotes: row.rejection_notes ?? null,
        }))
      );
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  };

const fetchUnpaidFlights = async () => {
    try {
      const { data, error } = await supabase
        .from('flight_logs')
        .select(`
          id,
          student_id,
          start_time,
          flight_duration,
          calculated_cost,
          flight_type_id,
          payment_status,
          payment_type,
          xero_sync_status,
          xero_sync_error,
          xero_invoice_id,
          xero_invoice_number,
          xero_payment_id,
          booking:booking_id(
            is_guest_booking,
            guest_name,
            guest_email
          ),
          aircraft!flight_logs_aircraft_id_fkey(registration),
          users!flight_logs_student_id_fkey(name, email),
          flight_types(name)
        `)
        .or('payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.pending')
        .order('start_time', { ascending: false });

      if (error) throw error;

      const flightIds = (data || []).map((row: any) => row.id);
      const paidByFlight: Record<string, number> = {};
      if (flightIds.length > 0) {
        const { data: paymentRows, error: paymentsError } = await supabase
          .from('account_transactions')
          .select('flight_log_id, amount, type, verified_status')
          .eq('type', 'flight_charge')
          .eq('verified_status', 'verified')
          .in('flight_log_id', flightIds);

        if (paymentsError) throw paymentsError;
        (paymentRows || []).forEach((tx: any) => {
          const flightId = tx.flight_log_id;
          paidByFlight[flightId] = (paidByFlight[flightId] ?? 0) + parseFloat(tx.amount ?? 0);
        });
      }

      setUnpaidFlights(
        (data || []).map((row: any) => {
          const calculatedCost = row.calculated_cost != null ? parseFloat(row.calculated_cost) : null;
          const amountPaid = paidByFlight[row.id] ?? 0;
          const amountRemaining = calculatedCost == null ? null : Math.max(0, Math.round((calculatedCost - amountPaid + Number.EPSILON) * 100) / 100);
          const booking = Array.isArray(row.booking) ? row.booking[0] : row.booking;
          const isGuestBooking = Boolean(booking?.is_guest_booking);
          return {
          id: row.id,
          userId: row.student_id,
          userName: isGuestBooking ? (booking?.guest_name ?? 'Guest') : (row.users?.name ?? 'Unknown'),
          userEmail: isGuestBooking ? (booking?.guest_email ?? '') : (row.users?.email ?? ''),
          aircraftRegistration: row.aircraft?.registration ?? 'Unknown',
          flightDate: row.start_time,
          flightDuration: parseFloat(row.flight_duration ?? 0),
          calculatedCost,
          amountPaid,
          amountRemaining,
          flightTypeId: row.flight_type_id ?? null,
          flightTypeName: row.flight_types?.name ?? null,
          paymentType: row.payment_type ?? null,
          xeroSyncStatus: row.xero_sync_status ?? null,
          xeroSyncError: row.xero_sync_error ?? null,
          xeroInvoiceId: row.xero_invoice_id ?? null,
          xeroInvoiceNumber: row.xero_invoice_number ?? null,
          xeroPaymentId: row.xero_payment_id ?? null,
        };
      })
      );
    } catch (err) {
      console.error('Error fetching unpaid flights:', err);
    }
  };

  const fetchPilotAccounts = async () => {
    try {
      // Get all users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, email')
        .neq('portal_access_scope', 'guest_placeholder')
        .order('name');

      if (usersError) throw usersError;

      // Compute balance from verified transactions:
      // verified topups/refunds add, flight_charges/adjustments subtract
      const { data: txAll, error: txError } = await supabase
        .from('account_transactions')
        .select('user_id, type, amount, verified_status, created_at')
        .order('created_at', { ascending: false });

      if (txError) throw txError;

      const balanceMap: Record<string, number> = {};
      const txByUser: Record<string, { count: number; last: string }> = {};

      (txAll || []).forEach((tx: any) => {
        const uid = tx.user_id;
        if (!txByUser[uid]) txByUser[uid] = { count: 0, last: tx.created_at };
        txByUser[uid].count += 1;
      });

      try {
        const xeroData = await fetchAllMemberXeroBalances();
        setXeroConnected(Boolean(xeroData.connected));
        setMinimumPrepaidPack(Number(xeroData.minimumPrepaidPack ?? 1000));
        (xeroData.balances || []).forEach((account) => {
          if (account.userId) {
            balanceMap[account.userId] = Number(account.availableCredit ?? 0);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/not authorised|only staff/i.test(message)) {
          const self = await fetchUserXeroBalance((await supabase.auth.getUser()).data.user?.id || '');
          setXeroConnected(Boolean(self.connected));
          setMinimumPrepaidPack(Number(self.minimumPrepaidPack ?? 1000));
          if (self.userId) {
            balanceMap[self.userId] = Number(self.availableCredit ?? 0);
          }
        } else {
          throw error;
        }
      }

      // Get unpaid flight counts per user
      const { data: unpaid, error: unpaidError } = await supabase
        .from('flight_logs')
        .select('student_id')
        .or('payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.pending');

      if (unpaidError) throw unpaidError;

      const unpaidByUser: Record<string, number> = {};
      (unpaid || []).forEach((f: any) => {
        unpaidByUser[f.student_id] = (unpaidByUser[f.student_id] ?? 0) + 1;
      });

      setPilotAccounts(
        (users || []).map((u: any) => ({
          userId: u.id,
          name: u.name,
          email: u.email,
          balance: balanceMap[u.id] ?? 0,
          lastTransactionDate: txByUser[u.id]?.last ?? null,
          totalTransactions: txByUser[u.id]?.count ?? 0,
          unpaidFlightCount: unpaidByUser[u.id] ?? 0,
        }))
      );
    } catch (err) {
      console.error('Error fetching pilot accounts:', err);
    }
  };

  const addTopUp = async (userId: string, amount: number, description: string, paymentMethodId?: string, transactionDate?: string) => {
    try {
      const createdAt = transactionDate
        ? new Date(`${transactionDate}T12:00:00`).toISOString()
        : new Date().toISOString();

      // Insert as pending — balance is NOT applied until an admin verifies the payment
      const { error: txError } = await supabase
        .from('account_transactions')
        .insert({
          user_id: userId,
          type: 'topup',
          amount,
          description: description || 'Account top-up',
          payment_method_id: paymentMethodId ?? null,
          created_at: createdAt,
          balance_after: null, // set when verified
          verified_status: 'pending',
        });

      if (txError) throw txError;

      toast.success('Top-up recorded — awaiting verification');
      await fetchAll();
    } catch (err) {
      console.error('Error adding top-up:', err);
      toast.error('Failed to add top-up');
      throw err;
    }
  };

  const getPilotAccountPaymentMethodId = async () => {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('id,name')
      .eq('active', true);
    if (error) throw error;
    return (data || []).find((method: any) => {
      const name = String(method.name || '').toLowerCase();
      return name.includes('pilot account') || name.includes('pre-paid') || name.includes('prepaid');
    })?.id ?? null;
  };

  const updateFlightPaidIfSettled = async (flightLogId: string, paymentType = 'Split payment') => {
    const { data: flightLog, error: flightError } = await supabase
      .from('flight_logs')
      .select('calculated_cost')
      .eq('id', flightLogId)
      .maybeSingle();
    if (flightError) throw flightError;
    const cost = parseFloat(flightLog?.calculated_cost ?? 0);
    if (!Number.isFinite(cost) || cost <= 0) return;

    const { data: txRows, error: txError } = await supabase
      .from('account_transactions')
      .select('amount')
      .eq('flight_log_id', flightLogId)
      .eq('type', 'flight_charge')
      .eq('verified_status', 'verified');
    if (txError) throw txError;

    const paid = (txRows || []).reduce((sum: number, tx: any) => sum + parseFloat(tx.amount ?? 0), 0);
    await supabase
      .from('flight_logs')
      .update({
        payment_status: paid + 0.005 >= cost ? 'paid' : 'pending',
        payment_type: paid + 0.005 >= cost ? paymentType : 'Split payment',
      })
      .eq('id', flightLogId);
  };

  const markFlightPaid = async (flightLogId: string, paymentType: string) => {
    try {
      const { error } = await supabase
        .from('flight_logs')
        .update({ payment_status: 'paid', payment_type: paymentType })
        .eq('id', flightLogId);

      if (error) throw error;

      toast.success('Flight marked as paid');
      await fetchAll();
    } catch (err) {
      console.error('Error marking flight paid:', err);
      toast.error('Failed to mark flight as paid');
      throw err;
    }
  };

  const createFlightPaymentCheckout = async (flightLogId: string, amount?: number) => {
    try {
      const returnUrl = `${window.location.origin}/billing`;
      const { data, error } = await supabase.functions.invoke('create-flight-payment-checkout', {
        body: {
          flightLogId,
          amount,
          successUrl: `${returnUrl}?stripe_flight=success`,
          cancelUrl: `${returnUrl}?stripe_flight=cancelled`,
        },
      });

      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to create Stripe payment link'));
      if (!data?.checkoutUrl) throw new Error('Stripe checkout did not return a payment link');

      toast.success('Stripe checkout link ready');
      await fetchAll();
      return data as { checkoutUrl: string; sessionId: string; flightLogId: string };
    } catch (err) {
      console.error('Error creating Stripe flight payment checkout:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create Stripe payment link');
      throw err;
    }
  };

  const chargeFlightSavedCard = async (flightLogId: string, amount?: number) => {
    try {
      const { data, error } = await supabase.functions.invoke('charge-flight-saved-card', {
        body: { flightLogId, amount },
      });

      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to charge saved card'));

      if ((data as any)?.ok) {
        toast.success('Saved card charged and flight marked paid');
      } else if ((data as any)?.requiresAction) {
        toast.error('The cardholder needs to authenticate this card payment');
      } else {
        toast('Stripe payment is pending confirmation');
      }
      await fetchAll();
      return data as { ok?: boolean; status?: string; paymentIntentId?: string; requiresAction?: boolean };
    } catch (err) {
      console.error('Error charging saved card:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to charge saved card');
      throw err;
    }
  };

  const syncFlightInvoiceToXero = async (flightLogId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'sync-flight-invoice', flightLogId },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to sync Xero invoice'));
      toast.success(`Xero invoice ${((data as any)?.invoiceNumber || (data as any)?.invoiceId || '').toString().trim() || 'created'}`);
      await fetchAll();
      return data;
    } catch (err) {
      console.error('Error syncing Xero invoice:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync Xero invoice');
      throw err;
    }
  };

  const applyXeroPaymentsForFlight = async (flightLogId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'apply-flight-payments', flightLogId },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to apply Xero payments'));
      const count = Array.isArray((data as any)?.payments) ? (data as any).payments.length : 0;
      toast.success(count > 0 ? `${count} Xero payment${count === 1 ? '' : 's'} applied` : 'No eligible payments to apply');
      await fetchAll();
      return data;
    } catch (err) {
      console.error('Error applying Xero payments:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to apply Xero payments');
      throw err;
    }
  };

  const applyPilotAccountPayment = async (flightLogId: string, amount: number) => {
    try {
      const paymentAmount = Math.round((amount + Number.EPSILON) * 100) / 100;
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        throw new Error('Enter a payment amount greater than $0');
      }

      const { data: flightLog, error: flightError } = await supabase
        .from('flight_logs')
        .select('id, student_id, start_time, calculated_cost, payment_status, aircraft!flight_logs_aircraft_id_fkey(registration)')
        .eq('id', flightLogId)
        .maybeSingle();
      if (flightError) throw flightError;
      if (!flightLog) throw new Error('Flight log not found');
      if (flightLog.payment_status === 'paid') throw new Error('This flight is already paid');

      const { data: txRows, error: txError } = await supabase
        .from('account_transactions')
        .select('amount')
        .eq('flight_log_id', flightLogId)
        .eq('type', 'flight_charge')
        .eq('verified_status', 'verified');
      if (txError) throw txError;

      const cost = parseFloat(flightLog.calculated_cost ?? 0);
      const paid = (txRows || []).reduce((sum: number, tx: any) => sum + parseFloat(tx.amount ?? 0), 0);
      const remaining = Math.max(0, Math.round((cost - paid + Number.EPSILON) * 100) / 100);
      if (paymentAmount > remaining + 0.005) {
        throw new Error(`Payment is greater than the remaining balance of $${remaining.toFixed(2)}`);
      }

      const xeroBalance = await fetchUserXeroBalance(flightLog.student_id);
      if (!xeroBalance.connected) {
        throw new Error('Prepaid account payments require Xero to be connected for this club.');
      }
      const currentBalance = Number(xeroBalance.overpaymentCredit ?? xeroBalance.availableCredit ?? 0);
      const minimumPack = Number(xeroBalance.minimumPrepaidPack ?? minimumPrepaidPack);
      if (currentBalance + 0.005 < minimumPack) {
        throw new Error(`Prepaid is locked until the member has at least $${minimumPack.toFixed(2)} sitting in Xero overpayments. If they do not have enough, add a $${minimumPack.toFixed(2)} package first.`);
      }
      if (paymentAmount > currentBalance + 0.005) {
        throw new Error(`This member only has $${currentBalance.toFixed(2)} available in Xero overpayments, so prepaid cannot cover this amount. Add a $${minimumPack.toFixed(2)} package first.`);
      }

      const newBalance = Math.round((currentBalance - paymentAmount + Number.EPSILON) * 100) / 100;
      const paymentMethodId = await getPilotAccountPaymentMethodId();
      const aircraft = Array.isArray(flightLog.aircraft) ? flightLog.aircraft[0] : flightLog.aircraft;
      const description = `Pilot account split payment - ${aircraft?.registration ?? 'aircraft'} flight on ${new Date(flightLog.start_time).toLocaleDateString('en-AU')}`;

      const { error: insertError } = await supabase
        .from('account_transactions')
        .insert({
          user_id: flightLog.student_id,
          type: 'flight_charge',
          amount: paymentAmount,
          description,
          flight_log_id: flightLogId,
          payment_method_id: paymentMethodId,
          balance_after: newBalance,
          verified_status: 'verified',
        });
      if (insertError) throw insertError;

      await updateFlightPaidIfSettled(flightLogId);
      toast.success('Pilot account payment applied');
      await fetchAll();
    } catch (err) {
      console.error('Error applying pilot account payment:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to apply pilot account payment');
      throw err;
    }
  };

  const verifyTransaction = async (transactionId: string) => {
    try {
      const { data: tx, error: fetchError } = await supabase
        .from('account_transactions')
        .select('id, amount, user_id, verified_status, type')
        .eq('id', transactionId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!tx) throw new Error('Transaction not found');

      const { error: verifyError } = await supabase
        .from('account_transactions')
        .update({ verified_status: 'verified', balance_after: null })
        .eq('id', transactionId);

      if (verifyError) throw verifyError;

      let suffix = '';
      if (tx.type === 'topup') {
        const { error } = await supabase.functions.invoke('xero-sync', {
          body: { action: 'sync-transaction', transactionId },
        });
        if (error) {
          console.error('Verified top-up but failed to sync Xero credit:', error);
          suffix = '. Xero sync still needs attention';
        } else {
          suffix = ' and synced to Xero';
        }
      }

      toast.success(`Payment verified${suffix}`);
      await fetchAll();
    } catch (err) {
      console.error('Error verifying transaction:', err);
      toast.error('Failed to verify payment');
      throw err;
    }
  };

  const rejectTransaction = async (transactionId: string, notes: string) => {
    try {
      const { error: rejectError } = await supabase
        .from('account_transactions')
        .update({ verified_status: 'rejected', rejection_notes: notes })
        .eq('id', transactionId);

      if (rejectError) throw rejectError;

      toast.success('Payment rejected');
      await fetchAll();
    } catch (err) {
      console.error('Error rejecting transaction:', err);
      toast.error('Failed to reject payment');
      throw err;
    }
  };

  return {
    transactions,
    unpaidFlights,
    pilotAccounts,
    loading,
    xeroConnected,
    minimumPrepaidPack,
    addTopUp,
    markFlightPaid,
    createFlightPaymentCheckout,
    chargeFlightSavedCard,
    syncFlightInvoiceToXero,
    applyXeroPaymentsForFlight,
    applyPilotAccountPayment,
    verifyTransaction,
    rejectTransaction,
    refetch: fetchAll,
  };
};
