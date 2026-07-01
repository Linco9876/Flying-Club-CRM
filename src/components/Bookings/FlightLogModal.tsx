import React, { useState, useEffect } from 'react';
import { X, Lock, Copy, ExternalLink, Mail, QrCode, Loader2 } from 'lucide-react';
import { FlightPaymentLinkResult, useFlightLogs } from '../../hooks/useFlightLogs';
import { useFlightLogSettings } from '../../hooks/useFlightLogSettings';
import { useAircraft } from '../../hooks/useAircraft';
import { useUsers } from '../../hooks/useUsers';
import { useBillingSettings } from '../../hooks/useBillingSettings';
import { useAircraftRates } from '../../hooks/useAircraftRates';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { calculateFlightCost, isPrepaidPaymentMethod, isVoucherPaymentMethod } from '../../utils/billing';
import { TachOverlapWarningModal } from './TachOverlapWarningModal';
import { fetchUserPrepaidLedgerBalance } from '../../lib/prepaidLedger';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';

interface Booking {
  id: string;
  studentId: string;
  instructorId?: string;
  aircraftId: string;
  startTime: Date | string;
  endTime: Date | string;
  notes?: string;
  flightTypeId?: string;
  paymentType?: string;
  trialFlightVoucherId?: string;
  status?: string;
  isGuestBooking?: boolean;
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  hirerName?: string;
}

interface FlightLogModalProps {
  booking: Booking;
  onClose: () => void;
  onSuccess: () => void;
  onApproveBooking?: (bookingId: string) => Promise<void> | void;
  mode?: 'create' | 'edit';
  flightLogId?: string;
}

const padDatePart = (value: number) => String(value).padStart(2, '0');

