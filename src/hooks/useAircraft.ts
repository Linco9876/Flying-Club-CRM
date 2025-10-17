import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Aircraft, Defect } from '../types';
import toast from 'react-hot-toast';

export const useAircraft = (includeGrounded: boolean = true) => {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAircraft = async () => {
    try {
      setLoading(true);
      const { data: aircraftData, error: aircraftError } = await supabase
        .from('aircraft')
        .select('*')
        .order('registration');

      if (aircraftError) throw aircraftError;

      const { data: defectsData, error: defectsError } = await supabase
        .from('defects')
        .select('*');

      if (defectsError) throw defectsError;

      const { data: ratesData, error: ratesError } = await supabase
        .from('aircraft_rates')
        .select('*');

      if (ratesError) throw ratesError;

      const defectsMap = new Map<string, Defect[]>();
      defectsData?.forEach(d => {
        const aircraftDefects = defectsMap.get(d.aircraft_id) || [];
        aircraftDefects.push({
          id: d.id,
          aircraftId: d.aircraft_id,
          reportedBy: d.reported_by,
          dateReported: new Date(d.date_reported),
          description: d.description,
          status: d.status,
          photos: d.photos,
          melNotes: d.mel_notes,
          severity: d.severity,
          location: d.location,
          tachHours: d.tach_hours,
          hobbsHours: d.hobbs_hours
        });
        defectsMap.set(d.aircraft_id, aircraftDefects);
      });

      const ratesMap = new Map<string, { aircraft: any; instructor: any }>();
      ratesData?.forEach(r => {
        const aircraftRates = ratesMap.get(r.aircraft_id) || { aircraft: {}, instructor: {} };

        if (r.rate_type === 'aircraft_prepaid') {
          aircraftRates.aircraft.prepaid = parseFloat(r.amount);
        } else if (r.rate_type === 'aircraft_payg') {
          aircraftRates.aircraft.payg = parseFloat(r.amount);
        } else if (r.rate_type === 'aircraft_account') {
          aircraftRates.aircraft.account = parseFloat(r.amount);
        } else if (r.rate_type === 'instructor_prepaid') {
          aircraftRates.instructor.prepaid = parseFloat(r.amount);
        } else if (r.rate_type === 'instructor_payg') {
          aircraftRates.instructor.payg = parseFloat(r.amount);
        } else if (r.rate_type === 'instructor_account') {
          aircraftRates.instructor.account = parseFloat(r.amount);
        }

        ratesMap.set(r.aircraft_id, aircraftRates);
      });

      let combinedAircraft: Aircraft[] = (aircraftData || []).map(a => {
        const rates = ratesMap.get(a.id);
        return {
          id: a.id,
          registration: a.registration,
          make: a.make,
          model: a.model,
          type: a.type,
          status: a.status,
          hourlyRate: parseFloat(a.hourly_rate),
          totalHours: a.total_hours ? parseFloat(a.total_hours) : 0,
          lastMaintenance: a.last_maintenance ? new Date(a.last_maintenance) : undefined,
          nextMaintenance: a.next_maintenance ? new Date(a.next_maintenance) : undefined,
          seatCapacity: a.seat_capacity,
          fuelCapacity: a.fuel_capacity ? parseFloat(a.fuel_capacity) : undefined,
          emptyWeight: a.empty_weight ? parseFloat(a.empty_weight) : undefined,
          maxWeight: a.max_weight ? parseFloat(a.max_weight) : undefined,
          tachStart: a.total_hours ? parseFloat(a.total_hours) : 0,
          defects: defectsMap.get(a.id) || [],
          aircraftRates: rates?.aircraft,
          instructorRates: rates?.instructor,
          isGrounded: a.is_grounded || false
        };
      });

      if (!includeGrounded) {
        combinedAircraft = combinedAircraft.filter(a => !a.isGrounded);
      }

      setAircraft(combinedAircraft);
      setError(null);
    } catch (err) {
      console.error('Error fetching aircraft:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch aircraft');
      toast.error('Failed to load aircraft');
    } finally {
      setLoading(false);
    }
  };

  const addAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'> & {
    aircraftRates?: { prepaid: number; payg: number; account: number };
    instructorRates?: { prepaid: number; payg: number; account: number };
    milestones?: Array<{ title: string; dueCondition: string; dueValue: string }>;
    documents?: Array<{ name: string; type: string; size: number }>;
  }) => {
    try {
      const { data: newAircraft, error } = await supabase
        .from('aircraft')
        .insert({
          registration: aircraftData.registration,
          make: aircraftData.make,
          model: aircraftData.model,
          type: aircraftData.type,
          status: aircraftData.status,
          hourly_rate: aircraftData.hourlyRate || 0,
          total_hours: aircraftData.totalHours || 0,
          last_maintenance: aircraftData.lastMaintenance,
          next_maintenance: aircraftData.nextMaintenance,
          seat_capacity: aircraftData.seatCapacity || 2,
          fuel_capacity: aircraftData.fuelCapacity || null,
          empty_weight: aircraftData.emptyWeight || null,
          max_weight: aircraftData.maxWeight || null
        })
        .select()
        .single();

      if (error) throw error;

      if (newAircraft && aircraftData.aircraftRates) {
        const { error: ratesError } = await supabase.from('aircraft_rates').insert([
          { aircraft_id: newAircraft.id, rate_type: 'aircraft_prepaid', amount: aircraftData.aircraftRates.prepaid },
          { aircraft_id: newAircraft.id, rate_type: 'aircraft_payg', amount: aircraftData.aircraftRates.payg },
          { aircraft_id: newAircraft.id, rate_type: 'aircraft_account', amount: aircraftData.aircraftRates.account }
        ]);
        if (ratesError) {
          console.error('Error saving aircraft rates:', ratesError);
        }
      }

      if (newAircraft && aircraftData.instructorRates) {
        const { error: instructorRatesError } = await supabase.from('aircraft_rates').insert([
          { aircraft_id: newAircraft.id, rate_type: 'instructor_prepaid', amount: aircraftData.instructorRates.prepaid },
          { aircraft_id: newAircraft.id, rate_type: 'instructor_payg', amount: aircraftData.instructorRates.payg },
          { aircraft_id: newAircraft.id, rate_type: 'instructor_account', amount: aircraftData.instructorRates.account }
        ]);
        if (instructorRatesError) {
          console.error('Error saving instructor rates:', instructorRatesError);
        }
      }

      if (newAircraft && aircraftData.milestones && aircraftData.milestones.length > 0) {
        const { error: milestonesError } = await supabase.from('maintenance_milestones').insert(
          aircraftData.milestones.map(m => ({
            aircraft_id: newAircraft.id,
            title: m.title,
            due_condition: m.dueCondition,
            due_value: m.dueValue
          }))
        );
        if (milestonesError) {
          console.error('Error saving milestones:', milestonesError);
        }
      }

      if (newAircraft && aircraftData.documents && aircraftData.documents.length > 0) {
        const { error: documentsError } = await supabase.from('aircraft_documents').insert(
          aircraftData.documents.map(d => ({
            aircraft_id: newAircraft.id,
            filename: d.name,
            file_path: `/documents/${newAircraft.id}/${d.name}`,
            file_type: d.type,
            file_size: d.size,
            uploaded_by: null
          }))
        );
        if (documentsError) {
          console.error('Error saving documents:', documentsError);
        }
      }

      await fetchAircraft();
      toast.success('Aircraft added successfully');
    } catch (err) {
      console.error('Error adding aircraft:', err);
      toast.error('Failed to add aircraft');
      throw err;
    }
  };

  const updateAircraft = async (id: string, aircraftData: Partial<Omit<Aircraft, 'id' | 'defects'>>) => {
    try {
      const updateData: any = {};
      if (aircraftData.registration !== undefined) updateData.registration = aircraftData.registration;
      if (aircraftData.make !== undefined) updateData.make = aircraftData.make;
      if (aircraftData.model !== undefined) updateData.model = aircraftData.model;
      if (aircraftData.type !== undefined) updateData.type = aircraftData.type;
      if (aircraftData.status !== undefined) updateData.status = aircraftData.status;
      if (aircraftData.hourlyRate !== undefined) updateData.hourly_rate = aircraftData.hourlyRate;
      if (aircraftData.totalHours !== undefined) updateData.total_hours = aircraftData.totalHours;
      if (aircraftData.lastMaintenance !== undefined) updateData.last_maintenance = aircraftData.lastMaintenance;
      if (aircraftData.nextMaintenance !== undefined) updateData.next_maintenance = aircraftData.nextMaintenance;
      if (aircraftData.seatCapacity !== undefined) updateData.seat_capacity = aircraftData.seatCapacity;
      if (aircraftData.fuelCapacity !== undefined) updateData.fuel_capacity = aircraftData.fuelCapacity;
      if (aircraftData.emptyWeight !== undefined) updateData.empty_weight = aircraftData.emptyWeight;
      if (aircraftData.maxWeight !== undefined) updateData.max_weight = aircraftData.maxWeight;

      const { error } = await supabase
        .from('aircraft')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      await fetchAircraft();
      toast.success('Aircraft updated successfully');
    } catch (err) {
      console.error('Error updating aircraft:', err);
      toast.error('Failed to update aircraft');
      throw err;
    }
  };

  const deleteAircraft = async (id: string) => {
    try {
      const { error } = await supabase
        .from('aircraft')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await fetchAircraft();
      toast.success('Aircraft deleted successfully');
    } catch (err) {
      console.error('Error deleting aircraft:', err);
      toast.error('Failed to delete aircraft');
      throw err;
    }
  };

  useEffect(() => {
    fetchAircraft();
  }, []);

  return {
    aircraft,
    loading,
    error,
    addAircraft,
    updateAircraft,
    deleteAircraft,
    refetch: fetchAircraft
  };
};
