import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import {
  TrialFlightVoucher,
  TrialFlightVoucherAircraftMode,
  TrialFlightVoucherPaymentStatus,
  TrialFlightVoucherProduct,
  TrialFlightVoucherStatus,
} from '../types';

const mapProduct = (row: any): TrialFlightVoucherProduct => ({
  id: row.id,
  name: row.name,
  description: row.description || '',
  aircraftMode: row.aircraft_mode as TrialFlightVoucherAircraftMode,
  aircraftIds: row.aircraft_ids || [],
  instructorIds: row.instructor_ids || [],
  durationMinutes: row.duration_minutes,
  price: Number(row.price || 0),
  stripePriceId: row.stripe_price_id || undefined,
  emailSubject: row.email_subject || '',
  emailBody: row.email_body || '',
  bookingInstructions: row.booking_instructions || '',
  isActive: row.is_active ?? true,
  createdAt: row.created_at ? new Date(row.created_at) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
});

const mapVoucher = (
  row: any,
  bookingMap = new Map<string, any>(),
  aircraftMap = new Map<string, any>(),
  userMap = new Map<string, any>()
): TrialFlightVoucher => {
  const booking = row.booked_booking_id ? bookingMap.get(row.booked_booking_id) : null;
  const aircraft = booking?.aircraft_id ? aircraftMap.get(booking.aircraft_id) : null;
  const instructor = booking?.instructor_id ? userMap.get(booking.instructor_id) : null;
  const redeemedBy = row.redeemed_by_user_id ? userMap.get(row.redeemed_by_user_id) : null;

  return ({
  id: row.id,
  productId: row.product_id,
  productName: row.trial_flight_voucher_products?.name,
  code: row.code,
  purchaserName: row.purchaser_name,
  purchaserEmail: row.purchaser_email,
  purchaserPhone: row.purchaser_phone || undefined,
  recipientName: row.recipient_name || undefined,
  recipientEmail: row.recipient_email || undefined,
  sendToRecipient: row.send_to_recipient ?? false,
  recipientDeliveryAt: row.recipient_delivery_at ? new Date(row.recipient_delivery_at) : undefined,
  deliveredAt: row.delivered_at ? new Date(row.delivered_at) : undefined,
  status: row.status as TrialFlightVoucherStatus,
  paymentStatus: (row.payment_status || 'manual') as TrialFlightVoucherPaymentStatus,
  paymentAmount: row.payment_amount === null || row.payment_amount === undefined ? undefined : Number(row.payment_amount),
  paymentCurrency: row.payment_currency || 'AUD',
  stripeCheckoutSessionId: row.stripe_checkout_session_id || undefined,
  stripePaymentIntentId: row.stripe_payment_intent_id || undefined,
  paidAt: row.paid_at ? new Date(row.paid_at) : undefined,
  expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
  redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : undefined,
  redeemedByUserId: row.redeemed_by_user_id || undefined,
  redeemedByName: redeemedBy?.name || undefined,
  redeemedByEmail: redeemedBy?.email || undefined,
  bookedBookingId: row.booked_booking_id || undefined,
  bookedBooking: booking ? {
    id: booking.id,
    startTime: new Date(booking.start_time),
    endTime: new Date(booking.end_time),
    status: booking.status,
    flightLogged: Boolean(booking.flight_logged),
    aircraftRegistration: aircraft?.registration || undefined,
    aircraftType: aircraft ? [aircraft.make, aircraft.model].filter(Boolean).join(' ') : undefined,
    instructorName: instructor?.name || undefined,
  } : undefined,
  notes: row.notes || undefined,
  createdBy: row.created_by || undefined,
  createdAt: row.created_at ? new Date(row.created_at) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  });
};

export const generateVoucherCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  );
  return `BFC-${parts.join('-')}`;
};

const isMissingColumnError = (error: unknown) => {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '');
  return /column .* does not exist|could not find .* column|schema cache/i.test(message);
};

const extractFunctionErrorMessage = async (error: unknown, fallback: string) => {
  const defaultMessage =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message || fallback)
      : fallback;

  if (!error || typeof error !== 'object' || !('context' in error)) {
    return defaultMessage;
  }

  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || typeof (context as Response).text !== 'function') {
    return defaultMessage;
  }

  try {
    const response = context as Response;
    const bodyText = await response.clone().text();
    if (!bodyText) return defaultMessage;

    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown };
      const message = String(parsed.error || parsed.message || '').trim();
      return message || defaultMessage;
    } catch {
      return bodyText.trim() || defaultMessage;
    }
  } catch {
    return defaultMessage;
  }
};

