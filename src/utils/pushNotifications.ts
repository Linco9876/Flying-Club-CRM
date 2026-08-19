import { supabase } from '../lib/supabase';

export type PwaPushState = 'checking' | 'unsupported' | 'prompt' | 'enabled' | 'blocked' | 'error';
export type PushAppScope = 'portal' | 'duty_clock';

export const urlBase64ToUint8Array = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
};

export const browserPushSupport = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
};

export const isStandalonePwa = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
};

const invokePush = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('push-notifications', { body });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
};

const registrationForScope = async (appScope: PushAppScope) => {
  if (!browserPushSupport()) throw new Error('Push notifications are not supported on this device.');
  const registration = appScope === 'duty_clock'
    ? await navigator.serviceWorker.getRegistration('/duty-clock/app/')
    : await navigator.serviceWorker.getRegistration('/');
  if (registration) return registration;
  if (appScope === 'duty_clock') {
    return navigator.serviceWorker.register('/duty-clock/app/duty-clock-sw.js', { scope: '/duty-clock/app/' });
  }
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
};

const deviceLabel = () => {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform
    || 'Phone or computer';
  return `${platform}${isStandalonePwa() ? ' PWA' : ' browser'}`.slice(0, 120);
};

export const currentPushSubscription = async (appScope: PushAppScope = 'portal') => {
  if (!browserPushSupport()) return null;
  const registration = await registrationForScope(appScope);
  return registration.pushManager.getSubscription();
};

export const enablePwaPushNotifications = async (appScope: PushAppScope = 'portal') => {
  if (!browserPushSupport()) throw new Error('Push notifications are not supported on this device.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Phone notifications are blocked in this device’s settings.'
      : 'Notification permission was not granted.');
  }
  const registration = await registrationForScope(appScope);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const keyResponse = await invokePush({ action: 'public-key' });
    const publicKey = String(keyResponse?.publicKey || '');
    if (!publicKey) throw new Error('The phone notification key is not configured.');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  await invokePush({
    action: 'subscribe',
    subscription: subscription.toJSON(),
    appScope,
    deviceLabel: deviceLabel(),
    userAgent: navigator.userAgent,
  });
  return subscription;
};

export const disablePwaPushNotifications = async (appScope: PushAppScope = 'portal') => {
  const subscription = await currentPushSubscription(appScope);
  if (!subscription) return;
  await invokePush({ action: 'unsubscribe', endpoint: subscription.endpoint });
  await subscription.unsubscribe();
};

export const syncExistingPwaPushSubscription = async (appScope: PushAppScope = 'portal') => {
  if (!browserPushSupport() || Notification.permission !== 'granted') return false;
  const subscription = await currentPushSubscription(appScope);
  if (!subscription) return false;
  await invokePush({
    action: 'subscribe',
    subscription: subscription.toJSON(),
    appScope,
    deviceLabel: deviceLabel(),
    userAgent: navigator.userAgent,
  });
  return true;
};

export const detachPwaPushSubscription = async (appScope: PushAppScope = 'portal') => {
  const subscription = await currentPushSubscription(appScope);
  if (!subscription) return;
  await invokePush({ action: 'detach', endpoint: subscription.endpoint });
};

export const sendPwaPushTest = async () => invokePush({ action: 'test' });
