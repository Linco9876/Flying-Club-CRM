import React, { useEffect, useState } from 'react';
import {
  BookOpenCheck,
  CalendarClock,
  FileUp,
  Info,
  Pencil,
  Plane,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getExternalLogbookEntryValidationError,
  getLogbookBaselineValidationError,
  isIncludedInLogbookBaseline,
  todayDateOnly,
  type ExternalLogbookEntry,
  type ExternalLogbookEntryInput,
  type LogbookBaseline,
  type LogbookBaselineInput,
} from '../../utils/externalLogbook';

export type ExternalLogbookEditorState =
  | { mode: 'new' }
  | { mode: 'edit'; entry: ExternalLogbookEntry }
  | null;

interface ExternalLogbookPanelProps {
  userName: string;
  baseline: LogbookBaseline | null;
  entries: ExternalLogbookEntry[];
  canEdit: boolean;
  editor: ExternalLogbookEditorState;
  onEditorChange: (editor: ExternalLogbookEditorState) => void;
  onSaveBaseline: (input: LogbookBaselineInput) => Promise<unknown>;
  onDeleteBaseline: () => Promise<void>;
  onSaveEntry: (input: ExternalLogbookEntryInput, entryId?: string) => Promise<unknown>;
  onDeleteEntry: (entryId: string) => Promise<void>;
  onClose?: () => void;
  inDialog?: boolean;
}

interface ExternalLogbookDialogProps extends Omit<ExternalLogbookPanelProps, 'onClose' | 'inDialog'> {
  isOpen: boolean;
  onClose: () => void;
}

