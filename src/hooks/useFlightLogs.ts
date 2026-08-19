import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { calculateFlightCost, isNoChargeRate, isPrepaidPaymentMethod, isVoucherPaymentMethod } from '../utils/billing';
import { fetchUserPrepaidLedgerBalance } from '../lib/prepaidLedger';
import { useAuth } from '../context/AuthContext';
import { usePageLoadState } from '../context/PageLoadContext';
import { useFinancialProviders } from '../context/financialProviderState';
import { useLatestEffect } from './useLatestEffect';
import { shouldCaptureFinancialDetails } from '../utils/financialProviderPresentation';
import {
  FLIGHT_LOG_ALREADY_EXISTS_MESSAGE,
  isDuplicateBookingFlightLogError,
} from '../utils/flightLogBookingRules';
import { validateFlightTimeAllocation } from '../utils/flightTimeAllocation';
import { requestBookingCalendarRefresh } from '../utils/bookingCalendarRefresh';

const roundFlightDecimal = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
const roundCurrency = (value: number) => Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100);

const toLocalDateOnly = (value: string) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  financial_capture_suppressed?: boolean;
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
  aircraft?: {
    id: string;
    registration: string;
    make: string;
    model: string;
  } | null;
  student?: {
    id: string;
    name: string;
    email: string;
  } | null;
  instructor?: {
    id: string;
    name: string;
    email: string;
  } | null;
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
  prepaid_payment_acknowledged?: boolean;
  training_record_status?: 'pending' | 'dismissed' | 'recorded';
}

export interface FlightPaymentLinkResult {
  checkoutUrl: string;
  sessionId: string;
  emailSent?: boolean;
  emailError?: string | null;
  emailTo?: string | null;
}

export interface FlightLogDeleteImpact {
  requiresXeroAction: boolean;
  recommendedAction: 'crm-only' | 'void-delete' | 'credit-note';
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  hasXeroPayments: boolean;
  hasStripePayments: boolean;
  summary: string;
  detail: string;
}

interface DeleteFlightLogOptions {
  xeroMode?: 'auto' | 'void-delete' | 'credit-note' | 'crm-only';
}

const getSupabaseFunctionErrorMessage = async (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object') {
    const maybeMessage = 'message' in error ? (error as { message?: unknown }).message : undefined;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;

    const context = 'context' in error ? (error as { context?: unknown }).context : undefined;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json();
        if (body?.error) return String(body.error);
        if (body?.message) return String(body.message);
      } catch {
        try {
          const text = await context.clone().text();
          if (text.trim()) return text;
        } catch {
          // ignore parsing issues and fall back below
        }
      }
    }
  }
  return fallback;
};

interface UseFlightLogsOptions {
  participateInPageLoad?: boolean;
}

