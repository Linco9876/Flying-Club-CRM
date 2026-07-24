import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { type AppColours, useAppTheme } from '../theme';
import { formatClockTime, formatDuration } from '../utils/time';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
};

type DutyPeriodRow = {
  id: string;
  duty_date: string;
  actual_start: string;
  actual_end: string;
  location: string;
  flight_minutes: number;
  entry_source: 'manual' | 'mobile' | 'automatic_booking';
  auto_closed_at_limit: boolean;
};

const formatDutyDate = (value: string) => new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}).format(new Date(`${value}T12:00:00`));

const formatFlightTime = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
};

const sourceLabel = (source: DutyPeriodRow['entry_source']) => {
  if (source === 'automatic_booking') return 'AUTO START';
  if (source === 'mobile') return 'DUTY CLOCK';
  return 'MANUAL';
};

export const DutyHistoryModal = ({ visible, userId, onClose }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [periods, setPeriods] = useState<DutyPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(undefined);

    const { data, error: queryError } = await supabase
      .from('duty_periods')
      .select('id,duty_date,actual_start,actual_end,location,flight_minutes,entry_source,auto_closed_at_limit')
      .eq('instructor_id', userId)
      .eq('status', 'completed')
      .not('actual_start', 'is', null)
      .not('actual_end', 'is', null)
      .order('actual_start', { ascending: false })
      .limit(50);

    if (queryError) {
      setError(queryError.message);
    } else {
      setPeriods((data ?? []) as DutyPeriodRow[]);
    }

    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    if (visible) void loadHistory();
  }, [loadHistory, visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Previous duty periods</Text>
            <Text style={styles.subtitle}>Your latest 50 completed records</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close previous duty periods"
            hitSlop={12}
            onPress={onClose}
          >
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colours.blue} />
            <Text style={styles.centerText}>Loading duty periods...</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.content, periods.length === 0 && !error && styles.emptyContent]}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void loadHistory(true)}
                tintColor={colours.blue}
              />
            )}
          >
            {error ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorTitle}>Duty periods could not be loaded</Text>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => void loadHistory()} style={styles.retryButton}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            {!error && periods.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No previous duty periods</Text>
                <Text style={styles.emptyText}>Completed duty periods will appear here after you clock out.</Text>
              </View>
            ) : null}

            {!error && periods.map(period => {
              const duration = new Date(period.actual_end).getTime() - new Date(period.actual_start).getTime();
              return (
                <View key={period.id} style={styles.periodCard}>
                  <View style={styles.periodHeader}>
                    <View style={styles.periodHeading}>
                      <Text style={styles.periodDate}>{formatDutyDate(period.duty_date)}</Text>
                      <Text style={styles.location} numberOfLines={1}>{period.location}</Text>
                    </View>
                    <View style={styles.badges}>
                      {period.auto_closed_at_limit ? <Text style={styles.warningBadge}>MAX ASSUMED</Text> : null}
                      <Text style={styles.sourceBadge}>{sourceLabel(period.entry_source)}</Text>
                    </View>
                  </View>

                  <View style={styles.durationRow}>
                    <View>
                      <Text style={styles.detailLabel}>ELAPSED DUTY</Text>
                      <Text style={styles.duration}>{formatDuration(duration)}</Text>
                    </View>
                    <View style={styles.flightBlock}>
                      <Text style={styles.detailLabel}>FLYING</Text>
                      <Text style={styles.flightTime}>{formatFlightTime(period.flight_minutes)}</Text>
                    </View>
                  </View>

                  <View style={styles.rule} />
                  <View style={styles.timeRow}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.detailLabel}>START</Text>
                      <Text style={styles.timeValue}>{formatClockTime(period.actual_start)}</Text>
                    </View>
                    <View style={styles.timeBlock}>
                      <Text style={styles.detailLabel}>END</Text>
                      <Text style={styles.timeValue}>{formatClockTime(period.actual_end)}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const createStyles = (colours: AppColours) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.background },
  header: {
    backgroundColor: colours.surface,
    borderBottomWidth: 1,
    borderBottomColor: colours.border,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: { flex: 1 },
  title: { color: colours.navy, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colours.muted, fontSize: 13, marginTop: 3 },
  close: { color: colours.blue, fontSize: 15, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerText: { color: colours.muted, fontSize: 13, marginTop: 12 },
  content: { padding: 18, paddingBottom: 42, gap: 14 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  errorCard: { borderRadius: 18, borderWidth: 1, borderColor: colours.red, backgroundColor: colours.redLight, padding: 18 },
  errorTitle: { color: colours.red, fontSize: 16, fontWeight: '900' },
  errorText: { color: colours.ink, fontSize: 12, lineHeight: 18, marginTop: 5 },
  retryButton: { alignSelf: 'flex-start', marginTop: 14, borderRadius: 12, backgroundColor: colours.red, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  emptyCard: { alignItems: 'center', borderRadius: 20, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, padding: 28 },
  emptyTitle: { color: colours.navy, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: colours.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
  periodCard: { borderRadius: 20, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, padding: 18 },
  periodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  periodHeading: { flex: 1, minWidth: 0 },
  periodDate: { color: colours.navy, fontSize: 17, fontWeight: '900' },
  location: { color: colours.muted, fontSize: 12, marginTop: 3 },
  badges: { alignItems: 'flex-end', gap: 5 },
  sourceBadge: { color: colours.blue, backgroundColor: colours.blueLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6, overflow: 'hidden' },
  warningBadge: { color: colours.amber, backgroundColor: colours.amberLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.5, overflow: 'hidden' },
  durationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18 },
  duration: { color: colours.navy, fontSize: 28, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  flightBlock: { alignItems: 'flex-end' },
  flightTime: { color: colours.green, fontSize: 18, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  detailLabel: { color: colours.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  rule: { height: 1, backgroundColor: colours.border, marginVertical: 14 },
  timeRow: { flexDirection: 'row', gap: 24 },
  timeBlock: { flex: 1 },
  timeValue: { color: colours.ink, fontSize: 16, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
});
