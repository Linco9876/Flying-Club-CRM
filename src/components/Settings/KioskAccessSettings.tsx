import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, Loader, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getSupabaseFunctionErrorMessage } from '../../lib/supabaseFunctionErrors';

interface KioskAccessSettingsProps {
  canEdit: boolean;
}

interface KioskAccessState {
  configured: boolean;
  token?: string;
  tokenUnavailable?: boolean;
  prefix?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
}

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not used yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not used yet'
    : parsed.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
};

export const KioskAccessSettings: React.FC<KioskAccessSettingsProps> = ({ canEdit }) => {
  const [access, setAccess] = useState<KioskAccessState>({ configured: false });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'rotate' | 'disable' | null>(null);
  const [revealed, setRevealed] = useState(false);

  const invoke = useCallback(async (action: 'get-settings' | 'rotate' | 'disable') => {
    const { data, error } = await supabase.functions.invoke('kiosk-access', {
      body: { action },
    });
    if (error) {
      throw new Error(await getSupabaseFunctionErrorMessage(error, 'Kiosk access settings could not be loaded'));
    }
    if (data?.error) throw new Error(String(data.error));
    return data as KioskAccessState;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccess(await invoke('get-settings'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kiosk access settings could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => {
    void load();
  }, [load]);

  const rotate = async () => {
    if (access.configured && !window.confirm(
      'Create a new kiosk key? Any kiosk using the current key will be signed out and must enter the new key.',
    )) return;

    setWorking('rotate');
    try {
      const next = await invoke('rotate');
      setAccess(next);
      setRevealed(true);
      toast.success(access.configured ? 'Kiosk key rotated' : 'Kiosk key created');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The kiosk key could not be created');
    } finally {
      setWorking(null);
    }
  };

  const disable = async () => {
    if (!window.confirm(
      'Disable kiosk access? All active kiosk sessions will be signed out.',
    )) return;

    setWorking('disable');
    try {
      setAccess(await invoke('disable'));
      setRevealed(false);
      toast.success('Kiosk access disabled');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kiosk access could not be disabled');
    } finally {
      setWorking(null);
    }
  };

  const copyToken = async () => {
    if (!access.token) return;
    try {
      await navigator.clipboard.writeText(access.token);
      toast.success('Kiosk key copied');
    } catch {
      toast.error('Copy failed. Reveal the key and copy it manually.');
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-[#30343c] dark:bg-[#171a21]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
            <KeyRound className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            Kiosk access
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
            Use this key at <span className="font-medium">/kiosk</span>. It replaces the kiosk email and password
            while keeping the kiosk&apos;s existing calendar permissions.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <ShieldCheck className="h-4 w-4" />
          MFA-protected setting
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader className="h-4 w-4 animate-spin" />
          Loading kiosk access…
        </div>
      ) : access.configured && access.token ? (
        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="kiosk-access-key" className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
              Kiosk key
            </label>
            <div className="mt-1.5 flex min-w-0 gap-2">
              <input
                id="kiosk-access-key"
                type="text"
                readOnly
                value={revealed ? access.token : `••••••••••••••••${access.token.slice(-8)}`}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 font-mono text-sm text-gray-900 dark:border-[#3a3f49] dark:bg-[#11141a] dark:text-gray-100"
                aria-label={revealed ? 'Kiosk access key' : 'Masked kiosk access key'}
              />
              <button
                type="button"
                onClick={() => setRevealed((current) => !current)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-[#3a3f49] dark:bg-[#20242c] dark:text-gray-200 dark:hover:bg-[#292e38]"
                aria-label={revealed ? 'Hide kiosk key' : 'Reveal kiosk key'}
                title={revealed ? 'Hide kiosk key' : 'Reveal kiosk key'}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => void copyToken()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-[#3a3f49] dark:bg-[#20242c] dark:text-gray-200 dark:hover:bg-[#292e38]"
              >
                <Copy className="h-4 w-4" />
                <span className="hidden sm:inline">Copy</span>
              </button>
            </div>
          </div>

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#11141a]">
              <span className="block text-xs text-gray-500 dark:text-gray-400">Created</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{formatDateTime(access.createdAt)}</span>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-[#11141a]">
              <span className="block text-xs text-gray-500 dark:text-gray-400">Last used</span>
              <span className="font-medium text-gray-800 dark:text-gray-200">{formatDateTime(access.lastUsedAt)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void rotate()}
              disabled={!canEdit || working !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working === 'rotate' ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Rotate key
            </button>
            <button
              type="button"
              onClick={() => void disable()}
              disabled={!canEdit || working !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/70 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {working === 'disable' ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Disable
            </button>
          </div>
        </div>
      ) : access.configured && access.tokenUnavailable ? (
        <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
          <p className="font-semibold text-amber-950 dark:text-amber-100">The existing kiosk key cannot be revealed</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            Its encryption key changed after it was created. Existing kiosk sessions will continue working until you rotate or disable the key.
          </p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-black/20">
              <span className="block text-xs text-amber-800 dark:text-amber-300">Created</span>
              <span className="font-medium text-amber-950 dark:text-amber-100">{formatDateTime(access.createdAt)}</span>
            </div>
            <div className="rounded-lg bg-white/70 px-3 py-2 dark:bg-black/20">
              <span className="block text-xs text-amber-800 dark:text-amber-300">Last used</span>
              <span className="font-medium text-amber-950 dark:text-amber-100">{formatDateTime(access.lastUsedAt)}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void rotate()}
              disabled={!canEdit || working !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working === 'rotate' ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Create replacement key
            </button>
            <button
              type="button"
              onClick={() => void disable()}
              disabled={!canEdit || working !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/70 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-950/30"
            >
              {working === 'disable' ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Disable
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-[#3a3f49] dark:bg-[#11141a]">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            No kiosk key exists. Create one, copy it to the kiosk device, then enter it at the kiosk screen.
          </p>
          <button
            type="button"
            onClick={() => void rotate()}
            disabled={!canEdit || working !== null}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working === 'rotate' ? <Loader className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Create kiosk key
          </button>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        Treat this key like a password. Rotating or disabling it immediately revokes existing kiosk browser grants.
        Active kiosks remain signed in while used and must re-enter the key after 30 days of inactivity.
      </p>
    </section>
  );
};
