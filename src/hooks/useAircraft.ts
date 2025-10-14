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

      const combinedAircraft: Aircraft[] = (aircraftData || []).map(a => ({
        id: a.id,
        registration: a.registration,
        make: a.make,
        model: a.model,
        type: a.type,
        status: a.status,
        hourlyRate: parseFloat(a.hourly_rate),
        totalHours: parseFloat(a.total_hours),
        lastMaintenance: a.last_maintenance ? new Date(a.last_maintenance) : undefined,
        nextMaintenance: a.next_maintenance ? new Date(a.next_maintenance) : undefined,
        defects: defectsMap.get(a.id) || []
      }));

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

  const addAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'>) => {
    try {
      const { error } = await supabase
        .from('aircraft')
        .insert({
          registration: aircraftData.registration,
          make: aircraftData.make,
          model: aircraftData.model,
          type: aircraftData.type,
          status: aircraftData.status,
          hourly_rate: aircraftData.hourlyRate,
          total_hours: aircraftData.totalHours,
          last_maintenance: aircraftData.lastMaintenance,
          next_maintenance: aircraftData.nextMaintenance
        });

      if (error) throw error;

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
