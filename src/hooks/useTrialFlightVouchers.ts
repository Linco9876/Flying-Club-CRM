import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import {
  TrialFlightVoucher,
  TrialFlightVoucherAircraftMode,
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
  emailSubject: row.email_subject || '',
  emailBody: row.email_body || '',
  bookingInstructions: row.booking_instructions || '',
  isActive: row.is_active ?? true,
  createdAt: row.created_at ? new Date(row.created_at) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
});

const mapVoucher = (row: any): TrialFlightVoucher => ({
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
  expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
  redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : undefined,
  redeemedByUserId: row.redeemed_by_user_id || undefined,
  bookedBookingId: row.booked_booking_id || undefined,
  notes: row.notes || undefined,
  createdBy: row.created_by || undefined,
  createdAt: row.created_at ? new Date(row.created_at) : undefined,
  updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
});

export const generateVoucherCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const parts = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  );
  return `BFC-${parts.join('-')}`;
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

      setProducts((productRows || []).map(mapProduct));
      setVouchers((voucherRows || []).map(mapVoucher));
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
      email_subject: product.emailSubject,
      email_body: product.emailBody,
      booking_instructions: product.bookingInstructions,
      is_active: product.isActive,
      updated_at: new Date().toISOString(),
    };

    const { error } = id
      ? await supabase.from('trial_flight_voucher_products').update(payload).eq('id', id)
      : await supabase.from('trial_flight_voucher_products').insert(payload);

    if (error) throw error;
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
  }) => {
    const { error } = await supabase.from('trial_flight_vouchers').insert({
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
      status: 'issued',
    });

    if (error) throw error;
    toast.success('Voucher issued');
    await fetchAll();
  };

  return {
    products,
    activeProducts,
    vouchers,
    loading,
    refetch: fetchAll,
    saveProduct,
    issueVoucher,
  };
};

