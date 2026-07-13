import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { GroundSessionLog } from '../types';
import { fetchUserPrepaidLedgerBalance } from '../lib/prepaidLedger';
import { getSupabaseFunctionErrorMessage } from '../lib/supabaseFunctionErrors';

export interface CreateGroundSessionLogData {
  booking_id?: string;
  student_id: string;
  instructor_id: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  flight_type_id?: string;
  payment_type: string;
  description_option_id?: string;
  description_text?: string;
  notes?: string;
}

interface GroundSessionPricingResult {
  calculatedCost: number;
  effectiveFlightTypeId?: string;
}

const mapLog = (row: any): GroundSessionLog => ({
  id: row.id,
  bookingId: row.booking_id || undefined,
  studentId: row.student_id,
  instructorId: row.instructor_id,
  startTime: row.start_time,
  endTime: row.end_time,
  durationHours: Number(row.duration_hours || 0),
  flightTypeId: row.flight_type_id || undefined,
  paymentType: row.payment_type || '',
  descriptionOptionId: row.description_option_id || undefined,
  descriptionText: row.description_text || undefined,
  notes: row.notes || undefined,
  calculatedCost: Number(row.calculated_cost || 0),
  paymentStatus: row.payment_status || 'pending',
  xeroInvoiceId: row.xero_invoice_id || null,
  xeroInvoiceNumber: row.xero_invoice_number || null,
  xeroInvoiceStatus: row.xero_invoice_status || null,
  xeroSyncStatus: row.xero_sync_status || null,
  xeroSyncError: row.xero_sync_error || null,
});

const isPrepaidLike = (value?: string | null) => {
  const normalised = String(value || '').toLowerCase().replace(/[-_]/g, ' ');
  return normalised.includes('pilot account') || normalised.includes('pre paid') || normalised.includes('prepaid');
};

const roundUpToQuarterHour = (hours: number) => {
  if (!Number.isFinite(hours) || hours <= 0) return 0.25;
  return Math.max(0.25, Math.ceil((hours - Number.EPSILON) * 4) / 4);
};

