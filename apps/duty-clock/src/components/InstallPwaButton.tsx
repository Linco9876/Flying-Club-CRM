import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { type AppColours, useAppTheme } from '../theme';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
};

export const InstallPwaButton = () => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent>();
  const [installed, setInstalled] = useState(isStandalone);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setInstalled(true);
      setPromptEvent(undefined);
      setShowGuide(false);
    };
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', markInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', markInstalled);
    };
  }, []);

  if (Platform.OS !== 'web' || installed) return null;

  const install = async () => {
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setPromptEvent(undefined);
      return;
    }
    setShowGuide(value => !value);
  };

  return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" onPress={() => void install()} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.icon}>+</Text>
        <Text style={styles.label}>Add Duty Clock to Home Screen</Text>
      </Pressable>
      {showGuide ? (
        <View style={styles.guide}>
          <Text style={styles.guideTitle}>Install from your browser</Text>
          <Text style={styles.guideText}>iPhone/iPad: open this page in Safari, tap Share, then Add to Home Screen.</Text>
          <Text style={styles.guideText}>Android: open the browser menu, then tap Install app or Add to Home screen.</Text>
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  container: { marginTop: 14 },
  button: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface },
  pressed: { opacity: 0.75 },
  icon: { color: colours.blue, fontSize: 14, fontWeight: '900' },
  label: { color: colours.blue, fontSize: 11, fontWeight: '800' },
  guide: { marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, padding: 13 },
  guideTitle: { color: colours.ink, fontSize: 12, fontWeight: '900' },
  guideText: { color: colours.muted, fontSize: 11, lineHeight: 17, marginTop: 5 },
});