const toLocalDateTimeInputValue = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate())
  ].join('-') + `T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
};

const localDateTimeInputToIso = (value: string) => new Date(value).toISOString();

const generateQrDataUrl = async (checkoutUrl: string) => {
  const qrCodeModule = await import('qrcode');
  const qrCode = qrCodeModule.default ?? qrCodeModule;

  return qrCode.toDataURL(checkoutUrl, {
    margin: 1,
    width: 256,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
};

export const FlightLogModal: React.FC<FlightLogModalProps> = ({
  booking,
  onClose,
  onSuccess,
  onApproveBooking,
  mode = 'create',
  flightLogId,
}) => {
  const { createFlightLog, updateFlightLog, checkTachOverlap } = useFlightLogs();
  const { user: currentUser } = useAuth();
  const { effectiveSettings: settings } = useFlightLogSettings(booking.aircraftId);
  const { aircraft: aircraftList } = useAircraft();
  const { users } = useUsers();
  const { flightTypes, paymentMethods } = useBillingSettings();
  const { rates: aircraftRates } = useAircraftRates(booking.aircraftId);

  const aircraft = aircraftList.find((a) => a.id === booking.aircraftId);
  const currentTach = aircraft?.totalHours || 0;

  const startTime = booking.startTime instanceof Date ? booking.startTime : new Date(booking.startTime);
  const endTime = booking.endTime instanceof Date ? booking.endTime : new Date(booking.endTime);
  const isDualFlight = !!booking.instructorId;
  const voucherPaymentType = 'Gift Voucher';
  const isVoucherBooking = !!booking.trialFlightVoucherId || isVoucherPaymentMethod(booking.paymentType);
  const defaultFlightTypeId = isVoucherBooking ? '' : (booking.flightTypeId || '');
  const fieldClass = 'w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelClass = 'block text-xs font-medium text-gray-700 mb-1';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tachAutoFilled, setTachAutoFilled] = useState(false);
  const [hobbsAutoFilled, setHobbsAutoFilled] = useState(false);
  const [loadedFlightLogId, setLoadedFlightLogId] = useState<string>(flightLogId || '');
  const [showOverlapWarning, setShowOverlapWarning] = useState(false);
  const [adminChargeOverride, setAdminChargeOverride] = useState<number | ''>('');
  const [adminChargeTouched, setAdminChargeTouched] = useState(false);
  const [overlappingLogs, setOverlappingLogs] = useState<Array<{
    id: string;
    start_tach: number;
    end_tach: number;
    start_time: string;
    end_time: string;
  }>>([]);
  const [pendingLogData, setPendingLogData] = useState<any>(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState<FlightPaymentLinkResult | null>(null);
  const [paymentQrDataUrl, setPaymentQrDataUrl] = useState('');
  const [topUpLinkResult, setTopUpLinkResult] = useState<(FlightPaymentLinkResult & { amount?: number }) | null>(null);
  const [topUpQrDataUrl, setTopUpQrDataUrl] = useState('');
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [pendingPrepaidLogData, setPendingPrepaidLogData] = useState<any>(null);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const roundFlightDecimal = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;
  const isPrepaidFlightType = (name?: string | null) => {
    const value = (name || '').toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    return value === 'pre paid' || value === 'prepaid' || value.includes('pre paid');
  };
  const findPilotAccountPaymentMethod = () =>
    paymentMethods.find(method => isPrepaidPaymentMethod(method.name));

  // Derive payment type from the pre-filled flight type (respects forced payment and free types)
  const derivePaymentType = (flightTypeId: string) => {
    if (isVoucherBooking) return voucherPaymentType;
    if (!flightTypeId) return '';
    const ft = flightTypes.find(f => f.id === flightTypeId);
    if (!ft) return '';
    if (isPrepaidFlightType(ft.name)) {
      return findPilotAccountPaymentMethod()?.name || 'Pilot Account';
    }
    const rate = aircraftRates.find(r => r.flightTypeId === flightTypeId);
    const free = rate?.chargeType === 'free' || rate?.chargeType === 'not_used';
    if (free) return '';
    if (ft.forcedPaymentMethodId) {
      const pm = paymentMethods.find(p => p.id === ft.forcedPaymentMethodId);
      return pm?.name ?? '';
    }
    if (rate?.defaultPaymentMethodId) {
      const pm = paymentMethods.find(p => p.id === rate.defaultPaymentMethodId);
      return pm?.name ?? '';
    }
    return '';
  };

  const buildDefaultFormData = () => ({
    start_time: startTime.toISOString(),
    end_time: endTime.toISOString(),
    start_tach: currentTach,
    end_tach: '' as number | '',
    flight_duration: '' as number | '',
    dual_time: 0,
    solo_time: 0,
    takeoffs: undefined as number | undefined,
    landings: undefined as number | undefined,
    comments: '',
    flight_type_id: defaultFlightTypeId,
    payment_type: derivePaymentType(defaultFlightTypeId),
    observations: '',
    hobbs_start: undefined as number | undefined,
    hobbs_end: undefined as number | undefined,
    fuel_start: undefined as number | undefined,
    fuel_end: undefined as number | undefined,
    oil_added: undefined as number | undefined,
    oil_start: undefined as number | undefined,
    oil_end: undefined as number | undefined,
    fuel_added: undefined as number | undefined,
    fuel_type: '',
    aircraft_condition: '',
    maintenance_notes: '',
    passengers: undefined as number | undefined,
  });

  const [formData, setFormData] = useState(buildDefaultFormData);

  const selectedFlightType = flightTypes.find(ft => ft.id === formData.flight_type_id) ?? null;
  const selectedRate = aircraftRates.find(r => r.flightTypeId === formData.flight_type_id) ?? null;
  const isFree = selectedRate?.chargeType === 'free' || selectedRate?.chargeType === 'not_used';
  const isPrepaidSelectedFlightType = isPrepaidFlightType(selectedFlightType?.name);
  const isPaymentForced = isVoucherBooking || isPrepaidSelectedFlightType || (!isFree && !!selectedFlightType?.forcedPaymentMethodId);
  const isAdmin = currentUser?.role === 'admin' || currentUser?.roles?.includes('admin');
  const estimatedCost = calculateFlightCost({
    rate: selectedRate,
    durationHours: formData.flight_duration === '' ? 0 : formData.flight_duration,
    isDual: isDualFlight,
    passengerCount: formData.passengers,
    startTime: formData.start_time,
  });
  const showAdminChargeOverride = mode === 'create' && isAdmin && !!formData.flight_type_id && formData.flight_duration !== '' && !isVoucherBooking;
  const finalCharge = showAdminChargeOverride && adminChargeOverride !== ''
    ? Number(adminChargeOverride)
    : estimatedCost;

  useEffect(() => {
    setIsSubmitting(false);
    setTachAutoFilled(false);
    setHobbsAutoFilled(false);
    setLoadedFlightLogId(flightLogId || '');
    setShowOverlapWarning(false);
    setAdminChargeOverride('');
    setAdminChargeTouched(false);
    setOverlappingLogs([]);
    setPendingLogData(null);
    setPaymentLinkResult(null);
    setPaymentQrDataUrl('');
    setTopUpLinkResult(null);
    setTopUpQrDataUrl('');
    setTopUpLoading(false);
    setPendingPrepaidLogData(null);
    setSubmissionMessage('');
    setFormData(buildDefaultFormData());
  }, [booking.id, flightLogId, mode]);

  useEffect(() => {
    let cancelled = false;

    const buildQrCode = async () => {
      if (!paymentLinkResult?.checkoutUrl) {
        setPaymentQrDataUrl('');
        return;
      }

      try {
        const dataUrl = await generateQrDataUrl(paymentLinkResult.checkoutUrl);

        if (!cancelled) {
          setPaymentQrDataUrl(dataUrl);
        }
      } catch (error) {
        console.error('Failed to generate QR code:', error);
        if (!cancelled) {
          setPaymentQrDataUrl('');
        }
      }
    };

    void buildQrCode();
    return () => {
      cancelled = true;
    };
  }, [paymentLinkResult]);

  useEffect(() => {
    let cancelled = false;

    const buildQrCode = async () => {
      if (!topUpLinkResult?.checkoutUrl) {
        setTopUpQrDataUrl('');
        return;
      }

      try {
        const dataUrl = await generateQrDataUrl(topUpLinkResult.checkoutUrl);

        if (!cancelled) {
          setTopUpQrDataUrl(dataUrl);
        }
      } catch (error) {
        console.error('Failed to generate top-up QR code:', error);
        if (!cancelled) {
          setTopUpQrDataUrl('');
        }
      }
    };

    void buildQrCode();
    return () => {
      cancelled = true;
    };
  }, [topUpLinkResult]);

  // Re-derive payment type when billing data loads (paymentMethods/flightTypes async) or flight type changes
  useEffect(() => {
    if (!flightTypes.length) return;

    if (isVoucherBooking) {
      setFormData(prev => (
        prev.flight_type_id === '' && prev.payment_type === voucherPaymentType
          ? prev
          : { ...prev, flight_type_id: '', payment_type: voucherPaymentType }
      ));
      return;
    }

    if (!formData.flight_type_id) return;
    const derived = derivePaymentType(formData.flight_type_id);
    setFormData(prev => ({ ...prev, payment_type: derived }));
  }, [formData.flight_type_id, flightTypes.length, aircraftRates.length, paymentMethods.length, isVoucherBooking]);

  useEffect(() => {
    if (!showAdminChargeOverride || adminChargeTouched) return;
    setAdminChargeOverride(Number(estimatedCost.toFixed(2)));
  }, [showAdminChargeOverride, adminChargeTouched, estimatedCost]);

  useEffect(() => {
    if (mode !== 'edit') return;

    const loadExistingFlightLog = async () => {
      const query = supabase
        .from('flight_logs')
        .select('*')
        .limit(1);

      const { data, error } = flightLogId
        ? await query.eq('id', flightLogId).maybeSingle()
        : await query.eq('booking_id', booking.id).maybeSingle();

      if (error) {
        toast.error('Failed to load flight log');
        return;
      }

      if (!data) {
        toast.error('Flight log could not be found');
        return;
      }

      const defaults = buildDefaultFormData();
      setLoadedFlightLogId(data.id);
      setTachAutoFilled(false);
      setFormData({
        ...defaults,
        start_time: data.start_time ?? defaults.start_time,
        end_time: data.end_time ?? defaults.end_time,
        start_tach: Number(data.start_tach ?? data.tach_start ?? defaults.start_tach),
        end_tach: data.end_tach ?? data.tach_end ?? '',
        flight_duration: data.flight_duration ?? data.duration ?? '',
        dual_time: Number(data.dual_time ?? 0),
        solo_time: Number(data.solo_time ?? 0),
        takeoffs: data.takeoffs ?? undefined,
        landings: data.landings ?? undefined,
        comments: data.comments ?? data.notes ?? '',
        flight_type_id: data.flight_type_id ?? defaults.flight_type_id,
        payment_type: data.payment_type ?? defaults.payment_type,
        observations: data.observations ?? '',
        hobbs_start: data.hobbs_start ?? undefined,
        hobbs_end: data.hobbs_end ?? undefined,
        fuel_start: data.fuel_start ?? undefined,
        fuel_end: data.fuel_end ?? undefined,
        oil_added: data.oil_added ?? undefined,
        oil_start: data.oil_start ?? undefined,
        oil_end: data.oil_end ?? undefined,
        fuel_added: data.fuel_added ?? undefined,
        fuel_type: data.fuel_type ?? '',
        aircraft_condition: data.aircraft_condition ?? '',
        maintenance_notes: data.maintenance_notes ?? '',
        passengers: data.passengers ?? undefined,
      });
    };

    loadExistingFlightLog();
  }, [booking.id, flightLogId, mode]);

  useEffect(() => {
    const calculateAutoFilledMeterStarts = async () => {
      if (mode === 'edit') return;
      if (!booking.aircraftId) return;

      const hobbsEnabled = settings.some(setting => setting.field_name === 'hobbs_start' && setting.is_enabled);
      const tachEnabled = settings.some(setting => setting.field_name === 'start_tach' && setting.is_enabled);
      if (!hobbsEnabled && !tachEnabled) return;

      try {
        const { data: logs, error } = await supabase
          .from('flight_logs')
          .select('start_time, end_time, start_tach, end_tach, hobbs_start, hobbs_end')
          .eq('aircraft_id', booking.aircraftId)
          .order('end_time', { ascending: false });

        if (error || !logs || logs.length === 0) return;

        const previousLog = logs.find(log => log.end_time && new Date(log.end_time) <= startTime);
        if (!previousLog) return;

        const nextState: Partial<typeof formData> = {};

        if (tachEnabled && previousLog.end_tach != null && previousLog.end_tach !== '') {
          const startTach = parseFloat(previousLog.end_tach);
          if (Number.isFinite(startTach)) {
            nextState.start_tach = startTach;
            setTachAutoFilled(true);
          }
        }

        if (hobbsEnabled && previousLog.hobbs_end != null && previousLog.hobbs_end !== '') {
          const startHobbs = parseFloat(previousLog.hobbs_end);
          if (Number.isFinite(startHobbs)) {
            nextState.hobbs_start = startHobbs;
            setHobbsAutoFilled(true);
          }
        }

        if (Object.keys(nextState).length > 0) {
          setFormData(prev => ({
            ...prev,
            ...nextState,
          }));
        }
      } catch (err) {
        console.error('Error calculating log meter start values:', err);
      }
    };
    calculateAutoFilledMeterStarts();
  }, [booking.aircraftId, mode, startTime, settings]);

  const handleTachChange = (field: 'start_tach' | 'end_tach', value: string) => {
    const numValue = value === '' ? '' : parseFloat(value);
    const newData = { ...formData, [field]: numValue };

    if (numValue === '' || Number.isNaN(numValue)) {
      if (field === 'end_tach') {
        newData.flight_duration = '';
        newData.dual_time = 0;
        newData.solo_time = 0;
      }
      setFormData(newData);
      return;
    }

    if (field === 'start_tach' && formData.end_tach !== '') {
      const duration = roundFlightDecimal(Math.max(0, formData.end_tach - numValue));
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    } else if (field === 'end_tach') {
      const duration = roundFlightDecimal(Math.max(0, numValue - formData.start_tach));
      newData.flight_duration = duration;
      newData.dual_time = isDualFlight ? duration : 0;
      newData.solo_time = isDualFlight ? 0 : duration;
    }
    setFormData(newData);
  };

  const handleDurationChange = (value: string) => {
    const duration = value === '' ? '' : roundFlightDecimal(parseFloat(value));
    if (duration === '' || Number.isNaN(duration)) {
      setFormData({
        ...formData,
        flight_duration: '',
        dual_time: 0,
        solo_time: 0,
      });
      return;
    }

    setFormData({
      ...formData,
      flight_duration: duration,
      end_tach: roundFlightDecimal(formData.start_tach + duration),
      dual_time: isDualFlight ? duration : 0,
      solo_time: isDualFlight ? 0 : duration,
    });
  };

  const getFieldSetting = (fieldName: string) => settings.find((s) => s.field_name === fieldName);
  const fieldDefaultEnabled: Record<string, boolean> = {
    start_time: true,
    end_time: true,
    start_tach: true,
    end_tach: true,
    flight_duration: true,
    flight_type: true,
    payment_type: true,
    takeoffs_landings: true,
    comments: true,
  };
  const fieldDefaultMandatory: Record<string, boolean> = {
    start_time: true,
    end_time: true,
    start_tach: true,
    end_tach: true,
    flight_duration: true,
    flight_type: true,
    payment_type: true,
  };
  const isFieldEnabled = (fieldName: string) => getFieldSetting(fieldName)?.is_enabled ?? fieldDefaultEnabled[fieldName] ?? false;
  const isFieldMandatory = (fieldName: string) => getFieldSetting(fieldName)?.is_mandatory ?? fieldDefaultMandatory[fieldName] ?? false;
  const isTakeoffsLandingsEnabled = isFieldEnabled('takeoffs_landings') || isFieldEnabled('landings');
  const isTakeoffsLandingsMandatory = isFieldMandatory('takeoffs_landings') || isFieldMandatory('landings');
  const isPaymentSelectorEnabled = isFieldEnabled('payment_type');

  const validateForm = (): string | null => {
    if (formData.end_tach === '') return 'Please enter end tach';
    if (formData.flight_duration === '') return 'Please enter flight duration';
    if (formData.start_tach >= formData.end_tach) return 'End tach must be greater than start tach';
    if (formData.flight_duration <= 0) return 'Flight duration must be positive';
    if (!isVoucherBooking && !formData.flight_type_id) return 'Please select a flight type';
    if (showAdminChargeOverride && adminChargeOverride !== '' && (!Number.isFinite(adminChargeOverride) || adminChargeOverride < 0)) return 'Flight charge cannot be negative';
    if (!isFree && isPaymentSelectorEnabled && isFieldMandatory('payment_type') && !formData.payment_type) return 'Please select a payment type';
    if (isTakeoffsLandingsMandatory && (formData.takeoffs === undefined || formData.landings === undefined)) return 'Please enter takeoffs and landings';
    if (isFieldMandatory('comments') && !formData.comments.trim()) return 'Please enter debrief comments';
    if (isFieldMandatory('observations') && !formData.observations.trim()) return 'Please enter observations';
    if (isFieldMandatory('hobbs_start') && formData.hobbs_start === undefined) return 'Please enter Hobbs start';
    if (isFieldMandatory('hobbs_end') && formData.hobbs_end === undefined) return 'Please enter Hobbs end';
    if (formData.hobbs_start !== undefined && formData.hobbs_end !== undefined && formData.hobbs_end < formData.hobbs_start) return 'Hobbs end must be greater than or equal to Hobbs start';
    if (isFieldMandatory('fuel_start') && formData.fuel_start === undefined) return 'Please enter fuel before flight';
    if (isFieldMandatory('fuel_end') && formData.fuel_end === undefined) return 'Please enter fuel after flight';
    if (isFieldMandatory('oil_added') && formData.oil_added === undefined) return 'Please enter oil added';
    if (isFieldMandatory('oil_start') && formData.oil_start === undefined) return 'Please enter oil before flight';
    if (isFieldMandatory('oil_end') && formData.oil_end === undefined) return 'Please enter oil after flight';
    if (isFieldMandatory('fuel_added') && formData.fuel_added === undefined) return 'Please enter fuel added';
    if (isFieldMandatory('fuel_type') && !formData.fuel_type.trim()) return 'Please enter fuel type';
    if (isFieldMandatory('aircraft_condition') && !formData.aircraft_condition.trim()) return 'Please enter aircraft condition';
    if (isFieldMandatory('maintenance_notes') && !formData.maintenance_notes.trim()) return 'Please enter maintenance notes';
    if (isFieldMandatory('passengers') && formData.passengers === undefined) return 'Please enter passenger count';
    return null;
  };

  const saveFlightLog = async (logData: any) => {
    setSubmissionMessage(mode === 'edit'
      ? 'Saving the flight log and updating linked billing records...'
      : 'Logging the flight and syncing billing, Xero and payment records...');

    if (booking.status === 'pending_approval' && onApproveBooking) {
      await onApproveBooking(booking.id);
    }

    const targetFlightLogId = loadedFlightLogId || flightLogId;
    if (mode === 'edit' && !targetFlightLogId) {
      toast.error('Flight log could not be found');
      return;
    }

    const result = mode === 'edit'
      ? await updateFlightLog(targetFlightLogId, logData)
      : await createFlightLog(logData);
    const { error, data } = result;
    if (error) {
      toast.error(error);
      return;
    }

    const paymentLink = (data as any)?.paymentLink as FlightPaymentLinkResult | null | undefined;
    if (mode === 'create' && paymentLink?.checkoutUrl) {
      toast.success('Flight logged successfully');
      setPaymentLinkResult(paymentLink);
      if (paymentLink.emailSent) {
        toast.success(`Payment link emailed${paymentLink.emailTo ? ` to ${paymentLink.emailTo}` : ''}`);
      } else if (paymentLink.emailError) {
        toast(`Payment link ready${paymentLink.emailTo ? ` for ${paymentLink.emailTo}` : ''}. Email was not sent automatically.`, {
          icon: '!',
        });
      }
      return;
    }

    toast.success(mode === 'edit' ? 'Flight log updated successfully' : 'Flight logged successfully');
    onSuccess();
    onClose();
  };

  const ensurePrepaidCanCoverFlight = async (logData: any) => {
    if (isVoucherBooking) return true;
    const selectedType = flightTypes.find(type => type.id === logData.flight_type_id);
    const usesPrepaid = isPrepaidFlightType(selectedType?.name) || isPrepaidPaymentMethod(logData.payment_type);
    if (!usesPrepaid || !logData.student_id) return true;

    setSubmissionMessage('Checking the verified prepaid balance before prepaid is used...');
    const balance = await fetchUserPrepaidLedgerBalance(logData.student_id);
    const availableCredit = Number(balance.verifiedBalance ?? 0);
    const topUpIncrement = 1000;
    const chargeAmount = Number(finalCharge || estimatedCost || 0);
    const requiredTopUp = Math.max(topUpIncrement, Math.ceil(Math.max(0, chargeAmount - availableCredit) / topUpIncrement) * topUpIncrement);

    if (availableCredit > 0.005 && availableCredit + 0.005 >= chargeAmount) return true;

    setTopUpLinkResult({
      checkoutUrl: '',
      sessionId: '',
      emailSent: false,
      emailError: null,
      emailTo: users.find(item => item.id === logData.student_id)?.email || null,
      amount: requiredTopUp,
    });
    setPendingPrepaidLogData(logData);
    return false;
  };

  const createTopUpPaymentLink = async () => {
    if (!booking.studentId || topUpLoading) return;
    setTopUpLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-member-topup-checkout', {
        body: {
          userId: booking.studentId,
          amount: topUpLinkResult?.amount || 1000,
          sendEmail: true,
          successUrl: `${window.location.origin}/billing?topup=success`,
          cancelUrl: `${window.location.origin}/billing?topup=cancelled`,
        },
      });

      if (error) {
        throw new Error(await getSupabaseFunctionErrorMessage(error, 'Failed to create top-up payment link'));
      }
      if (!data?.checkoutUrl) throw new Error('Stripe did not return a top-up payment link');

      setTopUpLinkResult({
        checkoutUrl: data.checkoutUrl,
        sessionId: data.sessionId,
        emailSent: data.emailSent,
        emailError: data.emailError,
        emailTo: data.emailTo,
        amount: Number(data.amount || topUpLinkResult?.amount || 1000),
      });
      if (data.emailSent) {
        toast.success(`Top-up link emailed${data.emailTo ? ` to ${data.emailTo}` : ''}`);
      } else {
        toast('Top-up payment link ready. Use the QR code or copy the link.', { icon: '$' });
      }
    } catch (error) {
      console.error('Failed to create member top-up checkout:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create top-up payment link');
    } finally {
      setTopUpLoading(false);
    }
  };

  const continueWithTachCheckAndSave = async (logData: any) => {
    setSubmissionMessage('Checking tach history before saving...');
    const { overlaps, error: overlapError } = await checkTachOverlap(
      booking.aircraftId,
      Number(logData.start_tach),
      Number(logData.end_tach),
      mode === 'edit' ? (loadedFlightLogId || flightLogId) : undefined
    );

    if (overlapError) {
      toast.error(overlapError);
      return;
    }

    if (overlaps.length > 0) {
      setOverlappingLogs(overlaps);
      setPendingLogData(logData);
      setShowOverlapWarning(true);
      return;
    }

    await saveFlightLog(logData);
  };

  const handlePrepaidPaymentMade = async () => {
    if (!pendingPrepaidLogData || isSubmitting) return;
    try {
      setIsSubmitting(true);
      setTopUpLinkResult(null);
      setTopUpQrDataUrl('');
      const logData = {
        ...pendingPrepaidLogData,
        prepaid_payment_acknowledged: true,
      };
      setPendingPrepaidLogData(null);
      await continueWithTachCheckAndSave(logData);
    } catch (error) {
      console.error('Failed to proceed with acknowledged prepaid payment:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to log flight');
    } finally {
      setIsSubmitting(false);
      setSubmissionMessage('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const validationError = validateForm();
      if (validationError) {
        toast.error(validationError);
        return;
      }
      setIsSubmitting(true);
      setSubmissionMessage('Preparing the flight log...');

      const logData = {
        booking_id: booking.id,
        aircraft_id: booking.aircraftId,
        student_id: booking.studentId,
        instructor_id: booking.instructorId,
        start_time: formData.start_time,
        end_time: formData.end_time,
        start_tach: formData.start_tach,
        end_tach: formData.end_tach,
        flight_duration: roundFlightDecimal(Number(formData.flight_duration)),
        dual_time: roundFlightDecimal(formData.dual_time),
        solo_time: roundFlightDecimal(formData.solo_time),
        takeoffs: isTakeoffsLandingsEnabled ? formData.takeoffs : undefined,
        comments: isFieldEnabled('comments') ? formData.comments || undefined : undefined,
        flight_type_id: isVoucherBooking ? undefined : formData.flight_type_id || undefined,
        payment_type: isVoucherBooking ? voucherPaymentType : formData.payment_type || undefined,
        ...(showAdminChargeOverride && { calculated_cost: Number(finalCharge.toFixed(2)) }),
        ...(isTakeoffsLandingsEnabled && { landings: formData.landings }),
        ...(isFieldEnabled('observations') && { observations: formData.observations }),
        ...(isFieldEnabled('hobbs_start') && { hobbs_start: formData.hobbs_start }),
        ...(isFieldEnabled('hobbs_end') && { hobbs_end: formData.hobbs_end }),
        ...(isFieldEnabled('fuel_start') && { fuel_start: formData.fuel_start }),
        ...(isFieldEnabled('fuel_end') && { fuel_end: formData.fuel_end }),
        ...(isFieldEnabled('oil_added') && { oil_added: formData.oil_added }),
        ...(isFieldEnabled('oil_start') && { oil_start: formData.oil_start }),
        ...(isFieldEnabled('oil_end') && { oil_end: formData.oil_end }),
        ...(isFieldEnabled('fuel_added') && { fuel_added: formData.fuel_added }),
        ...(isFieldEnabled('fuel_type') && { fuel_type: formData.fuel_type || undefined }),
        ...(isFieldEnabled('aircraft_condition') && { aircraft_condition: formData.aircraft_condition || undefined }),
        ...(isFieldEnabled('maintenance_notes') && { maintenance_notes: formData.maintenance_notes || undefined }),
        ...(isFieldEnabled('passengers') && { passengers: formData.passengers }),
      };

      const prepaidReady = await ensurePrepaidCanCoverFlight(logData);
      if (!prepaidReady) {
        setIsSubmitting(false);
        return;
      }

      await continueWithTachCheckAndSave(logData);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log flight');
    } finally {
      setIsSubmitting(false);
      setSubmissionMessage('');
    }
  };

  const handleConfirmOverlap = async () => {
    if (!pendingLogData) return;
    try {
      setIsSubmitting(true);
      setSubmissionMessage('Saving the flight log after tach warning confirmation...');
      await saveFlightLog(pendingLogData);
      setShowOverlapWarning(false);
      setPendingLogData(null);
      setOverlappingLogs([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log flight');
    } finally {
      setIsSubmitting(false);
      setSubmissionMessage('');
    }
  };

  const handleCancelOverlap = () => {
    setShowOverlapWarning(false);
    setPendingLogData(null);
    setOverlappingLogs([]);
  };

  const student = users.find((u) => u.id === booking.studentId);
  const instructor = booking.instructorId ? users.find((u) => u.id === booking.instructorId) : null;
  const guestLabel = booking.guestName || booking.hirerName || 'Guest';
  const studentLabel = booking.isGuestBooking ? guestLabel : (student?.name || 'Unknown');
  const pilotInCommand = instructor ? instructor.name : studentLabel;
  const otherPilot = instructor ? studentLabel : (isDualFlight ? studentLabel : 'Self');
  const availablePaymentMethods = paymentMethods.filter((pm) => {
    if (!pm.active) return false;
    if (!booking.isGuestBooking) return true;
    const name = String(pm.name || '').toLowerCase();
    return !name.includes('pilot account') && !name.includes('prepaid') && !name.includes('pre-paid');
  });

  return (
    <>
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">{mode === 'edit' ? 'Edit Flight Log' : 'Log Flight'}</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Flight Summary */}
          <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Aircraft</span>
              <p className="font-medium text-gray-900">
                {aircraft ? `${aircraft.registration} – ${aircraft.make} ${aircraft.model}` : 'Unknown'}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Pilot in Command</span>
              <p className="font-medium text-gray-900">{pilotInCommand}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">
                {instructor ? 'Student' : 'Other Crew'}
              </span>
              <p className="font-medium text-gray-900">{otherPilot}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase">Flight Type</span>
              <p className="font-medium text-gray-900">{isDualFlight ? 'Dual (with Instructor)' : 'Solo'}</p>
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Time</label>
              <input
                type="datetime-local"
                value={toLocalDateTimeInputValue(formData.start_time)}
                onChange={(e) => setFormData({ ...formData, start_time: localDateTimeInputToIso(e.target.value) })}
                className={fieldClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>End Time</label>
              <input
                type="datetime-local"
                value={toLocalDateTimeInputValue(formData.end_time)}
                onChange={(e) => setFormData({ ...formData, end_time: localDateTimeInputToIso(e.target.value) })}
                className={fieldClass}
                required
              />
            </div>
          </div>

          {/* Tach / Duration */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={labelClass}>
                Start Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.start_tach}
                onChange={(e) => handleTachChange('start_tach', e.target.value)}
                className={fieldClass}
                required
              />
              {tachAutoFilled && <p className="text-xs text-green-600 mt-1">Auto-filled from previous log</p>}
            </div>
            <div>
              <label className={labelClass}>
                End Tach <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.end_tach}
                onChange={(e) => handleTachChange('end_tach', e.target.value)}
                className={fieldClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>
                Duration <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.flight_duration}
                onChange={(e) => handleDurationChange(e.target.value)}
                className={fieldClass}
                required
              />
            </div>
            {isTakeoffsLandingsEnabled && (
              <div>
                <label className={labelClass}>
                  T/O &amp; Landings {isTakeoffsLandingsMandatory && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.takeoffs ?? ''}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value) : undefined;
                    setFormData({ ...formData, takeoffs: val, landings: val });
                  }}
                  className={fieldClass}
                  required={isTakeoffsLandingsMandatory}
                />
              </div>
            )}
          </div>

          {isVoucherBooking && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-semibold">Covered by linked gift voucher</p>
              <p className="mt-1 text-xs text-amber-800">
                Flight type and payment selection are not required because this booking is already voucher-paid.
              </p>
            </div>
          )}

          {/* Flight Type + Payment Type */}
          <div className={`${isVoucherBooking ? 'hidden' : 'grid'} grid-cols-1 md:grid-cols-2 gap-3`}>
            <div>
              <label className={labelClass}>
                Flight Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.flight_type_id}
                onChange={(e) => {
                  if (!isVoucherBooking) {
                    const nextFlightTypeId = e.target.value;
                    setFormData(prev => ({
                      ...prev,
                      flight_type_id: nextFlightTypeId,
                      payment_type: derivePaymentType(nextFlightTypeId),
                    }));
                  }
                }}
                className={`${fieldClass} ${
                  isVoucherBooking
                    ? 'border-amber-300 bg-amber-50 text-amber-900 cursor-not-allowed'
                    : ''
                }`}
                required
                disabled={isVoucherBooking}
              >
                <option value="">Select flight type</option>
                {flightTypes.filter(ft => ft.active).map(ft => (
                  <option key={ft.id} value={ft.id}>{ft.name}</option>
                ))}
              </select>
              {isFree && formData.flight_type_id && (
                <p className="mt-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5 inline-block">
                  No charge — payment not required
                </p>
              )}
            </div>

            {!isFree && isPaymentSelectorEnabled && (
              <div>
                <label className={labelClass}>
                  Payment Type {isFieldMandatory('payment_type') && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={formData.payment_type}
                  onChange={(e) => {
                    if (!isPaymentForced) setFormData(prev => ({ ...prev, payment_type: e.target.value }));
                  }}
                  className={`w-full px-2 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isPaymentForced
                      ? 'border-amber-300 bg-amber-50 text-amber-900 cursor-not-allowed'
                      : 'border-gray-300'
                  }`}
                  required={isFieldMandatory('payment_type')}
                  disabled={isPaymentForced}
                >
                  <option value="">Select payment type</option>
                  {isVoucherBooking && (
                    <option value={formData.payment_type || 'Gift Voucher'}>
                      {formData.payment_type || 'Gift Voucher'}
                    </option>
                  )}
                  {availablePaymentMethods.map(pm => (
                    <option key={pm.id} value={pm.name}>{pm.name}</option>
                  ))}
                </select>
                {isPaymentForced && (
                  <p className="mt-1 inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">
                    <Lock className="h-3 w-3" />
                    {isVoucherBooking ? 'Covered by voucher' : isPrepaidSelectedFlightType ? 'Pilot Account required' : 'Required by flight type'}
                  </p>
                )}
              </div>
            )}
          </div>

          {!isVoucherBooking && formData.flight_type_id && formData.flight_duration !== '' && (
            <div className="rounded-lg border border-gray-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  {isVoucherBooking ? 'Voucher value used for this flight: ' : 'Estimated charge: '}
                  <span className="font-semibold">${estimatedCost.toFixed(2)}</span>
                  {selectedRate && (
                    <span className="ml-2 text-xs text-blue-700">
                      {selectedRate.chargeType === 'tach'
                        ? `${isDualFlight ? 'Dual' : 'Solo'} tach rate`
                        : selectedRate.chargeType.replace('_', ' ')}
                    </span>
                  )}
                </div>
                {showAdminChargeOverride && (
                  <div className="flex flex-col gap-1 md:min-w-[220px]">
                    <label className="text-xs font-semibold text-blue-900">Admin final charge</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-700">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={adminChargeOverride}
                          onChange={(event) => {
                            setAdminChargeTouched(true);
                            const nextValue = event.target.value;
                            if (nextValue === '') {
                              setAdminChargeOverride('');
                              return;
                            }
                            const parsedValue = Number(nextValue);
                            setAdminChargeOverride(Number.isFinite(parsedValue) ? parsedValue : '');
                          }}
                          className="w-full rounded-md border border-blue-200 bg-white py-1.5 pl-6 pr-2 text-sm font-semibold text-blue-950 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAdminChargeOverride(Number(estimatedCost.toFixed(2)));
                          setAdminChargeTouched(false);
                        }}
                        className="rounded-md border border-blue-200 bg-white px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        Use rate
                      </button>
                    </div>
                    {Number(finalCharge.toFixed(2)) !== Number(estimatedCost.toFixed(2)) && (
                      <p className="text-xs text-blue-700">This log will charge ${finalCharge.toFixed(2)} instead of the rate price.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {isFieldEnabled('comments') && (
            <div>
              <label className={labelClass}>
                Comments {isFieldMandatory('comments') && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={formData.comments}
                onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
                rows={2}
                placeholder="Flight notes, debrief summary, areas to work on..."
                className={fieldClass}
                required={isFieldMandatory('comments')}
              />
            </div>
          )}

          {/* Optional settings-controlled fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {isFieldEnabled('hobbs_start') && (
              <div>
                <label className={labelClass}>
                  Hobbs Start {isFieldMandatory('hobbs_start') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.hobbs_start ?? ''}
                  onChange={(e) => setFormData({ ...formData, hobbs_start: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('hobbs_start')}
                />
                {hobbsAutoFilled && <p className="text-xs text-green-600 mt-1">Auto-filled from previous log</p>}
              </div>
            )}
            {isFieldEnabled('hobbs_end') && (
              <div>
                <label className={labelClass}>
                  Hobbs End {isFieldMandatory('hobbs_end') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.hobbs_end ?? ''}
                  onChange={(e) => setFormData({ ...formData, hobbs_end: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('hobbs_end')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_start') && (
              <div>
                <label className={labelClass}>
                  Fuel Before {isFieldMandatory('fuel_start') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuel_start ?? ''}
                  onChange={(e) => setFormData({ ...formData, fuel_start: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('fuel_start')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_end') && (
              <div>
                <label className={labelClass}>
                  Fuel After {isFieldMandatory('fuel_end') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuel_end ?? ''}
                  onChange={(e) => setFormData({ ...formData, fuel_end: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('fuel_end')}
                />
              </div>
            )}
            {isFieldEnabled('oil_added') && (
              <div>
                <label className={labelClass}>
                  Oil Added (quarts) {isFieldMandatory('oil_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.oil_added || ''}
                  onChange={(e) => setFormData({ ...formData, oil_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('oil_added')}
                />
              </div>
            )}
            {isFieldEnabled('oil_start') && (
              <div>
                <label className={labelClass}>
                  Oil Before {isFieldMandatory('oil_start') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.oil_start ?? ''}
                  onChange={(e) => setFormData({ ...formData, oil_start: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('oil_start')}
                />
              </div>
            )}
            {isFieldEnabled('oil_end') && (
              <div>
                <label className={labelClass}>
                  Oil After {isFieldMandatory('oil_end') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.oil_end ?? ''}
                  onChange={(e) => setFormData({ ...formData, oil_end: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('oil_end')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_added') && (
              <div>
                <label className={labelClass}>
                  Fuel Added (gallons) {isFieldMandatory('fuel_added') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.fuel_added || ''}
                  onChange={(e) => setFormData({ ...formData, fuel_added: e.target.value ? parseFloat(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('fuel_added')}
                />
              </div>
            )}
            {isFieldEnabled('fuel_type') && (
              <div>
                <label className={labelClass}>
                  Fuel Type {isFieldMandatory('fuel_type') && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={formData.fuel_type}
                  onChange={(e) => setFormData({ ...formData, fuel_type: e.target.value })}
                  className={fieldClass}
                  required={isFieldMandatory('fuel_type')}
                >
                  <option value="">Select fuel type</option>
                  <option value="Avgas">Avgas</option>
                  <option value="Mogas">Mogas</option>
                  <option value="Jet A-1">Jet A-1</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            )}
            {isFieldEnabled('passengers') && (
              <div>
                <label className={labelClass}>
                  Passengers {isFieldMandatory('passengers') && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="number"
                  value={formData.passengers || ''}
                  onChange={(e) => setFormData({ ...formData, passengers: e.target.value ? parseInt(e.target.value) : undefined })}
                  className={fieldClass}
                  required={isFieldMandatory('passengers')}
                />
              </div>
            )}
          </div>

          {(isFieldEnabled('aircraft_condition') || isFieldEnabled('maintenance_notes')) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {isFieldEnabled('aircraft_condition') && (
                <div>
                  <label className={labelClass}>
                    Aircraft Condition {isFieldMandatory('aircraft_condition') && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    value={formData.aircraft_condition}
                    onChange={(e) => setFormData({ ...formData, aircraft_condition: e.target.value })}
                    className={fieldClass}
                    required={isFieldMandatory('aircraft_condition')}
                  >
                    <option value="">Select condition</option>
                    <option value="Serviceable">Serviceable</option>
                    <option value="Monitor">Monitor</option>
                    <option value="Attention required">Attention required</option>
                    <option value="Defect reported">Defect reported</option>
                  </select>
                </div>
              )}
              {isFieldEnabled('maintenance_notes') && (
                <div>
                  <label className={labelClass}>
                    Maintenance Notes {isFieldMandatory('maintenance_notes') && <span className="text-red-500">*</span>}
                  </label>
                  <textarea
                    value={formData.maintenance_notes}
                    onChange={(e) => setFormData({ ...formData, maintenance_notes: e.target.value })}
                    rows={2}
                    className={fieldClass}
                    required={isFieldMandatory('maintenance_notes')}
                  />
                </div>
              )}
            </div>
          )}

          {isFieldEnabled('observations') && (
            <div>
              <label className={labelClass}>
                Observations {isFieldMandatory('observations') && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={formData.observations}
                onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
                rows={2}
                className={fieldClass}
                required={isFieldMandatory('observations')}
              />
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? (mode === 'edit' ? 'Saving...' : 'Logging...') : (mode === 'edit' ? 'Save Flight Log' : 'Log Flight')}
            </button>
          </div>
        </form>
      </div>
    </div>
    {isSubmitting && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-2xl">
          <div className="bg-gradient-to-r from-blue-700 to-slate-900 px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <div>
                <h3 className="text-base font-semibold">
                  {mode === 'edit' ? 'Updating flight log' : 'Logging flight'}
                </h3>
                <p className="text-sm text-blue-100">Please keep this window open.</p>
              </div>
            </div>
          </div>
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm font-medium text-gray-900">
              {submissionMessage || 'Finishing the flight workflow...'}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-600">
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-2 py-2">
                <p className="font-semibold text-blue-900">Flight log</p>
                <p>Saving</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-2 py-2">
                <p className="font-semibold text-amber-900">Billing</p>
                <p>Checking</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-2 py-2">
                <p className="font-semibold text-emerald-900">Xero</p>
                <p>Syncing</p>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-600" />
            </div>
          </div>
        </div>
      </div>
    )}
    {paymentLinkResult && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Payment link ready</h3>
              <p className="text-xs text-gray-500">The flight has been logged and is ready for payment.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPaymentLinkResult(null);
                setPaymentQrDataUrl('');
                onSuccess();
                onClose();
              }}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">
                    {paymentLinkResult.emailSent
                      ? `Email sent${paymentLinkResult.emailTo ? ` to ${paymentLinkResult.emailTo}` : ''}`
                      : 'Use the QR code or copy the link below'}
                  </p>
                  {paymentLinkResult.emailError && (
                    <p className="mt-1 text-xs text-blue-800">{paymentLinkResult.emailError}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <QrCode className="h-4 w-4" />
                <span>Scan to pay</span>
              </div>
              {paymentQrDataUrl ? (
                <img src={paymentQrDataUrl} alt="Stripe payment QR code" className="h-40 w-40 rounded-xl bg-white p-2 shadow-sm" />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-white text-sm text-gray-500 shadow-sm">
                  Preparing QR code...
                </div>
              )}
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(paymentLinkResult.checkoutUrl);
                    toast.success('Payment link copied');
                  } catch (error) {
                    console.error('Failed to copy payment link:', error);
                    toast.error('Could not copy the payment link');
                  }
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Copy className="h-4 w-4" />
                <span>Copy payment link</span>
              </button>
              <button
                type="button"
                onClick={() => window.open(paymentLinkResult.checkoutUrl, '_blank', 'noopener,noreferrer')}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Open payment page</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {topUpLinkResult && (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between border-b border-amber-200 bg-amber-50 px-4 py-3">
            <div>
              <h3 className="text-base font-semibold text-amber-950">Not enough prepaid funds</h3>
              <p className="mt-0.5 text-xs text-amber-800">
                Prepaid clients need a positive verified prepaid balance and enough funds to cover the flight.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTopUpLinkResult(null);
                setTopUpQrDataUrl('');
              }}
              className="rounded-md p-1.5 text-amber-700 hover:bg-amber-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="rounded-xl border border-amber-200 bg-white px-3 py-3 text-sm text-gray-800">
              <p>
                The member needs to add{' '}
                <span className="font-semibold">${Number(topUpLinkResult.amount || 1000).toFixed(2)}</span>{' '}
                to their account first. Top-ups can only be made in $1,000 increments.
              </p>
              {topUpLinkResult.checkoutUrl ? (
                <div className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-900">
                  <p className="font-medium">
                    {topUpLinkResult.emailSent
                      ? `Top-up link emailed${topUpLinkResult.emailTo ? ` to ${topUpLinkResult.emailTo}` : ''}`
                      : 'Top-up link ready'}
                  </p>
                  {topUpLinkResult.emailError && (
                    <p className="mt-1 text-xs text-green-800">{topUpLinkResult.emailError}</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  Send them a secure Stripe link by email, or show the QR code after the link is created.
                </p>
              )}
            </div>

            {topUpLinkResult.checkoutUrl && (
              <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <QrCode className="h-4 w-4" />
                  <span>Scan to add funds</span>
                </div>
                {topUpQrDataUrl ? (
                  <img src={topUpQrDataUrl} alt="Pilot account top-up QR code" className="h-40 w-40 rounded-xl bg-white p-2 shadow-sm" />
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center rounded-xl bg-white text-sm text-gray-500 shadow-sm">
                    Preparing QR code...
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {topUpLinkResult.checkoutUrl ? (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(topUpLinkResult.checkoutUrl);
                        toast.success('Top-up link copied');
                      } catch (error) {
                        console.error('Failed to copy top-up link:', error);
                        toast.error('Could not copy the top-up link');
                      }
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Copy className="h-4 w-4" />
                    <span>Copy link</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(topUpLinkResult.checkoutUrl, '_blank', 'noopener,noreferrer')}
                    className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    <span>Open payment page</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handlePrepaidPaymentMade}
                    disabled={isSubmitting}
                    className="flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span>{isSubmitting ? 'Logging flight...' : 'I have made a payment'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={createTopUpPaymentLink}
                    disabled={topUpLoading}
                    className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Mail className="h-4 w-4" />
                    <span>{topUpLoading ? 'Creating link...' : `Email $${Number(topUpLinkResult.amount || 1000).toFixed(0)} top-up link`}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    <TachOverlapWarningModal
      isOpen={showOverlapWarning}
      onClose={handleCancelOverlap}
      onConfirm={handleConfirmOverlap}
      overlappingLogs={overlappingLogs}
      tachStart={Number(pendingLogData?.start_tach ?? formData.start_tach)}
      tachEnd={Number(pendingLogData?.end_tach ?? formData.end_tach)}
    />
    </>
  );
};
