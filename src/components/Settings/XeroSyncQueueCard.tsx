import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type QueueStatus = 'all' | 'pending' | 'processing' | 'synced' | 'needs_review' | 'failed' | 'cancelled';

interface XeroQueueItem {
  id: string;
  entity_type: string;
  action: string;
  status: Exclude<QueueStatus, 'all'>;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  next_attempt_at: string;
  entityLabel?: string | null;
  entityDetail?: string | null;
  recordStatus?: string | null;
}

interface QueueResponse {
  items: XeroQueueItem[];
  counts: Record<string, number>;
}

const statusOptions: { value: QueueStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'failed', label: 'Failed' },
  { value: 'synced', label: 'Synced' },
  { value: 'cancelled', label: 'Cancelled' },
];

const statusPillClass = (status: string) => {
  switch (status) {
    case 'synced':
      return 'bg-green-100 text-green-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'needs_review':
      return 'bg-amber-100 text-amber-800';
    case 'processing':
      return 'bg-blue-100 text-blue-800';
    case 'pending':
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

export const XeroSyncQueueCard: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<QueueStatus>('all');
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [queue, setQueue] = useState<XeroQueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const loadQueue = useCallback(async (status: QueueStatus) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<QueueResponse>('xero-sync', {
        body: { action: 'list-queue', status, limit: 60 },
      });
      if (error) throw error;
      setQueue(data?.items || []);
      setCounts(data?.counts || {});
    } catch (error: any) {
      console.error('Failed to load Xero queue:', error);
      toast.error(error?.message || 'Failed to load Xero sync queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue(statusFilter);
  }, [loadQueue, statusFilter]);

  const processNext = async () => {
    setProcessingId('next');
    try {
      const { data, error } = await supabase.functions.invoke<{ processed?: boolean; message?: string }>('xero-sync', {
        body: { action: 'process-next' },
      });
      if (error) throw error;
      if (!data?.processed) {
        toast(data?.message || 'No pending Xero sync work');
      } else {
        toast.success('Processed the next Xero queue item');
      }
      await loadQueue(statusFilter);
    } catch (error: any) {
      console.error('Failed to process next Xero queue item:', error);
      toast.error(error?.message || 'Failed to process next Xero queue item');
      await loadQueue(statusFilter);
    } finally {
      setProcessingId(null);
    }
  };

  const processItem = async (queueId: string) => {
    setProcessingId(queueId);
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'process-item', queueId },
      });
      if (error) throw error;
      toast.success('Xero queue item processed');
      await loadQueue(statusFilter);
    } catch (error: any) {
      console.error('Failed to process Xero queue item:', error);
      toast.error(error?.message || 'Failed to process Xero queue item');
      await loadQueue(statusFilter);
    } finally {
      setProcessingId(null);
    }
  };

  const retryItem = async (queueId: string) => {
    setRetryingId(queueId);
    try {
      const { error } = await supabase.functions.invoke('xero-sync', {
        body: { action: 'retry-item', queueId },
      });
      if (error) throw error;
      toast.success('Queue item returned to pending');
      await loadQueue(statusFilter);
    } catch (error: any) {
      console.error('Failed to retry Xero queue item:', error);
      toast.error(error?.message || 'Failed to retry Xero queue item');
    } finally {
      setRetryingId(null);
    }
  };

  const summary = useMemo(
    () => [
      { label: 'Pending', value: counts.pending || 0, tone: 'text-slate-700' },
      { label: 'Needs review', value: counts.needs_review || 0, tone: 'text-amber-700' },
      { label: 'Failed', value: counts.failed || 0, tone: 'text-red-700' },
      { label: 'Synced', value: counts.synced || 0, tone: 'text-green-700' },
    ],
    [counts],
  );

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-gray-900">Xero sync queue</h3>
              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                Admin only
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Review pending, synced, failed and needs-review Xero items in one place. Process or retry them here instead of chasing them through member profiles and billing.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadQueue(statusFilter)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={processNext}
              disabled={processingId === 'next'}
              className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
            >
              {processingId === 'next' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
              Process next
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summary.map(item => (
            <div key={item.label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.label}</p>
              <p className={`mt-1 text-2xl font-bold ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {statusOptions.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatusFilter(option.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                statusFilter === option.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {queue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              No Xero sync items match this filter.
            </div>
          ) : (
            queue.map(item => {
              const canProcess = item.status === 'pending' || item.status === 'needs_review';
              const canRetry = item.status === 'failed' || item.status === 'needs_review' || item.status === 'cancelled';
              return (
                <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {item.entityLabel || item.entity_type}
                        </p>
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusPillClass(item.status)}`}>
                          {item.status.replace('_', ' ')}
                        </span>
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {item.entity_type}
                        </span>
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {item.action}
                        </span>
                      </div>
                      {item.entityDetail && (
                        <p className="mt-1 truncate text-sm text-gray-600">{item.entityDetail}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>Attempts: {item.attempts}</span>
                        {item.recordStatus ? <span>Record status: {item.recordStatus}</span> : null}
                        <span>Queued: {new Date(item.created_at).toLocaleString()}</span>
                        <span>Next: {new Date(item.next_attempt_at).toLocaleString()}</span>
                      </div>
                      {item.last_error && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                          <span>{item.last_error}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canProcess && (
                        <button
                          type="button"
                          onClick={() => processItem(item.id)}
                          disabled={processingId === item.id}
                          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {processingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Process
                        </button>
                      )}
                      {canRetry && (
                        <button
                          type="button"
                          onClick={() => retryItem(item.id)}
                          disabled={retryingId === item.id}
                          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {retryingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                          Retry
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
};
