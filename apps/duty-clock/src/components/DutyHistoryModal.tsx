import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { type AppColours, useAppTheme } from '../theme';
import type { HistoricalDutyPeriod } from '../types';
import { historicalBreakTypeLabel, historicalDutySourceLabel, summariseHistoricalDutyPeriod } from '../utils/dutyPeriodDetails';
import { groupHistoricalDutyByWeek } from '../utils/dutyWeekSummary';
import { formatClockTime, formatDateTime, formatDuration } from '../utils/time';

type Props = {
  visible: boolean;
  userId: string;
  onClose: () => void;
};

type DutyPeriodRow = {
  id: string;
  duty_date: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  location: string;
  flight_minutes: number;
  is_external: boolean;
  external_organisation: string | null;
  notes: string | null;
  amendment_reason: string | null;
  entry_source: 'manual' | 'mobile' | 'automatic_booking';
  auto_closed_at_limit: boolean;
  break_confirmation: 'taken' | 'not_taken' | null;
  duty_breaks: DutyBreakRow[] | null;
};

type DutyBreakRow = {
  id: string;
  break_start: string;
  break_end: string;
  break_type: 'break' | 'rest' | 'split_duty_rest';
  free_of_duty: boolean;
  affects_calculation: boolean;
  facility: string | null;
  notes: string | null;
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

const compactSourceLabel = (source: HistoricalDutyPeriod['entrySource']) => historicalDutySourceLabel(source).toUpperCase();

const formatWeekDate = (value: string) => new Intl.DateTimeFormat('en-AU', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
}).format(new Date(`${value}T12:00:00`));

