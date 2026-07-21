import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Clock3, Keyboard, X } from 'lucide-react';
import { format } from 'date-fns';

type ClockPhase = 'hour' | 'minute';

interface DutyTimePickerProps {
  label: string;
  value: string;
  defaultDate: string;
  onChange: (value: string) => void;
  hint?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

const initialParts = (value: string, defaultDate: string) => {
  const now = new Date();
  const [datePart, timePart] = value.split('T');
  const [rawHour, rawMinute] = (timePart || '').split(':').map(Number);
  return {
    date: datePart || defaultDate || format(now, 'yyyy-MM-dd'),
    hour24: Number.isFinite(rawHour) ? rawHour : now.getHours(),
    minute: Number.isFinite(rawMinute) ? rawMinute : now.getMinutes(),
  };
};

const displayTime = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    date: format(date, 'EEE, dd MMM yyyy'),
    time: format(date, 'h:mm a'),
  };
};

export const DutyTimePicker: React.FC<DutyTimePickerProps> = ({ label, value, defaultDate, onChange, hint }) => {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ClockPhase>('hour');
  const [date, setDate] = useState(defaultDate);
  const [hour24, setHour24] = useState(12);
  const [minute, setMinute] = useState(0);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const hourButtonRef = useRef<HTMLButtonElement>(null);
  const minuteButtonRef = useRef<HTMLButtonElement>(null);
  const dialDragging = useRef(false);
  const lastWheelAt = useRef<Record<ClockPhase, number>>({ hour: 0, minute: 0 });
  const shown = useMemo(() => displayTime(value), [value]);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  const dialValue = phase === 'hour' ? hour12 : minute;
  const dialAngle = phase === 'hour' ? (hour12 % 12) * 30 : minute * 6;
  const dialLabels = phase === 'hour'
    ? Array.from({ length: 12 }, (_, index) => index + 1)
    : Array.from({ length: 12 }, (_, index) => index * 5);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const addWheelAdjustment = (element: HTMLButtonElement | null, target: ClockPhase) => {
      if (!element) return () => undefined;
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.deltaY === 0) return;

        const now = performance.now();
        if (now - lastWheelAt.current[target] < 60) return;
        lastWheelAt.current[target] = now;
        const direction = event.deltaY < 0 ? 1 : -1;
        setKeyboardMode(false);
        setPhase(target);
        if (target === 'hour') {
          setHour24(current => (current + direction + 24) % 24);
        } else {
          setMinute(current => (current + direction + 60) % 60);
        }
      };

      element.addEventListener('wheel', handleWheel, { passive: false });
      return () => element.removeEventListener('wheel', handleWheel);
    };

    const removeHourWheel = addWheelAdjustment(hourButtonRef.current, 'hour');
    const removeMinuteWheel = addWheelAdjustment(minuteButtonRef.current, 'minute');
    return () => {
      removeHourWheel();
      removeMinuteWheel();
    };
  }, [open]);

  const openPicker = () => {
    const next = initialParts(value, defaultDate);
    setDate(next.date);
    setHour24(next.hour24);
    setMinute(next.minute);
    setPhase('hour');
    setKeyboardMode(false);
    setOpen(true);
  };

  const setPeriod = (nextPeriod: 'AM' | 'PM') => {
    const baseHour = hour24 % 12;
    setHour24(nextPeriod === 'PM' ? baseHour + 12 : baseHour);
  };

  const setHour = (nextHour12: number) => {
    const baseHour = nextHour12 % 12;
    setHour24(period === 'PM' ? baseHour + 12 : baseHour);
  };

  const selectFromDial = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
    if (phase === 'hour') {
      const selected = Math.round(angle / (Math.PI * 2) * 12) % 12 || 12;
      setHour(selected);
    } else {
      setMinute(Math.round(angle / (Math.PI * 2) * 60) % 60);
    }
  };

  const handleDialPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dialDragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectFromDial(event);
  };

  const handleDialPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dialDragging.current) return;
    event.preventDefault();
    selectFromDial(event);
  };

  const handleDialPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dialDragging.current) return;
    event.preventDefault();
    selectFromDial(event);
    dialDragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (phase === 'hour') setPhase('minute');
  };

  const handleDialPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    dialDragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleDialKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1;
    if (phase === 'hour') {
      setHour(((hour12 - 1 + direction + 12) % 12) + 1);
    } else {
      setMinute((minute + direction + 60) % 60);
    }
  };

  const handleReadoutKey = (target: ClockPhase, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? 1 : -1;
    setKeyboardMode(false);
    setPhase(target);
    if (target === 'hour') {
      setHour24(current => (current + direction + 24) % 24);
    } else {
      setMinute(current => (current + direction + 60) % 60);
    }
  };

  const apply = () => {
    if (!date) return;
    onChange(`${date}T${pad(hour24)}:${pad(minute)}`);
    setOpen(false);
  };

  return (
    <>
      <div className="duty-time-picker-field block text-sm font-semibold text-gray-700">
        <span>{label}</span>
        <button
          type="button"
          onClick={openPicker}
          className="duty-time-picker-trigger mt-1 flex w-full items-center justify-between rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={`${label}: ${shown ? `${shown.date} at ${shown.time}` : 'not selected'}`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="duty-time-picker-trigger-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Clock3 className="h-5 w-5" /></span>
            <span className="min-w-0">
              <span className={`duty-time-picker-trigger-value block text-sm font-bold ${shown ? 'is-set text-gray-950' : 'is-empty text-gray-400'}`}>{shown?.time || 'Select time'}</span>
              <span className="duty-time-picker-trigger-detail block truncate text-xs font-normal text-gray-500">{shown?.date || hint || 'Tap to choose'}</span>
            </span>
          </span>
          <span className="duty-time-picker-trigger-change text-xs font-bold text-blue-700">Change</span>
        </button>
      </div>

      {open && (
        <div className="duty-time-picker-overlay fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="duty-time-picker-title" className="duty-time-picker-dialog max-h-[96vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#f7f8fb] shadow-2xl">
            <div className="flex items-center justify-between px-5 pb-2 pt-5 sm:px-7 sm:pt-6">
              <div>
                <p id="duty-time-picker-title" className="duty-time-picker-title text-lg font-bold text-slate-950">Select time</p>
                <p className="duty-time-picker-subtitle text-xs text-slate-500">{label}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="duty-time-picker-close rounded-full p-2 text-slate-500 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label="Close time picker"><X className="h-5 w-5" /></button>
            </div>

            <div className="px-5 pb-5 sm:px-7 sm:pb-7">
              <label className="duty-time-picker-date-row mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                <CalendarDays className="duty-time-picker-accent h-4 w-4 text-blue-700" />
                <span className="sr-only">Date</span>
                <input type="date" value={date} onChange={event => setDate(event.target.value)} className="duty-time-picker-date-input min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
              </label>

              <div className="flex items-stretch justify-center gap-2">
                <div className="duty-time-picker-readout flex min-w-0 flex-1 items-center justify-center gap-1 rounded-2xl bg-slate-900 p-2 sm:gap-2">
                  <button ref={hourButtonRef} type="button" onClick={() => { setPhase('hour'); setKeyboardMode(false); }} onKeyDown={event => handleReadoutKey('hour', event)} className={`duty-time-picker-readout-button min-w-0 flex-1 rounded-xl px-2 py-2 text-center text-4xl font-light tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:text-5xl ${phase === 'hour' && !keyboardMode ? 'is-selected bg-blue-700 text-white' : 'text-slate-100'}`} aria-label={`Hours, ${hour12} ${period}. Scroll or use arrow keys to adjust.`}>{pad(hour12)}</button>
                  <span className="pb-1 text-4xl font-light text-white">:</span>
                  <button ref={minuteButtonRef} type="button" onClick={() => { setPhase('minute'); setKeyboardMode(false); }} onKeyDown={event => handleReadoutKey('minute', event)} className={`duty-time-picker-readout-button min-w-0 flex-1 rounded-xl px-2 py-2 text-center text-4xl font-light tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:text-5xl ${phase === 'minute' && !keyboardMode ? 'is-selected bg-blue-700 text-white' : 'text-slate-100'}`} aria-label={`Minutes, ${minute}. Scroll or use arrow keys to adjust.`}>{pad(minute)}</button>
                </div>
                <div className="grid w-16 shrink-0 grid-rows-2 gap-1.5">
                  {(['AM', 'PM'] as const).map(item => <button key={item} type="button" onClick={() => setPeriod(item)} className={`duty-time-picker-period rounded-xl border-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${period === item ? 'is-selected' : ''}`} aria-pressed={period === item}>{item}</button>)}
                </div>
              </div>

              <p className="duty-time-picker-wheel-hint mt-2 text-center text-[11px] font-medium text-slate-500">Tap or drag the clock · Scroll hours or minutes</p>
              <span className="sr-only" aria-live="polite">Selected time {hour12}:{pad(minute)} {period}</span>

              {keyboardMode ? (
                <div className="duty-time-picker-typed mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                  <label className="duty-time-picker-typed-label text-xs font-bold uppercase tracking-wide text-slate-500">Type an exact time
                    <input
                      type="time"
                      value={`${pad(hour24)}:${pad(minute)}`}
                      onChange={event => {
                        const [nextHour, nextMinute] = event.target.value.split(':').map(Number);
                        if (Number.isFinite(nextHour)) setHour24(nextHour);
                        if (Number.isFinite(nextMinute)) setMinute(nextMinute);
                      }}
                      className="duty-time-picker-typed-input mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-2xl font-bold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      autoFocus
                    />
                  </label>
                </div>
              ) : (
                <div
                  className="duty-time-picker-dial relative mx-auto mt-5 aspect-square w-[min(76vw,320px)] touch-none select-none rounded-full bg-slate-900 shadow-inner outline-none ring-blue-500 focus:ring-4"
                  onPointerDown={handleDialPointerDown}
                  onPointerMove={handleDialPointerMove}
                  onPointerUp={handleDialPointerUp}
                  onPointerCancel={handleDialPointerCancel}
                  onLostPointerCapture={() => { dialDragging.current = false; }}
                  onKeyDown={handleDialKey}
                  role="slider"
                  tabIndex={0}
                  aria-label={phase === 'hour' ? 'Select hour. Tap or drag around the clock.' : 'Select minute. Tap or drag around the clock.'}
                  aria-valuemin={phase === 'hour' ? 1 : 0}
                  aria-valuemax={phase === 'hour' ? 12 : 59}
                  aria-valuenow={dialValue}
                  aria-valuetext={phase === 'hour' ? `${hour12} ${period}` : `${minute} minutes`}
                >
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-[32%] w-0.5 origin-bottom -translate-x-1/2 -translate-y-full bg-blue-500" style={{ transform: `translateX(-50%) translateY(-100%) rotate(${dialAngle}deg)`, transformOrigin: 'bottom center' }}>
                    <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-blue-500" />
                  </div>
                  <span className="pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500" />
                  {dialLabels.map(item => {
                    const angle = phase === 'hour' ? (item % 12) * 30 : item * 6;
                    const isSelected = phase === 'hour' ? item === hour12 : item === minute;
                    return (
                      <span
                        key={item}
                        className={`duty-time-picker-dial-label pointer-events-none absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-lg font-semibold ${isSelected ? 'is-selected bg-blue-600 text-white' : 'text-white'}`}
                        style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(calc(min(76vw, 320px) * -0.39)) rotate(${-angle}deg)` }}
                      >
                        {phase === 'minute' ? pad(item) : item}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <button type="button" onClick={() => setKeyboardMode(current => !current)} className={`duty-time-picker-mode inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${keyboardMode ? 'is-selected' : ''}`}><Keyboard className="h-5 w-5" />{keyboardMode ? 'Use clock' : 'Type time'}</button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="duty-time-picker-cancel rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>
                  <button type="button" onClick={apply} disabled={!date} className="duty-time-picker-confirm inline-flex items-center gap-1 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"><Check className="h-4 w-4" /> OK</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
