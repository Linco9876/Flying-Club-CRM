import { Move, Repeat2, X } from 'lucide-react';
import type { Booking } from '../../types';
import {
  getExpectedFutureOccurrenceCount,
  type RecurringBookingEditScope,
} from '../../utils/recurringBookingEdits';

interface RecurringBookingInteractionModalProps {
  booking: Booking;
  action: 'move' | 'resize';
  onSelect: (scope: RecurringBookingEditScope) => void;
  onClose: () => void;
}

export const RecurringBookingInteractionModal = ({
  booking,
  action,
  onSelect,
  onClose,
}: RecurringBookingInteractionModalProps) => {
  const remainingCount = getExpectedFutureOccurrenceCount(booking);
  const actionLabel = action === 'resize' ? 'resize' : 'move';

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="recurring-interaction-title">
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:rounded-2xl dark:border-[#363b45] dark:bg-[#171a21]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-[#363b45]">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200">
              {action === 'resize' ? <Repeat2 className="h-5 w-5" /> : <Move className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="recurring-interaction-title" className="text-lg font-bold text-gray-950 dark:text-gray-100">
                {action === 'resize' ? 'Resize recurring booking' : 'Move recurring booking'}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Choose how much of the series to {actionLabel}.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-[#262b33]" aria-label="Close series options">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 p-5">
          <button
            type="button"
            onClick={() => onSelect('single')}
            className="min-h-16 rounded-xl border border-gray-300 px-4 py-3 text-left transition-colors hover:border-blue-500 hover:bg-blue-50 dark:border-[#454b56] dark:hover:bg-blue-950/30"
          >
            <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">This booking only</span>
            <span className="mt-1 block text-xs leading-5 text-gray-600 dark:text-gray-300">The other dates in the series stay unchanged.</span>
          </button>
          <button
            type="button"
            onClick={() => onSelect('future')}
            className="min-h-16 rounded-xl border border-blue-300 bg-blue-50/60 px-4 py-3 text-left transition-colors hover:border-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30"
          >
            <span className="block text-sm font-bold text-blue-950 dark:text-blue-100">This and all future bookings</span>
            <span className="mt-1 block text-xs leading-5 text-blue-800 dark:text-blue-200">
              Applies the same change to up to {remainingCount || 'all remaining'} active bookings. Earlier, completed and cancelled bookings stay unchanged.
            </span>
          </button>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-[#363b45] dark:bg-[#12151b]">
          <button type="button" onClick={onClose} className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-[#454b56] dark:bg-[#171a21] dark:text-gray-200">
            Cancel change
          </button>
        </div>
      </div>
    </div>
  );
};
