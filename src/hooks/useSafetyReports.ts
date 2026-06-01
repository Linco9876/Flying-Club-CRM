import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useSafetySettings } from './useSafetySettings';
import toast from 'react-hot-toast';

export type SafetyReportType = 'incident' | 'hazard' | 'risk_assessment';
export type SafetyReportSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyReportStatus = 'open' | 'under_review' | 'closed';

export interface SafetyReport {
  id: string;
  reporterId: string;
  reporterName: string;
  categoryId?: string;
  categoryName?: string;
  reportType: SafetyReportType;
  severity: SafetyReportSeverity;
  title: string;
  description: string;
  location?: string;
  immediateActions?: string;
  involvedUserIds: string[];
  status: SafetyReportStatus;
  assignedTo?: string;
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
  immediateActions?: string;
  involvedUserIds?: string[];
}

export const useSafetyReports = () => {
  const { user } = useAuth();
  const { settings, categories } = useSafetySettings();
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('safety_reports')
        .select('*, reporter:users!safety_reports_reporter_id_fkey(name), category:safety_report_categories(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;
      const mappedReports = (data || []).map((report: any) => ({
        id: report.id,
        reporterId: report.reporter_id,
        reporterName: report.reporter?.name || 'Unknown',
        categoryId: report.category_id || undefined,
        categoryName: report.category?.name || undefined,
        reportType: report.report_type,
        severity: report.severity,
        title: report.title,
        description: report.description,
        location: report.location || undefined,
        immediateActions: report.immediate_actions || undefined,
        involvedUserIds: report.involved_user_ids || [],
        status: report.status,
        assignedTo: report.assigned_to || undefined,
        createdAt: new Date(report.created_at),
        updatedAt: new Date(report.updated_at)
      }));

      const visibleReports = user?.role === 'student' || user?.role === 'pilot'
        ? mappedReports.filter((report: SafetyReport) =>
            report.reporterId === user.id || report.involvedUserIds.includes(user.id)
          )
        : mappedReports;

      setReports(visibleReports);
    } catch (error) {
      console.error('Error fetching safety reports:', error);
      toast.error('Failed to load safety reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

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
      immediate_actions: report.immediateActions || null,
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
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await fetchReports();
    toast.success('Safety report updated');
  };

  return { reports, loading, createReport, updateStatus, refetch: fetchReports };
};
