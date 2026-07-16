import { useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  BookingCancellationReason,
  BookingCancellationReasonInput,
  useBookingCancellationReasons,
} from '../../hooks/useBookingCancellationReasons';

interface CancellationReasonsSettingsProps {
  canEdit: boolean;
}

const emptyReason = (): BookingCancellationReasonInput => ({
  name: '',
  description: '',
  feeType: 'none',
  feeAmount: 0,
  isActive: true,
  displayOrder: 100,
});

export const CancellationReasonsSettings = ({ canEdit }: CancellationReasonsSettingsProps) => {
  const { reasons, loading, createReason, updateReason, deleteReason } = useBookingCancellationReasons();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingCancellationReasonInput | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (reason?: BookingCancellationReason) => {
    setEditingId(reason?.id || 'new');
    setDraft(reason ? {
      name: reason.name,
      description: reason.description || '',
      feeType: reason.feeType,
      feeAmount: reason.feeAmount,
      isActive: reason.isActive,
      displayOrder: reason.displayOrder,
    } : emptyReason());
  };

  const save = async () => {
    if (!draft?.name.trim()) {
      toast.error('Enter a cancellation reason name');
      return;
    }
    setSaving(true);
    try {
      if (editingId === 'new') await createReason(draft);
      else if (editingId) await updateReason(editingId, draft);
      setEditingId(null);
      setDraft(null);
    } catch (error) {
      console.error('Failed to save cancellation reason:', error);
      toast.error('Failed to save cancellation reason');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (reason: BookingCancellationReason) => {
    if (!window.confirm(`Remove "${reason.name}"? Existing cancelled bookings keep their saved reason.`)) return;
    try {
      await deleteReason(reason.id);
    } catch (error) {
      console.error('Failed to remove cancellation reason:', error);
      toast.error('Failed to remove cancellation reason');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading cancellation reasons...</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-gray-900">Cancellation reasons and fees</h4>
          <p className="mt-1 text-sm text-gray-500">
            Reasons are required inside the notice period. Fee amounts are recorded for admin review.
          </p>
        </div>
        {canEdit && !draft && (
          <button type="button" onClick={() => startEdit()} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Add reason
          </button>
        )}
      </div>

      {draft && (
        <div className="grid gap-3 rounded-md border border-blue-200 bg-blue-50 p-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason</label>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Fee outcome</label>
            <select value={draft.feeType} onChange={(e) => setDraft({ ...draft, feeType: e.target.value as BookingCancellationReasonInput['feeType'] })} className="w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="none">No fee</option>
              <option value="late_cancel">Late cancellation fee</option>
              <option value="no_show">No-show fee</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <input value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full rounded-md border border-gray-300 px-3 py-2" />
          </div>
          {draft.feeType !== 'none' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Fee amount</label>
              <input type="number" min="0" step="0.01" value={draft.feeAmount} onChange={(e) => setDraft({ ...draft, feeAmount: Number(e.target.value) })} className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-blue-600" />
            Available for new cancellations
          </label>
          <div className="flex justify-end gap-2 md:col-span-2">
            <button type="button" onClick={() => { setDraft(null); setEditingId(null); }} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm"><X className="h-4 w-4" /> Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save reason'}</button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-200 rounded-md border border-gray-200">
        {reasons.map(reason => (
          <div key={reason.id} className="flex items-start justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{reason.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${reason.feeType === 'none' ? 'bg-gray-100 text-gray-700' : 'bg-amber-100 text-amber-800'}`}>
                  {reason.feeType === 'none' ? 'No fee' : `${reason.feeType === 'no_show' ? 'No-show' : 'Late cancel'} $${reason.feeAmount.toFixed(2)}`}
                </span>
                {!reason.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Inactive</span>}
              </div>
              {reason.description && <p className="mt-1 text-sm text-gray-500">{reason.description}</p>}
            </div>
            {canEdit && (
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => startEdit(reason)} title="Edit reason" className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={() => remove(reason)} title="Remove reason" className="rounded-md p-2 text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
