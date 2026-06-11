const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.`);
    console.error('');
    console.error('Required: SUPABASE_URL and SUPABASE_ANON_KEY.');
    console.error('Optional: VOUCHER_TEST_CODE and TRIAL_VOUCHER_CRON_SECRET.');
    console.error('');
    console.error('Example:');
    console.error('SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_ANON_KEY=<anon-key> npm run smoke:vouchers');
    process.exit(1);
  }
  return value;
};

const optional = (name) => process.env[name]?.trim() || '';

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const anonKey = required('SUPABASE_ANON_KEY');
const cronSecret = optional('TRIAL_VOUCHER_CRON_SECRET');
const testVoucherCode = optional('VOUCHER_TEST_CODE');

const functionUrl = (name) => `${supabaseUrl}/functions/v1/${name}`;

const invoke = async (functionName, body, headers = {}) => {
  const response = await fetch(functionUrl(functionName), {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || payload?.error) {
    const message = payload?.error || payload?.raw || `HTTP ${response.status}`;
    throw new Error(`${functionName} ${body?.action || ''} failed: ${message}`);
  }

  return payload;
};

const checks = [];
const runCheck = async (label, fn) => {
  try {
    const detail = await fn();
    checks.push({ label, ok: true, detail });
  } catch (error) {
    checks.push({ label, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
};

await runCheck('Public voucher products endpoint responds', async () => {
  const payload = await invoke('trial-voucher-public', { action: 'products' });
  if (!Array.isArray(payload.products)) throw new Error('Response did not include a products array');
  return `${payload.products.length} product${payload.products.length === 1 ? '' : 's'} returned`;
});

if (testVoucherCode) {
  await runCheck('Voucher code verification responds', async () => {
    const payload = await invoke('trial-voucher-public', { action: 'verify', code: testVoucherCode });
    if (!payload.voucher?.code) throw new Error('Response did not include a voucher');
    return `voucher ${payload.voucher.code} is ${payload.voucher.status}`;
  });
} else {
  checks.push({
    label: 'Voucher code verification responds',
    ok: true,
    detail: 'skipped: set VOUCHER_TEST_CODE to verify a real issued voucher',
  });
}

if (cronSecret) {
  await runCheck('Due voucher email cron endpoint responds', async () => {
    const payload = await invoke(
      'send-trial-voucher-email',
      { action: 'send-due' },
      { 'x-cron-secret': cronSecret },
    );
    return `processed=${payload.processed ?? 0} sent=${payload.sent ?? 0} failed=${payload.failed ?? 0}`;
  });
} else {
  checks.push({
    label: 'Due voucher email cron endpoint responds',
    ok: true,
    detail: 'skipped: set TRIAL_VOUCHER_CRON_SECRET to test scheduled email delivery',
  });
}

for (const check of checks) {
  console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.label} - ${check.detail}`);
}

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error('');
  console.error(`Live voucher smoke test failed: ${failures.length} issue${failures.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}

console.log('');
console.log('Live voucher smoke test passed.');
