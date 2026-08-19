const unusableMessages = new Set([
  '',
  '{}',
  '[]',
  'null',
  'undefined',
  '[object object]',
]);

const usefulString = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const message = value.trim();
  const normalised = message.toLowerCase();
  const compact = normalised.replace(/\s+/g, '');
  return unusableMessages.has(normalised) || compact === '{}' || compact === '[]'
    ? null
    : message;
};

export const getAuthErrorMessage = (error: unknown, fallback: string) => {
  const direct = usefulString(error);
  if (direct) return direct;
  if (!error || typeof error !== 'object') return fallback;

  const candidate = error as {
    message?: unknown;
    error_description?: unknown;
    details?: unknown;
    error?: unknown;
  };
  const nested = candidate.error && typeof candidate.error === 'object'
    ? candidate.error as { message?: unknown; description?: unknown }
    : null;

  return usefulString(candidate.message)
    || usefulString(candidate.error_description)
    || usefulString(candidate.details)
    || usefulString(candidate.error)
    || usefulString(nested?.message)
    || usefulString(nested?.description)
    || fallback;
};
