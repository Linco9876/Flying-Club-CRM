import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCw, ShieldCheck, X } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useOrganisationLocations } from '../../hooks/useOrganisationLocations';
import {
  nearestDutyStartLocation,
  readableDutyDistance,
  validateDutyStart,
  type DutyStartGeo,
} from '../../utils/dutyStart';
import { DutyTimePicker } from './DutyTimePicker';

export type PortalDutyStartInput = {
  actualStart: Date;
  locationLabel: string;
  geo: DutyStartGeo;
  geofenceNotes: string;
  fitForDuty: boolean;
  externalDutyDeclared: boolean;
  sleepOpportunityConfirmed: boolean;
  kssScore?: number;
  privateNote: string;
};

type Props = {
  instructorName?: string;
  maximumBackdateMinutes?: number;
  working: boolean;
  onClose: () => void;
  onStart: (input: PortalDutyStartInput) => Promise<void>;
};

type ToggleRowProps = {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

const toLocalInput = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

const ToggleRow: React.FC<ToggleRowProps> = ({ label, detail, checked, onChange }) => (
  <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0 dark:border-slate-700">
    <div className="min-w-0">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{label}</p>
      {detail && <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800 ${checked ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <span className={`absolute top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`}>
        {checked && <Check className="h-3 w-3 text-emerald-700" strokeWidth={3} />}
      </span>
    </button>
  </div>
);

export const StartDutyModal: React.FC<Props> = ({
  instructorName,
  maximumBackdateMinutes = 120,
  working,
  onClose,
  onStart,
}) => {
  const { activeLocations, primaryLocation, loading: locationsLoading } = useOrganisationLocations();
  const [actualStart, setActualStart] = useState(() => toLocalInput(new Date()));
  const [locationLabel, setLocationLabel] = useState('');
  const [geofenceNotes, setGeofenceNotes] = useState('');
  const [fitForDuty, setFitForDuty] = useState(true);
  const [externalDutyDeclared, setExternalDutyDeclared] = useState(false);
  const [sleepOpportunityConfirmed, setSleepOpportunityConfirmed] = useState(true);
  const [kssScore, setKssScore] = useState<number>();
  const [privateNote, setPrivateNote] = useState('');
  const [locating, setLocating] = useState(false);
  const [geo, setGeo] = useState<DutyStartGeo>({ insideGeofence: false, label: 'Checking location…' });
  const locationRequested = useRef(false);

  const locate = useCallback(() => {
    setLocating(true);
    setGeo({ insideGeofence: false, label: 'Checking location…' });

    if (!navigator.geolocation) {
      const unavailable = {
        insideGeofence: false,
        label: primaryLocation?.name || 'Location unavailable',
        error: 'This browser does not provide GPS location.',
      };
      setGeo(unavailable);
      setLocationLabel(unavailable.label);
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords;
        const nearest = nearestDutyStartLocation(latitude, longitude, activeLocations);
        const allowedDistance = nearest
          ? nearest.location.radiusMetres + Math.min(accuracy || 0, 100)
          : 0;
        const insideGeofence = Boolean(nearest && nearest.distance <= allowedDistance);
        const label = insideGeofence && nearest ? nearest.location.name : 'Off-site';
        const result: DutyStartGeo = {
          latitude,
          longitude,
          accuracyMetres: accuracy || undefined,
          nearestLocation: nearest?.location,
          distanceMetres: nearest?.distance,
          insideGeofence,
          label,
        };
        setGeo(result);
        setLocationLabel(label);
        setLocating(false);
      },
      error => {
        const label = primaryLocation?.name || 'Location unavailable';
        const result: DutyStartGeo = {
          insideGeofence: false,
          label,
          error: error.code === error.PERMISSION_DENIED
            ? 'GPS permission was not granted.'
            : 'GPS location could not be read.',
        };
        setGeo(result);
        setLocationLabel(label);
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
    );
  }, [activeLocations, primaryLocation?.name]);

  useEffect(() => {
    if (locationsLoading || locationRequested.current) return;
    locationRequested.current = true;
    locate();
  }, [locate, locationsLoading]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, working]);

  const submit = async () => {
    const parsedStart = new Date(actualStart);
    const input: PortalDutyStartInput = {
      actualStart: parsedStart,
      locationLabel,
      geo,
      geofenceNotes,
      fitForDuty,
      externalDutyDeclared,
      sleepOpportunityConfirmed,
      kssScore,
      privateNote,
    };
    const validationError = validateDutyStart({
      ...input,
      now: new Date(),
      maximumBackdateMinutes,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }

    try {
      await onStart(input);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Duty could not be started');
    }
  };

  const fatigueNoteRequired = !sleepOpportunityConfirmed || (kssScore || 0) >= 7;
  const locationStatus = locationsLoading || locating
    ? 'Checking GPS…'
    : geo.insideGeofence
      ? `At ${geo.nearestLocation?.name || 'club location'}`
      : 'Outside club location';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/65 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-duty-title"
        className="flex max-h-[96dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-[#f4f7f9] shadow-2xl dark:bg-[#0d151c] sm:max-h-[94vh] sm:rounded-[28px]"
      >
        <header className="flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-[#17232d] sm:px-6">
          <div>
            <h2 id="start-duty-title" className="text-2xl font-black tracking-tight text-[#0f2942] dark:text-[#ddefff]">Start duty</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {instructorName ? `Confirm the details for ${instructorName}.` : 'Confirm the details below.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Close Start duty"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Start time</p>
            <div className="rounded-[18px] border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#17232d]">
              <DutyTimePicker
                label="Duty started"
                value={actualStart}
                defaultDate={actualStart.slice(0, 10)}
                onChange={setActualStart}
                hint={`Up to ${maximumBackdateMinutes / 60} hours back`}
              />
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Adjust the time if you are clocking in a little late · up to {maximumBackdateMinutes / 60} hours back.</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Location</p>
            <div className={`rounded-[18px] border p-4 ${geo.insideGeofence ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/35'}`}>
              <div className="flex items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white shadow-sm dark:bg-slate-800 ${geo.insideGeofence ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {locationsLoading || locating ? <Loader2 className="h-4 w-4 animate-spin" /> : geo.insideGeofence ? <Check className="h-4 w-4" strokeWidth={3} /> : <AlertTriangle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1" aria-live="polite">
                  <p className="font-black text-slate-900 dark:text-slate-100">{locationStatus}</p>
                  {!locating && geo.nearestLocation && geo.distanceMetres !== undefined && (
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{readableDutyDistance(geo.distanceMetres)} from {geo.nearestLocation.name}</p>
                  )}
                  {!locating && geo.error && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{geo.error}</p>}
                </div>
                <button
                  type="button"
                  onClick={locate}
                  disabled={locating || locationsLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-black text-blue-700 hover:bg-white/70 disabled:opacity-50 dark:text-sky-400 dark:hover:bg-slate-800"
                >
                  <RotateCw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>

              <label className="mt-4 block text-xs font-bold text-slate-700 dark:text-slate-200">
                Location name
                <input
                  value={locationLabel}
                  onChange={event => setLocationLabel(event.target.value)}
                  placeholder="Where are you working?"
                  className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-[#111d26] dark:text-slate-100"
                />
              </label>

              {!geo.insideGeofence && (
                <label className="mt-3 block text-xs font-bold text-slate-700 dark:text-slate-200">
                  Additional notes <span className="text-red-600 dark:text-red-400">*</span>
                  <textarea
                    value={geofenceNotes}
                    onChange={event => setGeofenceNotes(event.target.value)}
                    rows={3}
                    placeholder="Why are you starting duty away from the club?"
                    className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-[#111d26] dark:text-slate-100"
                  />
                </label>
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400">Pre-duty declaration</p>
            <div className="rounded-[18px] border border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-[#17232d]">
              <ToggleRow label="I am fit for duty" checked={fitForDuty} onChange={setFitForDuty} />
              <ToggleRow
                label="External duty is up to date"
                detail="I have entered any relevant external duty, or I have none."
                checked={externalDutyDeclared}
                onChange={setExternalDutyDeclared}
              />
              <ToggleRow label="I had adequate sleep opportunity" checked={sleepOpportunityConfirmed} onChange={setSleepOpportunityConfirmed} />

              <div className="py-4">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Sleepiness now <span className="font-medium text-slate-500 dark:text-slate-400">(optional)</span></p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">1 = very alert · 9 = very sleepy</p>
                <div className="mt-3 grid grid-cols-9 gap-1.5">
                  {Array.from({ length: 9 }, (_, index) => index + 1).map(score => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setKssScore(current => current === score ? undefined : score)}
                      aria-pressed={kssScore === score}
                      aria-label={`Sleepiness ${score}`}
                      className={`aspect-square min-w-0 rounded-lg border text-xs font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${kssScore === score ? 'border-blue-700 bg-blue-700 text-white dark:border-sky-500 dark:bg-sky-500 dark:text-slate-950' : 'border-slate-300 text-slate-800 hover:border-blue-400 hover:bg-blue-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700'}`}
                    >
                      {score}
                    </button>
                  ))}
                </div>

                {fatigueNoteRequired && (
                  <label className="mt-4 block text-xs font-bold text-slate-700 dark:text-slate-200">
                    Fatigue note <span className="text-red-600 dark:text-red-400">*</span>
                    <textarea
                      value={privateNote}
                      onChange={event => setPrivateNote(event.target.value)}
                      rows={3}
                      placeholder="Add context and any mitigation."
                      className="mt-1.5 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-[#111d26] dark:text-slate-100"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          {!fitForDuty && (
            <div className="flex gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <p><strong>Duty cannot start.</strong> Contact operations or a senior instructor if you are not fit for duty.</p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={working}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-base font-black text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:focus-visible:ring-offset-[#0d151c]"
          >
            {working ? <><Loader2 className="h-5 w-5 animate-spin" /> Starting duty…</> : 'Start duty'}
          </button>
          <p className="px-4 text-center text-[11px] leading-4 text-slate-500 dark:text-slate-400">
            GPS is checked only while you start duty. This portal does not track background location.
          </p>
        </div>
      </section>
    </div>
  );
};
