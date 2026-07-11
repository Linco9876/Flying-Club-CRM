import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useSafetySettings } from './useSafetySettings';
import toast from 'react-hot-toast';
import { usePageLoadState } from '../context/PageLoadContext';

export type SafetyReportType = 'incident' | 'hazard' | 'risk_assessment' | 'near_miss' | 'accident';
export type SafetyReportSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyReportStatus = 'open' | 'under_review' | 'closed';

export interface SafetyReport {
  id: string;
  reporterId: string;
  reporterName: string;
  categoryId?: string;
  categoryName?: string;
  aircraftId?: string;
  aircraftRegistration?: string;
  reportType: SafetyReportType;
  severity: SafetyReportSeverity;
  title: string;
  description: string;
  location?: string;
  occurrenceAt?: Date;
  phaseOfFlight?: string;
  witnesses?: string;
  immediateActions?: string;
  correctiveAction?: string;
  injuryReported: boolean;
  damageReported: boolean;
  reportableToAuthority: boolean;
  involvedUserIds: string[];
  status: SafetyReportStatus;
  assignedTo?: string;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSafetyReportData {
  categoryId?: string;
  reportType: SafetyReportType;
  severity: SafetyReportSeverity;
  title: string;
  description: string;
  location?: string;
  occurrenceAt?: string;
  aircraftId?: string;
  phaseOfFlight?: string;
  witnesses?: string;
  immediateActions?: string;
  correctiveAction?: string;
  injuryReported?: boolean;
  damageReported?: boolean;
  reportableToAuthority?: boolean;
  involvedUserIds?: string[];
}

interface UseSafetyReportsOptions {
  participateInPageLoad?: boolean;
}

export const useSafetyReports = (options?: UseSafetyReportsOptions) => {
  const { user } = useAuth();
  const { settings, categories } = useSafetySettings();
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const participateInPageLoad = options?.participateInPageLoad ?? true;

  usePageLoadState(
    participateInPageLoad && loading,
    'Loading safety',
    'Preparing safety reports, involved members and incident status...'
  );

  const fetchReports = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('safety_reports')
        .select('*, reporter:users!safety_reports_reporter_id_fkey(name), category:safety_report_categories(name), aircraft:aircraft(registration)')
        .order('occurrence_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if ((user?.role === 'student' || user?.role === 'pilot') && user.id) {
        query = query.or(`reporter_id.eq.${user.id},involved_user_ids.cs.{${user.id}}`);
      }

      const { data, error } = await query;

      if (error) throw error;
      const mappedReports = (data || []).map((report: any) => ({
        id: report.id,
        reporterId: report.reporter_id,
        reporterName: report.reporter?.name || 'Unknown',
        categoryId: report.category_id || undefined,
        categoryName: report.category?.name || undefined,
        aircraftId: report.aircraft_id || undefined,
        aircraftRegistration: report.aircraft?.registration || undefined,
        reportType: report.report_type,
        severity: report.severity,
        title: report.title,
        description: report.description,
        location: report.location || undefined,
        occurrenceAt: report.occurrence_at ? new Date(report.occurrence_at) : undefined,
        phaseOfFlight: report.phase_of_flight || undefined,
        witnesses: report.witnesses || undefined,
        immediateActions: report.immediate_actions || undefined,
        correctiveAction: report.corrective_action || undefined,
        injuryReported: report.injury_reported ?? false,
        damageReported: report.damage_reported ?? false,
        reportableToAuthority: report.reportable_to_authority ?? false,
        involvedUserIds: report.involved_user_ids || [],
        status: report.status,
        assignedTo: report.assigned_to || undefined,
        closedAt: report.closed_at ? new Date(report.closed_at) : undefined,
        createdAt: new Date(report.created_at),
        updatedAt: new Date(report.updated_at)
      }));

      setReports(mappedReports);
    } catch (error) {
      console.error('Error fetching safety reports:', error);
      toast.error('Failed to load safety reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [user?.id, user?.role]);

  const createReport = async (report: CreateSafetyReportData) => {
    if (!user) throw new Error('You must be signed in to submit a report');
    const category = categories.find(item => item.id === report.categoryId);
    const assignedTo = settings.autoAssignIncidents
      ? category?.defaultAssignee || settings.defaultSafetyOfficer
      : null;
    const { error } = await supabase.from('safety_reports').insert({
      reporter_id: user.id,
      category_id: report.categoryId || null,
      report_type: report.reportType,
      severity: report.severity,
      title: report.title,
      description: report.description,
      location: report.location || null,
      occurrence_at: report.occurrenceAt || null,
      aircraft_id: report.aircraftId || null,
      phase_of_flight: report.phaseOfFlight || null,
      witnesses: report.witnesses || null,
      immediate_actions: report.immediateActions || null,
      corrective_action: report.correctiveAction || null,
      injury_reported: report.injuryReported ?? false,
      damage_reported: report.damageReported ?? false,
      reportable_to_authority: report.reportableToAuthority ?? false,
      involved_user_ids: report.involvedUserIds || [],
      assigned_to: assignedTo
    });
    if (error) throw error;
    await fetchReports();
    toast.success('Safety report submitted');
  };

  const updateStatus = async (id: string, status: SafetyReportStatus) => {
    const { error } = await supabase
      .from('safety_reports')
      .update({
        status,
        closed_at: status === 'closed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    if (error) throw error;
    await fetchReports();
    toast.success('Safety report updated');
  };

  return { reports, loading, createReport, updateStatus, refetch: fetchReports };
};
