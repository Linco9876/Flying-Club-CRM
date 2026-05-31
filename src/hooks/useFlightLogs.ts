import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { calculateFlightCost, isNoChargeRate, isPrepaidPaymentMethod } from '../utils/billing';

export interface FlightLog {
  id: string;
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id?: string;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  dual_time: number;
  solo_time: number;
  takeoffs?: number;
  landings?: number;
  comments?: string;
  payment_type?: string;
  flight_type_id?: string;
  calculated_cost?: number;
  payment_status?: 'free' | 'pending' | 'paid';
  observations?: string;
  hobbs_start?: number;
  hobbs_end?: number;
  fuel_start?: number;
  fuel_end?: number;
  oil_added?: number;
  oil_start?: number;
  oil_end?: number;
  fuel_added?: number;
  fuel_type?: string;
  aircraft_condition?: string;
  maintenance_notes?: string;
  passengers?: number;
  created_at: string;
  created_by?: string;
}

export interface CreateFlightLogData {
  booking_id?: string;
  aircraft_id: string;
  student_id: string;
  instructor_id?: string;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  dual_time: number;
  solo_time: number;
  takeoffs?: number;
  landings?: number;
  comments?: string;
  payment_type?: string;
  flight_type_id?: string;
  observations?: string;
  hobbs_start?: number;
  hobbs_end?: number;
  fuel_start?: number;
  fuel_end?: number;
  oil_added?: number;
  oil_start?: number;
  oil_end?: number;
  fuel_added?: number;
  fuel_type?: string;
  aircraft_condition?: string;
  maintenance_notes?: string;
  passengers?: number;
  calculated_cost?: number;
  payment_status?: 'free' | 'pending' | 'paid';
}

