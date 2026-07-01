import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { GroundSessionDescriptionOption } from '../types';

const mapRow = (row: any): GroundSessionDescriptionOption => ({
  id: row.id,
  name: row.name || '',
  description: row.description || '',
  active: row.active !== false,
  displayOrder: Number(row.display_order || 0),
});

export const useGroundSessionDescriptions = () => {
  const [options, setOptions] = useState<GroundSessionDescriptionOption[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOptions = async () => {
    try {
      const { data, error } = await supabase
        .from('ground_session_description_options')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      setOptions((data || []).map(mapRow));
    } catch (error) {
      console.error('Error loading ground session description options:', error);
      toast.error('Failed to load ground session descriptions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOptions();
  }, []);

  const saveOptions = async (nextOptions: GroundSessionDescriptionOption[]) => {
    try {
      const cleaned = nextOptions
        .map((option, index) => ({
          ...option,
          name: option.name.trim(),
          description: option.description?.trim() || '',
          displayOrder: index + 1,
        }))
        .filter(option => option.name);

      const existingIds = new Set(options.map(option => option.id));
      const nextIds = new Set(cleaned.map(option => option.id));

      for (const option of cleaned) {
        const payload = {
          name: option.name,
          description: option.description || null,
          active: option.active,
          display_order: option.displayOrder,
          updated_at: new Date().toISOString(),
        };

        const { error } = existingIds.has(option.id)
          ? await supabase.from('ground_session_description_options').update(payload).eq('id', option.id)
          : await supabase.from('ground_session_description_options').insert(payload);

        if (error) throw error;
      }

      const removedIds = [...existingIds].filter(id => !nextIds.has(id));
      if (removedIds.length > 0) {
        const { error } = await supabase
          .from('ground_session_description_options')
          .update({ active: false, updated_at: new Date().toISOString() })
          .in('id', removedIds);
        if (error) throw error;
      }

      await fetchOptions();
      toast.success('Ground session descriptions saved');
    } catch (error) {
      console.error('Error saving ground session description options:', error);
      toast.error('Failed to save ground session descriptions');
      throw error;
    }
  };

  return {
    options,
    loading,
    saveOptions,
    refetch: fetchOptions,
  };
};
