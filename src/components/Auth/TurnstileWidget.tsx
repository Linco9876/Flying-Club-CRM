import React from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export const TurnstileWidget: React.FC<{ onToken: (token: string) => void }> = ({ onToken }) => {
  const container = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId = '';
    const render = () => {
      if (!container.current || !window.turnstile || widgetId) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        action: 'membership_signup',
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-bfc-turnstile]');
    if (existing) {
      if (window.turnstile) render();
      else existing.addEventListener('load', render, { once: true });
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.bfcTurnstile = 'true';
      script.addEventListener('load', render, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken]);

  if (!siteKey) return null;
  return <div ref={container} className="min-h-[65px] w-full" aria-label="Automated abuse protection" />;
};
