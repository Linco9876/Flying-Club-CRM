import React from 'react';
import { CalendarClock, Check, Clipboard, ExternalLink, Loader2, RefreshCw, Shield, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface CalendarFeedSettings {
  user_id: string;
  feed_key: string;
  enabled: boolean;
  include_pending: boolean;
  include_supervision: boolean;
  include_duty: boolean;
  last_accessed_at: string | null;
}

interface CalendarSubscriptionSettingsProps {
  userId: string;
  canEdit: boolean;
  hasStaffRole: boolean;
}

const ToggleRow = ({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  description: string;
  onChange: (checked: boolean) => void;
}) => (
  <label className={`flex items-start justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
    <span>
      <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
      <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
    </span>
    <input type="checkbox" className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </label>
);

export const CalendarSubscriptionSettings: React.FC<CalendarSubscriptionSettingsProps> = ({ userId, canEdit, hasStaffRole }) => {
  const [settings, setSettings] = React.useState<CalendarFeedSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const feedUrl = settings?.feed_key ? `${supabaseUrl}/functions/v1/calendar-feed?feed=${settings.feed_key}` : '';
  const webcalUrl = feedUrl.replace(/^https?:\/\//, 'webcal://');

  const loadSettings = React.useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('calendar_feed_settings')
        .select('user_id,feed_key,enabled,include_pending,include_supervision,include_duty,last_accessed_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setSettings(data as CalendarFeedSettings);
        return;
      }
      if (!canEdit) return;
      const { data: created, error: createError } = await supabase
        .from('calendar_feed_settings')
        .insert({ user_id: userId })
        .select('user_id,feed_key,enabled,include_pending,include_supervision,include_duty,last_accessed_at')
        .single();
      if (createError) throw createError;
      setSettings(created as CalendarFeedSettings);
    } catch (error: unknown) {
      console.error('Could not load calendar subscription:', error);
      toast.error(error instanceof Error ? error.message : 'Could not load calendar subscription');
    } finally {
      setLoading(false);
    }
  }, [canEdit, userId]);

  React.useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const savePatch = async (patch: Partial<CalendarFeedSettings>, successMessage?: string) => {
    if (!settings || !canEdit) return;
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setSaving(true);
    const { data, error } = await supabase
      .from('calendar_feed_settings')
      .update(patch)
      .eq('user_id', userId)
      .select('user_id,feed_key,enabled,include_pending,include_supervision,include_duty,last_accessed_at')
      .single();
    setSaving(false);
    if (error) {
      setSettings(previous);
      toast.error(error.message || 'Calendar setting could not be saved');
      return;
    }
    setSettings(data as CalendarFeedSettings);
    if (successMessage) toast.success(successMessage);
  };

  const copyFeed = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      toast.success('Private calendar link copied');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Copy failed. Select and copy the private link manually.');
    }
  };

  const openSubscriptionPage = (url: string) => {
    void copyFeed();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const rotateFeed = async () => {
    if (!settings || !window.confirm('Replace your private calendar link? Existing calendar subscriptions will stop updating until you add the new link.')) return;
    await savePatch({ feed_key: crypto.randomUUID() }, 'Private calendar link replaced');
  };

  if (loading) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" />Preparing your private calendar…</div>;
  }

  if (!settings) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">A private calendar subscription could not be created. Refresh this page or contact an administrator.</div>;
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><CalendarClock className="h-5 w-5" /></span>
          <div>
            <h4 className="font-semibold text-slate-950 dark:text-white">Your live BFC calendar</h4>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">Subscribe once to keep bookings, reschedules and cancellations in your usual calendar. Calendar apps refresh on their own schedule, so the portal remains the source of truth.</p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${settings.enabled ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
          <span className={`h-2 w-2 rounded-full ${settings.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />{settings.enabled ? 'Live' : 'Paused'}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <a href={webcalUrl} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"><Smartphone className="h-4 w-4" />Apple Calendar</a>
        <button type="button" onClick={() => openSubscriptionPage('https://calendar.google.com/calendar/u/0/r/settings/addbyurl')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700">Google Calendar<ExternalLink className="h-4 w-4" /></button>
        <button type="button" onClick={() => openSubscriptionPage('https://outlook.live.com/calendar/0/addcalendar')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700">Outlook<ExternalLink className="h-4 w-4" /></button>
      </div>
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">For Google or Outlook, the private URL is copied first. Paste it into the calendar page that opens under “From URL” or “Subscribe from web”.</p>

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Private subscription URL</label>
        <div className="flex gap-2">
          <input value={feedUrl} readOnly onFocus={event => event.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200" aria-label="Private calendar subscription URL" />
          <button type="button" onClick={() => void copyFeed()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Clipboard className="h-4 w-4" />}<span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span></button>
        </div>
      </div>

      <div className="grid gap-2">
        <ToggleRow checked={settings.enabled} disabled={!canEdit || saving} label="Keep calendar subscription active" description="Pause this to stop calendar apps receiving updates without replacing the private URL." onChange={checked => void savePatch({ enabled: checked }, checked ? 'Calendar subscription resumed' : 'Calendar subscription paused')} />
        <ToggleRow checked={settings.include_pending} disabled={!canEdit || saving} label="Include pending bookings" description="Shows bookings awaiting approval or senior-instructor supervision as tentative." onChange={checked => void savePatch({ include_pending: checked })} />
        {hasStaffRole && <ToggleRow checked={settings.include_supervision} disabled={!canEdit || saving} label="Include flights I supervise" description="Shows flights assigned to you as the supervising senior instructor." onChange={checked => void savePatch({ include_supervision: checked })} />}
        {hasStaffRole && <ToggleRow checked={settings.include_duty} disabled={!canEdit || saving} label="Include my duty periods" description="Adds your recorded or planned duty periods from the Duty tab." onChange={checked => void savePatch({ include_duty: checked })} />}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/35">
        <div className="flex items-start gap-2 text-xs leading-5 text-amber-900 dark:text-amber-200"><Shield className="mt-0.5 h-4 w-4 shrink-0" /><span>Treat this URL like a password. It gives read-only access to your calendar without signing in.</span></div>
        <button type="button" onClick={() => void rotateFeed()} disabled={!canEdit || saving} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950"><RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />Replace private link</button>
      </div>
      {settings.last_accessed_at && <p className="text-right text-xs text-slate-500 dark:text-slate-400">Last requested by a calendar app {new Date(settings.last_accessed_at).toLocaleString('en-AU')}</p>}
    </div>
  );
};
