import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { getOrganisationLocationValidationError } from '../utils/organisationLocationRules';

export interface OrganisationLocation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMetres: number;
  isPrimary: boolean;
  isActive: boolean;
}

export interface OrganisationLocationDraft extends Omit<OrganisationLocation, 'id'> {
  id?: string;
  key: string;
}

const mapLocation = (row: any): OrganisationLocation => ({
  id: row.id,
  name: row.name,
  address: row.address || '',
  latitude: Number(row.latitude),
  longitude: Number(row.longitude),
  radiusMetres: Number(row.radius_metres),
  isPrimary: Boolean(row.is_primary),
  isActive: Boolean(row.is_active),
});

export const useOrganisationLocations = () => {
  const [locations, setLocations] = useState<OrganisationLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = useCallback(async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('duty_clock_locations')
        .select('id,name,address,latitude,longitude,radius_metres,is_primary,is_active')
        .order('is_primary', { ascending: false })
        .order('name');

      if (fetchError) throw fetchError;
      setLocations((data || []).map(mapLocation));
      setError(null);
    } catch (caught) {
      console.error('Failed to load organisation locations:', caught);
      setError(caught instanceof Error ? caught.message : 'Locations could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLocations();
    const handleUpdated = () => void fetchLocations();
    window.addEventListener('organisation-locations-updated', handleUpdated);
    return () => window.removeEventListener('organisation-locations-updated', handleUpdated);
  }, [fetchLocations]);

  const saveLocations = useCallback(async (drafts: OrganisationLocationDraft[]) => {
    const normalised = drafts.map((location) => ({
      ...location,
      name: location.name.trim(),
      address: location.address.trim(),
    }));
    const validationError = getOrganisationLocationValidationError(normalised);
    if (validationError) throw new Error(validationError);

    const { error: saveError } = await supabase.rpc('save_organisation_locations', {
      p_locations: normalised.map((location) => ({
        id: location.id || null,
        name: location.name,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        radiusMetres: Math.max(50, Math.min(10000, Math.round(location.radiusMetres))),
        isPrimary: location.isPrimary && location.isActive,
        isActive: location.isActive,
      })),
    });
    if (saveError) throw saveError;

    await fetchLocations();
    window.dispatchEvent(new Event('organisation-locations-updated'));
    toast.success('Business locations saved');
  }, [fetchLocations]);

  const activeLocations = useMemo(
    () => locations.filter((location) => location.isActive),
    [locations]
  );
  const primaryLocation = useMemo(
    () => activeLocations.find((location) => location.isPrimary) || activeLocations[0] || null,
    [activeLocations]
  );

  return {
    locations,
    activeLocations,
    primaryLocation,
    loading,
    error,
    saveLocations,
    refetch: fetchLocations,
  };
};
