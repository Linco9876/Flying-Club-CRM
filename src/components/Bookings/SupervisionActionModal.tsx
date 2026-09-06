import React from 'react';
import { CalendarPlus, Check, Clock3, Loader2, ShieldCheck, X } from 'lucide-react';
import type { Booking } from '../../types';
import type { ManualSupervisorOption } from '../../utils/manualBookingSupervision';
import { supervisionToCalendarEvent } from '../../utils/calendarSupervision';
import { AddToCalendarModal } from './AddToCalendarModal';
import { SupervisorAssignmentModal } from './SupervisorAssignmentModal';

interface SupervisionActionModalProps {
  booking: Booking;
  instructorName: string;
  supervisorName: string;
  coverageStart: Date;
  coverageEnd: Date;
  aircraftLabel?: string;
  canAcknowledge: boolean;
  acknowledging: boolean;
  onAcknowledge: () => Promise<void> | void;
  canReallocate: boolean;
  supervisors: ManualSupervisorOption[];
  assigning: boolean;
  onAssign: (supervisorId: string) => Promise<void> | void;
  onClose: () => void;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

export const SupervisionActionModal: React.FC<SupervisionActionModalProps> = ({
  booking,
  instructorName,
  supervisorName,
  coverageStart,
  coverageEnd,
  aircraftLabel,
  canAcknowledge,
  acknowledging,
  onAcknowledge,
  canReallocate,
  supervisors,
  assigning,
  onAssign,
  onClose,
}) => {
  const [showCalendar, setShowCalendar] = React.useState(false);
  const [showAssignment, setShowAssignment] = React.useState(false);
  const acknowledged = booking.supervisionStatus === 'acknowledged';

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !acknowledging && !assigning) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [acknowledging, assigning, onClose]);

  const calendarEvent = supervisionToCalendarEvent(booking, {
    aircraftLabel,
    instructorName,
    supervisorName,
    coverageStart,
    coverageEnd,
    portalUrl: `${window.location.origin}/calendar`,
  });

  if (showCalendar) {
    return <AddToCalendarModal event={calendarEvent} itemLabel="supervision allocation" onClose={() => setShowCalendar(false)} />;
  }

  if (showAssignment) {
    return (
      <SupervisorAssignmentModal
        booking={booking}
        supervisors={supervisors}
        assigning={assigning}
        currentSupervisorName={supervisorName}
        onAssign={onAssign}
        onClose={() => setShowAssignment(false)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      role="presentation"
      data-supervision-action-modal
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => { if (!acknowledging && !assigning) onClose(); }}
        aria-label="Close supervision actions"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="supervision-actions-title"
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-amber-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-amber-900/80 dark:bg-slate-900 sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="supervision-actions-title" className="text-lg font-black text-slate-950 dark:text-white">
                Supervision allocation
              </h2>
              <p className="mt-1 truncate text-sm font-bold text-amber-800 dark:text-amber-300">
                Supervising {instructorName}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={acknowledging || assigning}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close supervision actions"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-950/60">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">Supervisor</span>
            <span className="truncate font-bold text-slate-900 dark:text-white">{supervisorName}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400"><Clock3 className="h-4 w-4" /> Coverage</span>
            <span className="text-right font-bold text-slate-900 dark:text-white">
              {dateTimeFormatter.format(coverageStart)}<br />to {dateTimeFormatter.format(coverageEnd)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">Status</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-black ${acknowledged
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'}`}
            >
              {acknowledged ? 'Acknowledged' : 'Awaiting acknowledgement'}
            </span>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
          These controls change only the supervision allocation. The booking, aircraft, student and flight record cannot be edited here.
        </p>

        <div className="mt-5 grid gap-2">
          {canAcknowledge && !acknowledged && (
            <button
              type="button"
              disabled={acknowledging}
              onClick={() => void onAcknowledge()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
            >
              {acknowledging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {acknowledging ? 'Acknowledging…' : 'Acknowledge supervision'}
            </button>
          )}
          {canReallocate && (
            <button
              type="button"
              disabled={assigning}
              onClick={() => setShowAssignment(true)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-black text-amber-950 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
            >
              {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Reallocate supervision
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCalendar(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
          >
            <CalendarPlus className="h-4 w-4" />
            Add supervision to my calendar
          </button>
        </div>
      </section>
    </div>
  );
};
