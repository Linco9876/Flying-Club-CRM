import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';

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
          return {
          id: row.id,
          userId: row.student_id,
          userName: row.users?.name ?? 'Unknown',
          userEmail: row.users?.email ?? '',
          aircraftRegistration: row.aircraft?.registration ?? 'Unknown',
          flightDate: row.start_time,
          flightDuration: parseFloat(row.flight_duration ?? 0),
          calculatedCost,
          amountPaid,
          amountRemaining,
          flightTypeId: row.flight_type_id ?? null,
          flightTypeName: row.flight_types?.name ?? null,
          paymentType: row.payment_type ?? null,
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

      // Read authoritative balance from students table
      const { data: students } = await supabase
        .from('students')
        .select('id, prepaid_balance');

      (students || []).forEach((s: any) => {
        balanceMap[s.id] = parseFloat(s.prepaid_balance ?? 0);
      });

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

      const { data: student, error: studentError } = await supabase
        .from('students')
        .select('prepaid_balance')
        .eq('id', flightLog.student_id)
        .maybeSingle();
      if (studentError) throw studentError;
      const currentBalance = parseFloat(student?.prepaid_balance ?? 0);
      if (paymentAmount > currentBalance + 0.005) {
        throw new Error(`Pilot account balance is only $${currentBalance.toFixed(2)}`);
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

      const { error: balanceError } = await supabase
        .from('students')
        .upsert({ id: flightLog.student_id, prepaid_balance: newBalance }, { onConflict: 'id' });
      if (balanceError) throw balanceError;

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
      // Fetch transaction to get amount and user
      const { data: tx, error: fetchError } = await supabase
        .from('account_transactions')
        .select('amount, user_id, verified_status')
        .eq('id', transactionId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!tx) throw new Error('Transaction not found');

      // Apply amount to student balance
      const { data: student } = await supabase
        .from('students')
        .select('prepaid_balance')
        .eq('id', tx.user_id)
        .maybeSingle();

      const currentBalance = parseFloat(student?.prepaid_balance ?? 0);
      const newBalance = currentBalance + parseFloat(tx.amount);

      const { error: verifyError } = await supabase
        .from('account_transactions')
        .update({ verified_status: 'verified', balance_after: newBalance })
        .eq('id', transactionId);

      if (verifyError) throw verifyError;

      const { error: balanceError } = await supabase
        .from('students')
        .upsert({ id: tx.user_id, prepaid_balance: newBalance }, { onConflict: 'id' });

      if (balanceError) throw balanceError;

      toast.success('Payment verified — balance updated');
      await fetchAll();
    } catch (err) {
      console.error('Error verifying transaction:', err);
      toast.error('Failed to verify payment');
      throw err;
    }
  };

  const rejectTransaction = async (transactionId: string, notes: string) => {
    try {
      // Reverse the balance: find the transaction to get amount and user_id
      const { data: tx, error: fetchError } = await supabase
        .from('account_transactions')
        .select('amount, user_id')
        .eq('id', transactionId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!tx) throw new Error('Transaction not found');

      const { error: rejectError } = await supabase
        .from('account_transactions')
        .update({ verified_status: 'rejected', rejection_notes: notes })
        .eq('id', transactionId);

      if (rejectError) throw rejectError;

      if (tx.verified_status === 'verified') {
        // Pending top-ups have not touched the approved balance yet.
        const { data: student } = await supabase
          .from('students')
          .select('prepaid_balance')
          .eq('id', tx.user_id)
          .maybeSingle();

        const currentBalance = parseFloat(student?.prepaid_balance ?? 0);
        const reversedBalance = currentBalance - parseFloat(tx.amount);

        const { error: balanceError } = await supabase
          .from('students')
          .update({ prepaid_balance: reversedBalance })
          .eq('id', tx.user_id);

        if (balanceError) throw balanceError;
      }

      toast.success(tx.verified_status === 'verified' ? 'Payment rejected and balance reversed' : 'Payment rejected');
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
    addTopUp,
    markFlightPaid,
    createFlightPaymentCheckout,
    chargeFlightSavedCard,
    applyPilotAccountPayment,
    verifyTransaction,
    rejectTransaction,
    refetch: fetchAll,
  };
};
