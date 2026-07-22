import React from 'react';
import { CalendarDays, Download, ExternalLink, X } from 'lucide-react';
import { BrowserCalendarEvent, downloadBookingIcs, googleCalendarUrl, outlookCalendarUrl } from '../../utils/calendar';

interface AddToCalendarModalProps {
  event: BrowserCalendarEvent;
  onClose: () => void;
}

export const AddToCalendarModal: React.FC<AddToCalendarModalProps> = ({ event, onClose }) => {
  React.useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-calendar-title"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div>
              <h2 id="add-calendar-title" className="font-semibold text-slate-950 dark:text-white">Add to calendar</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Choose the calendar you use</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <button type="button" onClick={() => openExternal(googleCalendarUrl(event))} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left font-medium text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-blue-700 dark:hover:bg-blue-950/50">
            <span>Google Calendar</span><ExternalLink className="h-4 w-4 text-slate-400" />
          </button>
          <button type="button" onClick={() => openExternal(outlookCalendarUrl(event))} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left font-medium text-slate-800 transition hover:border-sky-300 hover:bg-sky-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-sky-700 dark:hover:bg-sky-950/50">
            <span>Outlook Calendar</span><ExternalLink className="h-4 w-4 text-slate-400" />
          </button>
          <button type="button" onClick={() => { downloadBookingIcs(event); onClose(); }} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">
            <span><span className="block">Apple Calendar or other app</span><span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">Downloads a standard .ics file</span></span><Download className="h-4 w-4 text-slate-400" />
          </button>
          <p className="px-1 pt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">This adds a copy of the current booking. For automatic updates, subscribe to your private BFC calendar in Account Settings.</p>
        </div>
      </div>
    </div>
  );
};
