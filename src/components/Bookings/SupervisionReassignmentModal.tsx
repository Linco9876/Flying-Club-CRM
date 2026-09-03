import React from 'react';
import { ArrowRight, Loader2, ShieldCheck, X } from 'lucide-react';
import type { Booking } from '../../types';

interface SupervisionReassignmentModalProps {
  booking: Booking;
  currentSupervisorName?: string;
  nextSupervisorName: string;
  assigning: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export const SupervisionReassignmentModal: React.FC<SupervisionReassignmentModalProps> = ({
  booking,
  currentSupervisorName,
  nextSupervisorName,
  assigning,
  onConfirm,
  onClose,
}) => {
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

  const time = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(booking.startTime));

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={() => { if (!assigning) onClose(); }}
        aria-label="Close supervisor reassignment"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="supervision-reassignment-title"
        className="relative z-10 w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="supervision-reassignment-title" className="text-lg font-black text-slate-950 dark:text-white">
                {currentSupervisorName ? 'Change supervisor' : 'Allocate supervisor'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {time} · {booking.location || 'Bendigo'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={assigning}
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close supervisor reassignment"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/60">
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700 dark:text-slate-200">
            {currentSupervisorName || 'Unallocated'}
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate text-right text-sm font-black text-cyan-800 dark:text-cyan-200">
            {nextSupervisorName}
          </span>
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-600 dark:text-slate-300">
          The booking time, aircraft, student and booked instructor will not change. The selected supervisor will be validated and notified.
        </p>

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
            disabled={assigning}
            onClick={() => void onConfirm()}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-cyan-700 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-800 disabled:cursor-wait disabled:opacity-70"
          >
            {assigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {assigning ? 'Saving…' : currentSupervisorName ? 'Change supervisor' : 'Allocate supervisor'}
          </button>
        </div>
      </section>
    </div>
  );
};
