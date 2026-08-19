import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { type AppColours, useAppTheme } from '../theme';

const APP_ROOT = '/duty-clock/app/';

type PushState = 'checking' | 'unsupported' | 'prompt' | 'enabled' | 'blocked' | 'error';

const supportsPush = () => Platform.OS === 'web'
  && typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window;

const isStandalone = () => Platform.OS === 'web' && typeof window !== 'undefined'
  && (window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

const currentNotificationPermission = () => Notification.permission;

const urlBase64ToUint8Array = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(`${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
};

const invokePush = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('push-notifications', { body });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  return data;
};

const dutyRegistration = async () => {
  const existing = await navigator.serviceWorker.getRegistration(APP_ROOT);
  return existing || navigator.serviceWorker.register(`${APP_ROOT}duty-clock-sw.js`, { scope: APP_ROOT });
};

const deviceLabel = () => {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform
    || 'Phone or computer';
  return `${platform}${isStandalone() ? ' Duty Clock PWA' : ' Duty Clock browser'}`.slice(0, 120);
};

const registerSubscription = async (subscription: PushSubscription) => {
  await invokePush({
    action: 'subscribe',
    appScope: 'duty_clock',
    subscription: subscription.toJSON(),
    deviceLabel: deviceLabel(),
    userAgent: navigator.userAgent,
  });
};

export const detachDutyClockPushSubscription = async () => {
  if (!supportsPush()) return;
  const registration = await navigator.serviceWorker.getRegistration(APP_ROOT);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await invokePush({ action: 'detach', endpoint: subscription.endpoint });
};

export const PhoneNotificationsCard = () => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [state, setState] = useState<PushState>('checking');
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (!supportsPush()) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    try {
      const registration = await dutyRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && Notification.permission === 'granted') {
        await registerSubscription(subscription);
        setState('enabled');
      } else {
        setState('prompt');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (Platform.OS !== 'web') return null;

  const enable = async () => {
    if (!supportsPush()) {
      Alert.alert('Notifications unavailable', 'This browser does not support installed-app notifications.');
      return;
    }
    if (!isStandalone()) {
      Alert.alert('Install Duty Clock first', 'Add Duty Clock to your Home Screen, open the installed app, then tap this bell again.');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      Alert.alert('Notifications are blocked', 'Allow notifications for Duty Clock in your phone settings, then reopen the app.');
      return;
    }

    setWorking(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications were not allowed in this device’s settings.');
      const registration = await dutyRegistration();
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
      await registerSubscription(subscription);
      setState('enabled');
      Alert.alert('Duty reminders on', 'You will be reminded 30 minutes before a required break and when it becomes due.');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Notifications could not be enabled.';
      setState(currentNotificationPermission() === 'denied' ? 'blocked' : 'error');
      Alert.alert('Could not enable notifications', message);
    } finally {
      setWorking(false);
    }
  };

  const disable = async () => {
    setWorking(true);
    try {
      const registration = await dutyRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await invokePush({ action: 'unsubscribe', endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState('prompt');
      Alert.alert('Duty reminders off', 'This device will no longer receive Duty Clock notifications.');
    } catch (caught) {
      Alert.alert('Could not turn notifications off', caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setWorking(false);
    }
  };

  const toggle = () => {
    if (working || state === 'checking') return;
    if (state === 'enabled') void disable();
    else void enable();
  };

  const enabled = state === 'enabled';
  const status = enabled ? 'Notifications on' : state === 'checking' ? 'Checking notifications' : 'Notifications off';

  return (
    <View style={styles.wrapper}>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled, disabled: working || state === 'checking' }}
        accessibilityLabel={`${status}. Tap to ${enabled ? 'turn off' : 'turn on'} Duty Clock reminders.`}
        disabled={working || state === 'checking'}
        onPress={toggle}
        style={({ pressed }) => [
          styles.button,
          enabled && styles.buttonEnabled,
          pressed && styles.pressed,
          (working || state === 'checking') && styles.disabled,
        ]}
      >
        <View style={styles.iconCircle}>
          <Text style={[styles.icon, enabled && styles.iconEnabled]}>{working || state === 'checking' ? '…' : enabled ? '🔔' : '🔕'}</Text>
        </View>
      </Pressable>
    </View>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  wrapper: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    zIndex: 20,
    shadowColor: '#0F2942',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 8,
  },
  button: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colours.border,
    backgroundColor: colours.surface,
  },
  buttonEnabled: { borderColor: colours.green, backgroundColor: colours.green },
  iconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  icon: { color: colours.muted, fontSize: 16, lineHeight: 21, fontWeight: '900' },
  iconEnabled: { color: '#fff' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.55 },
});