const formatHours = (value: number) => Number(value || 0).toFixed(1);
const formatDate = (value?: string | null) => value
  ? new Date(`${value}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'Not recorded';

const numberFrom = (value: string) => value.trim() ? Number(value) : 0;
const integerFrom = (value: string) => value.trim() ? Number(value) : 0;

const inputClass = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600';

interface ModalShellProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const ModalShell: React.FC<ModalShellProps> = ({ title, description, icon, onClose, children }) => (
  <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="presentation">
    <section className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-label={title}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-xl bg-blue-100 p-2 text-blue-700">{icon}</span>
          <div>
            <h2 className="text-base font-bold text-gray-950 sm:text-lg">{title}</h2>
            <p className="mt-0.5 text-sm leading-5 text-gray-600">{description}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-900">
          <X className="h-5 w-5" />
        </button>
      </header>
      {children}
    </section>
  </div>
);

const BaselineEditor: React.FC<{
  baseline: LogbookBaseline | null;
  onClose: () => void;
  onSave: (input: LogbookBaselineInput) => Promise<unknown>;
  onDelete: () => Promise<void>;
}> = ({ baseline, onClose, onSave, onDelete }) => {
  const [asOfDate, setAsOfDate] = useState(baseline?.as_of_date || todayDateOnly());
  const [lastFlightDate, setLastFlightDate] = useState(baseline?.last_flight_date || '');
  const [totalHours, setTotalHours] = useState(baseline ? String(baseline.total_hours) : '');
  const [picHours, setPicHours] = useState(baseline ? String(baseline.pic_hours) : '');
  const [dualHours, setDualHours] = useState(baseline ? String(baseline.dual_hours) : '');
  const [takeoffs, setTakeoffs] = useState(baseline?.takeoffs ? String(baseline.takeoffs) : '');
  const [landings, setLandings] = useState(baseline?.landings ? String(baseline.landings) : '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildInput = (): LogbookBaselineInput => ({
    asOfDate,
    lastFlightDate,
    totalHours: numberFrom(totalHours),
    picHours: numberFrom(picHours),
    dualHours: numberFrom(dualHours),
    takeoffs: integerFrom(takeoffs),
    landings: integerFrom(landings),
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = buildInput();
    const validationError = getLogbookBaselineValidationError(input);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(input);
      toast.success(baseline ? 'Opening balance updated' : 'Opening balance saved');
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the opening balance');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onDelete();
      toast.success('Opening balance removed');
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the opening balance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={baseline ? 'Update opening balance' : 'Set opening balance'}
      description="Enter your complete logbook totals through the selected date."
      icon={<BookOpenCheck className="h-5 w-5" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-950">
          The opening balance includes all flying through the baseline date. Portal and individual external entries on or before that day remain visible, but are not added again.
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Totals accurate through *</span>
            <input type="date" required max={todayDateOnly()} value={asOfDate} onChange={event => setAsOfDate(event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>Last actual flight included</span>
            <input type="date" max={asOfDate || todayDateOnly()} value={lastFlightDate} onChange={event => setLastFlightDate(event.target.value)} className={inputClass} />
            <span className="mt-1 block text-xs leading-4 text-gray-500">Optional. Recency uses this date; the baseline date alone does not claim a flight occurred.</span>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <label>
            <span className={labelClass}>Total hours *</span>
            <input type="number" required min="0" max="100000" step="0.1" inputMode="decimal" value={totalHours} onChange={event => setTotalHours(event.target.value)} className={inputClass} placeholder="0.0" />
          </label>
          <label>
            <span className={labelClass}>PIC hours *</span>
            <input type="number" required min="0" max={totalHours || '100000'} step="0.1" inputMode="decimal" value={picHours} onChange={event => setPicHours(event.target.value)} className={inputClass} placeholder="0.0" />
          </label>
          <label>
            <span className={labelClass}>Dual hours</span>
            <input type="number" min="0" max={totalHours || '100000'} step="0.1" inputMode="decimal" value={dualHours} onChange={event => setDualHours(event.target.value)} className={inputClass} placeholder="0.0" />
          </label>
        </div>
        <p className="-mt-3 text-xs leading-5 text-gray-500">If some hours are neither PIC nor dual, leave them unallocated; total hours can be greater than PIC plus dual.</p>

        <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-gray-800">Optional movement totals</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label><span className={labelClass}>Take-offs</span><input type="number" min="0" max="1000000" step="1" inputMode="numeric" value={takeoffs} onChange={event => setTakeoffs(event.target.value)} className={inputClass} placeholder="0" /></label>
            <label><span className={labelClass}>Landings</span><input type="number" min="0" max="1000000" step="1" inputMode="numeric" value={landings} onChange={event => setLandings(event.target.value)} className={inputClass} placeholder="0" /></label>
          </div>
        </details>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{error}</p>}

        <footer className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-between">
          <div>
            {baseline && (
              <button type="button" onClick={() => void remove()} disabled={saving} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold sm:w-auto ${confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-200 text-red-700 hover:bg-red-50'}`}>
                <Trash2 className="h-4 w-4" /> {confirmDelete ? 'Confirm remove balance' : 'Remove opening balance'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:flex-none">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save opening balance'}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
};

