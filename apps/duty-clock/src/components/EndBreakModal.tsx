import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ActiveBreak } from '../types';
import { type AppColours, useAppTheme } from '../theme';
import { formatDateTime } from '../utils/time';
import { isSameLocalDate, validateBreakFinishTime } from '../utils/breakFinishTime';
import { DutyTimePicker } from './DutyTimePicker';
import { PrimaryButton } from './PrimaryButton';

type Props = {
  visible: boolean;
  activeBreak: ActiveBreak | null;
  working: boolean;
  onClose: () => void;
  onEnd: (finishedAt: Date) => Promise<void>;
};

export const EndBreakModal = ({ visible, activeBreak, working, onClose, onEnd }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [finishedAt, setFinishedAt] = useState(new Date());

  useEffect(() => {
    if (visible) setFinishedAt(new Date());
  }, [visible]);

  if (!activeBreak) return null;

  const startedAt = new Date(activeBreak.startedAt);
  const submit = async () => {
    const validationMessage = validateBreakFinishTime({
      breakStartedAt: startedAt,
      breakFinishedAt: finishedAt,
    });
    if (validationMessage) {
      Alert.alert('Check break finish', validationMessage);
      return;
    }
    try {
      await onEnd(finishedAt);
      onClose();
    } catch (error) {
      Alert.alert('Break could not be ended', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const sameDay = isSameLocalDate(startedAt, finishedAt);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>End break</Text>
            <Text style={styles.subtitle}>Record when the break actually finished.</Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close end break" hitSlop={8} style={styles.closeButton}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>BREAK STARTED</Text>
            <Text style={styles.summaryValue}>{formatDateTime(startedAt)}</Text>
          </View>

          <View style={styles.instructions}>
            <Text style={styles.instructionsTitle}>When did your break finish?</Text>
            <Text style={styles.instructionsText}>It defaults to now. If you forgot to end the break, select the real finish time before saving.</Text>
          </View>

          <Text style={styles.sectionLabel}>ACTUAL FINISH TIME</Text>
          <DutyTimePicker
            value={finishedAt}
            minimumDate={sameDay ? new Date(startedAt.getTime() + 60_000) : undefined}
            maximumDate={new Date()}
            onChange={setFinishedAt}
          />
          <Text style={styles.selectedTime}>{formatDateTime(finishedAt)}</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => setFinishedAt(new Date())}
            style={({ pressed }) => [styles.nowButton, pressed && styles.pressed]}
          >
            <Text style={styles.nowButtonText}>Use current time</Text>
          </Pressable>

          <PrimaryButton tone="primary" loading={working} onPress={() => void submit()}>Save break finish</PrimaryButton>
          <Text style={styles.auditNote}>The selected time is saved as the break finish and retained in the duty audit history.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  header: { backgroundColor: colours.surface, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colours.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1 },
  title: { color: colours.navy, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colours.muted, fontSize: 13, marginTop: 2 },
  closeButton: { minWidth: 48, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  close: { color: colours.blue, fontSize: 15, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 44, gap: 14, backgroundColor: colours.background },
  summaryCard: { borderRadius: 18, backgroundColor: colours.amberLight, borderWidth: 1, borderColor: colours.amberBorder, padding: 18 },
  summaryLabel: { color: colours.amber, fontSize: 10, letterSpacing: 1.3, fontWeight: '900' },
  summaryValue: { color: colours.navy, fontSize: 19, fontWeight: '900', marginTop: 5 },
  instructions: { paddingVertical: 5 },
  instructionsTitle: { color: colours.navy, fontSize: 22, fontWeight: '900' },
  instructionsText: { color: colours.muted, fontSize: 13, lineHeight: 20, marginTop: 5 },
  sectionLabel: { color: colours.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: '900', marginTop: 4 },
  selectedTime: { color: colours.ink, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  nowButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colours.inputBorder, backgroundColor: colours.input, alignItems: 'center', justifyContent: 'center' },
  nowButtonText: { color: colours.blue, fontSize: 14, fontWeight: '900' },
  auditNote: { color: colours.muted, textAlign: 'center', fontSize: 11, lineHeight: 16, paddingHorizontal: 14 },
  pressed: { opacity: 0.85 },
});
