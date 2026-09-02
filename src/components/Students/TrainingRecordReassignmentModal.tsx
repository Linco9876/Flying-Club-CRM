import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Loader2,
  Plane,
  Search,
  User,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import type { TrainingRecord } from '../../types';
import { supabase } from '../../lib/supabase';
import {
  getTrainingRecordReassignmentCandidates,
  matchesTrainingRecordReassignmentSearch,
  type TrainingRecordFlightLink,
  type TrainingRecordReassignmentFlight,
} from '../../utils/trainingRecordReassignment';

interface ReassignmentResult {
  acknowledgementEmailRequired?: boolean;
  studentAcknowledgementReset?: boolean;
}

interface TrainingRecordReassignmentModalProps {
  record: TrainingRecord;
  currentUserId: string;
  canManageAnyInstructor: boolean;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

const relationValue = <T,>(value: T | T[] | null | undefined): T | undefined => (
  Array.isArray(value) ? value[0] : value ?? undefined
);

const displayFlightDate = (value: string | Date) => format(new Date(value), 'EEE d MMM yyyy, h:mm a');

export const TrainingRecordReassignmentModal: React.FC<TrainingRecordReassignmentModalProps> = ({
  record,
  currentUserId,
  canManageAnyInstructor,
  onClose,
  onCompleted,
}) => {
  const [flights, setFlights] = useState<TrainingRecordReassignmentFlight[]>([]);
  const [links, setLinks] = useState<TrainingRecordFlightLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedFlightId, setSelectedFlightId] = useState('');
  const [reason, setReason] = useState('Attached to the wrong outstanding flight');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadCandidates = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [{ data: flightRows, error: flightError }, { data: recordRows, error: recordError }] = await Promise.all([
          supabase
            .from('flight_logs')
            .select(`
              id,
              booking_id,
              instructor_id,
              start_time,
              end_time,
              dual_time,
              solo_time,
              training_record_status,
              aircraft:aircraft_id ( registration ),
              instructor:instructor_id ( name ),
              booking:booking_id ( notes )
            `)
            .eq('student_id', record.studentId)
            .order('start_time', { ascending: false })
            .limit(250),
          supabase
            .from('training_records')
            .select('id, flight_log_id, booking_id')
            .eq('student_id', record.studentId),
        ]);

        if (flightError) throw flightError;
        if (recordError) throw recordError;
        if (cancelled) return;

