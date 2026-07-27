import React from 'react';
import { format } from 'date-fns';
import { Clock, Loader2, MapPin, Plane, Search, User, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import type { OrganisationLocation } from '../../hooks/useOrganisationLocations';

export interface NextAvailableSlot {
  slot_start: string;
  slot_end: string;
  aircraft_id: string;
  aircraft_registration: string;
  aircraft_description: string;
  instructor_id: string;
  instructor_name: string;
  location_id: string;
  location_name: string;
}

interface NextAvailableSlotModalProps {
  isOpen: boolean;
  initialDate: Date;
  aircraft: Array<{ id: string; registration: string; make?: string; model?: string }>;
  instructors: Array<{ id: string; name: string }>;
  locations: OrganisationLocation[];
  primaryLocation: OrganisationLocation | null;
  onClose: () => void;
  onSelect: (slot: NextAvailableSlot) => void;
}

const nextQuarterHour = (value: Date) => {
  const next = new Date(value);
  next.setSeconds(0, 0);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15);
  return next;
};

export const NextAvailableSlotModal: React.FC<NextAvailableSlotModalProps> = ({
  isOpen,
  initialDate,
  aircraft,
  instructors,
  locations,
  primaryLocation,
  onClose,
  onSelect,
}) => {
  const [afterDate, setAfterDate] = React.useState('');
  const [afterTime, setAfterTime] = React.useState('09:00');
  const [durationMinutes, setDurationMinutes] = React.useState(120);
  const [aircraftId, setAircraftId] = React.useState('');
  const [instructorId, setInstructorId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [slots, setSlots] = React.useState<NextAvailableSlot[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const now = nextQuarterHour(new Date());
    const requestedDate = new Date(initialDate);
    requestedDate.setHours(9, 0, 0, 0);
    const after = requestedDate.getTime() > now.getTime() ? requestedDate : now;
    setAfterDate(format(after, 'yyyy-MM-dd'));
    setAfterTime(format(after, 'HH:mm'));
    setDurationMinutes(120);
    setAircraftId('');
    setInstructorId('');
    setLocationId(primaryLocation?.id || locations[0]?.id || '');
    setSlots([]);
    setSearched(false);
  }, [initialDate, isOpen, locations, primaryLocation?.id]);

  if (!isOpen) return null;

  const search = async () => {
    const after = new Date(`${afterDate}T${afterTime}:00`);
    if (Number.isNaN(after.getTime())) {
      toast.error('Choose a valid date and time');
      return;
    }
    setSearching(true);
    setSearched(true);
    try {
      const { data, error } = await supabase.rpc('find_next_available_slots', {
        p_after: after.toISOString(),
        p_duration_minutes: durationMinutes,
        p_search_days: 30,
        p_aircraft_ids: aircraftId ? [aircraftId] : null,
        p_instructor_ids: instructorId ? [instructorId] : null,
        p_location_id: locationId || null,
        p_limit: 10,
      });
      if (error) throw error;
      setSlots((data || []) as NextAvailableSlot[]);
    } catch (caught) {
      console.error('Available slot search failed:', caught);
      toast.error('Availability could not be searched. Please try again.');
      setSlots([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="next-slot-title">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-[#363b45]">
          <div>
            <h2 id="next-slot-title" className="text-lg font-bold text-gray-950 dark:text-white">
              Find the next available slot
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Search aircraft and instructor availability before starting a booking.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close availability finder" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-[#262b33]">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Search from date
              <input type="date" value={afterDate} onChange={(event) => setAfterDate(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white" />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Earliest time
              <input type="time" step="900" value={afterTime} onChange={(event) => setAfterTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white" />
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Booking length
              <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white">
                {[30, 45, 60, 90, 120, 150, 180, 240].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hours`}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              <Plane className="mr-1 inline h-3.5 w-3.5" />
              Aircraft
              <select value={aircraftId} onChange={(event) => setAircraftId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white">
                <option value="">Any serviceable aircraft</option>
                {aircraft.map((item) => <option key={item.id} value={item.id}>{item.registration} — {[item.make, item.model].filter(Boolean).join(' ')}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              <User className="mr-1 inline h-3.5 w-3.5" />
              Instructor
              <select value={instructorId} onChange={(event) => setInstructorId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white">
                <option value="">Any rostered instructor</option>
                {instructors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {locations.length > 1 && (
              <label className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                <MapPin className="mr-1 inline h-3.5 w-3.5" />
                Location
                <select value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal text-gray-950 dark:border-[#4a505c] dark:bg-[#11141a] dark:text-white">
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.isPrimary ? ' (primary)' : ''}</option>)}
                </select>
              </label>
            )}
          </div>

          <button type="button" onClick={() => void search()} disabled={searching} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search next 30 days
          </button>

          <div className="mt-5 space-y-2" aria-live="polite">
            {!searching && searched && slots.length === 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                No matching aircraft and instructor slot was found in the next 30 days.
              </div>
            )}
            {slots.map((slot) => {
              const start = new Date(slot.slot_start);
              const end = new Date(slot.slot_end);
              return (
                <button
                  key={`${slot.slot_start}:${slot.aircraft_id}:${slot.instructor_id}`}
                  type="button"
                  onClick={() => onSelect(slot)}
                  className="flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-[#363b45] dark:bg-[#11141a] dark:hover:border-blue-600 dark:hover:bg-blue-950/30"
                >
                  <span className="rounded-lg bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-200"><Clock className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-gray-950 dark:text-white">
                      {start.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}, {format(start, 'HH:mm')}–{format(end, 'HH:mm')}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-gray-600 dark:text-gray-300">
                      {slot.aircraft_registration} · {slot.instructor_name} · {slot.location_name}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Choose</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
