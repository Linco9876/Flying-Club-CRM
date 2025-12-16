import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Aircraft, Defect } from '../types';
import toast from 'react-hot-toast';

export const useAircraft = () => {
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
          summary: d.summary || undefined,
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

      const combinedAircraft: Aircraft[] = (aircraftData || []).map(a => {
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
          instructorRates: rates?.instructor
        };
      });

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

  const reportDefect = async (defectData: Omit<Defect, 'id'>) => {
    try {
      const { error } = await supabase
        .from('defects')
        .insert({
          aircraft_id: defectData.aircraftId,
          reported_by: defectData.reportedBy,
          date_reported: defectData.dateReported.toISOString(),
          summary: defectData.summary ?? null,
          description: defectData.description,
          status: defectData.status,
          photos: defectData.photos ?? [],
          mel_notes: defectData.melNotes ?? null,
          severity: defectData.severity ?? null,
          location: defectData.location ?? null,
          tach_hours: defectData.tachHours ?? null,
          hobbs_hours: defectData.hobbsHours ?? null
        });

      if (error) throw error;

      await fetchAircraft();
    } catch (err) {
      console.error('Error reporting defect:', err);
      throw err;
    }
  };

  const updateDefect = async (
    defectId: string,
    updates: Partial<Defect>,
    userId?: string
  ) => {
    try {
      const { data: oldDefect } = await supabase
        .from('defects')
        .select('*')
        .eq('id', defectId)
        .single();

      const dbUpdates: any = {};
      if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.severity !== undefined) dbUpdates.severity = updates.severity;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.location !== undefined) dbUpdates.location = updates.location;
      if (updates.tachHours !== undefined) dbUpdates.tach_hours = updates.tachHours;
      if (updates.hobbsHours !== undefined) dbUpdates.hobbs_hours = updates.hobbsHours;

      dbUpdates.updated_at = new Date().toISOString();
      dbUpdates.updated_by = userId;

      const { error } = await supabase
        .from('defects')
        .update(dbUpdates)
        .eq('id', defectId);

      if (error) throw error;

      if (oldDefect) {
        const historyEntries = [];

        if (updates.summary !== undefined && oldDefect.summary !== updates.summary) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'summary',
            old_value: oldDefect.summary || '',
            new_value: updates.summary || ''
          });
        }

        if (updates.description !== undefined && oldDefect.description !== updates.description) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'description',
            old_value: oldDefect.description || '',
            new_value: updates.description || ''
          });
        }

        if (updates.severity !== undefined && oldDefect.severity !== updates.severity) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'severity',
            old_value: oldDefect.severity || '',
            new_value: updates.severity || ''
          });
        }

        if (updates.status !== undefined && oldDefect.status !== updates.status) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'status',
            old_value: oldDefect.status || '',
            new_value: updates.status || ''
          });
        }

        if (updates.location !== undefined && oldDefect.location !== updates.location) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'location',
            old_value: oldDefect.location || '',
            new_value: updates.location || ''
          });
        }

        if (updates.tachHours !== undefined && oldDefect.tach_hours !== updates.tachHours) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'tach_hours',
            old_value: oldDefect.tach_hours?.toString() || '',
            new_value: updates.tachHours?.toString() || ''
          });
        }

        if (updates.hobbsHours !== undefined && oldDefect.hobbs_hours !== updates.hobbsHours) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'hobbs_hours',
            old_value: oldDefect.hobbs_hours?.toString() || '',
            new_value: updates.hobbsHours?.toString() || ''
          });
        }

        if (historyEntries.length > 0) {
          await supabase.from('defect_history').insert(historyEntries);
        }
      }

      await fetchAircraft();
      toast.success('Defect updated successfully');
    } catch (err) {
      console.error('Error updating defect:', err);
      toast.error('Failed to update defect');
      throw err;
    }
  };

  const updateDefectStatus = async (
    defectId: string,
    updates: { status: Defect['status']; melNotes?: string },
    userId?: string
  ) => {
    try {
      // Get old values for history
      const { data: oldDefect } = await supabase
        .from('defects')
        .select('status, mel_notes')
        .eq('id', defectId)
        .single();

      const { error } = await supabase
        .from('defects')
        .update({
          status: updates.status,
          mel_notes: updates.melNotes ?? null,
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', defectId);

      if (error) throw error;

      // Track history
      if (oldDefect) {
        const historyEntries = [];
        if (oldDefect.status !== updates.status) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'status',
            old_value: oldDefect.status,
            new_value: updates.status
          });
        }
        if (updates.melNotes !== undefined && oldDefect.mel_notes !== updates.melNotes) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'mel_notes',
            old_value: oldDefect.mel_notes || '',
            new_value: updates.melNotes || ''
          });
        }

        if (historyEntries.length > 0) {
          await supabase.from('defect_history').insert(historyEntries);
        }
      }

      await fetchAircraft();
      toast.success('Defect status updated');
    } catch (err) {
      console.error('Error updating defect status:', err);
      toast.error('Failed to update defect status');
      throw err;
    }
  };

  const getDefectHistory = async (defectId: string) => {
    try {
      const { data, error } = await supabase
        .from('defect_history')
        .select(`
          *,
          changed_by_user:changed_by(name, email)
        `)
        .eq('defect_id', defectId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching defect history:', err);
      return [];
    }
  };

  const addAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'> & {
    aircraftRates?: { prepaid: number; payg: number; account: number };
    instructorRates?: { prepaid: number; payg: number; account: number };
    rates?: Array<any>;
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

      if (newAircraft && aircraftData.rates && aircraftData.rates.length > 0) {
        const ratesToInsert = aircraftData.rates.map(rate => ({
          aircraft_id: newAircraft.id,
          flight_type_id: rate.flightTypeId,
          charge_type: rate.chargeType,
          solo_rate: rate.soloRate || 0,
          dual_rate: rate.dualRate || 0,
          flat_surcharge: rate.flatSurcharge || 0,
          weekend_surcharge: rate.weekendSurcharge || 0,
          default_payment_method_id: rate.defaultPaymentMethodId || null,
          included_taxes: rate.includedTaxes || 0
        }));

        const { error: ratesError } = await supabase
          .from('aircraft_rates')
          .insert(ratesToInsert);

        if (ratesError) {
          console.error('Error saving aircraft rates:', ratesError);
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

  const updateAircraft = async (id: string, aircraftData: Partial<Omit<Aircraft, 'id' | 'defects'>> & {
    rates?: Array<any>;
  }) => {
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

      if (aircraftData.rates !== undefined) {
        const { error: deleteError } = await supabase
          .from('aircraft_rates')
          .delete()
          .eq('aircraft_id', id);

        if (deleteError) {
          console.error('Error deleting old rates:', deleteError);
        }

        if (aircraftData.rates.length > 0) {
          const ratesToInsert = aircraftData.rates.map(rate => ({
            aircraft_id: id,
            flight_type_id: rate.flightTypeId,
            charge_type: rate.chargeType,
            solo_rate: rate.soloRate || 0,
            dual_rate: rate.dualRate || 0,
            flat_surcharge: rate.flatSurcharge || 0,
            weekend_surcharge: rate.weekendSurcharge || 0,
            default_payment_method_id: rate.defaultPaymentMethodId || null,
            included_taxes: rate.includedTaxes || 0
          }));

          const { error: insertError } = await supabase
            .from('aircraft_rates')
            .insert(ratesToInsert);

          if (insertError) {
            console.error('Error inserting new rates:', insertError);
          }
        }
      }

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
    reportDefect,
    updateDefect,
    updateDefectStatus,
    getDefectHistory,
    addAircraft,
    updateAircraft,
    deleteAircraft,
    refetch: fetchAircraft
  };
};