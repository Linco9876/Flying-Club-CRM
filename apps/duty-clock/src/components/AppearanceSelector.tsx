import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type AppColours, type ThemeMode, useAppTheme } from '../theme';

const options: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'auto', label: 'Auto' },
  { value: 'dark', label: 'Dark' },
];

export const AppearanceSelector = () => {
  const { colours, mode, setMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);

  return (
    <View style={styles.wrapper} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
      {options.map(option => {
        const selected = mode === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => setMode(option.value)}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  wrapper: { alignSelf: 'center', flexDirection: 'row', padding: 3, borderRadius: 999, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface },
  option: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  selected: { backgroundColor: colours.subtle },
  label: { color: colours.muted, fontSize: 10, fontWeight: '700' },
  selectedLabel: { color: colours.ink },
});
