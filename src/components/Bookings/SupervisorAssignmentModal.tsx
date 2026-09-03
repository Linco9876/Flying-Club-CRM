import React from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import type { Booking } from '../../types';
import type { ManualSupervisorOption } from '../../utils/manualBookingSupervision';
import { SearchableSelect } from '../common/SearchableSelect';

interface SupervisorAssignmentModalProps {
  booking: Booking;
  supervisors: ManualSupervisorOption[];
  assigning?: boolean;
  currentSupervisorName?: string;
  onAssign: (supervisorId: string) => Promise<void> | void;
  onClose: () => void;
}

export const SupervisorAssignmentModal: React.FC<SupervisorAssignmentModalProps> = ({
  booking,
  supervisors,
  assigning = false,
  currentSupervisorName,
  onAssign,
  onClose,
}) => {
  const [supervisorId, setSupervisorId] = React.useState('');
  const supervisorName = supervisors.find(supervisor => supervisor.id === supervisorId)?.name;

  React.useEffect(() => {
    setSupervisorId(current => supervisors.some(supervisor => supervisor.id === current)
      ? current
      : '');
  }, [supervisors]);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !assigning) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [assigning, onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => { if (!assigning) onClose(); }}
        aria-label="Close supervisor allocation"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="supervisor-assignment-title"
        className="relative z-10 w-full max-w-lg rounded-t-3xl border border-slate-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="supervisor-assignment-title" className="text-lg font-black text-slate-950 dark:text-white">
                {currentSupervisorName ? 'Change supervisor' : 'Allocate supervisor'}
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
                {currentSupervisorName
                  ? `Currently allocated to ${currentSupervisorName}. Choose a replacement.`
                  : 'Choose a currently authorised senior instructor for this booking.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={assigning}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close supervisor allocation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs leading-5 text-cyan-950 dark:border-cyan-800/70 dark:bg-cyan-950/30 dark:text-cyan-100">
          This CFI allocation can override roster availability. The selected supervisor must still have the right authorisation, current qualification, duty capacity and concurrent-supervision capacity. They will be notified and asked to acknowledge the assignment.
        </div>

        <label htmlFor={`supervisor-${booking.id}`} className="mt-5 block text-sm font-bold text-slate-800 dark:text-slate-100">
          Authorised supervisor
        </label>
        {supervisors.length > 0 ? (
          <SearchableSelect
            id={`supervisor-${booking.id}`}
            value={supervisorId}
            onChange={event => setSupervisorId(event.target.value)}
            disabled={assigning}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
            aria-label="Authorised supervisor"
          >
            <option value="">Select a supervisor</option>
            {supervisors.map(supervisor => (
              <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
            ))}
          </SearchableSelect>
        ) : (
          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-100">
            No active senior-instructor authorisation covers this booking's location, activity and date. Update the authorisation record before allocating supervision.
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={assigning}
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!supervisorId || assigning}
            onClick={() => void Promise.resolve(onAssign(supervisorId))
              .then(onClose)
              .catch(() => undefined)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {assigning
              ? 'Saving…'
              : `${currentSupervisorName ? 'Change to' : 'Allocate'}${supervisorName ? ` ${supervisorName}` : ''}`}
          </button>
        </div>
      </section>
    </div>
  );
};
