export const safeImageSource = (value?: string | null) => {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol === 'https:') return url.toString();
    if (url.protocol === 'blob:' && url.origin === window.location.origin) return url.toString();
  } catch {
    // Invalid and non-web image sources are not rendered.
  }
  return '';
};
