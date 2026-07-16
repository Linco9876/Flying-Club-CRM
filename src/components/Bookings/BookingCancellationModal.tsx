import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { Booking } from '../../types';
import type { BookingCancellationInput } from '../../hooks/useBookings';
import { useBookingCancellationReasons } from '../../hooks/useBookingCancellationReasons';
import { useBookingRulesSettings } from '../../hooks/useSettings';

interface BookingCancellationModalProps {
  booking: Booking;
  onClose: () => void;
  onConfirm: (input: BookingCancellationInput) => Promise<void> | void;
}

export const BookingCancellationModal = ({ booking, onClose, onConfirm }: BookingCancellationModalProps) => {
  const { reasons, loading } = useBookingCancellationReasons();
  const { settings } = useBookingRulesSettings();
  const [reasonId, setReasonId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const insideNoticePeriod = Boolean(
    settings?.enforce_cancellation_notice &&
    booking.startTime.getTime() < Date.now() + settings.cancellation_notice_hours * 60 * 60 * 1000
  );
  const activeReasons = useMemo(() => reasons.filter(reason => reason.isActive), [reasons]);
  const selectedReason = activeReasons.find(reason => reason.id === reasonId);
  const needsNotes = selectedReason?.name.toLowerCase() === 'other';

  const submit = async () => {
    if (insideNoticePeriod && !reasonId) return;
    if (needsNotes && !notes.trim()) return;
    setSubmitting(true);
    try {
      await onConfirm({ reasonId: reasonId || undefined, notes: notes.trim() || undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-booking-title">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl dark:border-[#363b45] dark:bg-[#171a21]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-[#363b45]">
          <div>
            <h2 id="cancel-booking-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Cancel booking</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {booking.startTime.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-[#262b33]" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          {insideNoticePeriod && (
            <div className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>This booking is inside the {settings?.cancellation_notice_hours} hour cancellation period. Select a reason so the correct fee outcome is recorded.</p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
              Cancellation reason {insideNoticePeriod && <span className="text-red-500">*</span>}
            </label>
            <select value={reasonId} onChange={(event) => setReasonId(event.target.value)} disabled={loading} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-[#454b56] dark:bg-[#10131a] dark:text-gray-100">
              <option value="">{loading ? 'Loading reasons...' : 'Select a reason'}</option>
              {activeReasons.map(reason => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
            {selectedReason?.description && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{selectedReason.description}</p>}
          </div>

          {selectedReason && insideNoticePeriod && selectedReason.feeType !== 'none' && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-100">
              This reason records a {selectedReason.feeType === 'no_show' ? 'no-show' : 'late cancellation'} fee of ${selectedReason.feeAmount.toFixed(2)} for admin review.
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">Notes {needsNotes && <span className="text-red-500">*</span>}</label>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Optional details" className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-[#454b56] dark:bg-[#10131a] dark:text-gray-100" />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-[#363b45] dark:bg-[#12151b]">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-[#454b56] dark:bg-[#171a21] dark:text-gray-200">Keep booking</button>
          <button type="button" onClick={submit} disabled={submitting || loading || (insideNoticePeriod && !reasonId) || (needsNotes && !notes.trim())} className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm cancellation
          </button>
        </div>
      </div>
    </div>
  );
};