export const useGroundSessionLogs = (bookingId?: string) => {
  const [logs, setLogs] = useState<GroundSessionLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('ground_session_logs')
        .select('*')
        .order('start_time', { ascending: false });

      if (bookingId) {
        query = query.eq('booking_id', bookingId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs((data || []).map(mapLog));
    } catch (error) {
      console.error('Error loading ground session logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, [bookingId]);

  const calculatePricing = async (
    flightTypeId: string | undefined,
    descriptionOptionId: string | undefined,
    durationHours: number
  ): Promise<GroundSessionPricingResult> => {
    const billableHours = roundUpToQuarterHour(durationHours);
    if (billableHours <= 0) return { calculatedCost: 0, effectiveFlightTypeId: flightTypeId };

    const { data: description, error: descriptionError } = descriptionOptionId
      ? await supabase
        .from('ground_session_description_options')
        .select('pricing_mode, fixed_rate, flight_type_id')
        .eq('id', descriptionOptionId)
        .maybeSingle()
      : { data: null, error: null };

    if (descriptionError) throw descriptionError;
    if (description?.pricing_mode === 'fixed') {
      return {
        calculatedCost: Math.round((Number(description.fixed_rate || 0) + Number.EPSILON) * 100) / 100,
        effectiveFlightTypeId: flightTypeId || description.flight_type_id || undefined,
      };
    }

    const effectiveFlightTypeId = description?.flight_type_id || flightTypeId;
    if (!effectiveFlightTypeId) return { calculatedCost: 0, effectiveFlightTypeId: undefined };

    const { data, error } = await supabase
      .from('flight_types')
      .select('ground_session_hourly_rate')
      .eq('id', effectiveFlightTypeId)
      .maybeSingle();

    if (error) throw error;
    return {
      calculatedCost: Math.round((Number(data?.ground_session_hourly_rate || 0) * billableHours + Number.EPSILON) * 100) / 100,
      effectiveFlightTypeId,
    };
  };

  const syncXeroInvoiceIfAvailable = async (groundSessionLogId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: {
          action: 'sync-ground-session-invoice',
          groundSessionLogId,
        },
      });

      if (error) {
        const message = await getSupabaseFunctionErrorMessage(error, 'Ground session was saved but Xero invoice sync failed');
        console.error('Ground session Xero sync failed:', message);
        toast.error(message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Ground session Xero sync invoke failed:', error);
      return false;
    }
  };

  const applyGroundPaymentsIfNeeded = async (groundSessionLogId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: {
          action: 'apply-ground-session-payments',
          groundSessionLogId,
        },
      });

      if (error) {
        const message = await getSupabaseFunctionErrorMessage(error, 'Ground session payment sync failed');
        console.error('Ground session payment sync failed:', message);
      }
    } catch (error) {
      console.error('Ground session payment sync invoke failed:', error);
    }
  };

  const createGroundSessionLog = async (logData: CreateGroundSessionLogData) => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData.user;
      if (!currentUser) throw new Error('User not authenticated');

      const durationHours = roundUpToQuarterHour(Number(logData.duration_hours || 0));
      const pricing = await calculatePricing(logData.flight_type_id, logData.description_option_id, durationHours);
      const calculatedCost = pricing.calculatedCost;
      const prepaidSelected = isPrepaidLike(logData.payment_type);

      let paymentMethodId: string | null = null;
      if (logData.payment_type) {
        const query = supabase
          .from('payment_methods')
          .select('id, system_key')
          .eq('active', true);
        const { data: methods } = prepaidSelected
          ? await query.eq('system_key', 'pilot_account').limit(1)
          : await query.ilike('name', logData.payment_type).limit(1);
        paymentMethodId = methods?.[0]?.id ?? null;
      }

      let balanceAfter: number | null = null;
      if (prepaidSelected && calculatedCost > 0) {
        const ledger = await fetchUserPrepaidLedgerBalance(logData.student_id);
        const available = Number(ledger.verifiedBalance ?? 0);
        if (!ledger.xeroConnected) {
          throw new Error('Prepaid cannot be used until Xero credit can be confirmed. The old CRM prepaid balance is no longer used.');
        }
        if (available <= 0.005) {
          throw new Error('Prepaid is locked until the member has positive Xero credit. Top-ups can only be made in $1000.00 increments.');
        }
        if (available + 0.005 < calculatedCost) {
          throw new Error(`This member only has $${available.toFixed(2)} of Xero credit available, so prepaid cannot cover this ground session. Add a $1000.00 top-up first.`);
        }
        balanceAfter = Math.round((available - calculatedCost + Number.EPSILON) * 100) / 100;
      }

      const paymentStatus: GroundSessionLog['paymentStatus'] =
        calculatedCost <= 0 ? 'free' : prepaidSelected ? 'paid' : 'pending';

      const { data, error } = await supabase
        .from('ground_session_logs')
        .insert({
          ...logData,
          duration_hours: durationHours,
          flight_type_id: pricing.effectiveFlightTypeId || null,
          calculated_cost: calculatedCost,
          payment_status: paymentStatus,
          created_by: currentUser.id,
        })
        .select('*')
        .single();

      if (error) throw error;

      if (prepaidSelected && calculatedCost > 0) {
        const { error: txError } = await supabase
          .from('account_transactions')
          .insert({
            user_id: logData.student_id,
            type: 'flight_charge',
            amount: calculatedCost,
            description: `Ground session charge - ${new Date(logData.start_time).toLocaleDateString('en-AU')}`,
            ground_session_log_id: data.id,
            payment_method_id: paymentMethodId,
            balance_after: balanceAfter,
            verified_status: 'verified',
            created_by: currentUser.id,
          });

        if (txError) {
          console.error('Failed to record prepaid ground session charge:', txError);
        }
      }

      if (logData.booking_id) {
        const { error: bookingError } = await supabase
          .from('bookings')
          .update({
            ground_session_logged: true,
            status: 'confirmed',
            approved_by: currentUser.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', logData.booking_id);

        if (bookingError) {
          console.error('Failed to update booking after ground session log:', bookingError);
        }
      }

      if (calculatedCost > 0) {
        const synced = await syncXeroInvoiceIfAvailable(data.id);
        if (synced && prepaidSelected) {
          await applyGroundPaymentsIfNeeded(data.id);
        }
      }

      await fetchLogs();
      return { data: mapLog(data), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create ground session log';
      console.error('Error creating ground session log:', error);
      return { data: null, error: message };
    }
  };

  const updateGroundSessionLog = async (id: string, updates: Partial<CreateGroundSessionLogData>) => {
    try {
      const current = logs.find(log => log.id === id);
      const nextDuration = roundUpToQuarterHour(Number(updates.duration_hours ?? current?.durationHours ?? 0));
      const nextFlightTypeId = updates.flight_type_id ?? current?.flightTypeId;
      const nextDescriptionOptionId = updates.description_option_id ?? current?.descriptionOptionId;
      const pricing = await calculatePricing(nextFlightTypeId, nextDescriptionOptionId, nextDuration);
      const recalculatedCost = pricing.calculatedCost;
      const nextPaymentType = updates.payment_type ?? current?.paymentType ?? '';

      const payload: Record<string, unknown> = {
        ...updates,
        duration_hours: nextDuration,
        flight_type_id: pricing.effectiveFlightTypeId || null,
        calculated_cost: recalculatedCost,
        payment_status: recalculatedCost <= 0 ? 'free' : isPrepaidLike(nextPaymentType) ? 'paid' : 'pending',
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('ground_session_logs')
        .update(payload)
        .eq('id', id);

      if (error) throw error;

      if (recalculatedCost > 0) {
        await syncXeroInvoiceIfAvailable(id);
        if (isPrepaidLike(nextPaymentType)) {
          await applyGroundPaymentsIfNeeded(id);
        }
      }

      await fetchLogs();
      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update ground session log';
      console.error('Error updating ground session log:', error);
      return { error: message };
    }
  };

  const deleteGroundSessionLog = async (id: string) => {
    try {
      const { data: logRow, error: fetchError } = await supabase
        .from('ground_session_logs')
        .select('id, booking_id, xero_invoice_id')
        .eq('id', id)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (logRow?.xero_invoice_id) {
        throw new Error('This ground session has already been synced to Xero. Edit it instead of deleting it.');
      }

      const { error } = await supabase
        .from('ground_session_logs')
        .delete()
        .eq('id', id);

      if (error) throw error;

      if (logRow?.booking_id) {
        await supabase
          .from('bookings')
          .update({ ground_session_logged: false })
          .eq('id', logRow.booking_id);
      }

      await fetchLogs();
      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete ground session log';
      console.error('Error deleting ground session log:', error);
      return { error: message };
    }
  };

  return {
    logs,
    loading,
    refetch: fetchLogs,
    createGroundSessionLog,
    updateGroundSessionLog,
    deleteGroundSessionLog,
  };
};