export const DutyHistoryModal = ({ visible, userId, onClose }: Props) => {
  const { colours } = useAppTheme();
  const styles = useMemo(() => createStyles(colours), [colours]);
  const [periods, setPeriods] = useState<HistoricalDutyPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<HistoricalDutyPeriod>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(undefined);

    const { data, error: queryError } = await supabase
      .from('duty_periods')
      .select(`
        id,duty_date,planned_start,planned_end,actual_start,actual_end,location,
        is_external,external_organisation,flight_minutes,notes,amendment_reason,
        entry_source,auto_closed_at_limit,break_confirmation,
        duty_breaks(id,break_start,break_end,break_type,free_of_duty,affects_calculation,facility,notes)
      `)
      .eq('instructor_id', userId)
      .eq('status', 'completed')
      .not('actual_start', 'is', null)
      .not('actual_end', 'is', null)
      .order('actual_start', { ascending: false })
      .limit(50);

    if (queryError) {
      setError(queryError.message);
    } else {
      const mappedPeriods = ((data ?? []) as unknown as DutyPeriodRow[])
        .filter(row => Boolean(row.actual_start && row.actual_end))
        .map(row => ({
          id: row.id,
          dutyDate: row.duty_date,
          plannedStart: row.planned_start || undefined,
          plannedEnd: row.planned_end || undefined,
          actualStart: row.actual_start as string,
          actualEnd: row.actual_end as string,
          location: row.location,
          isExternal: Boolean(row.is_external),
          externalOrganisation: row.external_organisation || undefined,
          flightMinutes: Number(row.flight_minutes || 0),
          notes: row.notes || undefined,
          amendmentReason: row.amendment_reason || undefined,
          entrySource: row.entry_source,
          autoClosedAtLimit: Boolean(row.auto_closed_at_limit),
          breakConfirmation: row.break_confirmation || undefined,
          breaks: (row.duty_breaks || [])
            .map(item => ({
              id: item.id,
              breakStart: item.break_start,
              breakEnd: item.break_end,
              breakType: item.break_type,
              freeOfDuty: Boolean(item.free_of_duty),
              affectsCalculation: Boolean(item.affects_calculation),
              facility: item.facility || undefined,
              notes: item.notes || undefined,
            }))
            .sort((left, right) => left.breakStart.localeCompare(right.breakStart)),
        }));
      setPeriods(mappedPeriods);
      setSelectedPeriod(current => current ? mappedPeriods.find(period => period.id === current.id) : undefined);
    }

    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  useEffect(() => {
    if (visible) void loadHistory();
  }, [loadHistory, visible]);

  const closeModal = () => {
    setSelectedPeriod(undefined);
    onClose();
  };

  const selectedSummary = selectedPeriod ? summariseHistoricalDutyPeriod(selectedPeriod) : undefined;
  const weeks = useMemo(() => groupHistoricalDutyByWeek(periods), [periods]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={selectedPeriod ? () => setSelectedPeriod(undefined) : closeModal}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.header}>
          {selectedPeriod ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back to previous duty periods" hitSlop={8} onPress={() => setSelectedPeriod(undefined)} style={styles.backButton}>
              <Text style={styles.backText}>‹ Back</Text>
            </Pressable>
          ) : null}
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{selectedPeriod ? 'Duty period details' : 'Previous duty periods'}</Text>
            <Text style={styles.subtitle}>{selectedPeriod ? formatDutyDate(selectedPeriod.dutyDate) : 'Your latest 50 completed records'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close previous duty periods" hitSlop={8} onPress={closeModal} style={styles.closeButton}>
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
            contentContainerStyle={[styles.content, !selectedPeriod && periods.length === 0 && !error && styles.emptyContent]}
            refreshControl={!selectedPeriod ? (
              <RefreshControl refreshing={refreshing} onRefresh={() => void loadHistory(true)} tintColor={colours.blue} />
            ) : undefined}
          >
            {selectedPeriod && selectedSummary ? (
              <>
                <View style={styles.detailBadges}>
                  <Text style={styles.completedBadge}>COMPLETED</Text>
                  {selectedPeriod.isExternal ? <Text style={styles.externalBadge}>EXTERNAL DUTY</Text> : null}
                  {selectedPeriod.autoClosedAtLimit ? <Text style={styles.warningBadge}>MAX ASSUMED</Text> : null}
                  {selectedPeriod.breakConfirmation === 'not_taken' ? <Text style={styles.warningBadge}>NO BREAK TAKEN</Text> : null}
                </View>

                <View style={styles.detailMetrics}>
                  <View style={[styles.metricCard, styles.dutyMetric]}>
                    <Text style={styles.metricLabelLight}>ELAPSED DUTY</Text>
                    <Text style={styles.metricValueLight}>{formatFlightTime(selectedSummary.dutyMinutes)}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.detailLabel}>LOGGED FLYING</Text>
                    <Text style={styles.metricValue}>{formatFlightTime(selectedSummary.flightMinutes)}</Text>
                  </View>
                  <View style={styles.metricCard}>
                    <Text style={styles.detailLabel}>RECORDED BREAKS</Text>
                    <Text style={styles.metricValue}>{formatFlightTime(selectedSummary.breakMinutes)}</Text>
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <Text style={styles.sectionTitle}>Period summary</Text>
                  <View style={styles.infoGrid}>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>ACTUAL START</Text><Text style={styles.infoValue}>{formatDateTime(selectedPeriod.actualStart)}</Text></View>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>ACTUAL END</Text><Text style={styles.infoValue}>{formatDateTime(selectedPeriod.actualEnd)}</Text></View>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>DUTY EXCLUDING BREAKS</Text><Text style={styles.infoValue}>{formatFlightTime(selectedSummary.dutyMinutesExcludingBreaks)}</Text></View>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>ENTRY METHOD</Text><Text style={styles.infoValue}>{historicalDutySourceLabel(selectedPeriod.entrySource)}</Text></View>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>LOCATION</Text><Text style={styles.infoValue}>{selectedPeriod.location}</Text></View>
                    <View style={styles.infoCard}><Text style={styles.detailLabel}>BREAK DECLARATION</Text><Text style={styles.infoValue}>{selectedPeriod.breakConfirmation === 'taken' ? 'Break taken' : selectedPeriod.breakConfirmation === 'not_taken' ? 'No break taken' : 'Not recorded'}</Text></View>
                    {selectedPeriod.isExternal ? <View style={styles.infoCard}><Text style={styles.detailLabel}>EXTERNAL ORGANISATION</Text><Text style={styles.infoValue}>{selectedPeriod.externalOrganisation || 'Not recorded'}</Text></View> : null}
                    {selectedPeriod.plannedStart ? <View style={styles.infoCard}><Text style={styles.detailLabel}>PLANNED START</Text><Text style={styles.infoValue}>{formatDateTime(selectedPeriod.plannedStart)}</Text></View> : null}
                    {selectedPeriod.plannedEnd ? <View style={styles.infoCard}><Text style={styles.detailLabel}>PLANNED END</Text><Text style={styles.infoValue}>{formatDateTime(selectedPeriod.plannedEnd)}</Text></View> : null}
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Breaks</Text>
                    <Text style={styles.sectionCount}>{selectedPeriod.breaks.length} recorded</Text>
                  </View>
                  {selectedPeriod.breaks.length === 0 ? (
                    <View style={styles.noBreakCard}><Text style={styles.noBreakText}>No individual breaks were recorded for this duty period.</Text></View>
                  ) : selectedPeriod.breaks.map(item => (
                    <View key={item.id} style={styles.breakDetailCard}>
                      <View style={styles.breakDetailHeader}>
                        <View style={styles.breakDetailCopy}>
                          <Text style={styles.breakDetailTitle}>{historicalBreakTypeLabel(item.breakType)}</Text>
                          <Text style={styles.breakDetailTime}>{formatClockTime(item.breakStart)} – {formatClockTime(item.breakEnd)} · {formatDuration(new Date(item.breakEnd).getTime() - new Date(item.breakStart).getTime())}</Text>
                        </View>
                        <View style={styles.breakTags}>
                          {item.freeOfDuty ? <Text style={styles.freeDutyBadge}>FREE OF DUTY</Text> : null}
                          {item.affectsCalculation ? <Text style={styles.sourceBadge}>APPROVED CALCULATION</Text> : null}
                        </View>
                      </View>
                      {item.facility ? <Text style={styles.breakMeta}>Facility: {item.facility}</Text> : null}
                      {item.notes ? <Text style={styles.breakNotes}>{item.notes}</Text> : null}
                    </View>
                  ))}
                </View>

                {selectedPeriod.notes ? <View style={styles.detailSection}><Text style={styles.sectionTitle}>Notes</Text><Text style={styles.notesCard}>{selectedPeriod.notes}</Text></View> : null}
                {selectedPeriod.amendmentReason ? <View style={styles.detailSection}><Text style={styles.sectionTitle}>Latest amendment reason</Text><Text style={styles.notesCard}>{selectedPeriod.amendmentReason}</Text></View> : null}
              </>
            ) : (
              <>
                {error ? (
                  <View style={styles.errorCard}>
                    <Text style={styles.errorTitle}>Duty periods could not be loaded</Text>
                    <Text style={styles.errorText}>{error}</Text>
                    <Pressable accessibilityRole="button" onPress={() => void loadHistory()} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></Pressable>
                  </View>
                ) : null}

                {!error && periods.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyTitle}>No previous duty periods</Text>
                    <Text style={styles.emptyText}>Completed duty periods will appear here after you clock out.</Text>
                  </View>
                ) : null}

                {!error && weeks.map(week => (
                  <View key={week.key} style={styles.weekGroup}>
                    <View style={styles.weekSummary}>
                      <View style={styles.weekHeader}>
                        <View>
                          <Text style={styles.weekEyebrow}>SUNDAY TO SATURDAY</Text>
                          <Text style={styles.weekTitle}>{formatWeekDate(week.weekStart)} – {formatWeekDate(week.weekEnd)}</Text>
                        </View>
                        <Text style={styles.weekCount}>{week.periods.length} {week.periods.length === 1 ? 'period' : 'periods'}</Text>
                      </View>
                      <View style={styles.weekMetrics}>
                        <View style={styles.weekMetric}>
                          <Text style={styles.weekMetricLabel}>FLYING</Text>
                          <Text style={[styles.weekMetricValue, styles.weekFlying]}>{formatFlightTime(week.flightMinutes)}</Text>
                        </View>
                        <View style={styles.weekMetric}>
                          <Text style={styles.weekMetricLabel}>TOTAL TIME</Text>
                          <Text style={styles.weekMetricValue}>{formatFlightTime(week.dutyMinutes)}</Text>
                        </View>
                        <View style={styles.weekMetric}>
                          <Text style={styles.weekMetricLabel}>MINUS BREAKS</Text>
                          <Text style={styles.weekMetricValue}>{formatFlightTime(week.dutyMinutesExcludingBreaks)}</Text>
                        </View>
                      </View>
                    </View>

                    {week.periods.map(period => {
                      const summary = summariseHistoricalDutyPeriod(period);
                      return (
                        <Pressable
                          key={period.id}
                          accessibilityRole="button"
                          accessibilityLabel={`View duty period details for ${formatDutyDate(period.dutyDate)}`}
                          accessibilityHint="Shows times, breaks, location, flying and notes"
                          onPress={() => setSelectedPeriod(period)}
                          style={({ pressed }) => [styles.periodCard, pressed && styles.periodCardPressed]}
                        >
                          <View style={styles.periodHeader}>
                            <View style={styles.periodHeading}>
                              <Text style={styles.periodDate}>{formatDutyDate(period.dutyDate)}</Text>
                              <Text style={styles.location} numberOfLines={1}>{period.location}</Text>
                            </View>
                            <View style={styles.compactBadges}>
                              {period.autoClosedAtLimit ? <Text style={[styles.warningBadge, styles.compactBadge]}>MAX</Text> : null}
                              {period.breakConfirmation === 'not_taken' ? <Text style={[styles.warningBadge, styles.compactBadge]}>NO BREAK</Text> : null}
                              <Text style={[styles.sourceBadge, styles.compactBadge]}>{compactSourceLabel(period.entrySource)}</Text>
                            </View>
                          </View>
                          <View style={styles.compactSummary}>
                            <Text style={styles.compactTimes}>{formatClockTime(period.actualStart)}–{formatClockTime(period.actualEnd)}</Text>
                            <Text style={styles.compactMetric}>Duty <Text style={styles.compactMetricStrong}>{formatFlightTime(summary.dutyMinutes)}</Text></Text>
                            <Text style={styles.compactMetric}>Flying <Text style={[styles.compactMetricStrong, styles.weekFlying]}>{formatFlightTime(summary.flightMinutes)}</Text></Text>
                            <Text style={styles.openChevron}>›</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
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
  backButton: { minHeight: 44, justifyContent: 'center', paddingRight: 2 },
  backText: { color: colours.blue, fontSize: 14, fontWeight: '800' },
  closeButton: { minWidth: 48, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
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
  weekGroup: { gap: 8, marginBottom: 8 },
  weekSummary: { borderRadius: 17, backgroundColor: '#0F2942', padding: 13, gap: 11 },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10 },
  weekEyebrow: { color: '#8ECFEB', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  weekTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', marginTop: 3 },
  weekCount: { color: '#BFD4E3', fontSize: 9, fontWeight: '800' },
  weekMetrics: { flexDirection: 'row', gap: 7 },
  weekMetric: { flex: 1, minWidth: 0, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.09)', paddingHorizontal: 8, paddingVertical: 8 },
  weekMetricLabel: { color: '#9EB5C6', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  weekMetricValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  weekFlying: { color: colours.green },
  periodCard: { borderRadius: 14, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, paddingHorizontal: 12, paddingVertical: 10 },
  periodCardPressed: { opacity: 0.86, transform: [{ scale: 0.995 }] },
  periodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  periodHeading: { flex: 1, minWidth: 0 },
  periodDate: { color: colours.navy, fontSize: 13, fontWeight: '900' },
  location: { color: colours.muted, fontSize: 10, marginTop: 2 },
  badges: { alignItems: 'flex-end', gap: 5 },
  compactBadges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4, maxWidth: '52%' },
  sourceBadge: { color: colours.blue, backgroundColor: colours.blueLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6, overflow: 'hidden' },
  warningBadge: { color: colours.amber, backgroundColor: colours.amberLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.5, overflow: 'hidden' },
  compactBadge: { paddingHorizontal: 7, paddingVertical: 4, fontSize: 7, letterSpacing: 0.4 },
  compactSummary: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 },
  compactTimes: { color: colours.ink, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  compactMetric: { color: colours.muted, fontSize: 9 },
  compactMetricStrong: { color: colours.navy, fontWeight: '900', fontVariant: ['tabular-nums'] },
  durationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 18 },
  duration: { color: colours.navy, fontSize: 28, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  flightBlock: { alignItems: 'flex-end' },
  flightTime: { color: colours.green, fontSize: 18, fontWeight: '900', marginTop: 3, fontVariant: ['tabular-nums'] },
  detailLabel: { color: colours.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  rule: { height: 1, backgroundColor: colours.border, marginVertical: 14 },
  timeRow: { flexDirection: 'row', gap: 24 },
  timeBlock: { flex: 1 },
  timeValue: { color: colours.ink, fontSize: 16, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7, marginTop: 16 },
  openText: { color: colours.blue, fontSize: 12, fontWeight: '900' },
  openChevron: { color: colours.blue, fontSize: 20, lineHeight: 20, fontWeight: '600', marginLeft: 'auto' },
  detailBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  completedBadge: { color: colours.green, backgroundColor: colours.greenLight, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6, overflow: 'hidden' },
  externalBadge: { color: colours.blue, backgroundColor: colours.blueLight, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontSize: 9, fontWeight: '900', letterSpacing: 0.6, overflow: 'hidden' },
  detailMetrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { flexGrow: 1, flexBasis: 145, minHeight: 106, borderRadius: 18, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, padding: 15, justifyContent: 'flex-end' },
  dutyMetric: { backgroundColor: '#0F2942', borderColor: '#0F2942' },
  metricLabelLight: { color: '#BFD4E3', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  metricValueLight: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 5, fontVariant: ['tabular-nums'] },
  metricValue: { color: colours.navy, fontSize: 24, fontWeight: '900', marginTop: 5, fontVariant: ['tabular-nums'] },
  detailSection: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: colours.navy, fontSize: 18, fontWeight: '900' },
  sectionCount: { color: colours.muted, fontSize: 11, fontWeight: '800' },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  infoCard: { flexGrow: 1, flexBasis: 150, borderRadius: 14, backgroundColor: colours.subtle, padding: 12 },
  infoValue: { color: colours.ink, fontSize: 13, lineHeight: 18, fontWeight: '800', marginTop: 5 },
  noBreakCard: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: colours.border, padding: 15 },
  noBreakText: { color: colours.muted, fontSize: 12, lineHeight: 18 },
  breakDetailCard: { borderRadius: 15, borderWidth: 1, borderColor: colours.border, backgroundColor: colours.surface, padding: 14, gap: 7 },
  breakDetailHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 9 },
  breakDetailCopy: { flexGrow: 1, flexBasis: 150 },
  breakDetailTitle: { color: colours.navy, fontSize: 14, fontWeight: '900' },
  breakDetailTime: { color: colours.ink, fontSize: 12, fontWeight: '700', marginTop: 3, fontVariant: ['tabular-nums'] },
  breakTags: { alignItems: 'flex-end', gap: 5 },
  freeDutyBadge: { color: colours.green, backgroundColor: colours.greenLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 8, fontWeight: '900', letterSpacing: 0.4, overflow: 'hidden' },
  breakMeta: { color: colours.muted, fontSize: 11, fontWeight: '800' },
  breakNotes: { color: colours.ink, fontSize: 12, lineHeight: 18 },
  notesCard: { color: colours.ink, backgroundColor: colours.subtle, borderRadius: 14, padding: 14, fontSize: 13, lineHeight: 20 },
});
