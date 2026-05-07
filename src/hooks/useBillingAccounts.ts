import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

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
        .or('payment_status.is.null,payment_status.eq.unpaid')
        .not('payment_type', 'is', null)
        .order('start_time', { ascending: false });

      if (error) throw error;

      setUnpaidFlights(
        (data || []).map((row: any) => ({
          id: row.id,
          userId: row.student_id,
          userName: row.users?.name ?? 'Unknown',
          userEmail: row.users?.email ?? '',
          aircraftRegistration: row.aircraft?.registration ?? 'Unknown',
          flightDate: row.start_time,
          flightDuration: parseFloat(row.flight_duration ?? 0),
          calculatedCost: row.calculated_cost != null ? parseFloat(row.calculated_cost) : null,
          flightTypeId: row.flight_type_id ?? null,
          flightTypeName: row.flight_types?.name ?? null,
          paymentType: row.payment_type ?? null,
        }))
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

        // Only verified topups/refunds add to balance; flight charges always deduct
        const amt = parseFloat(tx.amount ?? 0);
        if (tx.type === 'topup' || tx.type === 'refund') {
          if (tx.verified_status === 'verified') {
            balanceMap[uid] = (balanceMap[uid] ?? 0) + amt;
          }
        } else if (tx.type === 'flight_charge' || tx.type === 'adjustment') {
          balanceMap[uid] = (balanceMap[uid] ?? 0) - amt;
        }
      });

      // Get unpaid flight counts per user
      const { data: unpaid, error: unpaidError } = await supabase
        .from('flight_logs')
        .select('student_id')
        .or('payment_status.is.null,payment_status.eq.unpaid')
        .not('payment_type', 'is', null);

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

  const addTopUp = async (userId: string, amount: number, description: string, paymentMethodId?: string) => {
    try {
      // Insert as pending — balance is NOT applied until an admin verifies the payment
      const { error: txError } = await supabase
        .from('account_transactions')
        .insert({
          user_id: userId,
          type: 'topup',
          amount,
          description: description || 'Account top-up',
          payment_method_id: paymentMethodId ?? null,
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

  const verifyTransaction = async (transactionId: string) => {
    try {
      // Fetch transaction to get amount and user
      const { data: tx, error: fetchError } = await supabase
        .from('account_transactions')
        .select('amount, user_id')
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

      // Reverse balance on student record
      const { data: student } = await supabase
        .from('students')
        .select('prepaid_balance')
        .eq('id', tx.user_id)
        .maybeSingle();

      const currentBalance = parseFloat(student?.prepaid_balance ?? 0);
      const reversedBalance = currentBalance - parseFloat(tx.amount);

      const { error: rejectError } = await supabase
        .from('account_transactions')
        .update({ verified_status: 'rejected', rejection_notes: notes })
        .eq('id', transactionId);

      if (rejectError) throw rejectError;

      const { error: balanceError } = await supabase
        .from('students')
        .update({ prepaid_balance: reversedBalance })
        .eq('id', tx.user_id);

      if (balanceError) throw balanceError;

      toast.success('Payment rejected and balance reversed');
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
    verifyTransaction,
    rejectTransaction,
    refetch: fetchAll,
  };
};
