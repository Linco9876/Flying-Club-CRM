import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';
import { fetchAllMemberXeroBalances, fetchUserXeroBalance } from '../lib/xeroMemberBalance';
import { fetchAllPrepaidLedgerBalances, fetchUserPrepaidLedgerBalance } from '../lib/prepaidLedger';

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
  xeroSyncStatus: string | null;
  xeroSyncError: string | null;
  xeroBankTransactionId: string | null;
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

  const createAdminAuditEntry = async ({
    action,
    recordId,
    recordLabel,
    changedFields,
    oldData,
    newData,
  }: {
    action: string;
    recordId: string;
    recordLabel: string;
    changedFields: string[];
    oldData: Record<string, unknown>;
    newData: Record<string, unknown>;
  }) => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      await supabase.from('admin_audit_log').insert({
        occurred_at: new Date().toISOString(),
        actor_id: authData.user?.id ?? null,
        action,
        table_name: 'account_transactions',
        record_id: recordId,
        record_label: recordLabel,
        area: 'Billing',
        changed_fields: changedFields,
        old_data: oldData,
        new_data: newData,
      });
    } catch (error) {
      console.warn('Unable to write billing audit event:', error);
    }
  };

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
          xero_sync_status,
          xero_sync_error,
          xero_bank_transaction_id,
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
          xeroSyncStatus: row.xero_sync_status ?? null,
          xeroSyncError: row.xero_sync_error ?? null,
          xeroBankTransactionId: row.xero_bank_transaction_id ?? null,
        }))
      );
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  };

