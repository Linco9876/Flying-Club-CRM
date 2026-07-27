import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DutyContext, EndDutyBreakResponse } from '../types';
import { type AppColours, useAppTheme } from '../theme';
import { formatDateTime, formatDuration, hoursFromMinutes, minutesFromHours } from '../utils/time';
import { PrimaryButton } from './PrimaryButton';
import { DutyTimePicker } from './DutyTimePicker';
import { evaluateDutyBreakRequirement } from '../utils/breakRequirement';

type Props = {
  visible: boolean;
  context: DutyContext;
  working: boolean;
  onClose: () => void;
  onEnd: (actualEnd: Date, flightMinutes: number, notes: string, breakResponse?: EndDutyBreakResponse) => Promise<void>;
};

export const EndDutyModal = ({ visible, context, working, onClose, onEnd }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [actualEnd, setActualEnd] = useState(new Date());
  const [flightHours, setFlightHours] = useState('0');
  const [notes, setNotes] = useState('');
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [breakAnswer, setBreakAnswer] = useState<'yes' | 'no'>();
  const [breakStart, setBreakStart] = useState(new Date());
  const [breakEnd, setBreakEnd] = useState(new Date());
  const [breakTimesReviewed, setBreakTimesReviewed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const finish = new Date();
    const dutyStart = new Date(context.activeDuty?.actualStart || finish);
    const suggestedEnd = new Date(Math.min(finish.getTime(), dutyStart.getTime() + 5 * 60 * 60_000));
    const suggestedStart = new Date(Math.max(dutyStart.getTime(), suggestedEnd.getTime() - 30 * 60_000));
    setActualEnd(finish);
    setFlightHours(hoursFromMinutes(context.loggedFlightMinutes));
    setNotes('');
    setShowPicker(Platform.OS === 'ios');
    setBreakAnswer(undefined);
    setBreakStart(suggestedStart);
    setBreakEnd(suggestedEnd);
    setBreakTimesReviewed(false);
  }, [context.activeDuty?.actualStart, context.loggedFlightMinutes, visible]);

  const changeTime = (selected?: Date) => {
    if (Platform.OS !== 'ios') setShowPicker(false);
    if (!selected) return;
    const now = new Date();
    const adjusted = new Date(selected);
    if (adjusted.getTime() > now.getTime() + 5 * 60_000) adjusted.setDate(adjusted.getDate() - 1);
    setActualEnd(adjusted);
  };

  const submit = async () => {
    if (!context.activeDuty) return;
    const dutyStart = new Date(context.activeDuty.actualStart);
    if (actualEnd <= dutyStart) {
      Alert.alert('Check finish time', 'Duty must finish after it started.');
      return;
    }
    let breakResponse: EndDutyBreakResponse | undefined;
    if (breakRequirement.needsConfirmation) {
      if (!breakAnswer) {
        Alert.alert('Break confirmation needed', 'Tell us whether you had the required break before ending duty.');
        return;
      }
      if (breakAnswer === 'yes') {
        const minimumBreakMs = context.fatiguePolicy.minimumBreakMinutes * 60_000;
        if (breakStart < dutyStart || breakEnd > actualEnd || breakEnd.getTime() - breakStart.getTime() < minimumBreakMs) {
          Alert.alert(
            'Check break times',
            `The break must be within this duty period and at least ${context.fatiguePolicy.minimumBreakMinutes} minutes long.`,
          );
          return;
        }
        if (!breakTimesReviewed) {
          Alert.alert('Check break times', 'Confirm that the displayed break start and finish are the actual times.');
          return;
        }
        breakResponse = { taken: true, start: breakStart, end: breakEnd };
      } else {
        breakResponse = { taken: false };
      }
    }
    try {
      await onEnd(actualEnd, minutesFromHours(flightHours), notes.trim(), breakResponse);
      onClose();
    } catch (error) {
      Alert.alert('Duty could not end', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const dutyDuration = context.activeDuty ? actualEnd.getTime() - new Date(context.activeDuty.actualStart).getTime() : 0;
  const breakRequirement = context.activeDuty
    ? evaluateDutyBreakRequirement({
      dutyStart: context.activeDuty.actualStart,
      dutyEnd: actualEnd,
      breaks: context.recordedBreaks,
      activeBreakStart: context.activeBreak?.startedAt,
      policy: {
        enabled: context.fatiguePolicy.enabled,
        requiredAfterMinutes: context.fatiguePolicy.breakRequiredAfterMinutes,
        minimumBreakMinutes: context.fatiguePolicy.minimumBreakMinutes,
      },
    })
    : { required: false, satisfied: true, needsConfirmation: false, dutyMinutes: 0 };

  const chooseBreakAnswer = (answer: 'yes' | 'no') => {
    setBreakAnswer(answer);
    setBreakTimesReviewed(false);
  };

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
            <DutyTimePicker
              value={actualEnd}
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

          {breakRequirement.needsConfirmation ? (
            <View style={styles.requiredBreakCard}>
              <Text style={styles.requiredBreakEyebrow}>BREAK CHECK</Text>
              <Text style={styles.requiredBreakTitle}>Did you take a break?</Text>
              <Text style={styles.requiredBreakText}>
                This duty exceeded {context.fatiguePolicy.breakRequiredAfterMinutes / 60} hours and no break of at least {context.fatiguePolicy.minimumBreakMinutes} minutes is recorded.
              </Text>
              <View style={styles.answerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: breakAnswer === 'yes' }}
                  onPress={() => chooseBreakAnswer('yes')}
                  style={[styles.answerButton, breakAnswer === 'yes' && styles.answerButtonSelected]}
                >
                  <Text style={[styles.answerButtonText, breakAnswer === 'yes' && styles.answerButtonTextSelected]}>Yes, I had a break</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: breakAnswer === 'no' }}
                  onPress={() => chooseBreakAnswer('no')}
                  style={[styles.answerButton, breakAnswer === 'no' && styles.answerButtonSelected]}
                >
                  <Text style={[styles.answerButtonText, breakAnswer === 'no' && styles.answerButtonTextSelected]}>No break taken</Text>
                </Pressable>
              </View>
              {breakAnswer === 'yes' ? (
                <View style={styles.breakTimeFields}>
                  <View style={styles.breakTimeField}>
                    <Text style={styles.breakTimeLabel}>BREAK STARTED</Text>
                    <DutyTimePicker
                      value={breakStart}
                      minimumDate={context.activeDuty ? new Date(context.activeDuty.actualStart) : undefined}
                      maximumDate={actualEnd}
                      onChange={value => { setBreakStart(value); setBreakTimesReviewed(false); }}
                    />
                  </View>
                  <View style={styles.breakTimeField}>
                    <Text style={styles.breakTimeLabel}>BREAK FINISHED</Text>
                    <DutyTimePicker
                      value={breakEnd}
                      minimumDate={breakStart}
                      maximumDate={actualEnd}
                      onChange={value => { setBreakEnd(value); setBreakTimesReviewed(false); }}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: breakTimesReviewed }}
                    onPress={() => setBreakTimesReviewed(value => !value)}
                    style={styles.reviewRow}
                  >
                    <View style={[styles.checkbox, breakTimesReviewed && styles.checkboxChecked]}>
                      <Text style={styles.checkboxMark}>{breakTimesReviewed ? '✓' : ''}</Text>
                    </View>
                    <Text style={styles.reviewText}>I checked these are the actual break times</Text>
                  </Pressable>
                </View>
              ) : breakAnswer === 'no' ? (
                <Text style={styles.noBreakText}>The duty will be saved with no break recorded.</Text>
              ) : null}
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
  requiredBreakCard: { borderRadius: 18, backgroundColor: colours.amberLight, borderWidth: 1, borderColor: colours.amberBorder, padding: 16, gap: 9 },
  requiredBreakEyebrow: { color: colours.amber, fontSize: 10, letterSpacing: 1.3, fontWeight: '900' },
  requiredBreakTitle: { color: colours.navy, fontSize: 20, fontWeight: '900' },
  requiredBreakText: { color: colours.ink, fontSize: 13, lineHeight: 19 },
  answerRow: { flexDirection: 'row', gap: 8, marginTop: 3 },
  answerButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: colours.amberBorder, backgroundColor: colours.input, paddingHorizontal: 10 },
  answerButtonSelected: { backgroundColor: colours.amber, borderColor: colours.amber },
  answerButtonText: { color: colours.ink, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  answerButtonTextSelected: { color: '#FFFFFF' },
  breakTimeFields: { gap: 10, marginTop: 4 },
  breakTimeField: { gap: 5 },
  breakTimeLabel: { color: colours.muted, fontSize: 10, letterSpacing: 1.1, fontWeight: '900' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: colours.inputBorder, backgroundColor: colours.input, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colours.green, borderColor: colours.green },
  checkboxMark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  reviewText: { flex: 1, color: colours.ink, fontSize: 12, fontWeight: '700' },
  noBreakText: { color: colours.amber, fontSize: 12, fontWeight: '700' },
  notes: { minHeight: 88, borderWidth: 1, borderColor: colours.inputBorder, borderRadius: 14, padding: 13, fontSize: 15, color: colours.ink, backgroundColor: colours.input, textAlignVertical: 'top' },
});
