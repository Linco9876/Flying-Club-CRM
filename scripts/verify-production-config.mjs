import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export const EXPECTED_PRODUCTION_SUPABASE_HOST = 'kcfjnpngnouyvcuvfleu.supabase.co';

const decodeLegacyKeyRole = (key) => {
  try {
    const payload = key.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
};

export const validateProductionConfig = (environment) => {
  const rawUrl = String(environment.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const publicKey = String(environment.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!rawUrl || !publicKey) {
    throw new Error('Production build blocked: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.');
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Production build blocked: VITE_SUPABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'https:' || url.hostname !== EXPECTED_PRODUCTION_SUPABASE_HOST) {
    throw new Error(
      `Production build blocked: Supabase host must be ${EXPECTED_PRODUCTION_SUPABASE_HOST}, received ${url.hostname || 'none'}.`
    );
  }

  if (publicKey.startsWith('sb_secret_')) {
    throw new Error('Production build blocked: VITE_SUPABASE_ANON_KEY must never contain a Supabase secret key.');
  }

  const isPublishableKey = publicKey.startsWith('sb_publishable_');
  const legacyRole = publicKey.split('.').length === 3 ? decodeLegacyKeyRole(publicKey) : null;
  if (!isPublishableKey && legacyRole !== 'anon') {
    throw new Error('Production build blocked: VITE_SUPABASE_ANON_KEY is not a public Supabase key.');
  }

  return { url: url.toString().replace(/\/$/, ''), publicKey };
};

export const verifyAuthHealth = async ({ url, publicKey }, fetchImpl = fetch) => {
  const response = await fetchImpl(`${url}/auth/v1/health`, {
    headers: {
      apikey: publicKey,
      Authorization: `Bearer ${publicKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Production deploy blocked: Supabase Auth health check returned HTTP ${response.status}.`);
  }
};

const run = async () => {
  const environment = loadEnv('production', process.cwd(), '');
  const config = validateProductionConfig(environment);

  if (!process.argv.includes('--offline')) {
    await verifyAuthHealth(config);
    console.log(`Production Auth verified at ${EXPECTED_PRODUCTION_SUPABASE_HOST}.`);
  }
};

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