const ExternalFlightEditor: React.FC<{
  state: Exclude<ExternalLogbookEditorState, null>;
  userName: string;
  baseline: LogbookBaseline | null;
  onClose: () => void;
  onSave: (input: ExternalLogbookEntryInput, entryId?: string) => Promise<unknown>;
  onDelete: (entryId: string) => Promise<void>;
}> = ({ state, userName, baseline, onClose, onSave, onDelete }) => {
  const existing = state.mode === 'edit' ? state.entry : null;
  const [flightDate, setFlightDate] = useState(existing?.flight_date || todayDateOnly());
  const [aircraftRegistration, setAircraftRegistration] = useState(existing?.aircraft_registration || '');
  const [aircraftType, setAircraftType] = useState(existing?.aircraft_type || '');
  const [pilotInCommandName, setPilotInCommandName] = useState(existing?.pilot_in_command_name || '');
  const [otherCrewName, setOtherCrewName] = useState(existing?.other_crew_name || '');
  const [picHours, setPicHours] = useState(existing ? String(existing.pic_hours) : '');
  const [dualHours, setDualHours] = useState(existing ? String(existing.dual_hours) : '');
  const [takeoffs, setTakeoffs] = useState(existing?.takeoffs ? String(existing.takeoffs) : '');
  const [landings, setLandings] = useState(existing?.landings ? String(existing.landings) : '');
  const [comments, setComments] = useState(existing?.comments || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setConfirmDelete(false), [state]);

  const input: ExternalLogbookEntryInput = {
    flightDate,
    aircraftRegistration,
    aircraftType,
    pilotInCommandName,
    otherCrewName,
    picHours: numberFrom(picHours),
    dualHours: numberFrom(dualHours),
    takeoffs: integerFrom(takeoffs),
    landings: integerFrom(landings),
    comments,
    description,
    notes,
  };
  const includedInBaseline = isIncludedInLogbookBaseline(flightDate, baseline);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = getExternalLogbookEntryValidationError(input);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(input, existing?.id);
      toast.success(existing ? 'External flight updated' : 'External flight added');
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the external flight');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onDelete(existing.id);
      toast.success('External flight removed');
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the external flight');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={existing ? 'Edit external flight' : 'Add external flight'}
      description="Record a flight completed outside the portal. It contributes to totals and recency without creating a booking or charge."
      icon={<Plane className="h-5 w-5" />}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
        {includedInBaseline && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-950">
            This flight is on or before the opening-balance date. It will remain visible for detail but will not be added to the totals again.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <label><span className={labelClass}>Flight date *</span><input type="date" required max={todayDateOnly()} value={flightDate} onChange={event => setFlightDate(event.target.value)} className={inputClass} /></label>
          <label><span className={labelClass}>Registration *</span><input required maxLength={20} value={aircraftRegistration} onChange={event => setAircraftRegistration(event.target.value)} className={inputClass} placeholder="24-0001" autoCapitalize="characters" /></label>
          <label><span className={labelClass}>Aircraft type *</span><input required maxLength={120} value={aircraftType} onChange={event => setAircraftType(event.target.value)} className={inputClass} placeholder="Tecnam P92" /></label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label><span className={labelClass}>PIC hours</span><input type="number" min="0" max="24" step="0.1" inputMode="decimal" value={picHours} onChange={event => setPicHours(event.target.value)} className={inputClass} placeholder="0.0" /></label>
          <label><span className={labelClass}>Dual hours</span><input type="number" min="0" max="24" step="0.1" inputMode="decimal" value={dualHours} onChange={event => setDualHours(event.target.value)} className={inputClass} placeholder="0.0" /></label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className={labelClass}>Instructor / pilot in command</span>
            <input maxLength={200} value={pilotInCommandName} onChange={event => setPilotInCommandName(event.target.value)} className={inputClass} placeholder={numberFrom(picHours) > 0 ? userName : 'Required for dual time'} />
            <span className="mt-1 block text-xs text-gray-500">If blank on a PIC-only flight, {userName} is shown as PIC.</span>
          </label>
          <label><span className={labelClass}>Other pilot / crew</span><input maxLength={200} value={otherCrewName} onChange={event => setOtherCrewName(event.target.value)} className={inputClass} placeholder="Optional" /></label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label><span className={labelClass}>Take-offs</span><input type="number" min="0" max="1000" step="1" inputMode="numeric" value={takeoffs} onChange={event => setTakeoffs(event.target.value)} className={inputClass} placeholder="0" /></label>
          <label><span className={labelClass}>Landings</span><input type="number" min="0" max="1000" step="1" inputMode="numeric" value={landings} onChange={event => setLandings(event.target.value)} className={inputClass} placeholder="0" /></label>
        </div>

        <label><span className={labelClass}>Comments</span><input maxLength={2000} value={comments} onChange={event => setComments(event.target.value)} className={inputClass} placeholder="Flight purpose or exercise" /></label>
        <label><span className={labelClass}>Description</span><textarea maxLength={2000} rows={2} value={description} onChange={event => setDescription(event.target.value)} className={inputClass} placeholder="Optional flight details" /></label>
        <label><span className={labelClass}>Personal notes</span><textarea maxLength={2000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} className={inputClass} placeholder="Optional notes visible to authorised staff" /></label>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800" role="alert">{error}</p>}

        <footer className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-between">
          <div>
            {existing && (
              <button type="button" onClick={() => void remove()} disabled={saving} className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold sm:w-auto ${confirmDelete ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-red-200 text-red-700 hover:bg-red-50'}`}>
                <Trash2 className="h-4 w-4" /> {confirmDelete ? 'Confirm delete flight' : 'Delete flight'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 sm:flex-none">Cancel</button>
            <button type="submit" disabled={saving} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 sm:flex-none">
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save flight'}
            </button>
          </div>
        </footer>
      </form>
    </ModalShell>
  );
};

export const ExternalLogbookPanel: React.FC<ExternalLogbookPanelProps> = ({
  userName,
  baseline,
  entries,
  canEdit,
  editor,
  onEditorChange,
  onSaveBaseline,
  onDeleteBaseline,
  onSaveEntry,
  onDeleteEntry,
  onClose,
  inDialog = false,
}) => {
  const [baselineOpen, setBaselineOpen] = useState(false);

  return (
    <>
      <section className={`overflow-hidden bg-white ${inDialog ? '' : 'rounded-xl border border-slate-200 shadow-sm'}`}>
        <div className="relative flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className={`flex items-start gap-3 ${onClose ? 'pr-12 sm:pr-0' : ''}`}>
            <span className="rounded-xl bg-indigo-100 p-2 text-indigo-700"><CalendarClock className="h-5 w-5" /></span>
            <div>
              <h2 className="font-bold text-slate-950">External logbook hours</h2>
              <p className="mt-0.5 text-sm text-slate-600">Opening balance plus {entries.length} individual external {entries.length === 1 ? 'flight' : 'flights'}.</p>
            </div>
          </div>
          {canEdit && (
            <div className={`flex gap-2 ${onClose ? 'sm:pr-12' : ''}`}>
              <button type="button" onClick={() => setBaselineOpen(true)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 sm:flex-none">
                {baseline ? <Pencil className="h-4 w-4" /> : <BookOpenCheck className="h-4 w-4" />} {baseline ? 'Edit opening balance' : 'Set opening balance'}
              </button>
              <button type="button" onClick={() => onEditorChange({ mode: 'new' })} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 sm:flex-none">
                <Plus className="h-4 w-4" /> Add flight
              </button>
            </div>
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close external logbook hours" className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          {baseline ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Opening balance</p>
                  <p className="mt-1 text-sm text-indigo-950">Cumulative through {formatDate(baseline.as_of_date)}</p>
                </div>
                <BookOpenCheck className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[
                  ['Total', formatHours(baseline.total_hours)],
                  ['PIC', formatHours(baseline.pic_hours)],
                  ['Dual', formatHours(baseline.dual_hours)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-white/80 p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-indigo-900">Last actual flight included: <strong>{formatDate(baseline.last_flight_date)}</strong></p>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="font-semibold text-slate-900">No opening balance recorded</p>
              <p className="mt-1 text-sm leading-5 text-slate-600">Portal totals currently use individual portal and external flights only. Set a baseline to include your complete logbook totals through a chosen date.</p>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-5 text-blue-950">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>PIC hours from the opening balance and external entries count toward aircraft-hire guidance. Recency uses actual flight dates only.</p>
            </div>
            <div className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm leading-5 text-slate-700">
              <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
              <p>If you have a digital logbook and would like it uploaded to the portal, contact an admin for assistance.</p>
            </div>
            {!canEdit && <p className="text-xs text-slate-500">Only {userName} can add, change or remove these external logbook records.</p>}
          </div>
        </div>
      </section>

      {baselineOpen && (
        <BaselineEditor
          baseline={baseline}
          onClose={() => setBaselineOpen(false)}
          onSave={onSaveBaseline}
          onDelete={onDeleteBaseline}
        />
      )}
      {editor && (
        <ExternalFlightEditor
          state={editor}
          userName={userName}
          baseline={baseline}
          onClose={() => onEditorChange(null)}
          onSave={onSaveEntry}
          onDelete={onDeleteEntry}
        />
      )}
    </>
  );
};

export const ExternalLogbookDialog: React.FC<ExternalLogbookDialogProps> = ({
  isOpen,
  onClose,
  ...panelProps
}) => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="External logbook hours"
        className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-5xl sm:rounded-2xl"
      >
        <ExternalLogbookPanel {...panelProps} onClose={onClose} inDialog />
      </section>
    </div>
  );
};