export function useFlightLogs(userId?: string, options?: UseFlightLogsOptions) {
  const { user: currentUser } = useAuth();
  const { capabilities: financialProviders } = useFinancialProviders();
  const financialCaptureEnabled = shouldCaptureFinancialDetails(financialProviders);
  const participateInPageLoad = options?.participateInPageLoad ?? true;
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  usePageLoadState(
    participateInPageLoad && loading,
    'Loading flight logs',
    'Preparing flight history, billing status and aircraft log entries...'
  );
  const [error, setError] = useState<string | null>(null);

  const fetchFlightLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('flight_logs')
        .select(`
          *,
          aircraft:aircraft_id(id, registration, make, model),
          student:student_id(id, name, email),
          instructor:instructor_id(id, name, email)
        `)
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

  const syncXeroInvoiceIfAvailable = async (flightLogId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: {
          action: 'sync-flight-invoice',
          flightLogId,
        },
      });

      if (error) {
        const message = await getSupabaseFunctionErrorMessage(error, 'Flight was logged but Xero invoice sync failed');
        console.error('Flight Xero sync failed:', message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Flight Xero sync invoke failed:', error);
      return false;
    }
  };

  const applyFlightPaymentsIfNeeded = async (flightLogId: string) => {
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: {
          action: 'apply-flight-payments',
          flightLogId,
        },
      });

      if (error) {
        const message = await getSupabaseFunctionErrorMessage(error, 'Flight payment sync failed');
        console.error('Flight payment sync failed:', message);
      }
    } catch (error) {
      console.error('Flight payment sync invoke failed:', error);
    }
  };

  useLatestEffect(() => {
    fetchFlightLogs();
  }, [userId]);

  const buildDeleteImpact = async (id: string): Promise<FlightLogDeleteImpact> => {
    const { data: log, error: logError } = await supabase
      .from('flight_logs')
      .select('id, xero_invoice_id, xero_invoice_number, xero_invoice_status, xero_payment_id')
      .eq('id', id)
      .maybeSingle();

    if (logError) throw logError;
    if (!log) throw new Error('Flight log not found');

    const { data: txRows, error: txError } = await supabase
      .from('account_transactions')
      .select('id, xero_payment_id, payment_methods(system_key, name)')
      .eq('flight_log_id', id)
      .eq('type', 'flight_charge');

    if (txError) throw txError;

    const hasXeroPayments = Boolean(log.xero_payment_id) || (txRows || []).some((tx: any) => Boolean(tx.xero_payment_id));
    const hasStripePayments = (txRows || []).some((tx: any) => {
      const systemKey = String(tx?.payment_methods?.system_key || '').toLowerCase();
      const methodName = String(tx?.payment_methods?.name || '').toLowerCase();
      return systemKey === 'stripe_card' || systemKey === 'stripe' || methodName.includes('stripe');
    });
    const hasInvoice = Boolean(log.xero_invoice_id);

    if (!hasInvoice && !hasXeroPayments) {
      return {
        requiresXeroAction: false,
        recommendedAction: 'crm-only',
        invoiceId: null,
        invoiceNumber: null,
        invoiceStatus: null,
        hasXeroPayments: false,
        hasStripePayments,
        summary: 'This flight log has not been synced to Xero.',
        detail: 'It can be deleted from the CRM normally.',
      };
    }

    const invoiceStatus = String(log.xero_invoice_status || '').toUpperCase() || null;
    const shouldCredit = hasXeroPayments || invoiceStatus === 'PAID' || invoiceStatus === 'PARTPAID';

    if (shouldCredit) {
      return {
        requiresXeroAction: true,
        recommendedAction: 'credit-note',
        invoiceId: log.xero_invoice_id || null,
        invoiceNumber: log.xero_invoice_number || null,
        invoiceStatus,
        hasXeroPayments,
        hasStripePayments,
        summary: 'This flight log has already been invoiced and paid in Xero.',
        detail: 'Deleting it should create a reversing credit note in Xero before the CRM record is removed.',
      };
    }

    return {
      requiresXeroAction: true,
      recommendedAction: 'void-delete',
      invoiceId: log.xero_invoice_id || null,
      invoiceNumber: log.xero_invoice_number || null,
      invoiceStatus,
      hasXeroPayments,
      hasStripePayments,
      summary: 'This flight log has already been invoiced in Xero.',
      detail: 'Deleting it should void or delete the Xero invoice first, then remove the CRM record.',
    };
  };

  const removeLocalFlightLog = async (id: string) => {
    const { data: existingLog, error: existingLogError } = await supabase
      .from('flight_logs')
      .select('booking_id')
      .eq('id', id)
      .maybeSingle();

    if (existingLogError) throw existingLogError;

    const { error: detachTrainingRecordsError } = await supabase
      .from('training_records')
      .update({
        flight_log_id: null,
        ...(existingLog?.booking_id ? { booking_id: existingLog.booking_id } : {}),
      })
      .eq('flight_log_id', id);

    if (detachTrainingRecordsError) throw detachTrainingRecordsError;

    if (existingLog?.booking_id) {
      const { error: bookingUpdateError } = await supabase
        .from('bookings')
        .update({ flight_logged: false })
        .eq('id', existingLog.booking_id);

      if (bookingUpdateError) {
        console.error('Error marking booking unlogged:', bookingUpdateError);
      }
    }

    const { data: chargeTransactions } = await supabase
      .from('account_transactions')
      .select('id, user_id, amount, type')
      .eq('flight_log_id', id);

    const prepaidCharges = (chargeTransactions || []).filter((tx: any) => tx.type === 'flight_charge');
    if (prepaidCharges.length > 0) {
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
    return existingLog?.booking_id || undefined;
  };

  const syncBookingTrainingRecordsToFlightLog = async (
    bookingId: string | undefined,
    flightLogId: string,
    logData: CreateFlightLogData
  ) => {
    if (!bookingId) return;

    const { data: aircraft } = await supabase
      .from('aircraft')
      .select('registration, type, make, model')
      .eq('id', logData.aircraft_id)
      .maybeSingle();

    const { data: linkedRecords, error: linkedRecordsError } = await supabase
      .from('training_records')
      .select('id')
      .eq('booking_id', bookingId);

    if (linkedRecordsError) throw linkedRecordsError;
    if (!linkedRecords || linkedRecords.length === 0) return;

    const aircraftType = aircraft?.type
      || [aircraft?.make, aircraft?.model].filter(Boolean).join(' ')
      || 'single-engine';

    const { error: trainingRecordUpdateError } = await supabase
      .from('training_records')
      .update({
        flight_log_id: flightLogId,
        student_id: logData.student_id,
        instructor_id: logData.instructor_id ?? null,
        aircraft_id: logData.aircraft_id,
        aircraft_type: aircraftType,
        registration: aircraft?.registration ?? '',
        date: toLocalDateOnly(logData.start_time),
        dual_time_min: Math.round((logData.dual_time ?? 0) * 60),
        solo_time_min: Math.round((logData.solo_time ?? 0) * 60),
      })
      .eq('booking_id', bookingId);

    if (trainingRecordUpdateError) throw trainingRecordUpdateError;

    if (logData.instructor_id) {
      const { error: matrixUpdateError } = await supabase
        .from('student_matrix_assessments')
        .update({ instructor_id: logData.instructor_id, updated_at: new Date().toISOString() })
        .in('training_record_id', linkedRecords.map(record => record.id));

      if (matrixUpdateError) {
        console.error('Error syncing matrix assessment instructor:', matrixUpdateError);
      }
    }
  };

  const findFlightLogForBooking = async (bookingId: string) => {
    try {
      const { data, error: lookupError } = await supabase
        .from('flight_logs')
        .select('id, booking_id')
        .eq('booking_id', bookingId)
        .limit(1)
        .maybeSingle();

      if (lookupError) throw lookupError;
      return { data, error: null };
    } catch (lookupError) {
      const message = lookupError instanceof Error
        ? lookupError.message
        : 'The CRM could not check whether this booking already has a flight log.';
      console.error('Error checking booking flight log:', lookupError);
      return { data: null, error: message };
    }
  };

  const createFlightLog = async (logData: CreateFlightLogData) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      const normalisedLogData = {
        ...logData,
        start_tach: roundFlightDecimal(logData.start_tach),
        end_tach: roundFlightDecimal(logData.end_tach),
        flight_duration: roundFlightDecimal(logData.flight_duration),
        dual_time: roundFlightDecimal(logData.dual_time),
        solo_time: roundFlightDecimal(logData.solo_time),
      };
      const allocationError = validateFlightTimeAllocation({
        durationHours: normalisedLogData.flight_duration,
        dualTime: normalisedLogData.dual_time,
        soloTime: normalisedLogData.solo_time,
        hasInstructor: Boolean(normalisedLogData.instructor_id),
      });
      if (allocationError) throw new Error(allocationError);
      const prepaidPaymentAcknowledged = Boolean(normalisedLogData.prepaid_payment_acknowledged);
      delete (normalisedLogData as any).prepaid_payment_acknowledged;

      if (normalisedLogData.booking_id) {
        const existingLog = await findFlightLogForBooking(normalisedLogData.booking_id);
        if (existingLog.error) throw new Error(existingLog.error);
        if (existingLog.data) {
          return { data: null, error: FLIGHT_LOG_ALREADY_EXISTS_MESSAGE };
        }
      }

      const requestedCostOverride = financialCaptureEnabled
        && typeof normalisedLogData.calculated_cost === 'number'
        && Number.isFinite(normalisedLogData.calculated_cost)
        ? roundCurrency(normalisedLogData.calculated_cost)
        : undefined;

      const { data: rateData } = financialCaptureEnabled && normalisedLogData.flight_type_id
        ? await supabase
          .from('aircraft_rates')
          .select('*, payment_methods(id, name, system_key), flight_types(forced_payment_method_id)')
          .eq('aircraft_id', normalisedLogData.aircraft_id)
          .eq('flight_type_id', normalisedLogData.flight_type_id)
          .maybeSingle()
        : { data: null };

      const selectedRate = rateData ? {
        chargeType: rateData.charge_type,
        soloRate: parseFloat(rateData.solo_rate || 0),
        dualRate: parseFloat(rateData.dual_rate || 0),
        flatSurcharge: parseFloat(rateData.flat_surcharge || 0),
        weekendSurcharge: parseFloat(rateData.weekend_surcharge || 0),
      } : null;
      const rateCalculatedCost = calculateFlightCost({
        rate: selectedRate as any,
        durationHours: normalisedLogData.flight_duration,
        isDual: !!normalisedLogData.instructor_id,
        dualHours: normalisedLogData.dual_time,
        soloHours: normalisedLogData.solo_time,
        passengerCount: normalisedLogData.passengers,
        startTime: normalisedLogData.start_time,
      });
      let canOverrideCost = false;
      if (requestedCostOverride !== undefined) {
        const { data: roleRows } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        if (roleRows?.some((row: any) => row.role === 'admin')) {
          canOverrideCost = true;
        } else {
          const { data: profile } = await supabase
            .from('users')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
          canOverrideCost = profile?.role === 'admin';
        }
      }
      const calculatedCost = financialCaptureEnabled
        ? requestedCostOverride !== undefined && canOverrideCost
          ? requestedCostOverride
          : rateCalculatedCost
        : null;
      const billableAmount = calculatedCost ?? 0;
      const noCharge = financialCaptureEnabled && isNoChargeRate(selectedRate?.chargeType);
      let paymentMethodId = rateData?.default_payment_method_id ?? rateData?.flight_types?.forced_payment_method_id ?? null;
      const voucherPayment = financialCaptureEnabled && isVoucherPaymentMethod(normalisedLogData.payment_type);
      const prepaidPayment = financialCaptureEnabled && isPrepaidPaymentMethod(normalisedLogData.payment_type);
      if (financialCaptureEnabled && !paymentMethodId && normalisedLogData.payment_type) {
        const query = supabase
          .from('payment_methods')
          .select('id, system_key, active')
          .eq('active', true);

        const { data: paymentMethods } = prepaidPayment
          ? await query.eq('system_key', 'pilot_account').limit(1)
          : await query.ilike('name', normalisedLogData.payment_type).limit(1);

        paymentMethodId = paymentMethods?.[0]?.id ?? null;
      }
      const selectedPaymentMethodSystemKey = String(rateData?.payment_methods?.system_key || '').toLowerCase();
      const selectedPaymentMethodName = String(rateData?.payment_methods?.name || normalisedLogData.payment_type || '').toLowerCase();
      const shouldCreateStripePaymentLink = !voucherPayment
        && !prepaidPayment
        && billableAmount > 0
        && (
          selectedPaymentMethodSystemKey === 'stripe_card'
          || selectedPaymentMethodSystemKey === 'stripe'
          || selectedPaymentMethodName.includes('stripe')
        );
      let prepaidBalanceAfter: number | null = null;
      if (financialCaptureEnabled && !voucherPayment && prepaidPayment && billableAmount > 0 && normalisedLogData.student_id) {
        const ledger = await fetchUserPrepaidLedgerBalance(normalisedLogData.student_id);
        const availableCredit = Number(ledger.verifiedBalance ?? 0);
        const topUpIncrement = 1000;
        if (!ledger.xeroConnected) {
          throw new Error('Prepaid cannot be used until Xero credit can be confirmed. The old CRM prepaid balance is no longer used.');
        }
        if (availableCredit <= 0.005 && !prepaidPaymentAcknowledged) {
          throw new Error(`Prepaid is locked until the member has positive Xero credit. Top-ups can only be made in $${topUpIncrement.toFixed(2)} increments.`);
        }
        if (availableCredit + 0.005 < billableAmount && !prepaidPaymentAcknowledged) {
          const requiredTopUp = Math.max(topUpIncrement, Math.ceil((billableAmount - availableCredit) / topUpIncrement) * topUpIncrement);
          throw new Error(`This member only has $${availableCredit.toFixed(2)} of Xero credit available, so prepaid cannot cover this flight. Add a $${requiredTopUp.toFixed(2)} top-up first. Top-ups can only be made in $${topUpIncrement.toFixed(2)} increments.`);
        }
        prepaidBalanceAfter = Math.round((availableCredit - billableAmount + Number.EPSILON) * 100) / 100;
      }
      const initialPaymentStatus: 'free' | 'pending' | 'paid' | null = financialCaptureEnabled
        ? voucherPayment || prepaidPayment
          ? 'paid'
          : noCharge || billableAmount <= 0
            ? 'free'
            : 'pending'
        : null;

      const { data, error: insertError } = await supabase
        .from('flight_logs')
        .insert({
          ...normalisedLogData,
          duration: normalisedLogData.flight_duration,
          tach_start: normalisedLogData.start_tach,
          tach_end: normalisedLogData.end_tach,
          flight_type_id: financialCaptureEnabled ? normalisedLogData.flight_type_id || null : null,
          payment_type: financialCaptureEnabled ? normalisedLogData.payment_type || null : null,
          total_cost: calculatedCost,
          calculated_cost: calculatedCost,
          payment_status: initialPaymentStatus,
          xero_sync_status: financialCaptureEnabled ? 'not_synced' : null,
          financial_capture_suppressed: !financialCaptureEnabled,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (financialCaptureEnabled && !voucherPayment && initialPaymentStatus === 'paid' && billableAmount > 0 && normalisedLogData.student_id) {
        const { error: txError } = await supabase
          .from('account_transactions')
          .insert({
            user_id: normalisedLogData.student_id,
            type: 'flight_charge',
            amount: billableAmount,
            description: `Flight charge - ${new Date(normalisedLogData.start_time).toLocaleDateString('en-AU')}`,
            flight_log_id: data.id,
            payment_method_id: paymentMethodId,
            balance_after: prepaidBalanceAfter,
            verified_status: 'verified',
            created_by: user.id,
          });

        if (txError) {
          console.error('Error recording flight charge transaction:', txError);
        }

        if (!txError && prepaidPayment && prepaidBalanceAfter !== null && prepaidBalanceAfter < -0.005) {
          const topUpAmount = Math.ceil(Math.abs(prepaidBalanceAfter) / 1000) * 1000;
          const { data: topUpData, error: topUpError } = await supabase.functions.invoke('create-member-topup-checkout', {
            body: {
              userId: normalisedLogData.student_id,
              amount: topUpAmount,
              sendEmail: true,
              dedupeWindowMinutes: 60,
              triggerReason: 'negative_prepaid_after_flight_log',
              successUrl: `${window.location.origin}/billing?topup=success`,
              cancelUrl: `${window.location.origin}/billing?topup=cancelled`,
            },
          });
          if (topUpError) {
            console.error('Error sending negative prepaid top-up link:', topUpError);
          } else if ((topUpData as any)?.skipped) {
            console.info('Skipped negative prepaid top-up link because one was sent recently:', topUpData);
          }
        }
      }

      if (normalisedLogData.booking_id) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update({ flight_logged: true })
          .eq('id', normalisedLogData.booking_id);

        if (updateError) console.error('Error updating booking:', updateError);

        const { error: approvalError } = await supabase
          .from('bookings')
          .update({
            status: 'confirmed',
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', normalisedLogData.booking_id)
          .eq('status', 'pending_approval');

        if (approvalError) console.error('Error approving logged booking:', approvalError);

        await syncBookingTrainingRecordsToFlightLog(normalisedLogData.booking_id, data.id, normalisedLogData);
        requestBookingCalendarRefresh({
          bookingId: normalisedLogData.booking_id,
          reason: 'flight-log-created',
        });
      }

      const { error: aircraftUpdateError } = await supabase
        .from('aircraft')
        .update({ total_hours: normalisedLogData.end_tach })
        .eq('id', normalisedLogData.aircraft_id);

      if (aircraftUpdateError) {
        console.error('Error updating aircraft hours:', aircraftUpdateError);
      }

      let paymentLink: FlightPaymentLinkResult | null = null;
      if (financialCaptureEnabled && shouldCreateStripePaymentLink) {
        try {
          const { data: paymentLinkData, error: paymentLinkError } = await supabase.functions.invoke('create-flight-payment-checkout', {
            body: {
              flightLogId: data.id,
              sendEmail: true,
              successUrl: `${window.location.origin}/billing?stripe_flight=success`,
              cancelUrl: `${window.location.origin}/billing?stripe_flight=cancelled`,
            },
          });

          if (paymentLinkError) {
            console.error('Error preparing Stripe payment link after flight log:', paymentLinkError);
          } else if (paymentLinkData?.checkoutUrl) {
            paymentLink = {
              checkoutUrl: paymentLinkData.checkoutUrl,
              sessionId: paymentLinkData.sessionId,
              emailSent: paymentLinkData.emailSent,
              emailError: paymentLinkData.emailError ?? null,
              emailTo: paymentLinkData.emailTo ?? null,
            };
          }
        } catch (paymentLinkInvokeError) {
          console.error('Error invoking Stripe payment link creation after flight log:', paymentLinkInvokeError);
        }
      }

      if (financialCaptureEnabled && !voucherPayment && billableAmount > 0) {
        const synced = await syncXeroInvoiceIfAvailable(data.id);
        if (synced && prepaidPayment) {
          await applyFlightPaymentsIfNeeded(data.id);
        }
      }

      await fetchFlightLogs();
      return { data: { ...data, paymentLink }, error: null };
    } catch (err) {
      const errorMessage = isDuplicateBookingFlightLogError(err)
        ? FLIGHT_LOG_ALREADY_EXISTS_MESSAGE
        : err instanceof Error ? err.message : 'Failed to create flight log';
      console.error('Error creating flight log:', err);
      return { data: null, error: errorMessage };
    }
  };

  const updateFlightLog = async (id: string, updates: Partial<CreateFlightLogData>) => {
    try {
      const normalisedUpdates = { ...updates };
      if (normalisedUpdates.start_tach !== undefined) normalisedUpdates.start_tach = roundFlightDecimal(normalisedUpdates.start_tach);
      if (normalisedUpdates.end_tach !== undefined) normalisedUpdates.end_tach = roundFlightDecimal(normalisedUpdates.end_tach);
      if (normalisedUpdates.flight_duration !== undefined) normalisedUpdates.flight_duration = roundFlightDecimal(normalisedUpdates.flight_duration);
      if (normalisedUpdates.dual_time !== undefined) normalisedUpdates.dual_time = roundFlightDecimal(normalisedUpdates.dual_time);
      if (normalisedUpdates.solo_time !== undefined) normalisedUpdates.solo_time = roundFlightDecimal(normalisedUpdates.solo_time);

      if (
        normalisedUpdates.flight_duration !== undefined
        || normalisedUpdates.dual_time !== undefined
        || normalisedUpdates.solo_time !== undefined
        || normalisedUpdates.instructor_id !== undefined
      ) {
        const { data: existingAllocation, error: allocationLookupError } = await supabase
          .from('flight_logs')
          .select('flight_duration, dual_time, solo_time, instructor_id')
          .eq('id', id)
          .maybeSingle();
        if (allocationLookupError) throw allocationLookupError;
        if (!existingAllocation) throw new Error('Flight log not found');

        const allocationError = validateFlightTimeAllocation({
          durationHours: Number(normalisedUpdates.flight_duration ?? existingAllocation.flight_duration ?? 0),
          dualTime: Number(normalisedUpdates.dual_time ?? existingAllocation.dual_time ?? 0),
          soloTime: Number(normalisedUpdates.solo_time ?? existingAllocation.solo_time ?? 0),
          hasInstructor: Boolean(normalisedUpdates.instructor_id ?? existingAllocation.instructor_id),
        });
        if (allocationError) throw new Error(allocationError);
      }

      const { error: updateError } = await supabase
        .from('flight_logs')
        .update(normalisedUpdates)
        .eq('id', id);

      if (updateError) throw updateError;

      requestBookingCalendarRefresh({
        bookingId: normalisedUpdates.booking_id,
        reason: 'flight-log-updated',
      });

      if (normalisedUpdates.booking_id) {
        const { data: updatedLog, error: updatedLogError } = await supabase
          .from('flight_logs')
          .select('booking_id, aircraft_id, student_id, instructor_id, start_time, end_time, start_tach, end_tach, flight_duration, dual_time, solo_time')
          .eq('id', id)
          .maybeSingle();

        if (updatedLogError) throw updatedLogError;

        if (updatedLog?.booking_id) {
          await syncBookingTrainingRecordsToFlightLog(updatedLog.booking_id, id, {
            booking_id: updatedLog.booking_id,
            aircraft_id: updatedLog.aircraft_id,
            student_id: updatedLog.student_id,
            instructor_id: updatedLog.instructor_id,
            start_time: updatedLog.start_time,
            end_time: updatedLog.end_time,
            start_tach: Number(updatedLog.start_tach ?? 0),
            end_tach: Number(updatedLog.end_tach ?? 0),
            flight_duration: Number(updatedLog.flight_duration ?? 0),
            dual_time: Number(updatedLog.dual_time ?? 0),
            solo_time: Number(updatedLog.solo_time ?? 0),
          });
        }
      }

      if (!financialCaptureEnabled) {
        await fetchFlightLogs();
        return { error: null };
      }

      const { data: xeroCheckLog, error: xeroCheckError } = await supabase
        .from('flight_logs')
        .select('id, calculated_cost, total_cost, payment_type')
        .eq('id', id)
        .maybeSingle();

      if (xeroCheckError) throw xeroCheckError;

      const xeroBillableAmount = Number(xeroCheckLog?.calculated_cost ?? xeroCheckLog?.total_cost ?? 0);
      const xeroPaymentType = String(xeroCheckLog?.payment_type || '');

      if (!isVoucherPaymentMethod(xeroPaymentType) && xeroBillableAmount > 0) {
        const synced = await syncXeroInvoiceIfAvailable(id);
        if (synced && isPrepaidPaymentMethod(xeroPaymentType)) {
          await applyFlightPaymentsIfNeeded(id);
        }
      }

      await fetchFlightLogs();
      return { error: null };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update flight log';
      console.error('Error updating flight log:', err);
      return { error: errorMessage };
    }
  };

  const deleteFlightLog = async (id: string, options: DeleteFlightLogOptions = {}) => {
    try {
      const deleteImpact = await buildDeleteImpact(id);

      if (deleteImpact.requiresXeroAction) {
        const isAdmin = currentUser?.role === 'admin' || currentUser?.roles?.includes('admin');
        if (!isAdmin) {
          return {
            error: 'This flight log has already been synced to Xero and can only be removed by an admin using the Xero reversal flow.',
            impact: deleteImpact,
          };
        }

        const xeroMode = options.xeroMode === 'auto' || !options.xeroMode
          ? deleteImpact.recommendedAction
          : options.xeroMode;

        if (xeroMode === 'crm-only') {
          return {
            error: 'This flight log is linked to Xero and must be voided or reversed there before deletion.',
            impact: deleteImpact,
          };
        }

        const { data, error } = await supabase.functions.invoke('xero-sync', {
          body: {
            action: 'remove-flight-log',
            flightLogId: id,
            mode: xeroMode,
          },
        });

        if (error) {
          throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to reverse this flight log in Xero'));
        }

        if (data?.ok === false) {
          throw new Error(String(data?.error || 'Failed to reverse this flight log in Xero'));
        }
      }

      const bookingId = await removeLocalFlightLog(id);

      await fetchFlightLogs();
      requestBookingCalendarRefresh({ bookingId, reason: 'flight-log-deleted' });
      return { error: null, impact: deleteImpact };
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
    getFlightLogDeleteImpact: buildDeleteImpact,
    findFlightLogForBooking,
    checkTachOverlap,
    refetch: fetchFlightLogs,
  };
}
