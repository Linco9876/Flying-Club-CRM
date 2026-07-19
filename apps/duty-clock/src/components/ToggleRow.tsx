import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colours } from '../theme';

type Props = {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

export const ToggleRow = ({ label, detail, value, onChange }: Props) => (
  <Pressable style={styles.row} onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
    <View style={styles.copy}>
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
    <View style={[styles.box, value && styles.boxChecked]}>
      {value ? <Text style={styles.tick}>✓</Text> : null}
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colours.border },
  copy: { flex: 1 },
  label: { color: colours.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  detail: { marginTop: 3, color: colours.muted, fontSize: 12, lineHeight: 17 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#AAB5BF', alignItems: 'center', justifyContent: 'center' },
  boxChecked: { backgroundColor: colours.green, borderColor: colours.green },
  tick: { color: '#fff', fontSize: 17, fontWeight: '900' },
});
