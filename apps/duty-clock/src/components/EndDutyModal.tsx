import { useEffect, useMemo, useState } from 'react';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DutyContext } from '../types';
import { type AppColours, useAppTheme } from '../theme';
import { formatDateTime, formatDuration, hoursFromMinutes, minutesFromHours } from '../utils/time';
import { PrimaryButton } from './PrimaryButton';

type Props = {
  visible: boolean;
  context: DutyContext;
  working: boolean;
  onClose: () => void;
  onEnd: (actualEnd: Date, flightMinutes: number, notes: string) => Promise<void>;
};

export const EndDutyModal = ({ visible, context, working, onClose, onEnd }: Props) => {
  const { colours, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [actualEnd, setActualEnd] = useState(new Date());
  const [flightHours, setFlightHours] = useState('0');
  const [notes, setNotes] = useState('');
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');

  useEffect(() => {
    if (!visible) return;
    setActualEnd(new Date());
    setFlightHours(hoursFromMinutes(context.loggedFlightMinutes));
    setNotes('');
    setShowPicker(Platform.OS === 'ios');
  }, [context.loggedFlightMinutes, visible]);

  const changeTime = (_event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (!selected) return;
    const now = new Date();
    const adjusted = new Date(selected);
    if (adjusted.getTime() > now.getTime() + 5 * 60_000) adjusted.setDate(adjusted.getDate() - 1);
    setActualEnd(adjusted);
  };

  const submit = async () => {
    if (!context.activeDuty) return;
    if (actualEnd <= new Date(context.activeDuty.actualStart)) {
      Alert.alert('Check finish time', 'Duty must finish after it started.');
      return;
    }
    try {
      await onEnd(actualEnd, minutesFromHours(flightHours), notes.trim());
      onClose();
    } catch (error) {
      Alert.alert('Duty could not end', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const dutyDuration = context.activeDuty ? actualEnd.getTime() - new Date(context.activeDuty.actualStart).getTime() : 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View><Text style={styles.title}>End duty</Text><Text style={styles.subtitle}>Review the final times before saving.</Text></View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}><Text style={styles.close}>Close</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>DUTY TOTAL</Text>
            <Text style={styles.summaryValue}>{formatDuration(dutyDuration)}</Text>
            {context.activeDuty ? <Text style={styles.summaryDetail}>Started {formatDateTime(context.activeDuty.actualStart)} · {context.activeDuty.location}</Text> : null}
          </View>

          <Text style={styles.sectionLabel}>FINISH TIME</Text>
          <Pressable style={styles.card} onPress={() => setShowPicker(true)}>
            <Text style={styles.timeValue}>{formatDateTime(actualEnd)}</Text>
            <Text style={styles.hint}>Tap to correct the finish time</Text>
          </Pressable>
          {showPicker ? (
            <DateTimePicker
              value={actualEnd}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'clock'}
              themeVariant={isDark ? 'dark' : 'light'}
              minimumDate={context.activeDuty ? new Date(context.activeDuty.actualStart) : undefined}
              maximumDate={new Date(Date.now() + 5 * 60_000)}
              onChange={changeTime}
            />
          ) : null}

          <Text style={styles.sectionLabel}>FLYING TIME</Text>
          <View style={styles.flightCard}>
            <Text style={styles.flightStatus}>✓ Prefilled from {context.loggedFlightCount} logged {context.loggedFlightCount === 1 ? 'flight' : 'flights'}</Text>
            <View style={styles.flightInputRow}>
              <TextInput
                value={flightHours}
                onChangeText={setFlightHours}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={styles.flightInput}
                placeholderTextColor={colours.placeholder}
              />
              <Text style={styles.hours}>hours</Text>
            </View>
            <Text style={styles.hint}>You can edit this if today’s flight logs are incomplete.</Text>
          </View>

          {context.activeBreak ? (
            <View style={styles.breakNotice}>
              <Text style={styles.breakNoticeTitle}>Break is still running</Text>
              <Text style={styles.breakNoticeText}>It will be ended automatically at the duty finish time.</Text>
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>NOTES (OPTIONAL)</Text>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Anything operations should know?" placeholderTextColor={colours.placeholder} style={styles.notes} />

          <PrimaryButton tone="danger" loading={working} onPress={() => void submit()}>End duty</PrimaryButton>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  flex: { flex: 1, backgroundColor: colours.background },
  header: { backgroundColor: colours.surface, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colours.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colours.navy, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colours.muted, fontSize: 13, marginTop: 2 },
  close: { color: colours.blue, fontSize: 15, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 44, gap: 12, backgroundColor: colours.background },
  sectionLabel: { color: colours.muted, fontSize: 11, letterSpacing: 1.5, fontWeight: '900', marginTop: 8 },
  summaryCard: { borderRadius: 20, backgroundColor: '#0F2942', padding: 20 },
  summaryLabel: { color: colours.sky, fontSize: 11, letterSpacing: 1.5, fontWeight: '900' },
  summaryValue: { color: '#fff', fontSize: 36, fontWeight: '900', marginTop: 4 },
  summaryDetail: { color: '#C8D9E6', fontSize: 12, marginTop: 5 },
  card: { backgroundColor: colours.surface, borderRadius: 18, borderWidth: 1, borderColor: colours.border, padding: 18 },
  timeValue: { color: colours.navy, fontSize: 20, fontWeight: '900' },
  hint: { color: colours.muted, fontSize: 12, marginTop: 5 },
  flightCard: { borderRadius: 18, borderWidth: 1, borderColor: colours.greenBorder, backgroundColor: colours.greenLight, padding: 16 },
  flightStatus: { color: colours.green, fontSize: 13, fontWeight: '800' },
  flightInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  flightInput: { minWidth: 120, backgroundColor: colours.input, borderWidth: 1, borderColor: colours.greenBorder, borderRadius: 13, color: colours.ink, fontSize: 25, fontWeight: '900', paddingHorizontal: 14, paddingVertical: 10 },
  hours: { color: colours.ink, fontSize: 15, fontWeight: '700', marginLeft: 10 },
  breakNotice: { borderRadius: 16, backgroundColor: colours.amberLight, borderWidth: 1, borderColor: colours.amberBorder, padding: 14 },
  breakNoticeTitle: { color: colours.amber, fontSize: 14, fontWeight: '900' },
  breakNoticeText: { color: colours.ink, fontSize: 12, marginTop: 3 },
  notes: { minHeight: 88, borderWidth: 1, borderColor: colours.inputBorder, borderRadius: 14, padding: 13, fontSize: 15, color: colours.ink, backgroundColor: colours.input, textAlignVertical: 'top' },
});
