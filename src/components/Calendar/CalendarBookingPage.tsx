import React from 'react';
import { CalendarDays, Download, ExternalLink, Loader2, Plane, ShieldCheck } from 'lucide-react';
import { BrowserCalendarEvent, googleCalendarUrl, outlookCalendarUrl } from '../../utils/calendar';

interface CalendarBookingPayload {
  event: {
    uid: string;
    title: string;
    description: string;
    location: string;
    start: string;
    end: string;
    status: BrowserCalendarEvent['status'];
  };
  manageUrl: string;
  downloadUrl: string;
}

const formatDate = (date: Date) => new Intl.DateTimeFormat('en-AU', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney',
}).format(date);

const formatTime = (date: Date) => new Intl.DateTimeFormat('en-AU', {
  hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney',
}).format(date);

export const CalendarBookingPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('event') || '';
  const [payload, setPayload] = React.useState<CalendarBookingPayload | null>(null);
  const [error, setError] = React.useState('');
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!token) {
        setError('This calendar link is incomplete. Please use the button in your booking confirmation email.');
        return;
      }
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/calendar-feed?event=${encodeURIComponent(token)}&format=json`, {
          headers: { Accept: 'application/json' },
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body?.event) throw new Error(body?.error || 'This booking calendar link is no longer available.');
        if (!cancelled) setPayload(body as CalendarBookingPayload);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'This booking calendar link could not be loaded.');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [supabaseUrl, token]);

  const event: BrowserCalendarEvent | null = payload ? {
    ...payload.event,
    start: new Date(payload.event.start),
    end: new Date(payload.event.end),
  } : null;
  const isCancelled = event?.status === 'CANCELLED';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-slate-200 px-4 py-8 text-slate-950 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 dark:text-white sm:py-14">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="bg-gradient-to-br from-[#06152f] to-[#0d3b78] px-6 py-7 text-white sm:px-8">
          <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em] text-blue-200"><span className="rounded-xl bg-white/10 p-2"><Plane className="h-5 w-5" /></span>Bendigo Flying Club</div>
          <h1 className="mt-5 text-2xl font-bold sm:text-3xl">{isCancelled ? 'Booking cancelled' : 'Add booking to calendar'}</h1>
          <p className="mt-2 text-sm leading-6 text-blue-100">Use the calendar you already know. The BFC portal remains the source of truth.</p>
        </header>

        <section className="p-6 sm:p-8" aria-live="polite">
          {!payload && !error && <div className="flex min-h-48 items-center justify-center gap-3 text-slate-600 dark:text-slate-300"><Loader2 className="h-5 w-5 animate-spin text-blue-600" />Loading current booking…</div>}

          {error && (
            <div className="py-8 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><CalendarDays className="h-6 w-6" /></span>
              <h2 className="mt-5 text-xl font-semibold">Calendar link unavailable</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">{error}</p>
              <a href="/" className="mt-6 inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">Go to the BFC portal</a>
            </div>
          )}

          {event && payload && (
            <>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/60">
                <h2 className="text-lg font-semibold leading-7">{event.title}</h2>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</dt><dd className="mt-1 font-medium">{formatDate(event.start)}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Time</dt><dd className="mt-1 font-medium">{formatTime(event.start)} – {formatTime(event.end)}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Location</dt><dd className="mt-1 font-medium">{event.location}</dd></div>
                </dl>
              </div>

              {isCancelled ? (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium leading-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">This booking is cancelled. If it is already in your calendar, remove it or allow your live BFC subscription to update it.</div>
              ) : (
                <div className="mt-5 grid gap-3">
                  <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white hover:bg-blue-700">Google Calendar<ExternalLink className="h-4 w-4" /></a>
                  <a href={outlookCalendarUrl(event)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl bg-sky-700 px-5 py-3.5 font-semibold text-white hover:bg-sky-800">Outlook Calendar<ExternalLink className="h-4 w-4" /></a>
                  <a href={payload.downloadUrl} className="flex items-center justify-between rounded-xl border border-slate-300 bg-white px-5 py-3.5 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700"><span><span className="block">Apple Calendar or other app</span><span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">Download standard .ics file</span></span><Download className="h-4 w-4" /></a>
                </div>
              )}

              <a href={payload.manageUrl} className="mt-6 block text-center text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">View current booking in the BFC portal</a>
              <div className="mt-6 flex items-start gap-2 border-t border-slate-200 pt-5 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:text-slate-400"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>This private link shows only the calendar details for this booking. Do not forward it.</span></div>
            </>
          )}
        </section>
      </div>
    </main>
  );
};
