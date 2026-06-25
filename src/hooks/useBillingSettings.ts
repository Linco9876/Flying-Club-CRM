import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { UserRole } from '../types';

export interface FlightType {
  id: string;
  name: string;
  description: string;
  active: boolean;
  allowedRoles: UserRole[];
  displayOrder: number;
  forcedPaymentMethodId: string | null;
}

export interface PaymentMethod {
  id: string;
  name: string;
  description: string;
  active: boolean;
  displayOrder: number;
  allowAccountTopup: boolean;
  isSystem?: boolean;
  systemKey?: string | null;
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
    refetch();
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
          description: ft.description || '',
          active: ft.active !== false,
          allowedRoles: ft.allowed_roles || [],
          displayOrder: ft.display_order,
          forcedPaymentMethodId: ft.forced_payment_method_id ?? null
        })));
      }
    } catch (error) {
      console.error('Error fetching flight types:', error);
      toast.error('Failed to load flight types');
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
          description: pm.description || '',
          active: pm.active !== false,
          displayOrder: pm.display_order,
          allowAccountTopup: pm.allow_account_topup !== false,
          isSystem: pm.is_system === true,
          systemKey: pm.system_key ?? null
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
          description: data.description || '',
          active: data.active !== false,
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
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
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
          description: data.description || '',
          active: data.active !== false,
          displayOrder: data.display_order,
          allowAccountTopup: data.allow_account_topup !== false,
          isSystem: data.is_system === true,
          systemKey: data.system_key ?? null
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
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
      if (updates.displayOrder !== undefined) dbUpdates.display_order = updates.displayOrder;
      if (updates.allowAccountTopup !== undefined) dbUpdates.allow_account_topup = updates.allowAccountTopup;
      if (updates.isSystem !== undefined) dbUpdates.is_system = updates.isSystem;
      if (updates.systemKey !== undefined) dbUpdates.system_key = updates.systemKey;

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

  const saveBillingSettings = async (nextFlightTypes: FlightType[], nextPaymentMethods: PaymentMethod[]) => {
    try {
      const originalFlightTypeIds = new Set(flightTypes.map(item => item.id));
      const originalPaymentMethodIds = new Set(paymentMethods.map(item => item.id));

      const paymentMethodIdMap = new Map<string, string>();
      const validPaymentMethods = nextPaymentMethods.filter(method => method.name.trim());

      for (const [index, method] of validPaymentMethods.entries()) {
        const dbMethod = {
          name: method.systemKey === 'stripe_card'
            ? 'Stripe Card Payment'
            : method.systemKey === 'pilot_account'
              ? 'Pilot Account'
              : method.name.trim(),
          description: method.description?.trim() || null,
          active: method.active,
          allow_account_topup: method.allowAccountTopup !== false,
          display_order: index + 1,
          is_system: method.isSystem === true,
          system_key: method.systemKey || null,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = originalPaymentMethodIds.has(method.id)
          ? await supabase.from('payment_methods').update(dbMethod).eq('id', method.id).select().single()
          : await supabase.from('payment_methods').insert(dbMethod).select().single();
        if (error) throw error;
        if (data) paymentMethodIdMap.set(method.id, data.id);
      }

      const activePaymentMethodIds = new Set(validPaymentMethods.map(method => originalPaymentMethodIds.has(method.id) ? method.id : null).filter(Boolean));
      const removedPaymentMethodIds = [...originalPaymentMethodIds].filter(id => !activePaymentMethodIds.has(id));
      if (removedPaymentMethodIds.length > 0) {
        const { error } = await supabase
          .from('payment_methods')
          .update({ active: false, updated_at: new Date().toISOString() })
          .in('id', removedPaymentMethodIds);
        if (error) throw error;
      }

      const validFlightTypes = nextFlightTypes.filter(type => type.name.trim());

      for (const [index, type] of validFlightTypes.entries()) {
        const forcedPaymentMethodId = type.forcedPaymentMethodId
          ? paymentMethodIdMap.get(type.forcedPaymentMethodId) || type.forcedPaymentMethodId
          : null;
        const dbType = {
          name: type.name.trim(),
          description: type.description?.trim() || null,
          active: type.active,
          allowed_roles: type.allowedRoles,
          display_order: index + 1,
          forced_payment_method_id: forcedPaymentMethodId,
          updated_at: new Date().toISOString(),
        };
        const { error } = originalFlightTypeIds.has(type.id)
          ? await supabase.from('flight_types').update(dbType).eq('id', type.id)
          : await supabase.from('flight_types').insert(dbType);
        if (error) throw error;
      }

      const activeFlightTypeIds = new Set(validFlightTypes.map(type => originalFlightTypeIds.has(type.id) ? type.id : null).filter(Boolean));
      const removedFlightTypeIds = [...originalFlightTypeIds].filter(id => !activeFlightTypeIds.has(id));
      if (removedFlightTypeIds.length > 0) {
        const { error } = await supabase
          .from('flight_types')
          .update({ active: false, updated_at: new Date().toISOString() })
          .in('id', removedFlightTypeIds);
        if (error) throw error;
      }

      await refetch();
      toast.success('Billing settings saved');
    } catch (error) {
      console.error('Error saving billing settings:', error);
      toast.error('Failed to save billing settings');
      throw error;
    }
  };

  const refetch = async () => {
    setLoading(true);
    await Promise.all([fetchFlightTypes(), fetchPaymentMethods()]);
    setLoading(false);
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
    saveBillingSettings,
    refetch
  };
};
