import React, { useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Clock3, Coffee, MapPin, Plane, X } from 'lucide-react';
import type { DutyPeriod } from '../../types';
import { groupDutyHistoryByWeek } from '../../utils/dutyWeekSummary';

type Props = {
  period: DutyPeriod;
  onClose: () => void;
};

const readableMinutes = (minutes: number) => {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return [hours ? `${hours} h` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ') || '0 min';
};

const sourceLabel = (source: DutyPeriod['entrySource']) => {
  if (source === 'automatic_booking') return 'Automatic booking start';
  if (source === 'mobile') return 'Duty Clock app';
  return 'Manual entry';
};

const breakTypeLabel = (type: DutyPeriod['breaks'][number]['breakType']) => {
  if (type === 'split_duty_rest') return 'Split-duty rest';
  if (type === 'rest') return 'Rest period';
  return 'Break';
};

const Detail = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/80">
    <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{value}</dd>
  </div>
);

export const DutyPeriodDetailsModal: React.FC<Props> = ({ period, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const start = period.actualStart || period.plannedStart;
  const end = period.actualEnd || period.plannedEnd;
  const totals = useMemo(() => groupDutyHistoryByWeek([period])[0], [period]);
  const dutyMinutes = totals?.dutyMinutes || 0;
  const breakMinutes = totals?.breakMinutes || 0;
  const dutyMinusBreaks = totals?.dutyMinutesExcludingBreaks || 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duty-period-details-title"
      onMouseDown={event => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-300">Duty period details</p>
            <h2 id="duty-period-details-title" className="mt-1 text-xl font-black text-slate-950 dark:text-white">
              {format(new Date(`${period.dutyDate}T12:00:00`), 'EEEE, dd MMMM yyyy')}
            </h2>
            {period.instructorName && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{period.instructorName}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close duty period details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${period.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : period.status === 'active' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>{period.status === 'completed' ? 'Completed' : period.status === 'active' ? 'Active' : 'Draft'}</span>
            {period.isExternal && <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">External duty</span>}
            {period.autoClosedAtLimit && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">Maximum end assumed</span>}
            {period.breakConfirmation === 'not_taken' && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">No break taken</span>}
          </div>

          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-blue-950 p-4 text-white">
              <Clock3 className="h-5 w-5 text-blue-200" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-blue-200">Elapsed duty</p>
              <p className="mt-1 text-2xl font-black">{readableMinutes(dutyMinutes)}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950/40">
              <Plane className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Logged flying</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{readableMinutes(period.flightMinutes)}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4 dark:bg-amber-950/40">
              <Coffee className="h-5 w-5 text-amber-700 dark:text-amber-300" />
              <p className="mt-3 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Recorded breaks</p>
              <p className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{readableMinutes(breakMinutes)}</p>
            </div>
          </section>

          <section className="mt-6">
            <h3 className="font-black text-slate-950 dark:text-white">Period summary</h3>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <Detail label={period.actualStart ? 'Actual start' : 'Planned start'} value={start ? format(start, 'dd MMM yyyy, HH:mm') : 'Not recorded'} />
              <Detail label={period.actualEnd ? 'Actual end' : 'Planned end'} value={end ? format(end, 'dd MMM yyyy, HH:mm') : 'Not recorded'} />
              <Detail label="Duty excluding breaks" value={readableMinutes(dutyMinusBreaks)} />
              <Detail label="Entry method" value={sourceLabel(period.entrySource)} />
              <Detail label="Location" value={<span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-blue-600" />{period.location}</span>} />
              <Detail label="Break declaration" value={period.breakConfirmation === 'taken' ? 'Break taken' : period.breakConfirmation === 'not_taken' ? 'No break taken' : 'Not recorded'} />
              {period.isExternal && <Detail label="External organisation" value={period.externalOrganisation || 'Not recorded'} />}
              {period.plannedStart && <Detail label="Planned start" value={format(period.plannedStart, 'dd MMM yyyy, HH:mm')} />}
              {period.plannedEnd && <Detail label="Planned end" value={format(period.plannedEnd, 'dd MMM yyyy, HH:mm')} />}
            </dl>
          </section>

          <section className="mt-6">
            <div className="flex items-end justify-between gap-3">
              <h3 className="font-black text-slate-950 dark:text-white">Breaks</h3>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{period.breaks.length} recorded</p>
            </div>
            {period.breaks.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No individual breaks were recorded for this duty period.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {period.breaks.map(item => {
                  const duration = Math.max(0, Math.round((item.breakEnd.getTime() - item.breakStart.getTime()) / 60_000));
                  return (
                    <div key={item.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-slate-950 dark:text-white">{breakTypeLabel(item.breakType)}</p>
                          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{format(item.breakStart, 'HH:mm')} – {format(item.breakEnd, 'HH:mm')} · {readableMinutes(duration)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {item.freeOfDuty && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">Free of duty</span>}
                          {item.affectsCalculation && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">Approved calculation</span>}
                        </div>
                      </div>
                      {item.facility && <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Facility: {item.facility}</p>}
                      {item.notes && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{item.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {(period.notes || period.amendmentReason) && (
            <section className="mt-6 space-y-3">
              {period.notes && <div><h3 className="font-black text-slate-950 dark:text-white">Notes</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/80 dark:text-slate-200">{period.notes}</p></div>}
              {period.amendmentReason && <div><h3 className="font-black text-slate-950 dark:text-white">Latest amendment reason</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-800/80 dark:text-slate-200">{period.amendmentReason}</p></div>}
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">Close</button>
        </div>
      </div>
    </div>
  );
};