export function useFlightLogs(userId?: string) {
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFlightLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('flight_logs')
        .select('*')
        .order('start_time', { ascending: false });

      if (userId) {
        query = query.or(`student_id.eq.${userId},instructor_id.eq.${userId}`);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setFlightLogs(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch flight logs');
      console.error('Error fetching flight logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlightLogs();
  }, [userId]);

  const createFlightLog = async (logData: CreateFlightLogData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: rateData } = logData.flight_type_id
        ? await supabase
          .from('aircraft_rates')
          .select('*, payment_methods(id, name), flight_types(forced_payment_method_id)')
          .eq('aircraft_id', logData.aircraft_id)
          .eq('flight_type_id', logData.flight_type_id)
          .maybeSingle()
        : { data: null };

      const selectedRate = rateData ? {
        chargeType: rateData.charge_type,
        soloRate: parseFloat(rateData.solo_rate || 0),
        dualRate: parseFloat(rateData.dual_rate || 0),
        flatSurcharge: parseFloat(rateData.flat_surcharge || 0),
        weekendSurcharge: parseFloat(rateData.weekend_surcharge || 0),
      } : null;
      const calculatedCost = calculateFlightCost({
        rate: selectedRate as any,
        durationHours: logData.flight_duration,
        isDual: !!logData.instructor_id,
        passengerCount: logData.passengers,
        startTime: logData.start_time,
      });
      const noCharge = isNoChargeRate(selectedRate?.chargeType);
      let paymentMethodId = rateData?.default_payment_method_id ?? rateData?.flight_types?.forced_payment_method_id ?? null;
      if (!paymentMethodId && logData.payment_type) {
        const { data: paymentMethod } = await supabase
          .from('payment_methods')
          .select('id')
          .ilike('name', logData.payment_type)
          .maybeSingle();
        paymentMethodId = paymentMethod?.id ?? null;
      }
      const initialPaymentStatus: 'free' | 'pending' | 'paid' = noCharge || calculatedCost <= 0
        ? 'free'
        : isPrepaidPaymentMethod(logData.payment_type)
          ? 'paid'
          : 'pending';

      const { data, error: insertError } = await supabase
        .from('flight_logs')
        .insert({
          ...logData,
          duration: logData.flight_duration,
          tach_start: logData.start_tach,
          tach_end: logData.end_tach,
          total_cost: calculatedCost,
          calculated_cost: calculatedCost,
          payment_status: initialPaymentStatus,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (initialPaymentStatus === 'paid' && calculatedCost > 0 && logData.student_id) {
        const { data: student } = await supabase
          .from('students')
          .select('prepaid_balance')
          .eq('id', logData.student_id)
          .maybeSingle();

        const currentBalance = parseFloat(student?.prepaid_balance ?? 0);
        const newBalance = currentBalance - calculatedCost;

        const { error: txError } = await supabase
          .from('account_transactions')
          .insert({
            user_id: logData.student_id,
            type: 'flight_charge',
            amount: calculatedCost,
            description: `Flight charge - ${new Date(logData.start_time).toLocaleDateString('en-AU')}`,
            flight_log_id: data.id,
            payment_method_id: paymentMethodId,
            balance_after: newBalance,
            verified_status: 'verified',
            created_by: user.id,
          });

        if (txError) {
          console.error('Error recording flight charge transaction:', txError);
        } else {
          const { error: balanceError } = await supabase
            .from('students')
            .upsert({ id: logData.student_id, prepaid_balance: newBalance }, { onConflict: 'id' });
          if (balanceError) console.error('Error updating prepaid balance:', balanceError);
        }
      }

      if (logData.booking_id) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ flight_logged: true })
          .eq('id', logData.booking_id);

        if (updateError) console.error('Error updating booking:', updateError);

        const { error: approvalError } = await supabase
          .from('bookings')
          .update({
            status: 'confirmed',
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', logData.booking_id)
          .eq('status', 'pending_approval');

        if (approvalError) console.error('Error approving logged booking:', approvalError);
      }

      const { error: aircraftUpdateError } = await supabase
        .from('aircraft')
        .update({ total_hours: logData.end_tach })
        .eq('id', logData.aircraft_id);

      if (aircraftUpdateError) {
        console.error('Error updating aircraft hours:', aircraftUpdateError);
      }

      await fetchFlightLogs();
      return { data, error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create flight log';
      console.error('Error creating flight log:', err);
      return { data: null, error: errorMessage };
    }
  };

  const updateFlightLog = async (id: string, updates: Partial<CreateFlightLogData>) => {
    try {
      const { error: updateError } = await supabase
        .from('flight_logs')
        .update(updates)
        .eq('id', id);

      if (updateError) throw updateError;

      await fetchFlightLogs();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update flight log';
      console.error('Error updating flight log:', err);
      return { error: errorMessage };
    }
  };

  const deleteFlightLog = async (id: string) => {
    try {
      const { data: chargeTransactions } = await supabase
        .from('account_transactions')
        .select('id, user_id, amount, type')
        .eq('flight_log_id', id);

      const prepaidCharges = (chargeTransactions || []).filter((tx: any) => tx.type === 'flight_charge');
      if (prepaidCharges.length > 0) {
        const refundByUser = prepaidCharges.reduce<Record<string, number>>((acc, tx: any) => {
          acc[tx.user_id] = (acc[tx.user_id] || 0) + parseFloat(tx.amount || 0);
          return acc;
        }, {});

        for (const [studentId, refundAmount] of Object.entries(refundByUser)) {
          const { data: student } = await supabase
            .from('students')
            .select('prepaid_balance')
            .eq('id', studentId)
            .maybeSingle();
          const newBalance = parseFloat(student?.prepaid_balance ?? 0) + refundAmount;
          const { error: balanceError } = await supabase
            .from('students')
            .upsert({ id: studentId, prepaid_balance: newBalance }, { onConflict: 'id' });
          if (balanceError) throw balanceError;
        }

        const { error: txDeleteError } = await supabase
          .from('account_transactions')
          .delete()
          .in('id', prepaidCharges.map((tx: any) => tx.id));

        if (txDeleteError) throw txDeleteError;
      }

      const { error: deleteError } = await supabase
        .from('flight_logs')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      await fetchFlightLogs();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete flight log';
      console.error('Error deleting flight log:', err);
      return { error: errorMessage };
    }
  };

  const checkTachOverlap = async (aircraftId: string, startTach: number, endTach: number, excludeLogId?: string) => {
    try {
      let query = supabase
        .from('flight_logs')
        .select('id, start_tach, end_tach, start_time, end_time')
        .eq('aircraft_id', aircraftId)
        .or(`and(start_tach.lte.${endTach},end_tach.gte.${startTach})`);

      if (excludeLogId) {
        query = query.neq('id', excludeLogId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      const overlappingLogs = data?.filter(log => {
        const overlapStart = Math.max(log.start_tach, startTach);
        const overlapEnd = Math.min(log.end_tach, endTach);
        return overlapEnd > overlapStart;
      }) || [];

      return { overlaps: overlappingLogs, error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check tach overlap';
      console.error('Error checking tach overlap:', err);
      return { overlaps: [], error: errorMessage };
    }
  };

  return {
    flightLogs,
    loading,
    error,
    createFlightLog,
    updateFlightLog,
    deleteFlightLog,
    checkTachOverlap,
    refetch: fetchFlightLogs,
  };
}
