import React, { useEffect, useState } from 'react';
import { Building2, Lock, Pencil, Plane, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  ResourceAircraftField,
  ResourceDocumentType,
  RoomResource,
  useResourceSettings,
} from '../../hooks/useResourceSettings';

interface ResourcesSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

const EMPTY_ROOM: Omit<RoomResource, 'id'> = {
  name: '',
  location: '',
  description: '',
  capacity: 1,
  status: 'available',
  isBookable: true,
};

export const ResourcesSettings: React.FC<ResourcesSettingsProps> = ({ canEdit, onFormChange }) => {
  const {
    aircraftFields: savedFields,
    documentTypes: savedDocumentTypes,
    rooms,
    loading,
    saveSettings,
    addRoom,
    updateRoom,
    deleteRoom,
  } = useResourceSettings();
  const [aircraftFields, setAircraftFields] = useState<ResourceAircraftField[]>([]);
  const [documentTypes, setDocumentTypes] = useState<ResourceDocumentType[]>([]);
  const [roomDraft, setRoomDraft] = useState(EMPTY_ROOM);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [showRoomForm, setShowRoomForm] = useState(false);

  const resetDrafts = () => {
    setAircraftFields(savedFields);
    setDocumentTypes(savedDocumentTypes);
  };

  useEffect(resetDrafts, [savedFields, savedDocumentTypes]);

  useEffect(() => {
    (window as any).__resourcesSettingsSave = async () => {
      await saveSettings(aircraftFields, documentTypes);
    };
    (window as any).__resourcesSettingsCancel = resetDrafts;
    return () => {
      delete (window as any).__resourcesSettingsSave;
      delete (window as any).__resourcesSettingsCancel;
    };
  }, [aircraftFields, documentTypes, savedFields, savedDocumentTypes]);

  const changeField = (id: string, changes: Partial<ResourceAircraftField>) => {
    setAircraftFields(current => current.map(field => field.id === id ? { ...field, ...changes } : field));
    onFormChange();
  };

  const changeDocumentType = (id: string, changes: Partial<ResourceDocumentType>) => {
    setDocumentTypes(current => current.map(type => type.id === id ? { ...type, ...changes } : type));
    onFormChange();
  };

  const addDocumentType = () => {
    setDocumentTypes(current => [
      ...current,
      { id: `custom-${Date.now()}`, name: 'New document type', required: false },
    ]);
    onFormChange();
  };

  const removeDocumentType = (id: string) => {
    setDocumentTypes(current => current.filter(type => type.id !== id));
    onFormChange();
  };

  const openRoomForm = (room?: RoomResource) => {
    setEditingRoomId(room?.id || null);
    setRoomDraft(room ? {
      name: room.name,
      location: room.location,
      description: room.description,
      capacity: room.capacity,
      status: room.status,
      isBookable: room.isBookable,
    } : EMPTY_ROOM);
    setShowRoomForm(true);
  };

  const closeRoomForm = () => {
    setShowRoomForm(false);
    setEditingRoomId(null);
    setRoomDraft(EMPTY_ROOM);
  };

  const handleRoomSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingRoomId) await updateRoom(editingRoomId, roomDraft);
      else await addRoom(roomDraft);
      closeRoomForm();
    } catch (error) {
      console.error('Failed to save room:', error);
      toast.error('Failed to save room');
    }
  };

  const handleDeleteRoom = async (id: string) => {
    if (!window.confirm('Remove this room resource?')) return;
    try {
      await deleteRoom(id);
    } catch (error) {
      console.error('Failed to remove room:', error);
      toast.error('Failed to remove room');
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading resources...</div>;

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2 flex items-center">
          <Plane className="h-5 w-5 mr-2" />
          Resources (Aircraft & Rooms)
        </h2>
        <p className="text-gray-600">Configure aircraft records, required documents, and club rooms</p>
      </div>

      <section>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Aircraft Fields</h3>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_100px] gap-3 px-4 py-2 bg-gray-50 text-xs font-semibold uppercase text-gray-500">
            <span>Field</span><span>Visible</span><span>Required</span>
          </div>
          {aircraftFields.map(field => (
            <div key={field.id} className="grid grid-cols-[1fr_100px_100px] gap-3 items-center px-4 py-3 border-t border-gray-200">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-800">
                {field.name}
                {field.locked && <Lock className="h-3.5 w-3.5 text-gray-400" />}
              </span>
              <input
                type="checkbox"
                checked={field.visible}
                disabled={!canEdit || field.locked}
                onChange={event => changeField(field.id, { visible: event.target.checked })}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded disabled:opacity-50"
              />
              <input
                type="checkbox"
                checked={field.required}
                disabled={!canEdit || field.locked}
                onChange={event => changeField(field.id, { required: event.target.checked })}
                className="h-4 w-4 text-blue-600 border-gray-300 rounded disabled:opacity-50"
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900">Aircraft Document Types</h3>
          {canEdit && (
            <button onClick={addDocumentType} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Add Type
            </button>
          )}
        </div>
        <div className="space-y-2">
          {documentTypes.map(type => (
            <div key={type.id} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <input
                value={type.name}
                disabled={!canEdit}
                onChange={event => changeDocumentType(type.id, { name: event.target.value })}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
              />
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={type.required}
                  disabled={!canEdit}
                  onChange={event => changeDocumentType(type.id, { required: event.target.checked })}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                />
                Required
              </label>
              {canEdit && (
                <button onClick={() => removeDocumentType(type.id)} title="Remove document type" className="p-2 text-red-600 hover:bg-red-50 rounded-md">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
              <Building2 className="h-5 w-5" /> Rooms
            </h3>
            <p className="text-sm text-gray-600 mt-1">Manage club facilities and briefing rooms</p>
          </div>
          {canEdit && (
            <button onClick={() => openRoomForm()} className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
              <Plus className="h-4 w-4" /> Add Room
            </button>
          )}
        </div>

        {showRoomForm && (
          <form onSubmit={handleRoomSubmit} className="p-4 mb-4 border border-blue-200 bg-blue-50 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-gray-900">{editingRoomId ? 'Edit Room' : 'Add Room'}</h4>
              <button type="button" onClick={closeRoomForm} title="Close" className="p-1 text-gray-600 hover:bg-blue-100 rounded"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input required value={roomDraft.name} onChange={e => setRoomDraft(room => ({ ...room, name: e.target.value }))} placeholder="Room name" className="px-3 py-2 border border-gray-300 rounded-md" />
              <input value={roomDraft.location} onChange={e => setRoomDraft(room => ({ ...room, location: e.target.value }))} placeholder="Location" className="px-3 py-2 border border-gray-300 rounded-md" />
              <input type="number" min="1" required value={roomDraft.capacity} onChange={e => setRoomDraft(room => ({ ...room, capacity: Number(e.target.value) }))} placeholder="Capacity" className="px-3 py-2 border border-gray-300 rounded-md" />
              <select value={roomDraft.status} onChange={e => setRoomDraft(room => ({ ...room, status: e.target.value as RoomResource['status'] }))} className="px-3 py-2 border border-gray-300 rounded-md">
                <option value="available">Available</option>
                <option value="unavailable">Unavailable</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <input value={roomDraft.description} onChange={e => setRoomDraft(room => ({ ...room, description: e.target.value }))} placeholder="Description" className="md:col-span-2 px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={roomDraft.isBookable} onChange={e => setRoomDraft(room => ({ ...room, isBookable: e.target.checked }))} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
              Available for bookings
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeRoomForm} className="px-3 py-2 text-sm border border-gray-300 bg-white rounded-md hover:bg-gray-50">Cancel</button>
              <button type="submit" className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Room</button>
            </div>
          </form>
        )}

        {rooms.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">No rooms added</div>
        ) : (
          <div className="space-y-2">
            {rooms.map(room => (
              <div key={room.id} className="flex items-center justify-between gap-4 p-4 border border-gray-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{room.name}</p>
                  <p className="text-sm text-gray-600">{room.location || 'No location'} · Capacity {room.capacity} · {room.status}</p>
                  {room.description && <p className="text-xs text-gray-500 mt-1">{room.description}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button onClick={() => openRoomForm(room)} title="Edit room" className="p-2 text-blue-600 hover:bg-blue-50 rounded-md"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => handleDeleteRoom(room.id)} title="Remove room" className="p-2 text-red-600 hover:bg-red-50 rounded-md"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
