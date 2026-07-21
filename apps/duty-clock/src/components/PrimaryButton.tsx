import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { type AppColours, useAppTheme } from '../theme';

type Props = {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'success' | 'danger' | 'neutral';
};

export const PrimaryButton = ({ children, onPress, disabled, loading, tone = 'primary' }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  return <Pressable
    accessibilityRole="button"
    disabled={disabled || loading}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      styles[tone],
      (disabled || loading) && styles.disabled,
      pressed && !disabled && !loading && styles.pressed,
    ]}
  >
    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.label}>{children}</Text>}
  </Pressable>;
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  button: { minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colours.blue },
  success: { backgroundColor: colours.green },
  danger: { backgroundColor: colours.red },
  neutral: { backgroundColor: colours.navy },
  label: { color: '#fff', fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
});
