import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Aircraft, Defect } from '../types';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { usePageLoadState } from '../context/PageLoadContext';

let staffAircraftCache: Aircraft[] | null = null;
let publicAircraftCache: Aircraft[] | null = null;

const DEFECT_ATTACHMENT_BUCKET = 'defect-attachments';

const getDefectAttachmentPath = (value: string) => {
  if (!value) return value;

  try {
    const url = new URL(value);
    const marker = `/storage/v1/object/public/${DEFECT_ATTACHMENT_BUCKET}/`;
    const privateMarker = `/storage/v1/object/sign/${DEFECT_ATTACHMENT_BUCKET}/`;
    const markerIndex = url.pathname.indexOf(marker);
    const privateMarkerIndex = url.pathname.indexOf(privateMarker);

    if (markerIndex >= 0) {
      return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
    }

    if (privateMarkerIndex >= 0) {
      return decodeURIComponent(url.pathname.slice(privateMarkerIndex + privateMarker.length));
    }
  } catch {
    // Plain storage path, not a URL.
  }

  return value;
};

const getSignedDefectAttachmentUrls = async (photos?: string[] | null) => {
  if (!photos?.length) return [];

  return Promise.all(
    photos.map(async (photo) => {
      const path = getDefectAttachmentPath(photo);
      const { data, error } = await supabase.storage
        .from(DEFECT_ATTACHMENT_BUCKET)
        .createSignedUrl(path, 60 * 60);

      if (error) {
        console.warn('Failed to sign defect attachment URL:', error);
        return photo;
      }

      return data.signedUrl;
    })
  );
};

interface UseAircraftOptions {
  participateInPageLoad?: boolean;
}