export const useTrialFlightVouchers = () => {
  const [products, setProducts] = useState<TrialFlightVoucherProduct[]>([]);
  const [vouchers, setVouchers] = useState<TrialFlightVoucher[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: productRows, error: productError }, { data: voucherRows, error: voucherError }] = await Promise.all([
        supabase
          .from('trial_flight_voucher_products')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('trial_flight_vouchers')
          .select('*, trial_flight_voucher_products(name)')
          .order('created_at', { ascending: false }),
      ]);

      if (productError) throw productError;
      if (voucherError) throw voucherError;

      const bookedBookingIds = Array.from(new Set(
        (voucherRows || []).map((row: any) => row.booked_booking_id).filter(Boolean)
      ));
      const redeemedUserIds = Array.from(new Set(
        (voucherRows || []).map((row: any) => row.redeemed_by_user_id).filter(Boolean)
      ));

      let bookingRows: any[] = [];
      if (bookedBookingIds.length > 0) {
        const { data, error } = await supabase
          .from('bookings')
          .select('id,start_time,end_time,status,aircraft_id,instructor_id,flight_logged')
          .in('id', bookedBookingIds);
        if (error) throw error;
        bookingRows = data || [];
      }

      const aircraftIds = Array.from(new Set(bookingRows.map(row => row.aircraft_id).filter(Boolean)));
      const instructorIds = Array.from(new Set(bookingRows.map(row => row.instructor_id).filter(Boolean)));
      const userIds = Array.from(new Set([...redeemedUserIds, ...instructorIds]));

      const [{ data: aircraftRows, error: aircraftError }, { data: userRows, error: userError }] = await Promise.all([
        aircraftIds.length > 0
          ? supabase.from('aircraft').select('id,registration,make,model').in('id', aircraftIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length > 0
          ? supabase.from('users').select('id,name,email').in('id', userIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (aircraftError) throw aircraftError;
      if (userError) throw userError;

      const bookingMap = new Map((bookingRows || []).map(row => [row.id, row]));
      const aircraftMap = new Map((aircraftRows || []).map((row: any) => [row.id, row]));
      const userMap = new Map((userRows || []).map((row: any) => [row.id, row]));

      setProducts((productRows || []).map(mapProduct));
      setVouchers((voucherRows || []).map((row: any) => mapVoucher(row, bookingMap, aircraftMap, userMap)));
    } catch (error) {
      console.error('Failed to load trial flight vouchers:', error);
      toast.error('Failed to load trial flight vouchers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const activeProducts = useMemo(
    () => products.filter(product => product.isActive),
    [products]
  );

  const saveProduct = async (
    product: Omit<TrialFlightVoucherProduct, 'id' | 'createdAt' | 'updatedAt'>,
    id?: string
  ) => {
    const payload = {
      name: product.name,
      description: product.description,
      aircraft_mode: product.aircraftMode,
      aircraft_ids: product.aircraftIds,
      instructor_ids: product.instructorIds,
      duration_minutes: product.durationMinutes,
      price: product.price,
      stripe_price_id: product.stripePriceId?.trim() || null,
      email_subject: product.emailSubject,
      email_body: product.emailBody,
      booking_instructions: product.bookingInstructions,
      is_active: product.isActive,
      updated_at: new Date().toISOString(),
    };

    const savePayload = async (nextPayload: Record<string, unknown>) => id
      ? await supabase.from('trial_flight_voucher_products').update(nextPayload).eq('id', id)
      : await supabase.from('trial_flight_voucher_products').insert(nextPayload);

    const { error } = await savePayload(payload);
    if (error) {
      if (!isMissingColumnError(error)) throw error;
      const legacyPayload = { ...payload };
      delete legacyPayload.stripe_price_id;
      const { error: legacyError } = await savePayload(legacyPayload);
      if (legacyError) throw legacyError;
    }
    toast.success(id ? 'Voucher product updated' : 'Voucher product created');
    await fetchAll();
  };

  const issueVoucher = async (voucher: {
    productId: string;
    purchaserName: string;
    purchaserEmail: string;
    purchaserPhone?: string;
    recipientName?: string;
    recipientEmail?: string;
    sendToRecipient: boolean;
    recipientDeliveryAt?: string;
    expiresAt?: string;
    notes?: string;
    createdBy?: string;
    paymentStatus?: TrialFlightVoucherPaymentStatus;
    paymentAmount?: number;
    paymentCurrency?: string;
  }) => {
    const paymentStatus = voucher.paymentStatus || 'manual';
    const issueStatus =
      paymentStatus === 'pending'
        ? 'draft'
        : paymentStatus === 'failed' || paymentStatus === 'refunded'
          ? 'cancelled'
          : 'issued';
    const paymentFields = {
      payment_status: paymentStatus,
      payment_amount: voucher.paymentAmount ?? null,
      payment_currency: voucher.paymentCurrency || 'AUD',
      paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
    };
    const basePayload = {
      product_id: voucher.productId,
      code: generateVoucherCode(),
      purchaser_name: voucher.purchaserName,
      purchaser_email: voucher.purchaserEmail,
      purchaser_phone: voucher.purchaserPhone || null,
      recipient_name: voucher.recipientName || null,
      recipient_email: voucher.recipientEmail || null,
      send_to_recipient: voucher.sendToRecipient,
      recipient_delivery_at: voucher.recipientDeliveryAt || null,
      expires_at: voucher.expiresAt || null,
      notes: voucher.notes || null,
      created_by: voucher.createdBy || null,
      status: issueStatus,
    };

    let { data: createdVoucher, error } = await supabase
      .from('trial_flight_vouchers')
      .insert({ ...basePayload, ...paymentFields })
      .select('id, code')
      .single();

    if (error && isMissingColumnError(error)) {
      const legacyResult = await supabase
        .from('trial_flight_vouchers')
        .insert(basePayload)
        .select('id, code')
        .single();
      createdVoucher = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) throw error;

    if (issueStatus !== 'issued') {
      toast.success(
        issueStatus === 'draft'
          ? 'Voucher saved as a draft. It will not email or redeem until payment is marked ready.'
          : 'Voucher saved, but it has not been issued.'
      );
      await fetchAll();
      return;
    }

    try {
      const { data, error: emailError } = await supabase.functions.invoke('send-trial-voucher-email', {
        body: {
          voucherId: createdVoucher?.id,
          redirectOrigin: window.location.origin,
        },
      });
      if (emailError) throw emailError;
      if (data?.error) throw new Error(data.error);
      toast.success(data?.scheduled ? 'Voucher issued and email scheduled' : 'Voucher issued and emailed');
    } catch (emailError) {
      console.error('Failed to send voucher email:', emailError);
      toast.error(await extractFunctionErrorMessage(emailError, 'Voucher issued, but email delivery failed'));
    }

    await fetchAll();
  };

  const sendVoucherEmail = async (voucherId: string, options?: { force?: boolean }) => {
    const { data, error } = await supabase.functions.invoke('send-trial-voucher-email', {
      body: {
        voucherId,
        force: Boolean(options?.force),
        redirectOrigin: window.location.origin,
      },
    });

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, 'Failed to send voucher email'));
    }
    if (data?.error) throw new Error(data.error);

    toast.success(data?.scheduled ? 'Voucher email is scheduled' : 'Voucher email sent');
    await fetchAll();
    return data;
  };

  const markVoucherReady = async (
    voucherId: string,
    paymentStatus: Extract<TrialFlightVoucherPaymentStatus, 'manual' | 'paid' | 'waived'> = 'paid'
  ) => {
    const { error } = await supabase
      .from('trial_flight_vouchers')
      .update({
        status: 'issued',
        payment_status: paymentStatus,
        paid_at: paymentStatus === 'paid' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', voucherId);

    if (error) throw error;

    try {
      const data = await sendVoucherEmail(voucherId);
      toast.success('Voucher marked ready');
      return data;
    } catch (emailError) {
      await fetchAll();
      throw new Error(await extractFunctionErrorMessage(emailError, 'Voucher marked ready, but email delivery failed'));
    }
  };

  const processDueVoucherEmails = async () => {
    const { data, error } = await supabase.functions.invoke('send-trial-voucher-email', {
      body: { action: 'send-due' },
    });

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, 'Failed to process due voucher emails'));
    }
    if (data?.error) throw new Error(data.error);

    toast.success(`Due voucher emails checked: ${data?.sent || 0} sent, ${data?.failed || 0} failed`);
    await fetchAll();
    return data;
  };

  const releaseVoucherBooking = async (voucher: TrialFlightVoucher) => {
    if (!voucher.bookedBookingId || !voucher.bookedBooking) {
      throw new Error('This voucher does not have a linked booking');
    }
    if (voucher.bookedBooking.flightLogged) {
      throw new Error('This voucher booking has a flight log. Delete or correct the flight log before releasing the voucher booking.');
    }

    const { data, error } = await supabase.functions.invoke('trial-voucher-admin', {
      body: {
        action: 'release-booking',
        voucherId: voucher.id,
      },
    });

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, 'Failed to release voucher booking'));
    }
    if (data?.error) throw new Error(data.error);

    toast.success('Voucher booking released. The recipient can choose a new time.');
    await fetchAll();
    return data;
  };

  const cancelVoucher = async (voucherId: string, reason?: string) => {
    const { data, error } = await supabase.functions.invoke('trial-voucher-admin', {
      body: {
        action: 'cancel-voucher',
        voucherId,
        reason,
      },
    });

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, 'Failed to cancel voucher'));
    }
    if (data?.error) throw new Error(data.error);

    toast.success('Voucher cancelled');
    await fetchAll();
    return data;
  };

  return {
    products,
    activeProducts,
    vouchers,
    loading,
    refetch: fetchAll,
    saveProduct,
    issueVoucher,
    sendVoucherEmail,
    markVoucherReady,
    processDueVoucherEmails,
    releaseVoucherBooking,
    cancelVoucher,
  };
};