const fetchUnpaidFlights = async (skipXeroRefresh = false) => {
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

      const mappedFlights = (data || []).map((row: any) => {
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
      });

      setUnpaidFlights(mappedFlights);

      const xeroFlightIds = mappedFlights
        .filter((flight: UnpaidFlight) => flight.xeroInvoiceId)
        .map((flight: UnpaidFlight) => flight.id);
      if (!skipXeroRefresh && xeroFlightIds.length > 0) {
        try {
          const { data: refreshData, error: refreshError } = await supabase.functions.invoke('xero-sync', {
            body: { action: 'refresh-paid-flight-invoices', flightLogIds: xeroFlightIds },
          });
          if (refreshError) throw refreshError;
          if ((refreshData as any)?.paidCount > 0) {
            await fetchUnpaidFlights(true);
            await fetchTransactions();
          }
        } catch (refreshErr) {
          console.warn('Unable to refresh Xero invoice payment statuses:', refreshErr);
        }
      }
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

      const ledgerByUser = await fetchAllPrepaidLedgerBalances();

      try {
        const xeroData = await fetchAllMemberXeroBalances();
        setXeroConnected(Boolean(xeroData.connected));
        setMinimumPrepaidPack(Number(xeroData.minimumPrepaidPack ?? 1000));
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/not authorised|only staff/i.test(message)) {
          const self = await fetchUserXeroBalance((await supabase.auth.getUser()).data.user?.id || '');
          setXeroConnected(Boolean(self.connected));
          setMinimumPrepaidPack(Number(self.minimumPrepaidPack ?? 1000));
        } else {
          console.warn('Unable to confirm Xero connection while loading pilot accounts:', error);
          setXeroConnected(false);
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
          balance: ledgerByUser[u.id]?.verifiedBalance ?? 0,
          lastTransactionDate: ledgerByUser[u.id]?.lastTransactionDate ?? null,
          totalTransactions: ledgerByUser[u.id]?.totalTransactions ?? 0,
          unpaidFlightCount: unpaidByUser[u.id] ?? 0,
        }))
      );
    } catch (err) {
      console.error('Error fetching pilot accounts:', err);
    }
  };

  const addTopUp = async (userId: string, amount: number, description: string, paymentMethodId?: string, transactionDate?: string, options?: { autoVerify?: boolean }) => {
    try {
      if (!Number.isFinite(amount) || amount < 1000 || amount % 1000 !== 0) {
        throw new Error('Top-ups must be made in $1000 increments.');
      }

      const createdAt = transactionDate
        ? new Date(`${transactionDate}T12:00:00`).toISOString()
        : new Date().toISOString();
      const autoVerify = Boolean(options?.autoVerify);
      const currentLedger = autoVerify ? await fetchUserPrepaidLedgerBalance(userId) : null;

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
          balance_after: autoVerify && currentLedger
            ? Math.round((currentLedger.verifiedBalance + amount + Number.EPSILON) * 100) / 100
            : null,
          verified_status: autoVerify ? 'verified' : 'pending',
        });

      if (txError) throw txError;

      toast.success('Top-up recorded — awaiting verification');
      await fetchAll();
    } catch (err) {
      console.error('Error adding top-up:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to add top-up');
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

      const ledger = await fetchUserPrepaidLedgerBalance(flightLog.student_id);
      const currentBalance = Number(ledger.verifiedBalance ?? 0);
      const topUpIncrement = Number(minimumPrepaidPack ?? 1000);
      if (currentBalance <= 0.005) {
        throw new Error(`Prepaid is locked until the member has a positive verified prepaid balance. Top-ups can only be made in $${topUpIncrement.toFixed(2)} increments.`);
      }
      if (paymentAmount > currentBalance + 0.005) {
        const requiredTopUp = Math.max(topUpIncrement, Math.ceil((paymentAmount - currentBalance) / topUpIncrement) * topUpIncrement);
        throw new Error(`This member only has $${currentBalance.toFixed(2)} of verified prepaid funds available, so prepaid cannot cover this amount. Add a $${requiredTopUp.toFixed(2)} top-up first. Top-ups can only be made in $${topUpIncrement.toFixed(2)} increments.`);
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
        .select('id, amount, user_id, verified_status, type, xero_sync_status, xero_sync_error, rejection_notes')
        .eq('id', transactionId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!tx) throw new Error('Transaction not found');

      const currentLedger = await fetchUserPrepaidLedgerBalance(tx.user_id);
      const nextBalance = tx.type === 'topup'
        ? Math.round((currentLedger.verifiedBalance + Math.abs(Number(tx.amount || 0)) + Number.EPSILON) * 100) / 100
        : null;

      const { error: verifyError } = await supabase
        .from('account_transactions')
        .update({
          verified_status: 'verified',
          rejection_notes: null,
          balance_after: nextBalance,
          xero_sync_status: tx.type === 'topup' ? 'queued' : tx.xero_sync_status,
          xero_sync_error: tx.type === 'topup' ? null : tx.xero_sync_error,
        })
        .eq('id', transactionId);

      if (verifyError) throw verifyError;

      let suffix = '';
      if (tx.type === 'topup') {
        const { error } = await supabase.functions.invoke('xero-sync', {
          body: { action: 'sync-transaction', transactionId },
        });
        if (error) {
          console.error('Verified top-up but failed to reconcile against Xero:', error);
          suffix = '. Xero reconciliation still needs attention';
        } else {
          suffix = ' and queued for Xero reconciliation';
        }
      }

      await createAdminAuditEntry({
        action: 'UPDATE',
        recordId: transactionId,
        recordLabel: 'Account top-up verification',
        changedFields: ['verified_status', 'balance_after', 'xero_sync_status'],
        oldData: {
          verified_status: tx.verified_status,
          rejection_notes: tx.rejection_notes,
          xero_sync_status: tx.xero_sync_status,
          xero_sync_error: tx.xero_sync_error,
        },
        newData: {
          verified_status: 'verified',
          balance_after: nextBalance,
          xero_sync_status: tx.type === 'topup' ? 'queued' : tx.xero_sync_status,
        },
      });

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
      const { data: existingTx, error: existingTxError } = await supabase
        .from('account_transactions')
        .select('verified_status, rejection_notes, xero_sync_status')
        .eq('id', transactionId)
        .maybeSingle();

      if (existingTxError) throw existingTxError;

      const { error: rejectError } = await supabase
        .from('account_transactions')
        .update({
          verified_status: 'rejected',
          rejection_notes: notes,
          xero_sync_status: 'cancelled',
          xero_sync_error: null,
        })
        .eq('id', transactionId);

      if (rejectError) throw rejectError;

      await createAdminAuditEntry({
        action: 'UPDATE',
        recordId: transactionId,
        recordLabel: 'Account top-up rejection',
        changedFields: ['verified_status', 'rejection_notes', 'xero_sync_status'],
        oldData: {
          verified_status: existingTx?.verified_status ?? null,
          rejection_notes: existingTx?.rejection_notes ?? null,
          xero_sync_status: existingTx?.xero_sync_status ?? null,
        },
        newData: {
          verified_status: 'rejected',
          rejection_notes: notes,
          xero_sync_status: 'cancelled',
        },
      });

      toast.success('Payment rejected');
      await fetchAll();
    } catch (err) {
      console.error('Error rejecting transaction:', err);
      toast.error('Failed to reject payment');
      throw err;
    }
  };

  const retryTransactionXeroSync = async (transactionId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'sync-transaction', transactionId },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to retry Xero reconciliation'));
      toast.success('Xero reconciliation retried');
      await fetchAll();
    } catch (err) {
      console.error('Error retrying transaction Xero sync:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to retry Xero reconciliation');
      throw err;
    }
  };

  const listTransactionXeroMatches = async (transactionId: string) => {
    const { data, error } = await supabase.functions.invoke('xero-sync', {
      body: { action: 'list-transaction-credit-matches', transactionId },
    });
    if (error) {
      throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to load Xero credit matches'));
    }
    return data as {
      transactionId: string;
      contactId: string | null;
      memberName: string;
      candidates: Array<{
        id: string;
        kind: 'overpayment' | 'prepayment';
        amount: number;
        status: string;
        date: string | null;
        reference: string | null;
        exactAmount: boolean;
      }>;
    };
  };

  const matchTransactionToXeroCredit = async (transactionId: string, creditId: string, creditKind: 'overpayment' | 'prepayment') => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'match-transaction-credit', transactionId, creditId, creditKind },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to match the top-up to Xero'));
      toast.success('Top-up linked to the matching Xero credit');
      await fetchAll();
    } catch (err) {
      console.error('Error matching transaction to Xero credit:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to match top-up to Xero');
      throw err;
    }
  };

  const unlinkTransactionXeroCredit = async (transactionId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'unlink-transaction-credit-match', transactionId },
      });
      if (error) throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to unlink the Xero match'));
      toast.success('Xero link removed from the top-up');
      await fetchAll();
    } catch (err) {
      console.error('Error unlinking transaction Xero credit:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to unlink Xero match');
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
    retryTransactionXeroSync,
    listTransactionXeroMatches,
    matchTransactionToXeroCredit,
    unlinkTransactionXeroCredit,
    refetch: fetchAll,
  };
};
