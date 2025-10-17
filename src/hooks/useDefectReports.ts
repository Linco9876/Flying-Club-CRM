import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

export interface DefectReport {
  id: string;
  aircraftId: string;
  reporterId: string;
  discoveryDate: Date;
  location: string;
  briefSummary: string;
  detailedSummary: string;
  severity: 'minor' | 'major' | 'critical';
  isUnserviceable: boolean;
  engineHours?: number;
  status: 'open' | 'in_progress' | 'resolved';
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  createdAt: Date;
  updatedAt: Date;
  aircraft?: {
    registration: string;
    type: string;
  };
  reporter?: {
    name: string;
    email: string;
  };
  resolver?: {
    name: string;
  };
}

export interface DefectAttachment {
  id: string;
  defectReportId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
  uploadedBy: string;
  createdAt: Date;
}

export interface MaintenanceAuditLog {
  id: string;
  defectReportId?: string;
  aircraftId?: string;
  action: string;
  performedBy: string;
  oldValues?: any;
  newValues?: any;
  notes?: string;
  createdAt: Date;
  performer?: {
    name: string;
  };
}

export const useDefectReports = () => {
  const [defectReports, setDefectReports] = useState<DefectReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDefectReports = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('defect_reports')
        .select(`
          *,
          aircraft:aircraft_id (registration, type),
          reporter:reporter_id (name, email),
          resolver:resolved_by (name)
        `)
        .order('discovery_date', { ascending: false });

      if (fetchError) throw fetchError;

      const mappedData: DefectReport[] = (data || []).map(report => ({
        id: report.id,
        aircraftId: report.aircraft_id,
        reporterId: report.reporter_id,
        discoveryDate: new Date(report.discovery_date),
        location: report.location,
        briefSummary: report.brief_summary,
        detailedSummary: report.detailed_summary,
        severity: report.severity,
        isUnserviceable: report.is_unserviceable,
        engineHours: report.engine_hours,
        status: report.status,
        resolvedBy: report.resolved_by,
        resolvedAt: report.resolved_at ? new Date(report.resolved_at) : undefined,
        resolutionNotes: report.resolution_notes,
        createdAt: new Date(report.created_at),
        updatedAt: new Date(report.updated_at),
        aircraft: report.aircraft,
        reporter: report.reporter,
        resolver: report.resolver
      }));

      setDefectReports(mappedData);
      setError(null);
    } catch (err) {
      console.error('Error fetching defect reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch defect reports');
      toast.error('Failed to load defect reports');
    } finally {
      setLoading(false);
    }
  };

  const createDefectReport = async (reportData: Omit<DefectReport, 'id' | 'createdAt' | 'updatedAt' | 'aircraft' | 'reporter' | 'resolver'>) => {
    try {
      const { data, error: insertError } = await supabase
        .from('defect_reports')
        .insert({
          aircraft_id: reportData.aircraftId,
          reporter_id: reportData.reporterId,
          discovery_date: reportData.discoveryDate.toISOString(),
          location: reportData.location,
          brief_summary: reportData.briefSummary,
          detailed_summary: reportData.detailedSummary,
          severity: reportData.severity,
          is_unserviceable: reportData.isUnserviceable,
          engine_hours: reportData.engineHours,
          status: reportData.status
        })
        .select()
        .single();

      if (insertError) throw insertError;

      await fetchDefectReports();
      toast.success('Defect report created successfully');
      return data;
    } catch (err) {
      console.error('Error creating defect report:', err);
      toast.error('Failed to create defect report');
      throw err;
    }
  };

  const updateDefectReport = async (id: string, updates: Partial<DefectReport>) => {
    try {
      const updateData: any = {};
      if (updates.location !== undefined) updateData.location = updates.location;
      if (updates.briefSummary !== undefined) updateData.brief_summary = updates.briefSummary;
      if (updates.detailedSummary !== undefined) updateData.detailed_summary = updates.detailedSummary;
      if (updates.severity !== undefined) updateData.severity = updates.severity;
      if (updates.isUnserviceable !== undefined) updateData.is_unserviceable = updates.isUnserviceable;
      if (updates.engineHours !== undefined) updateData.engine_hours = updates.engineHours;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.resolvedBy !== undefined) updateData.resolved_by = updates.resolvedBy;
      if (updates.resolvedAt !== undefined) updateData.resolved_at = updates.resolvedAt.toISOString();
      if (updates.resolutionNotes !== undefined) updateData.resolution_notes = updates.resolutionNotes;
      if (updates.reporterId !== undefined) updateData.reporter_id = updates.reporterId;

      updateData.updated_at = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('defect_reports')
        .update(updateData)
        .eq('id', id);

      if (updateError) throw updateError;

      await fetchDefectReports();
      toast.success('Defect report updated successfully');
    } catch (err) {
      console.error('Error updating defect report:', err);
      toast.error('Failed to update defect report');
      throw err;
    }
  };

  const resolveDefect = async (id: string, resolverId: string, resolutionNotes: string) => {
    try {
      await updateDefectReport(id, {
        status: 'resolved',
        resolvedBy: resolverId,
        resolvedAt: new Date(),
        resolutionNotes
      });
      toast.success('Defect marked as resolved');
    } catch (err) {
      console.error('Error resolving defect:', err);
      toast.error('Failed to resolve defect');
      throw err;
    }
  };

  const fetchAuditLog = async (defectReportId: string): Promise<MaintenanceAuditLog[]> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('maintenance_audit_log')
        .select(`
          *,
          performer:performed_by (name)
        `)
        .eq('defect_report_id', defectReportId)
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      return (data || []).map(log => ({
        id: log.id,
        defectReportId: log.defect_report_id,
        aircraftId: log.aircraft_id,
        action: log.action,
        performedBy: log.performed_by,
        oldValues: log.old_values,
        newValues: log.new_values,
        notes: log.notes,
        createdAt: new Date(log.created_at),
        performer: log.performer
      }));
    } catch (err) {
      console.error('Error fetching audit log:', err);
      toast.error('Failed to load audit log');
      return [];
    }
  };

  useEffect(() => {
    fetchDefectReports();
  }, []);

  return {
    defectReports,
    loading,
    error,
    createDefectReport,
    updateDefectReport,
    resolveDefect,
    fetchAuditLog,
    refetch: fetchDefectReports
  };
};
