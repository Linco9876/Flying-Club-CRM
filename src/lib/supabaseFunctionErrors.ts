export const getSupabaseFunctionErrorMessage = async (error: any, fallback: string) => {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await (typeof response.clone === 'function' ? response.clone() : response).json();
      if (typeof body?.error === 'string') return body.error;
      if (typeof body?.message === 'string') return body.message;
    } catch {
      // Fall through to text/message parsing below.
    }
  }

  if (response && typeof response.text === 'function') {
    try {
      const text = await (typeof response.clone === 'function' ? response.clone() : response).text();
      if (text) {
        try {
          const body = JSON.parse(text);
          if (typeof body?.error === 'string') return body.error;
          if (typeof body?.message === 'string') return body.message;
        } catch {
          return text;
        }
      }
    } catch {
      // Fall through to the generic message.
    }
  }

  return error?.message || fallback;
};
