import { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DutyContext, StartDutyInput } from '../types';
import { type AppColours, useAppTheme } from '../theme';
import { formatDateTime } from '../utils/time';
import { readableDistance } from '../utils/geo';
import { useStartLocation } from '../hooks/useStartLocation';
import { PrimaryButton } from './PrimaryButton';
import { ToggleRow } from './ToggleRow';
import { DutyTimePicker } from './DutyTimePicker';

type Props = {
  visible: boolean;
  context: DutyContext;
  working: boolean;
  onClose: () => void;
  onStart: (input: StartDutyInput) => Promise<void>;
};

export const StartDutyModal = ({ visible, context, working, onClose, onStart }: Props) => {
  const { colours, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [actualStart, setActualStart] = useState(new Date());
  const [showPicker, setShowPicker] = useState(Platform.OS === 'ios');
  const [locationLabel, setLocationLabel] = useState('');
  const [geofenceNotes, setGeofenceNotes] = useState('');
  const [fitForDuty, setFitForDuty] = useState(true);
  const [externalDutyDeclared, setExternalDutyDeclared] = useState(false);
  const [sleepOpportunityConfirmed, setSleepOpportunityConfirmed] = useState(true);
  const [kssScore, setKssScore] = useState<number>();
  const [privateNote, setPrivateNote] = useState('');
  const [locationRequested, setLocationRequested] = useState(false);
  const { geo, locating, locate } = useStartLocation(context.locations);

  useEffect(() => {
    if (!visible) {
      setLocationRequested(false);
      return;
    }
    setActualStart(new Date());
    setShowPicker(Platform.OS === 'ios');
    setLocationLabel('');
    setGeofenceNotes('');
    setFitForDuty(true);
    setExternalDutyDeclared(false);
    setSleepOpportunityConfirmed(true);
    setKssScore(undefined);
    setPrivateNote('');
  }, [visible]);

  useEffect(() => {
    if (!visible || locationRequested || !context.locations.length) return;
    setLocationRequested(true);
    void locate();
  }, [context.locations.length, locate, locationRequested, visible]);

  useEffect(() => {
    if (visible && geo.label && geo.label !== 'Checking location…') setLocationLabel(geo.label);
  }, [geo.label, visible]);

  const changeTime = (selected?: Date) => {
    if (Platform.OS !== 'ios') setShowPicker(false);
    if (!selected) return;
    const now = new Date();
    const adjusted = new Date(selected);
    if (adjusted.getTime() > now.getTime() + 5 * 60_000) adjusted.setDate(adjusted.getDate() - 1);
    setActualStart(adjusted);
  };

  const submit = async () => {
    const outsideNeedsNote = !geo.insideGeofence && geofenceNotes.trim().length < 10;
    const fatigueNeedsNote = (!sleepOpportunityConfirmed || (kssScore || 0) >= 7) && privateNote.trim().length < 10;
    if (!fitForDuty) {
      Alert.alert('Cannot start duty', 'Contact operations or a senior instructor if you are not fit for duty.');
      return;
    }
    if (!externalDutyDeclared) {
      Alert.alert('Declaration required', 'Confirm that relevant external duty has been entered, or that there is none.');
      return;
    }
    if (!locationLabel.trim()) {
      Alert.alert('Enter a location', 'Confirm the location where you are starting duty.');
      return;
    }
    if (outsideNeedsNote) {
      Alert.alert('Add an off-site note', 'GPS is outside the club location or unavailable. Add at least 10 characters explaining where you are working.');
      return;
    }
    if (fatigueNeedsNote) {
      Alert.alert('Add a fatigue note', 'Briefly explain the reduced sleep opportunity or elevated sleepiness score.');
      return;
    }
    try {
      await onStart({
        actualStart,
        locationLabel: locationLabel.trim(),
        geo,
        geofenceNotes: geofenceNotes.trim(),
        fitForDuty,
        externalDutyDeclared,
        sleepOpportunityConfirmed,
        kssScore,
        privateNote: privateNote.trim(),
      });
      onClose();
    } catch (error) {
      Alert.alert('Duty could not start', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View><Text style={styles.title}>Start duty</Text><Text style={styles.subtitle}>Confirm the details below.</Text></View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}><Text style={styles.close}>Close</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>START TIME</Text>
          <Pressable style={styles.timeCard} onPress={() => setShowPicker(true)}>
            <Text style={styles.timeValue}>{formatDateTime(actualStart)}</Text>
            <Text style={styles.timeHint}>Tap to adjust · up to {context.maximumBackdateMinutes / 60} hours back</Text>
          </Pressable>
          {showPicker ? (
            <DutyTimePicker
              value={actualStart}
              isDark={isDark}
              minimumDate={new Date(Date.now() - context.maximumBackdateMinutes * 60_000)}
              maximumDate={new Date(Date.now() + 5 * 60_000)}
              onChange={changeTime}
            />
          ) : null}

          <Text style={styles.sectionLabel}>LOCATION</Text>
          <View style={[styles.locationCard, geo.insideGeofence ? styles.locationInside : styles.locationOutside]}>
            <View style={styles.locationHeading}>
              <Text style={styles.locationIcon}>{geo.insideGeofence ? '✓' : '!'}</Text>
              <View style={styles.flex}>
                <Text style={styles.locationStatus}>{locating ? 'Checking GPS…' : geo.insideGeofence ? `At ${geo.nearestLocation?.name || 'club location'}` : 'Outside club location'}</Text>
                {!locating && geo.nearestLocation && geo.distanceMetres !== undefined ? <Text style={styles.locationDetail}>{readableDistance(geo.distanceMetres)} from {geo.nearestLocation.name}</Text> : null}
                {!locating && geo.error ? <Text style={styles.locationDetail}>{geo.error}</Text> : null}
              </View>
              <Pressable onPress={() => void locate()} disabled={locating}><Text style={styles.retry}>Retry</Text></Pressable>
            </View>
            <Text style={styles.inputLabel}>Location name</Text>
            <TextInput value={locationLabel} onChangeText={setLocationLabel} style={styles.input} placeholder="Where are you working?" placeholderTextColor={colours.placeholder} />
            {!geo.insideGeofence ? (
              <>
                <Text style={styles.inputLabel}>Additional notes *</Text>
                <TextInput value={geofenceNotes} onChangeText={setGeofenceNotes} style={[styles.input, styles.textArea]} multiline placeholder="Why are you starting duty away from the club?" placeholderTextColor={colours.placeholder} />
              </>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>PRE-DUTY DECLARATION</Text>
          <View style={styles.card}>
            <ToggleRow label="I am fit for duty" value={fitForDuty} onChange={setFitForDuty} />
            <ToggleRow label="External duty is up to date" detail="I have entered any relevant external duty, or I have none." value={externalDutyDeclared} onChange={setExternalDutyDeclared} />
            <ToggleRow label="I had adequate sleep opportunity" value={sleepOpportunityConfirmed} onChange={setSleepOpportunityConfirmed} />
            <Text style={styles.kssLabel}>Sleepiness now (optional)</Text>
            <Text style={styles.kssHint}>1 = very alert · 9 = very sleepy</Text>
            <View style={styles.scoreRow}>
              {Array.from({ length: 9 }, (_, index) => index + 1).map(score => (
                <Pressable key={score} onPress={() => setKssScore(kssScore === score ? undefined : score)} style={[styles.score, kssScore === score && styles.scoreSelected]}>
                  <Text style={[styles.scoreText, kssScore === score && styles.scoreTextSelected]}>{score}</Text>
                </Pressable>
              ))}
            </View>
            {!sleepOpportunityConfirmed || (kssScore || 0) >= 7 ? (
              <>
                <Text style={styles.inputLabel}>Fatigue note *</Text>
                <TextInput value={privateNote} onChangeText={setPrivateNote} style={[styles.input, styles.textArea]} multiline placeholder="Add context and any mitigation." placeholderTextColor={colours.placeholder} />
              </>
            ) : null}
          </View>

          <PrimaryButton tone="success" loading={working} onPress={() => void submit()}>Start duty</PrimaryButton>
          <Text style={styles.privacy}>Location is captured only when you press Start duty. This app does not track background location.</Text>
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
  timeCard: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.border, borderRadius: 18, padding: 18 },
  timeValue: { color: colours.navy, fontSize: 20, fontWeight: '900' },
  timeHint: { color: colours.muted, fontSize: 12, marginTop: 4 },
  locationCard: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 9 },
  locationInside: { backgroundColor: colours.greenLight, borderColor: colours.greenBorder },
  locationOutside: { backgroundColor: colours.amberLight, borderColor: colours.amberBorder },
  locationHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  locationIcon: { width: 28, height: 28, textAlign: 'center', textAlignVertical: 'center', borderRadius: 14, overflow: 'hidden', backgroundColor: colours.surface, color: colours.navy, fontWeight: '900', lineHeight: 28 },
  locationStatus: { color: colours.ink, fontSize: 14, fontWeight: '900' },
  locationDetail: { color: colours.muted, fontSize: 11, marginTop: 2 },
  retry: { color: colours.blue, fontSize: 13, fontWeight: '900' },
  card: { backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.border, borderRadius: 18, paddingHorizontal: 16, paddingBottom: 16 },
  inputLabel: { color: colours.ink, fontSize: 12, fontWeight: '800', marginTop: 5 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colours.inputBorder, borderRadius: 13, paddingHorizontal: 13, fontSize: 15, color: colours.ink, backgroundColor: colours.input },
  textArea: { minHeight: 76, paddingTop: 12, textAlignVertical: 'top' },
  kssLabel: { color: colours.ink, fontSize: 14, fontWeight: '800', marginTop: 16 },
  kssHint: { color: colours.muted, fontSize: 11, marginTop: 2 },
  scoreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10, marginBottom: 8 },
  score: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colours.inputBorder, alignItems: 'center', justifyContent: 'center' },
  scoreSelected: { backgroundColor: colours.blue, borderColor: colours.blue },
  scoreText: { color: colours.ink, fontSize: 13, fontWeight: '800' },
  scoreTextSelected: { color: '#fff' },
  privacy: { color: colours.muted, textAlign: 'center', fontSize: 11, lineHeight: 16, paddingHorizontal: 16 },
});
