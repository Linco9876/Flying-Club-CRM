import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

export type CancellationFeeType = 'none' | 'late_cancel' | 'no_show';

export interface BookingCancellationReason {
  id: string;
  name: string;
  description?: string;
  feeType: CancellationFeeType;
  feeAmount: number;
  isActive: boolean;
  displayOrder: number;
}

export type BookingCancellationReasonInput = Omit<BookingCancellationReason, 'id'>;

const mapReason = (row: any): BookingCancellationReason => ({
  id: row.id,
  name: row.name,
  description: row.description || undefined,
  feeType: row.fee_type,
  feeAmount: Number(row.fee_amount || 0),
  isActive: row.is_active,
  displayOrder: row.display_order || 0,
});

export const useBookingCancellationReasons = () => {
  const [reasons, setReasons] = useState<BookingCancellationReason[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReasons = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('booking_cancellation_reasons')
        .select('*')
        .order('display_order')
        .order('name');
      if (error) throw error;
      setReasons((data || []).map(mapReason));
    } catch (error) {
      console.error('Failed to load booking cancellation reasons:', error);
      toast.error('Failed to load cancellation reasons');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReasons();
  }, [fetchReasons]);

  const createReason = async (input: BookingCancellationReasonInput) => {
    const { error } = await supabase.from('booking_cancellation_reasons').insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      fee_type: input.feeType,
      fee_amount: input.feeType === 'none' ? 0 : input.feeAmount,
      is_active: input.isActive,
      display_order: input.displayOrder,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await fetchReasons();
    toast.success('Cancellation reason added');
  };

  const updateReason = async (id: string, input: BookingCancellationReasonInput) => {
    const { error } = await supabase
      .from('booking_cancellation_reasons')
      .update({
        name: input.name.trim(),
        description: input.description?.trim() || null,
        fee_type: input.feeType,
        fee_amount: input.feeType === 'none' ? 0 : input.feeAmount,
        is_active: input.isActive,
        display_order: input.displayOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
    await fetchReasons();
    toast.success('Cancellation reason updated');
  };

  const deleteReason = async (id: string) => {
    const { error } = await supabase.from('booking_cancellation_reasons').delete().eq('id', id);
    if (error) throw error;
    await fetchReasons();
    toast.success('Cancellation reason removed');
  };

  return { reasons, loading, createReason, updateReason, deleteReason, refetch: fetchReasons };
};
