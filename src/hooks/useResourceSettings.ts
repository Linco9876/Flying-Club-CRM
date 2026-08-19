import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

export interface ResourceAircraftField {
  id: string;
  name: string;
  required: boolean;
  visible: boolean;
  locked?: boolean;
}

export interface ResourceDocumentType {
  id: string;
  name: string;
  required: boolean;
}

export interface RoomResource {
  id: string;
  name: string;
  location: string;
  description: string;
  capacity: number;
  status: 'available' | 'unavailable' | 'maintenance';
  isBookable: boolean;
}

export const DEFAULT_AIRCRAFT_FIELDS: ResourceAircraftField[] = [
  { id: 'registration', name: 'Registration', required: true, visible: true, locked: true },
  { id: 'make', name: 'Make', required: true, visible: true, locked: true },
  { id: 'model', name: 'Model', required: true, visible: true, locked: true },
  { id: 'type', name: 'Aircraft Type', required: true, visible: true, locked: true },
  { id: 'tachStart', name: 'Tach Start', required: false, visible: true },
  { id: 'seatCapacity', name: 'Seat Capacity', required: false, visible: true },
  { id: 'fuelCapacity', name: 'Fuel Capacity', required: false, visible: true },
  { id: 'emptyWeight', name: 'Empty Weight', required: false, visible: true },
  { id: 'maxWeight', name: 'Max Weight', required: false, visible: true },
];

export const DEFAULT_DOCUMENT_TYPES: ResourceDocumentType[] = [
  { id: 'poh', name: 'Pilot Operating Handbook (POH)', required: true },
  { id: 'insurance', name: 'Insurance Certificate', required: true },
  { id: 'airworthiness', name: 'Certificate of Airworthiness', required: true },
  { id: 'weight-balance', name: 'Weight & Balance Sheet', required: false },
  { id: 'maintenance-log', name: 'Maintenance Log', required: false },
];

export const useResourceSettings = () => {
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [aircraftFields, setAircraftFields] = useState(DEFAULT_AIRCRAFT_FIELDS);
  const [documentTypes, setDocumentTypes] = useState(DEFAULT_DOCUMENT_TYPES);
  const [rooms, setRooms] = useState<RoomResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResult, roomsResult] = await Promise.all([
        supabase.from('resource_settings').select('*').limit(1).maybeSingle(),
        supabase.from('rooms').select('*').order('name'),
      ]);
      if (settingsResult.error) throw settingsResult.error;
      if (roomsResult.error) throw roomsResult.error;
      const settings = settingsResult.data;
      const roomRows = roomsResult.data;

      if (settings) {
        setSettingsId(settings.id);
        setAircraftFields(settings.aircraft_fields || DEFAULT_AIRCRAFT_FIELDS);
        setDocumentTypes(settings.aircraft_document_types || DEFAULT_DOCUMENT_TYPES);
      } else {
        setSettingsId(null);
        setAircraftFields(DEFAULT_AIRCRAFT_FIELDS);
        setDocumentTypes(DEFAULT_DOCUMENT_TYPES);
      }

      setRooms((roomRows || []).map(room => ({
        id: room.id,
        name: room.name,
        location: room.location,
        description: room.description,
        capacity: room.capacity,
        status: room.status,
        isBookable: room.is_bookable,
      })));
      setError(null);
    } catch (caught) {
      console.error('Failed to load resource settings:', caught);
      setError(caught instanceof Error ? caught.message : 'Resource settings could not be loaded');
      toast.error('Failed to load resource settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    const refresh = () => fetchSettings();
    window.addEventListener('resource-settings-updated', refresh);
    return () => window.removeEventListener('resource-settings-updated', refresh);
  }, [fetchSettings]);

  const saveSettings = async (fields: ResourceAircraftField[], docs: ResourceDocumentType[]) => {
    if (error) throw new Error('Resource settings must load successfully before they can be changed.');
    const payload = {
      aircraft_fields: fields,
      aircraft_document_types: docs,
      updated_at: new Date().toISOString(),
    };
    const query = settingsId
      ? supabase.from('resource_settings').update(payload).eq('id', settingsId)
      : supabase.from('resource_settings').insert(payload);
    const { error: saveError } = await query;
    if (saveError) throw saveError;
    window.dispatchEvent(new Event('resource-settings-updated'));
    toast.success('Resource settings saved');
  };

  const addRoom = async (room: Omit<RoomResource, 'id'>) => {
    if (error) throw new Error('Resource settings must load successfully before rooms can be changed.');
    const { error: roomError } = await supabase.from('rooms').insert({
      name: room.name,
      location: room.location,
      description: room.description,
      capacity: room.capacity,
      status: room.status,
      is_bookable: room.isBookable,
    });
    if (roomError) throw roomError;
    await fetchSettings();
    toast.success('Room added');
  };

  const updateRoom = async (id: string, room: Omit<RoomResource, 'id'>) => {
    if (error) throw new Error('Resource settings must load successfully before rooms can be changed.');
    const { error: roomError } = await supabase.from('rooms').update({
      name: room.name,
      location: room.location,
      description: room.description,
      capacity: room.capacity,
      status: room.status,
      is_bookable: room.isBookable,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (roomError) throw roomError;
    await fetchSettings();
    toast.success('Room updated');
  };

  const deleteRoom = async (id: string) => {
    if (error) throw new Error('Resource settings must load successfully before rooms can be changed.');
    const { error: roomError } = await supabase.from('rooms').delete().eq('id', id);
    if (roomError) throw roomError;
    await fetchSettings();
    toast.success('Room removed');
  };

  return { aircraftFields, documentTypes, rooms, loading, error, saveSettings, addRoom, updateRoom, deleteRoom, refetch: fetchSettings };
};