        setFlights((flightRows ?? []).map(row => {
          const aircraft = relationValue(row.aircraft as { registration?: string } | Array<{ registration?: string }> | null);
          const instructor = relationValue(row.instructor as { name?: string } | Array<{ name?: string }> | null);
          const booking = relationValue(row.booking as { notes?: string } | Array<{ notes?: string }> | null);
          return {
            id: row.id,
            bookingId: row.booking_id,
            instructorId: row.instructor_id,
            startTime: row.start_time,
            endTime: row.end_time,
            dualTime: Number(row.dual_time ?? 0),
            soloTime: Number(row.solo_time ?? 0),
            trainingRecordStatus: (row.training_record_status || 'pending') as TrainingRecordReassignmentFlight['trainingRecordStatus'],
            registration: aircraft?.registration,
            instructorName: instructor?.name,
            bookingNotes: booking?.notes,
          };
        }));
        setLinks((recordRows ?? []).map(row => ({
          trainingRecordId: row.id,
          flightLogId: row.flight_log_id,
          bookingId: row.booking_id,
        })));
      } catch (error) {
        console.error('Failed to load training record reassignment candidates', error);
        if (!cancelled) setLoadError('Compatible logged flights could not be loaded. Close this window and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadCandidates();
    return () => { cancelled = true; };
  }, [record.studentId]);

  const candidates = useMemo(() => getTrainingRecordReassignmentCandidates({
    flights,
    links,
    sourceFlightLogId: record.flightLogId || '',
    sourceTrainingRecordId: record.id,
    currentUserId,
    canManageAnyInstructor,
  }), [canManageAnyInstructor, currentUserId, flights, links, record.flightLogId, record.id]);

  const visibleCandidates = useMemo(
    () => candidates.filter(candidate => matchesTrainingRecordReassignmentSearch(candidate, search)),
    [candidates, search],
  );
  const selectedFlight = candidates.find(candidate => candidate.id === selectedFlightId);
  const reasonIsValid = reason.trim().length >= 5 && reason.trim().length <= 500;

  const handleReassign = async () => {
    if (!selectedFlight || !reasonIsValid || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('reassign_training_record_flight', {
        p_training_record_id: record.id,
        p_target_flight_log_id: selectedFlight.id,
        p_reason: reason.trim(),
      });
      if (error) throw error;

      const result = (data ?? {}) as ReassignmentResult;
      let acknowledgementEmailFailed = false;
      if (result.acknowledgementEmailRequired) {
        const { error: emailError } = await supabase.functions.invoke('send-training-record-acknowledgement', {
          body: { trainingRecordId: record.id },
        });
        acknowledgementEmailFailed = Boolean(emailError);
        if (emailError) console.error('Reassignment succeeded but the corrected acknowledgement email failed', emailError);
      }

      await onCompleted();
      onClose();
      if (acknowledgementEmailFailed) {
        toast.success('Record moved. The corrected acknowledgement email needs to be resent.');
      } else if (result.studentAcknowledgementReset) {
        toast.success('Record moved and returned to the student for acknowledgement.');
      } else {
        toast.success('Training record moved to the selected flight.');
      }
    } catch (error) {
      console.error('Failed to reassign training record', error);
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'The training record could not be moved.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reassign training record to another flight"
      onMouseDown={event => { if (event.target === event.currentTarget && !submitting) onClose(); }}
    >
      <div className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#171a21] sm:max-h-[90vh] sm:rounded-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-4 dark:border-[#2c2f36] sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-950 dark:text-white">Reassign to another logged flight</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              The lesson content stays intact. Only its flight, aircraft, instructor and recorded times are corrected.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close reassignment"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-[#262b33] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-950/20">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Currently attached</p>
              <p className="mt-2 font-semibold text-amber-950 dark:text-amber-100">
                {displayFlightDate(record.bookingStartTime || record.date)}
              </p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{record.registration || 'Aircraft not recorded'}</p>
            </div>
            <ArrowRight className="mx-auto h-5 w-5 rotate-90 text-gray-400 sm:rotate-0" />
            <div className={`rounded-xl border p-4 ${selectedFlight
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-950/20'
              : 'border-dashed border-gray-300 bg-gray-50 dark:border-[#39414d] dark:bg-[#11141a]'}`}>
              <p className={`text-xs font-bold uppercase tracking-wide ${selectedFlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500'}`}>Move to</p>
              {selectedFlight ? (
                <>
                  <p className="mt-2 font-semibold text-emerald-950 dark:text-emerald-100">{displayFlightDate(selectedFlight.startTime)}</p>
                  <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">{selectedFlight.registration || 'Aircraft not recorded'}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">Select the correct flight below.</p>
              )}
            </div>
          </div>

          <section>
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold text-gray-950 dark:text-white">Compatible outstanding flights</h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Only this student's flights without another training record are shown.</p>
              </div>
              <label className="relative block sm:w-72">
                <span className="sr-only">Search compatible flights</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search date, aircraft, instructor..."
                  className="min-h-11 w-full rounded-xl border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-[#39414d] dark:bg-[#11141a] dark:text-white"
                />
              </label>
            </div>

            {loading && (
              <div className="flex min-h-36 items-center justify-center gap-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 dark:border-[#343b47] dark:text-gray-300">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" /> Loading logged flights...
              </div>
            )}
            {!loading && loadError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/25 dark:bg-red-950/20 dark:text-red-200">{loadError}</div>
            )}
            {!loading && !loadError && candidates.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center dark:border-[#39414d] dark:bg-[#11141a]">
                <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
                <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-white">No compatible outstanding flight was found</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Check that the correct flight has been logged and does not already have a training record.</p>
              </div>
            )}
            {!loading && !loadError && candidates.length > 0 && visibleCandidates.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-[#39414d] dark:text-gray-400">No compatible flight matches that search.</div>
            )}
            {!loading && !loadError && visibleCandidates.length > 0 && (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {visibleCandidates.map(candidate => {
                  const selected = candidate.id === selectedFlightId;
                  const durationHours = candidate.dualTime + candidate.soloTime;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedFlightId(candidate.id)}
                      className={`w-full rounded-xl border p-3 text-left transition sm:p-4 ${selected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15 dark:bg-blue-950/25'
                        : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50 dark:border-[#343b47] dark:bg-[#11141a] dark:hover:border-blue-500/50 dark:hover:bg-blue-950/15'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-950 dark:text-white">{displayFlightDate(candidate.startTime)}</p>
                          {candidate.bookingNotes && <p className="mt-1 truncate text-sm text-gray-600 dark:text-gray-300">{candidate.bookingNotes}</p>}
                        </div>
                        <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${selected ? 'border-blue-600 bg-blue-600 ring-2 ring-blue-200' : 'border-gray-300'}`} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                        <span className="inline-flex items-center gap-1"><Plane className="h-3.5 w-3.5" />{candidate.registration || 'No aircraft'}</span>
                        <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{candidate.instructorName || 'No instructor name'}</span>
                        <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{durationHours.toFixed(1)} flight hours</span>
                        {candidate.trainingRecordStatus === 'dismissed' && <span className="font-semibold text-amber-700 dark:text-amber-300">Previously marked no record needed</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <label className="block">
            <span className="block text-sm font-semibold text-gray-900 dark:text-white">Reason for reassignment</span>
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              className="mt-2 w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-[#39414d] dark:bg-[#11141a] dark:text-white"
            />
            <span className="mt-1 flex justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>This reason is stored permanently in the training record audit history.</span>
              <span>{reason.length}/500</span>
            </span>
          </label>

          {record.studentAck && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/25 dark:bg-amber-950/20 dark:text-amber-100">
              <p className="font-semibold">Student acknowledgement will be reset</p>
              <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">Changing the linked flight is material. The corrected record will be sent back to the student to acknowledge again.</p>
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 px-4 py-4 dark:border-[#2c2f36] dark:bg-[#11141a] sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-11 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-white disabled:opacity-50 dark:border-[#39414d] dark:text-gray-200 dark:hover:bg-[#262b33]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleReassign()}
            disabled={!selectedFlight || !reasonIsValid || submitting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {submitting ? 'Moving record...' : 'Move training record'}
          </button>
        </footer>
      </div>
    </div>
  );
};

