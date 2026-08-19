import { getAuthErrorMessage } from '../utils/authErrorMessage';

export const getSupabaseFunctionErrorMessage = async (error: any, fallback: string) => {
  const response = error?.context;
  if (response && typeof response.json === 'function') {
    try {
      const body = await (typeof response.clone === 'function' ? response.clone() : response).json();
      const message = getAuthErrorMessage(body, '');
      if (message) return message;
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
          const message = getAuthErrorMessage(body, '');
          if (message) return message;
        } catch {
          return getAuthErrorMessage(text, fallback);
        }
      }
    } catch {
      // Fall through to the generic message.
    }
  }

  return getAuthErrorMessage(error, fallback);
};
