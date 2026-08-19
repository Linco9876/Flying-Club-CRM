import { useCallback, useEffect, useState } from 'react';
import {
  browserPushSupport,
  currentPushSubscription,
  disablePwaPushNotifications,
  enablePwaPushNotifications,
  isStandalonePwa,
  sendPwaPushTest,
  type PushAppScope,
  type PwaPushState,
} from '../utils/pushNotifications';

export const usePwaPushNotifications = (appScope: PushAppScope = 'portal') => {
  const [state, setState] = useState<PwaPushState>('checking');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!browserPushSupport()) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    try {
      const subscription = await currentPushSubscription(appScope);
      setState(subscription && Notification.permission === 'granted' ? 'enabled' : 'prompt');
    } catch (refreshError) {
      console.error('Failed to inspect PWA push subscription', refreshError);
      setState('error');
      setError(refreshError instanceof Error ? refreshError.message : 'Phone notification status could not be checked.');
    }
  }, [appScope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setWorking(true);
    setError('');
    try {
      await enablePwaPushNotifications(appScope);
      setState('enabled');
    } catch (enableError) {
      setState(Notification.permission === 'denied' ? 'blocked' : 'error');
      setError(enableError instanceof Error ? enableError.message : 'Phone notifications could not be enabled.');
      throw enableError;
    } finally {
      setWorking(false);
    }
  };

  const disable = async () => {
    setWorking(true);
    setError('');
    try {
      await disablePwaPushNotifications(appScope);
      setState('prompt');
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : 'Phone notifications could not be disabled.');
      throw disableError;
    } finally {
      setWorking(false);
    }
  };

  const sendTest = async () => {
    setWorking(true);
    setError('');
    try {
      await sendPwaPushTest();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'The test notification could not be sent.');
      throw testError;
    } finally {
      setWorking(false);
    }
  };

  return { state, working, error, installed: isStandalonePwa(), enable, disable, sendTest, refresh };
};
