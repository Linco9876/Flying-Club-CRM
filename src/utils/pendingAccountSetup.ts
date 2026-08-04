const existingAccountErrorCodes = new Set([
  'email_exists',
  'identity_already_exists',
  'user_already_exists',
]);

export const isExistingAccountSignupError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code || '').trim().toLowerCase();
  if (existingAccountErrorCodes.has(code)) return true;

  const message = String(candidate.message || '').toLowerCase();
  return /(?:user|email|account).*(?:already registered|already exists)|already registered/.test(message);
};

export const requestPendingAccountSetup = async ({
  email,
  redirectTo,
  supabaseUrl,
  supabaseKey,
}: {
  email: string;
  redirectTo: string;
  supabaseUrl: string;
  supabaseKey: string;
}) => {
  const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/invite-user`;
  const request = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      action: 'request_pending_account_setup',
      email: email.trim().toLowerCase(),
      redirectTo,
    }),
  } satisfies RequestInit;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, request);
      if (response.ok) return;
    } catch {
      // A retry is safe because the server reserves each account before sending.
    }
  }

  throw new Error('The account setup request could not be submitted');
};
