import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { UserRole } from '../types';

export interface FlightType {
  id: string;
  name: string;
  allowedRoles: UserRole[];
  displayOrder: number;
  forcedPaymentMethodId: string | null;
}

export interface PaymentMethod {
  id: string;
  name: string;
  displayOrder: number;
}

export interface AircraftRate {
  id: string;
  aircraftId: string;
  flightTypeId: string;
  chargeType: 'tach' | 'flat' | 'per_pax' | 'free' | 'not_used';
  soloRate: number;
  dualRate: number;
  flatSurcharge: number;
  weekendSurcharge: number;
  defaultPaymentMethodId: string | null;
  includedTaxes: number;
}

export const useBillingSettings = () => {
  const [flightTypes, setFlightTypes] = useState<FlightType[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFlightTypes();
    fetchPaymentMethods();
  }, []);

  const fetchFlightTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('flight_types')
        .select('*')
        .order('display_order');

      if (error) throw error;

      if (data) {
        setFlightTypes(data.map(ft => ({
          id: ft.id,
          name: ft.name,
          allowedRoles: ft.allowed_roles || [],
          displayOrder: ft.display_order,
          forcedPaymentMethodId: ft.forced_payment_method_id ?? null
        })));
      }
    } catch (error) {
      console.error('Error fetching flight types:', error);
      toast.error('Failed to load flight types');
    } finally {
      setLoading(false);
    }
  };

  const fetchPaymentMethods = async () => {
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .order('display_order');

      if (error) throw error;

      if (data) {
        setPaymentMethods(data.map(pm => ({
          id: pm.id,
          name: pm.name,
          displayOrder: pm.display_order
        })));
      }
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      toast.error('Failed to load payment methods');
    }
  };

  const addFlightType = async (name: string, allowedRoles: UserRole[]) => {
    try {
      const { data, error } = await supabase
        .from('flight_types')
        .insert({
          name,
          allowed_roles: allowedRoles,
          display_order: flightTypes.length
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setFlightTypes([...flightTypes, {
          id: data.id,
          name: data.name,
          allowedRoles: data.allowed_roles || [],
          displayOrder: data.display_order,
          forcedPaymentMethodId: data.forced_payment_method_id ?? null
        }]);
        toast.success('Flight type added');
      }
    } catch (error) {
      console.error('Error adding flight type:', error);
      toast.error('Failed to add flight type');
    }
  };

  const updateFlightType = async (id: string, updates: Partial<FlightType>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.allowedRoles !== undefined) dbUpdates.allowed_roles = updates.allowedRoles;
      if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder;
      if ('forcedPaymentMethodId' in updates) dbUpdates.forced_payment_method_id = updates.forcedPaymentMethodId ?? null;

      const { error } = await supabase
        .from('flight_types')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      setFlightTypes(flightTypes.map(ft =>
        ft.id === id ? { ...ft, ...updates } : ft
      ));
      toast.success('Flight type updated');
    } catch (error) {
      console.error('Error updating flight type:', error);
      toast.error('Failed to update flight type');
    }
  };

  const deleteFlightType = async (id: string) => {
    try {
      const { error } = await supabase
        .from('flight_types')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setFlightTypes(flightTypes.filter(ft => ft.id !== id));
      toast.success('Flight type deleted');
    } catch (error) {
      console.error('Error deleting flight type:', error);
      toast.error('Failed to delete flight type');
    }
  };

  const addPaymentMethod = async (name: string) => {
    try {
      const { data, error } = await supabase
        .from('payment_methods')
        .insert({
          name,
          display_order: paymentMethods.length
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setPaymentMethods([...paymentMethods, {
          id: data.id,
          name: data.name,
          displayOrder: data.display_order
        }]);
        toast.success('Payment method added');
      }
    } catch (error) {
      console.error('Error adding payment method:', error);
      toast.error('Failed to add payment method');
    }
  };

  const updatePaymentMethod = async (id: string, updates: Partial<PaymentMethod>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder;

      const { error } = await supabase
        .from('payment_methods')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      setPaymentMethods(paymentMethods.map(pm =>
        pm.id === id ? { ...pm, ...updates } : pm
      ));
      toast.success('Payment method updated');
    } catch (error) {
      console.error('Error updating payment method:', error);
      toast.error('Failed to update payment method');
    }
  };

  const deletePaymentMethod = async (id: string) => {
    try {
      const { error } = await supabase
        .from('payment_methods')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPaymentMethods(paymentMethods.filter(pm => pm.id !== id));
      toast.success('Payment method deleted');
    } catch (error) {
      console.error('Error deleting payment method:', error);
      toast.error('Failed to delete payment method');
    }
  };

  return {
    flightTypes,
    paymentMethods,
    loading,
    addFlightType,
    updateFlightType,
    deleteFlightType,
    addPaymentMethod,
    updatePaymentMethod,
    deletePaymentMethod,
    refetch: () => {
      fetchFlightTypes();
      fetchPaymentMethods();
    }
  };
};
