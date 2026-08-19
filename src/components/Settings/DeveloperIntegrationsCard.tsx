import React from 'react';
import { Check, Clipboard, Code2, KeyRound, Loader2, Radio, Webhook } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { SettingsLoadError } from './SettingsLoadError';

const API_SCOPES = [
  ['availability:read', 'Availability'],
  ['aircraft:read', 'Aircraft'],
  ['bookings:read', 'Bookings'],
] as const;
const WEBHOOK_EVENTS = ['bookings.insert', 'bookings.update', 'club_memberships.insert', 'club_memberships.update', 'membership_financial_periods.update'];

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  expires_at?: string | null;
  last_used_at?: string | null;
  created_at: string;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  subscribed_events: string[];
  is_active: boolean;
  last_success_at?: string | null;
  last_failure_at?: string | null;
}

export const DeveloperIntegrationsCard: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [webhooks, setWebhooks] = React.useState<WebhookRow[]>([]);
  const [keyName, setKeyName] = React.useState('');
  const [scopes, setScopes] = React.useState<string[]>(['availability:read']);
  const [webhookName, setWebhookName] = React.useState('');
  const [webhookUrl, setWebhookUrl] = React.useState('');
  const [events, setEvents] = React.useState<string[]>(['bookings.insert', 'bookings.update']);
  const [busy, setBusy] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = React.useState<{ title: string; value: string }>();

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [keyResult, webhookResult] = await Promise.all([
        supabase.from('integration_api_keys').select('id, name, key_prefix, scopes, is_active, expires_at, last_used_at, created_at').order('created_at', { ascending: false }),
        supabase.from('integration_webhook_endpoints').select('id, name, url, subscribed_events, is_active, last_success_at, last_failure_at').order('created_at', { ascending: false }),
      ]);
      if (keyResult.error || webhookResult.error) {
        throw keyResult.error || webhookResult.error || new Error('Could not load developer integrations');
      }
      setKeys((keyResult.data || []) as ApiKeyRow[]);
      setWebhooks((webhookResult.data || []) as WebhookRow[]);
      setLoadError(null);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not load developer integrations';
      setKeys([]);
      setWebhooks([]);
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const createKey = async () => {
    if (keyName.trim().length < 3 || !scopes.length) return toast.error('Enter a key name and choose at least one scope');
    setBusy('key');
    const { data, error } = await supabase.rpc('create_integration_api_key', {
      p_name: keyName.trim(),
      p_scopes: scopes,
      p_expires_at: null,
    });
    setBusy('');
    if (error) return toast.error(error.message);
    const result = data as { token: string };
    setOneTimeSecret({ title: 'API key', value: result.token });
    setKeyName('');
    await load();
  };

  const createWebhook = async () => {
    if (webhookName.trim().length < 3 || !webhookUrl.trim() || !events.length) return toast.error('Enter a webhook name, HTTPS URL and events');
    setBusy('webhook');
    const { data, error } = await supabase.rpc('create_integration_webhook', {
      p_name: webhookName.trim(),
      p_url: webhookUrl.trim(),
      p_events: events,
    });
    setBusy('');
    if (error) return toast.error(error.message);
    const result = data as { signingSecret: string };
    setOneTimeSecret({ title: 'Webhook signing secret', value: result.signingSecret });
    setWebhookName('');
    setWebhookUrl('');
    await load();
  };

  const toggle = (value: string, values: string[], update: React.Dispatch<React.SetStateAction<string[]>>) =>
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  if (loading) {
    return <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading developer integrations...</section>;
  }
  if (loadError) {
    return <SettingsLoadError section="Developer integrations" error={loadError} onRetry={load} />;
  }

  return (
    <section className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-violet-100 p-2 text-violet-700"><Code2 className="h-5 w-5" /></div>
        <div><h3 className="font-semibold text-gray-950">Developer API and webhooks</h3><p className="mt-1 text-sm text-gray-600">Versioned, scoped access for future integrations. Secrets are shown once and stored hashed or service-only.</p></div>
      </div>

      {oneTimeSecret && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-950">Copy this {oneTimeSecret.title} now</p>
          <p className="mt-1 text-xs text-amber-800">For security it will not be displayed again.</p>
          <div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-3 text-xs text-gray-900">{oneTimeSecret.value}</code><button type="button" onClick={() => { void navigator.clipboard.writeText(oneTimeSecret.value); toast.success('Copied'); }} className="rounded-lg border border-amber-300 bg-white p-3" aria-label={`Copy ${oneTimeSecret.title}`}><Clipboard className="h-4 w-4" /></button></div>
          <button type="button" onClick={() => setOneTimeSecret(undefined)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-amber-900"><Check className="h-3.5 w-3.5" /> I saved it</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-gray-900"><KeyRound className="h-4 w-4" /> API keys</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500">Base URL: your Supabase project functions URL ending in <code>/integration-api/v1</code>. Limit: 60 requests per key per minute.</p>
          <div className="mt-3 space-y-2">
            <input value={keyName} onChange={(event) => setKeyName(event.target.value)} disabled={!canEdit} placeholder="Integration name" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div className="flex flex-wrap gap-2">{API_SCOPES.map(([value, label]) => <label key={value} className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-xs"><input type="checkbox" checked={scopes.includes(value)} onChange={() => toggle(value, scopes, setScopes)} disabled={!canEdit} />{label}</label>)}</div>
            <button type="button" onClick={() => void createKey()} disabled={!canEdit || busy === 'key'} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'key' && <Loader2 className="h-4 w-4 animate-spin" />} Create key</button>
          </div>
          <div className="mt-4 space-y-2">{keys.map((key) => <div key={key.id} className="rounded-lg border border-gray-200 p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-gray-900">{key.name}</span><span className={key.is_active ? 'text-green-700' : 'text-gray-500'}>{key.is_active ? 'Active' : 'Revoked'}</span></div><p className="mt-1 font-mono text-gray-500">{key.key_prefix}… · {key.scopes.join(', ')}</p>{key.is_active && canEdit && <button type="button" onClick={async () => { const { error } = await supabase.rpc('revoke_integration_api_key', { p_key_id: key.id }); if (error) toast.error(error.message); else await load(); }} className="mt-2 font-semibold text-red-700">Revoke</button>}</div>)}</div>
        </div>

        <div>
          <h4 className="flex items-center gap-2 font-semibold text-gray-900"><Webhook className="h-4 w-4" /> Signed webhooks</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500">Events carry an ID and HMAC-SHA256 signature, retry with backoff, and are safe to process idempotently.</p>
          <div className="mt-3 space-y-2">
            <input value={webhookName} onChange={(event) => setWebhookName(event.target.value)} disabled={!canEdit} placeholder="Endpoint name" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} disabled={!canEdit} placeholder="https://example.com/bfc-webhook" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div className="space-y-1">{WEBHOOK_EVENTS.map((value) => <label key={value} className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" checked={events.includes(value)} onChange={() => toggle(value, events, setEvents)} disabled={!canEdit} />{value}</label>)}</div>
            <button type="button" onClick={() => void createWebhook()} disabled={!canEdit || busy === 'webhook'} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === 'webhook' && <Loader2 className="h-4 w-4 animate-spin" />} Add webhook</button>
          </div>
          <div className="mt-4 space-y-2">{webhooks.map((webhook) => <div key={webhook.id} className="rounded-lg border border-gray-200 p-3 text-xs"><div className="flex items-center justify-between gap-2"><span className="font-semibold text-gray-900">{webhook.name}</span><span className="inline-flex items-center gap-1"><Radio className="h-3 w-3" />{webhook.is_active ? 'Active' : 'Paused'}</span></div><p className="mt-1 truncate text-gray-500">{webhook.url}</p>{canEdit && <button type="button" onClick={async () => { const { error } = await supabase.rpc('set_integration_webhook_active', { p_endpoint_id: webhook.id, p_active: !webhook.is_active }); if (error) toast.error(error.message); else await load(); }} className="mt-2 font-semibold text-violet-700">{webhook.is_active ? 'Pause' : 'Resume'}</button>}</div>)}</div>
        </div>
      </div>
    </section>
  );
};