export const useAircraft = (options?: UseAircraftOptions) => {
  const { user } = useAuth();
  const participateInPageLoad = options?.participateInPageLoad ?? true;
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const canSeePrivateAircraftData = roles.some(role => ['admin', 'instructor', 'senior_instructor'].includes(role));
  const activeAircraftCache = canSeePrivateAircraftData ? staffAircraftCache : publicAircraftCache;
  const [aircraft, setAircraft] = useState<Aircraft[]>(() => activeAircraftCache || []);
  const [loading, setLoading] = useState(() => !activeAircraftCache);
  const [error, setError] = useState<string | null>(null);
  usePageLoadState(
    participateInPageLoad && loading,
    'Loading aircraft',
    'Preparing aircraft, defects, documents and maintenance status...'
  );

  const fetchAircraft = async () => {
    try {
      const cachedAircraft = canSeePrivateAircraftData ? staffAircraftCache : publicAircraftCache;
      if (!cachedAircraft) {
        setLoading(true);
      }
      const { data: aircraftData, error: aircraftError } = await supabase
        .from('aircraft')
        .select('*')
        .order('registration');

      if (aircraftError) throw aircraftError;

      const defectColumns = canSeePrivateAircraftData
        ? '*'
        : 'id, aircraft_id, date_reported, description, status, photos, severity, location, tach_hours, hobbs_hours';

      const { data: defectsData, error: defectsError } = await supabase
        .from('defects')
        .select(defectColumns)
        .eq('status', 'open');

      if (defectsError) throw defectsError;

      const { data: ratesData, error: ratesError } = await supabase
        .from('aircraft_rates')
        .select('*, flight_types(name), payment_methods(name)');

      if (ratesError) throw ratesError;

      const defectsMap = new Map<string, Defect[]>();
      const hydratedDefects = await Promise.all((defectsData || []).map(async (d) => ({
        ...d,
        signedPhotos: await getSignedDefectAttachmentUrls(d.photos)
      })));

      hydratedDefects.forEach(d => {
        const aircraftDefects = defectsMap.get(d.aircraft_id) || [];
        aircraftDefects.push({
          id: d.id,
          aircraftId: d.aircraft_id,
          reportedBy: canSeePrivateAircraftData ? d.reported_by : undefined,
          dateReported: new Date(d.date_reported),
          summary: d.summary || undefined,
          description: d.description,
          status: d.status,
          photos: d.signedPhotos,
          melNotes: canSeePrivateAircraftData ? d.mel_notes : undefined,
          fixNotes: canSeePrivateAircraftData ? d.fix_notes : undefined,
          severity: d.severity,
          location: d.location,
          tachHours: d.tach_hours,
          hobbsHours: d.hobbs_hours
        });
        defectsMap.set(d.aircraft_id, aircraftDefects);
      });

      const ratesMap = new Map<string, { aircraft: any; instructor: any; rows: any[] }>();
      ratesData?.forEach(r => {
        const aircraftRates = ratesMap.get(r.aircraft_id) || { aircraft: {}, instructor: {}, rows: [] };
        const soloRate = parseFloat(r.solo_rate || 0);
        const dualRate = parseFloat(r.dual_rate || 0);
        const instructorComponent = Math.max(0, dualRate - soloRate);
        const flightTypeName = (r.flight_types?.name || '').toLowerCase();

        aircraftRates.rows.push({
          id: r.id,
          aircraftId: r.aircraft_id,
          flightTypeId: r.flight_type_id,
          flightTypeName: r.flight_types?.name,
          chargeType: r.charge_type,
          soloRate,
          dualRate,
          flatSurcharge: parseFloat(r.flat_surcharge || 0),
          weekendSurcharge: parseFloat(r.weekend_surcharge || 0),
          defaultPaymentMethodId: r.default_payment_method_id,
          defaultPaymentMethodName: r.payment_methods?.name,
          includedTaxes: parseFloat(r.included_taxes || 0),
        });

        if (flightTypeName.includes('pre') && flightTypeName.includes('paid')) {
          aircraftRates.aircraft.prepaid = soloRate;
          aircraftRates.instructor.prepaid = instructorComponent;
        } else if (flightTypeName.includes('payg') || flightTypeName.includes('pay as')) {
          aircraftRates.aircraft.payg = soloRate;
          aircraftRates.instructor.payg = instructorComponent;
        } else if (flightTypeName.includes('account') || flightTypeName.includes('invoice')) {
          aircraftRates.aircraft.account = soloRate;
          aircraftRates.instructor.account = instructorComponent;
        }

        ratesMap.set(r.aircraft_id, aircraftRates);
      });

      const combinedAircraft: Aircraft[] = (aircraftData || []).map(a => {
        const rates = ratesMap.get(a.id);
        return {
          id: a.id,
          registration: a.registration,
          make: a.make,
          model: a.model,
          type: a.type,
          status: a.status,
          hourlyRate: parseFloat(a.hourly_rate),
          totalHours: a.total_hours ? parseFloat(a.total_hours) : 0,
          lastMaintenance: a.last_maintenance ? new Date(a.last_maintenance) : undefined,
          nextMaintenance: a.next_maintenance ? new Date(a.next_maintenance) : undefined,
          seatCapacity: a.seat_capacity,
          fuelCapacity: a.fuel_capacity ? parseFloat(a.fuel_capacity) : undefined,
          emptyWeight: a.empty_weight ? parseFloat(a.empty_weight) : undefined,
          maxWeight: a.max_weight ? parseFloat(a.max_weight) : undefined,
          tachStart: a.total_hours ? parseFloat(a.total_hours) : 0,
          requiredEndorsementType: a.required_endorsement_type || null,
          requiredEndorsementTypes: Array.isArray(a.required_endorsement_types)
            ? a.required_endorsement_types.filter(Boolean)
            : a.required_endorsement_type
              ? [a.required_endorsement_type]
              : [],
          iconKey: a.icon_key || null,
          xeroTrackingCategoryId: a.xero_tracking_category_id || null,
          xeroTrackingCategoryName: a.xero_tracking_category_name || null,
          xeroTrackingOptionId: a.xero_tracking_option_id || null,
          xeroTrackingOptionName: a.xero_tracking_option_name || null,
          xeroTrackingLastSyncedAt: a.xero_tracking_last_synced_at ? new Date(a.xero_tracking_last_synced_at) : undefined,
          xeroTrackingSyncError: a.xero_tracking_sync_error || null,
          isArchived: Boolean(a.is_archived),
          archivedAt: a.archived_at ? new Date(a.archived_at) : undefined,
          archivedBy: a.archived_by || null,
          archiveReason: a.archive_reason || null,
          defects: defectsMap.get(a.id) || [],
          rates: rates?.rows || [],
          aircraftRates: rates?.aircraft,
          instructorRates: rates?.instructor
        };
      });

      if (canSeePrivateAircraftData) {
        staffAircraftCache = combinedAircraft;
      } else {
        publicAircraftCache = combinedAircraft;
      }
      setAircraft(combinedAircraft);
      setError(null);
    } catch (err) {
      console.error('Error fetching aircraft:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch aircraft');
      toast.error('Failed to load aircraft');
    } finally {
      setLoading(false);
    }
  };

  const reportDefect = async (defectData: Omit<Defect, 'id'>) => {
    try {
      const { error } = await supabase
        .from('defects')
        .insert({
          aircraft_id: defectData.aircraftId,
          reported_by: defectData.reportedBy,
          date_reported: defectData.dateReported.toISOString(),
          summary: defectData.summary ?? null,
          description: defectData.description,
          status: defectData.status,
          photos: defectData.photos ?? [],
          mel_notes: defectData.melNotes ?? null,
          severity: defectData.severity ?? null,
          location: defectData.location ?? null,
          tach_hours: defectData.tachHours ?? null,
          hobbs_hours: defectData.hobbsHours ?? null
        });

      if (error) throw error;

      await fetchAircraft();
    } catch (err) {
      console.error('Error reporting defect:', err);
      throw err;
    }
  };

  const updateDefect = async (
    defectId: string,
    updates: Partial<Defect>,
    userId?: string
  ) => {
    try {
      const { data: oldDefect } = await supabase
        .from('defects')
        .select('*')
        .eq('id', defectId)
        .single();

      const dbUpdates: any = {};
      if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.severity !== undefined) dbUpdates.severity = updates.severity;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.location !== undefined) dbUpdates.location = updates.location;
      if (updates.tachHours !== undefined) dbUpdates.tach_hours = updates.tachHours;
      if (updates.hobbsHours !== undefined) dbUpdates.hobbs_hours = updates.hobbsHours;

      dbUpdates.updated_at = new Date().toISOString();
      dbUpdates.updated_by = userId;

      const { error } = await supabase
        .from('defects')
        .update(dbUpdates)
        .eq('id', defectId);

      if (error) throw error;

      if (oldDefect) {
        const historyEntries = [];

        if (updates.summary !== undefined && oldDefect.summary !== updates.summary) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'summary',
            old_value: oldDefect.summary || '',
            new_value: updates.summary || ''
          });
        }

        if (updates.description !== undefined && oldDefect.description !== updates.description) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'description',
            old_value: oldDefect.description || '',
            new_value: updates.description || ''
          });
        }

        if (updates.severity !== undefined && oldDefect.severity !== updates.severity) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'severity',
            old_value: oldDefect.severity || '',
            new_value: updates.severity || ''
          });
        }

        if (updates.status !== undefined && oldDefect.status !== updates.status) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'status',
            old_value: oldDefect.status || '',
            new_value: updates.status || ''
          });
        }

        if (updates.location !== undefined && oldDefect.location !== updates.location) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'location',
            old_value: oldDefect.location || '',
            new_value: updates.location || ''
          });
        }

        if (updates.tachHours !== undefined && oldDefect.tach_hours !== updates.tachHours) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'tach_hours',
            old_value: oldDefect.tach_hours?.toString() || '',
            new_value: updates.tachHours?.toString() || ''
          });
        }

        if (updates.hobbsHours !== undefined && oldDefect.hobbs_hours !== updates.hobbsHours) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'hobbs_hours',
            old_value: oldDefect.hobbs_hours?.toString() || '',
            new_value: updates.hobbsHours?.toString() || ''
          });
        }

        if (historyEntries.length > 0) {
          await supabase.from('defect_history').insert(historyEntries);
        }
      }

      await fetchAircraft();
      toast.success('Defect updated successfully');
    } catch (err) {
      console.error('Error updating defect:', err);
      toast.error('Failed to update defect');
      throw err;
    }
  };

  const updateDefectStatus = async (
    defectId: string,
    updates: { status: Defect['status']; melNotes?: string; fixNotes?: string },
    userId?: string
  ) => {
    try {
      // Get old values for history
      const { data: oldDefect } = await supabase
        .from('defects')
        .select('status, mel_notes, fix_notes')
        .eq('id', defectId)
        .single();

      const { error } = await supabase
        .from('defects')
        .update({
          status: updates.status,
          mel_notes: updates.melNotes ?? null,
          fix_notes: updates.fixNotes ?? null,
          updated_at: new Date().toISOString(),
          updated_by: userId
        })
        .eq('id', defectId);

      if (error) throw error;

      // Track history
      if (oldDefect) {
        const historyEntries = [];
        if (oldDefect.status !== updates.status) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'status',
            old_value: oldDefect.status,
            new_value: updates.status
          });
        }
        if (updates.melNotes !== undefined && oldDefect.mel_notes !== updates.melNotes) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'mel_notes',
            old_value: oldDefect.mel_notes || '',
            new_value: updates.melNotes || ''
          });
        }
        if (updates.fixNotes !== undefined && oldDefect.fix_notes !== updates.fixNotes) {
          historyEntries.push({
            defect_id: defectId,
            changed_by: userId,
            field_name: 'fix_notes',
            old_value: oldDefect.fix_notes || '',
            new_value: updates.fixNotes || ''
          });
        }

        if (historyEntries.length > 0) {
          await supabase.from('defect_history').insert(historyEntries);
        }
      }

      await fetchAircraft();
      toast.success('Defect status updated');
    } catch (err) {
      console.error('Error updating defect status:', err);
      toast.error('Failed to update defect status');
      throw err;
    }
  };

  const getDefectHistory = async (defectId: string) => {
    try {
      const { data, error } = await supabase
        .from('defect_history')
        .select(`
          *,
          changed_by_user:changed_by(name, email)
        `)
        .eq('defect_id', defectId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (err) {
      console.error('Error fetching defect history:', err);
      return [];
    }
  };

  const addAircraft = async (aircraftData: Omit<Aircraft, 'id' | 'defects'> & {
    aircraftRates?: { prepaid: number; payg: number; account: number };
    instructorRates?: { prepaid: number; payg: number; account: number };
    rates?: Array<any>;
    milestones?: Array<{ title: string; dueCondition: string; dueValue: string }>;
    documents?: Array<{ name: string; type: string; size: number; documentType?: string }>;
  }) => {
    try {
      const { data: newAircraft, error } = await supabase
        .from('aircraft')
        .insert({
          registration: aircraftData.registration,
          make: aircraftData.make,
          model: aircraftData.model,
          type: aircraftData.type,
          status: aircraftData.status,
          hourly_rate: aircraftData.hourlyRate || 0,
          total_hours: aircraftData.totalHours || 0,
          last_maintenance: aircraftData.lastMaintenance,
          next_maintenance: aircraftData.nextMaintenance,
          seat_capacity: aircraftData.seatCapacity || 2,
          fuel_capacity: aircraftData.fuelCapacity || null,
          empty_weight: aircraftData.emptyWeight || null,
          max_weight: aircraftData.maxWeight || null,
          required_endorsement_type: aircraftData.requiredEndorsementTypes?.[0] || aircraftData.requiredEndorsementType || null,
          required_endorsement_types: aircraftData.requiredEndorsementTypes || (
            aircraftData.requiredEndorsementType ? [aircraftData.requiredEndorsementType] : []
          ),
          icon_key: aircraftData.iconKey || null,
          xero_tracking_category_id: aircraftData.xeroTrackingCategoryId || null,
          xero_tracking_category_name: aircraftData.xeroTrackingCategoryName || null,
          xero_tracking_option_id: aircraftData.xeroTrackingOptionId || null,
          xero_tracking_option_name: aircraftData.xeroTrackingOptionName || null,
          xero_tracking_last_synced_at: aircraftData.xeroTrackingLastSyncedAt
            ? aircraftData.xeroTrackingLastSyncedAt.toISOString()
            : null,
          xero_tracking_sync_error: aircraftData.xeroTrackingSyncError || null,
          is_archived: false
        })
        .select()
        .single();

      if (error) throw error;

      if (newAircraft && aircraftData.rates && aircraftData.rates.length > 0) {
        const ratesToInsert = aircraftData.rates.map(rate => ({
          aircraft_id: newAircraft.id,
          flight_type_id: rate.flightTypeId,
          charge_type: rate.chargeType,
          solo_rate: rate.soloRate || 0,
          dual_rate: rate.dualRate || 0,
          flat_surcharge: rate.flatSurcharge || 0,
          weekend_surcharge: rate.weekendSurcharge || 0,
          default_payment_method_id: rate.defaultPaymentMethodId || null,
          included_taxes: rate.includedTaxes || 0
        }));

        const { error: ratesError } = await supabase
          .from('aircraft_rates')
          .insert(ratesToInsert);

        if (ratesError) {
          console.error('Error saving aircraft rates:', ratesError);
        }
      }

      if (newAircraft && aircraftData.milestones && aircraftData.milestones.length > 0) {
        const { error: milestonesError } = await supabase.from('maintenance_milestones').insert(
          aircraftData.milestones.map(m => ({
            aircraft_id: newAircraft.id,
            title: m.title,
            due_condition: m.dueCondition,
            due_value: m.dueValue
          }))
        );
        if (milestonesError) {
          console.error('Error saving milestones:', milestonesError);
        }
      }

      if (newAircraft && aircraftData.documents && aircraftData.documents.length > 0) {
        const { error: documentsError } = await supabase.from('aircraft_documents').insert(
          aircraftData.documents.map(d => ({
            aircraft_id: newAircraft.id,
            filename: d.name,
            file_path: `/documents/${newAircraft.id}/${d.name}`,
            file_type: d.type,
            file_size: d.size,
            document_type: d.documentType || null,
            uploaded_by: null
          }))
        );
        if (documentsError) {
          console.error('Error saving documents:', documentsError);
        }
      }

      await fetchAircraft();
      toast.success('Aircraft added successfully');
    } catch (err) {
      console.error('Error adding aircraft:', err);
      toast.error('Failed to add aircraft');
      throw err;
    }
  };

  const updateAircraft = async (id: string, aircraftData: Partial<Omit<Aircraft, 'id' | 'defects'>> & {
    rates?: Array<any>;
    milestones?: Array<{ title: string; dueCondition: string; dueValue: string }>;
    documents?: Array<{ name: string; type: string; size: number; documentType?: string }>;
  }) => {
    try {
      const updateData: any = {};
      if (aircraftData.registration !== undefined) updateData.registration = aircraftData.registration;
      if (aircraftData.make !== undefined) updateData.make = aircraftData.make;
      if (aircraftData.model !== undefined) updateData.model = aircraftData.model;
      if (aircraftData.type !== undefined) updateData.type = aircraftData.type;
      if (aircraftData.status !== undefined) updateData.status = aircraftData.status;
      if (aircraftData.hourlyRate !== undefined) updateData.hourly_rate = aircraftData.hourlyRate;
      if (aircraftData.totalHours !== undefined) updateData.total_hours = aircraftData.totalHours;
      if (aircraftData.lastMaintenance !== undefined) updateData.last_maintenance = aircraftData.lastMaintenance;
      if (aircraftData.nextMaintenance !== undefined) updateData.next_maintenance = aircraftData.nextMaintenance;
      if (aircraftData.seatCapacity !== undefined) updateData.seat_capacity = aircraftData.seatCapacity;
      if (aircraftData.fuelCapacity !== undefined) updateData.fuel_capacity = aircraftData.fuelCapacity;
      if (aircraftData.emptyWeight !== undefined) updateData.empty_weight = aircraftData.emptyWeight;
      if (aircraftData.maxWeight !== undefined) updateData.max_weight = aircraftData.maxWeight;
      if (aircraftData.requiredEndorsementType !== undefined || aircraftData.requiredEndorsementTypes !== undefined) {
        const requiredTypes = aircraftData.requiredEndorsementTypes
          ?? (aircraftData.requiredEndorsementType ? [aircraftData.requiredEndorsementType] : []);
        updateData.required_endorsement_types = requiredTypes;
        updateData.required_endorsement_type = requiredTypes[0] || null;
      }
      if (aircraftData.iconKey !== undefined) updateData.icon_key = aircraftData.iconKey || null;
      if (aircraftData.xeroTrackingCategoryId !== undefined) updateData.xero_tracking_category_id = aircraftData.xeroTrackingCategoryId || null;
      if (aircraftData.xeroTrackingCategoryName !== undefined) updateData.xero_tracking_category_name = aircraftData.xeroTrackingCategoryName || null;
      if (aircraftData.xeroTrackingOptionId !== undefined) updateData.xero_tracking_option_id = aircraftData.xeroTrackingOptionId || null;
      if (aircraftData.xeroTrackingOptionName !== undefined) updateData.xero_tracking_option_name = aircraftData.xeroTrackingOptionName || null;
      if (aircraftData.xeroTrackingLastSyncedAt !== undefined) {
        updateData.xero_tracking_last_synced_at = aircraftData.xeroTrackingLastSyncedAt
          ? aircraftData.xeroTrackingLastSyncedAt.toISOString()
          : null;
      }
      if (aircraftData.xeroTrackingSyncError !== undefined) updateData.xero_tracking_sync_error = aircraftData.xeroTrackingSyncError || null;
      if (aircraftData.isArchived !== undefined) updateData.is_archived = aircraftData.isArchived;
      if (aircraftData.archivedAt !== undefined) updateData.archived_at = aircraftData.archivedAt ? aircraftData.archivedAt.toISOString() : null;
      if (aircraftData.archivedBy !== undefined) updateData.archived_by = aircraftData.archivedBy || null;
      if (aircraftData.archiveReason !== undefined) updateData.archive_reason = aircraftData.archiveReason || null;

      const { error } = await supabase
        .from('aircraft')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;

      if (aircraftData.rates !== undefined) {
        const { error: deleteError } = await supabase
          .from('aircraft_rates')
          .delete()
          .eq('aircraft_id', id);

        if (deleteError) {
          console.error('Error deleting old rates:', deleteError);
        }

        if (aircraftData.rates.length > 0) {
          const ratesToInsert = aircraftData.rates.map(rate => ({
            aircraft_id: id,
            flight_type_id: rate.flightTypeId,
            charge_type: rate.chargeType,
            solo_rate: rate.soloRate || 0,
            dual_rate: rate.dualRate || 0,
            flat_surcharge: rate.flatSurcharge || 0,
            weekend_surcharge: rate.weekendSurcharge || 0,
            default_payment_method_id: rate.defaultPaymentMethodId || null,
            included_taxes: rate.includedTaxes || 0
          }));

          const { error: insertError } = await supabase
            .from('aircraft_rates')
            .insert(ratesToInsert);

          if (insertError) {
            console.error('Error inserting new rates:', insertError);
          }
        }
      }

      // Insert any newly-added milestones
      if (aircraftData.milestones && aircraftData.milestones.length > 0) {
        const { error: milestonesError } = await supabase.from('maintenance_milestones').insert(
          aircraftData.milestones.map(m => ({
            aircraft_id: id,
            title: m.title,
            due_condition: m.dueCondition,
            due_value: m.dueValue,
          }))
        );
        if (milestonesError) console.error('Error saving milestones:', milestonesError);
      }

      if (aircraftData.documents && aircraftData.documents.length > 0) {
        const { error: documentsError } = await supabase.from('aircraft_documents').insert(
          aircraftData.documents.map(d => ({
            aircraft_id: id,
            filename: d.name,
            file_path: `/documents/${id}/${d.name}`,
            file_type: d.type,
            file_size: d.size,
            document_type: d.documentType || null,
            uploaded_by: null
          }))
        );
        if (documentsError) console.error('Error saving documents:', documentsError);
      }

      await fetchAircraft();
      toast.success('Aircraft updated successfully');
    } catch (err) {
      console.error('Error updating aircraft:', err);
      toast.error('Failed to update aircraft');
      throw err;
    }
  };

  const deleteAircraft = async (id: string) => {
    try {
      const { error } = await supabase
        .from('aircraft')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user?.id || null,
          archive_reason: 'Archived from fleet'
        })
        .eq('id', id);

      if (error) throw error;

      staffAircraftCache = null;
      publicAircraftCache = null;
      await fetchAircraft();
      toast.success('Aircraft archived');
    } catch (err) {
      console.error('Error archiving aircraft:', err);
      toast.error('Failed to archive aircraft');
      throw err;
    }
  };

  const archiveAircraft = async (id: string, userId?: string, reason?: string) => {
    try {
      const { error } = await supabase
        .from('aircraft')
        .update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: userId || null,
          archive_reason: reason?.trim() || null
        })
        .eq('id', id);

      if (error) throw error;

      staffAircraftCache = null;
      publicAircraftCache = null;
      await fetchAircraft();
      toast.success('Aircraft archived');
    } catch (err) {
      console.error('Error archiving aircraft:', err);
      toast.error('Failed to archive aircraft');
      throw err;
    }
  };

  const restoreAircraft = async (id: string) => {
    try {
      const { error } = await supabase
        .from('aircraft')
        .update({
          is_archived: false,
          archived_at: null,
          archived_by: null,
          archive_reason: null
        })
        .eq('id', id);

      if (error) throw error;

      staffAircraftCache = null;
      publicAircraftCache = null;
      await fetchAircraft();
      toast.success('Aircraft restored');
    } catch (err) {
      console.error('Error restoring aircraft:', err);
      toast.error('Failed to restore aircraft');
      throw err;
    }
  };

  const deleteDefect = async (defectId: string) => {
    try {
      const { data: defect, error: fetchError } = await supabase
        .from('defects')
        .select('photos')
        .eq('id', defectId)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching defect:', fetchError);
        throw fetchError;
      }

      if (defect?.photos && Array.isArray(defect.photos)) {
        for (const photoPath of defect.photos) {
          try {
            const { error: storageError } = await supabase.storage
              .from(DEFECT_ATTACHMENT_BUCKET)
              .remove([getDefectAttachmentPath(photoPath)]);

            if (storageError) {
              console.warn('Error deleting photo from storage:', storageError);
            }
          } catch (photoErr) {
            console.warn('Failed to delete photo:', photoErr);
          }
        }
      }

      const { error } = await supabase
        .from('defects')
        .delete()
        .eq('id', defectId);

      if (error) {
        console.error('Error deleting defect from database:', error);
        throw error;
      }

      await fetchAircraft();
      toast.success('Defect deleted successfully');
    } catch (err) {
      console.error('Error deleting defect:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete defect';
      toast.error(errorMessage);
      throw err;
    }
  };

  useEffect(() => {
    const cachedAircraft = canSeePrivateAircraftData ? staffAircraftCache : publicAircraftCache;
    if (cachedAircraft) {
      setAircraft(cachedAircraft);
      setLoading(false);
    }
    fetchAircraft();
  }, [canSeePrivateAircraftData]);

  return {
    aircraft,
    loading,
    error,
    reportDefect,
    updateDefect,
    updateDefectStatus,
    getDefectHistory,
    addAircraft,
    updateAircraft,
    deleteAircraft,
    archiveAircraft,
    restoreAircraft,
    deleteDefect,
    refetch: fetchAircraft
  };
};
