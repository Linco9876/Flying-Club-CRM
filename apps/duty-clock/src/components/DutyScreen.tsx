import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { User } from '@supabase/supabase-js';
import { type AppColours, useAppTheme } from '../theme';
import { formatClockTime, formatDateTime, formatDuration } from '../utils/time';
import { useDutyClock } from '../hooks/useDutyClock';
import { supabase } from '../lib/supabase';
import { PrimaryButton } from './PrimaryButton';
import { StartDutyModal } from './StartDutyModal';
import { EndDutyModal } from './EndDutyModal';
import { PRIVACY_URL, SUPPORT_URL } from '../config';
import { AppearanceSelector } from './AppearanceSelector';

type Props = { user: User };

export const DutyScreen = ({ user }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const { context, loading, working, error, refresh, startDuty, startBreak, endBreak, endDuty } = useDutyClock(user.id);
  const [now, setNow] = useState(Date.now());
  const [startVisible, setStartVisible] = useState(false);
  const [endVisible, setEndVisible] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const runBreakAction = async (action: 'start' | 'end') => {
    try {
      if (action === 'start') await startBreak();
      else await endBreak();
    } catch (caught) {
      Alert.alert('Break could not be updated', caught instanceof Error ? caught.message : 'Please try again.');
    }
  };

  const logout = () => {
    Alert.alert('Sign out?', 'Your active duty will continue running.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void supabase.auth.signOut() },
    ]);
  };

  if (loading) {
    return <SafeAreaView style={styles.loading}><ActivityIndicator size="large" color={colours.blue} /><Text style={styles.loadingText}>Loading duty status…</Text></SafeAreaView>;
  }

  if (!context.allowed) {
    return (
      <SafeAreaView style={styles.loading}>
        <View style={styles.deniedIcon}><Text style={styles.deniedIconText}>!</Text></View>
        <Text style={styles.deniedTitle}>Instructor access required</Text>
        <Text style={styles.deniedText}>Your account is signed in, but it is not assigned an instructor, senior instructor or administrator role.</Text>
        <View style={styles.deniedButton}><PrimaryButton tone="neutral" onPress={() => void supabase.auth.signOut()}>Sign out</PrimaryButton></View>
      </SafeAreaView>
    );
  }

  const dutyElapsed = context.activeDuty ? now - new Date(context.activeDuty.actualStart).getTime() : 0;
  const breakElapsed = context.activeBreak ? now - new Date(context.activeBreak.startedAt).getTime() : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={colours.blue} />}
      >
        <View style={styles.topbar}>
          <View>
            <Text style={styles.eyebrow}>BFC DUTY CLOCK</Text>
            <Text style={styles.greeting}>Hi, {context.profile?.name?.split(' ')[0] || 'Instructor'}</Text>
          </View>
          <Pressable onPress={logout} hitSlop={12}><Text style={styles.signOut}>Sign out</Text></Pressable>
        </View>

        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}

        {!context.activeDuty ? (
          <View style={styles.offDuty}>
            <View style={styles.statusBadge}><View style={styles.offDot} /><Text style={styles.statusText}>OFF DUTY</Text></View>
            <Text style={styles.offTitle}>Ready to start?</Text>
            <Text style={styles.offCopy}>Clock in when your duty begins. You can adjust the start time if you are a little late.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start duty"
              onPress={() => setStartVisible(true)}
              style={({ pressed }) => [styles.startCircle, pressed && styles.pressed]}
            >
              <Text style={styles.startIcon}>▶</Text>
              <Text style={styles.startText}>START</Text>
              <Text style={styles.startSubtext}>DUTY</Text>
            </Pressable>
            <Text style={styles.locationPrivacy}>GPS is checked only when you start.</Text>
          </View>
        ) : (
          <>
            <View style={styles.activeCard}>
              <View style={styles.activeTopline}>
                <View style={styles.statusBadgeActive}><View style={styles.activeDot} /><Text style={styles.activeBadgeText}>ON DUTY</Text></View>
                {context.activeDuty.entrySource === 'automatic_booking' ? <Text style={styles.autoBadge}>AUTO START</Text> : null}
              </View>
              <Text style={styles.elapsed}>{formatDuration(dutyElapsed)}</Text>
              <Text style={styles.started}>Started {formatDateTime(context.activeDuty.actualStart)}</Text>
              <View style={styles.rule} />
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Location</Text><Text style={styles.detailValue}>{context.activeDuty.location}</Text></View>
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Maximum end</Text><Text style={styles.detailValue}>{formatClockTime(context.activeDuty.maximumEnd)}</Text></View>
            </View>

            <View style={[styles.breakCard, context.activeBreak && styles.breakCardActive]}>
              <View style={styles.breakCopy}>
                <Text style={styles.breakEyebrow}>{context.activeBreak ? 'BREAK IN PROGRESS' : 'BREAKS'}</Text>
                <Text style={styles.breakTitle}>{context.activeBreak ? formatDuration(breakElapsed) : 'Take a break'}</Text>
                <Text style={styles.breakDetail}>{context.activeBreak ? `Started ${formatClockTime(context.activeBreak.startedAt)}` : 'Record rest periods during your duty day.'}</Text>
              </View>
              <Pressable
                disabled={working}
                onPress={() => void runBreakAction(context.activeBreak ? 'end' : 'start')}
                style={({ pressed }) => [styles.breakButton, context.activeBreak && styles.breakButtonEnd, pressed && styles.pressed, working && styles.disabled]}
              >
                <Text style={[styles.breakButtonText, context.activeBreak && styles.breakButtonEndText]}>{context.activeBreak ? 'End break' : 'Start break'}</Text>
              </Pressable>
            </View>

            <View style={styles.flightSummary}>
              <Text style={styles.flightLabel}>TODAY’S LOGGED FLYING</Text>
              <Text style={styles.flightValue}>{(context.loggedFlightMinutes / 60).toFixed(1)} h</Text>
              <Text style={styles.flightDetail}>{context.loggedFlightCount} logged {context.loggedFlightCount === 1 ? 'flight' : 'flights'} · final total remains editable</Text>
            </View>

            <PrimaryButton tone="danger" onPress={() => setEndVisible(true)}>End duty</PrimaryButton>
          </>
        )}
        <View style={styles.footerLinks}>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_URL)}><Text style={styles.footerLink}>Privacy</Text></Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => void Linking.openURL(SUPPORT_URL)}><Text style={styles.footerLink}>Support</Text></Pressable>
        </View>
        <AppearanceSelector />
      </ScrollView>

      <StartDutyModal visible={startVisible} context={context} working={working} onClose={() => setStartVisible(false)} onStart={startDuty} />
      <EndDutyModal visible={endVisible} context={context} working={working} onClose={() => setEndVisible(false)} onEnd={endDuty} />
    </SafeAreaView>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colours.background },
  content: { flexGrow: 1, padding: 20, paddingBottom: 42, gap: 18 },
  loading: { flex: 1, backgroundColor: colours.background, alignItems: 'center', justifyContent: 'center', padding: 28 },
  loadingText: { color: colours.muted, marginTop: 12, fontSize: 14 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  eyebrow: { color: colours.blue, fontSize: 10, fontWeight: '900', letterSpacing: 1.8 },
  greeting: { color: colours.navy, fontSize: 27, fontWeight: '900', marginTop: 3 },
  signOut: { color: colours.muted, fontSize: 13, fontWeight: '800' },
  error: { borderRadius: 14, backgroundColor: colours.redLight, borderWidth: 1, borderColor: colours.red, padding: 12 },
  errorText: { color: colours.red, fontSize: 12, fontWeight: '700' },
  offDuty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colours.subtle, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  offDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#7A8792' },
  statusText: { color: colours.subtleText, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  offTitle: { color: colours.navy, fontSize: 30, fontWeight: '900', marginTop: 18 },
  offCopy: { color: colours.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 310, marginTop: 8 },
  startCircle: { width: 210, height: 210, borderRadius: 105, backgroundColor: colours.green, alignItems: 'center', justifyContent: 'center', marginTop: 36, shadowColor: colours.green, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 18, elevation: 8 },
  startIcon: { color: '#fff', fontSize: 23, marginBottom: 5 },
  startText: { color: '#fff', fontSize: 31, fontWeight: '900', letterSpacing: 1.5 },
  startSubtext: { color: '#CFF3E3', fontSize: 14, fontWeight: '900', letterSpacing: 2.5 },
  locationPrivacy: { color: colours.muted, fontSize: 11, marginTop: 24 },
  activeCard: { backgroundColor: '#0F2942', borderRadius: 24, padding: 22 },
  activeTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadgeActive: { flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#56E1A9' },
  activeBadgeText: { color: '#D9F7EB', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  autoBadge: { color: colours.sky, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  elapsed: { color: '#fff', fontSize: 52, fontWeight: '900', marginTop: 17, fontVariant: ['tabular-nums'] },
  started: { color: '#C8D9E6', fontSize: 13, marginTop: 1 },
  rule: { height: 1, backgroundColor: 'rgba(255,255,255,0.14)', marginVertical: 18 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 15, marginTop: 6 },
  detailLabel: { color: '#9EB5C6', fontSize: 12 },
  detailValue: { color: '#fff', fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  breakCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, backgroundColor: colours.surface, borderWidth: 1, borderColor: colours.border, padding: 17 },
  breakCardActive: { backgroundColor: colours.amberLight, borderColor: colours.amberBorder },
  breakCopy: { flex: 1 },
  breakEyebrow: { color: colours.amber, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  breakTitle: { color: colours.navy, fontSize: 22, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  breakDetail: { color: colours.muted, fontSize: 11, marginTop: 3 },
  breakButton: { backgroundColor: colours.blue, paddingHorizontal: 16, paddingVertical: 13, borderRadius: 13 },
  breakButtonEnd: { backgroundColor: colours.input, borderWidth: 1, borderColor: colours.amber },
  breakButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  breakButtonEndText: { color: colours.amber },
  flightSummary: { borderRadius: 18, backgroundColor: colours.greenLight, borderWidth: 1, borderColor: colours.greenBorder, padding: 17 },
  flightLabel: { color: colours.green, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  flightValue: { color: colours.navy, fontSize: 29, fontWeight: '900', marginTop: 4 },
  flightDetail: { color: colours.muted, fontSize: 11, marginTop: 3 },
  pressed: { opacity: 0.86, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.5 },
  deniedIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: colours.amberLight, alignItems: 'center', justifyContent: 'center' },
  deniedIconText: { color: colours.amber, fontSize: 30, fontWeight: '900' },
  deniedTitle: { color: colours.navy, fontSize: 23, fontWeight: '900', marginTop: 18, textAlign: 'center' },
  deniedText: { color: colours.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  deniedButton: { width: '100%', marginTop: 24 },
  footerLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 },
  footerLink: { color: colours.blue, fontSize: 11, fontWeight: '700' },
  footerDot: { color: colours.muted, fontSize: 11 },
});
