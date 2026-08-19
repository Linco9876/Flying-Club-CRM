import type { ResourceAircraftField, ResourceDocumentType, RoomResource } from '../hooks/useResourceSettings';

const duplicateName = (items: Array<{ name: string }>) => {
  const names = items.map(item => item.name.trim().toLocaleLowerCase()).filter(Boolean);
  return new Set(names).size !== names.length;
};

export const getResourceSettingsValidationError = (
  aircraftFields: ResourceAircraftField[],
  documentTypes: ResourceDocumentType[],
): string | null => {
  if (aircraftFields.length === 0) return 'Keep at least one aircraft field.';
  if (aircraftFields.some(field => !field.name.trim())) return 'Every aircraft field needs a name.';
  if (duplicateName(aircraftFields)) return 'Aircraft field names must be unique.';
  if (aircraftFields.some(field => field.required && !field.visible)) {
    return 'A required aircraft field must also be visible.';
  }
  if (documentTypes.length === 0) return 'Keep at least one aircraft document type.';
  if (documentTypes.some(type => !type.name.trim())) return 'Every aircraft document type needs a name.';
  if (duplicateName(documentTypes)) return 'Aircraft document type names must be unique.';
  return null;
};

export const getRoomValidationError = (room: Omit<RoomResource, 'id'>): string | null => {
  if (!room.name.trim()) return 'Enter a room name.';
  if (!Number.isInteger(room.capacity) || room.capacity < 1 || room.capacity > 1000) {
    return 'Room capacity must be a whole number from 1 to 1,000.';
  }
  if (!['available', 'unavailable', 'maintenance'].includes(room.status)) {
    return 'Choose a valid room status.';
  }
  return null;
};
