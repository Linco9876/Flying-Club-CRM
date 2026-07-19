import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin, ShieldCheck, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

type StaffRow = { id: string; name: string; email: string; roles: string[] };
type RequirementDraft = { enabled: boolean; locations: string; preflightMinutes: number; postflightMinutes: number; notes: string };
type AuthorisationDraft = { enabled: boolean; priority: number; locations: string; maximumConcurrent: number; remoteAllowed: boolean; qualificationExpiresOn: string; notes: string };

export const DutySupervisionSettings: React.FC<{ canEdit?: boolean; onFormChange?: () => void }> = ({ canEdit = false, onFormChange }) => {
  const { user } = useAuth();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [requirements, setRequirements] = useState<Record<string, RequirementDraft>>({});
  const [authorisations, setAuthorisations] = useState<Record<string, AuthorisationDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: roleRows, error: roleError }, { data: requirementRows, error: requirementError }, { data: authorisationRows, error: authorisationError }] = await Promise.all([
        supabase.from('user_roles').select('user_id,role').in('role', ['admin', 'senior_instructor', 'instructor']),
        supabase.from('instructor_supervision_requirements').select('*'),
        supabase.from('senior_instructor_authorisations').select('*'),
      ]);
      if (roleError) throw roleError;
      if (requirementError) throw requirementError;
      if (authorisationError) throw authorisationError;
      const ids = Array.from(new Set((roleRows || []).map(row => row.user_id)));
      const { data: users, error: usersError } = ids.length
        ? await supabase.from('users').select('id,name,email').in('id', ids).eq('is_active', true).order('name')
        : { data: [] as Array<{ id: string; name: string; email: string }>, error: null };
      if (usersError) throw usersError;
      const rolesByUser = new Map<string, string[]>();
      (roleRows || []).forEach(row => rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) || []), row.role]));
      setStaff((users || []).map(row => ({ ...row, roles: rolesByUser.get(row.id) || [] })));
      setRequirements(Object.fromEntries((users || []).map(row => {
        const saved = (requirementRows || []).find(value => value.instructor_id === row.id);
        return [row.id, {
          enabled: Boolean(saved?.supervision_required),
          locations: (saved?.locations || []).join(', '),
          preflightMinutes: Number(saved?.preflight_minutes ?? 30),
          postflightMinutes: Number(saved?.postflight_minutes ?? 30),
          notes: saved?.notes || '',
        }];
      })));
      setAuthorisations(Object.fromEntries((users || []).map((row, index) => {
        const saved = (authorisationRows || []).find(value => value.instructor_id === row.id);
        return [row.id, {
          enabled: Boolean(saved?.is_active),
          priority: Number(saved?.priority ?? index + 1),
          locations: (saved?.locations || []).join(', '),
          maximumConcurrent: Number(saved?.maximum_concurrent ?? 1),
          remoteAllowed: Boolean(saved?.remote_supervision_allowed),
          qualificationExpiresOn: saved?.qualification_expires_on || '',
          notes: saved?.notes || '',
        }];
      })));
    } catch (error) {
      console.error('Failed to load duty and supervision settings', error);
      toast.error('Duty and supervision settings could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const parseLocations = (value: string) => Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)));
  const markChanged = () => onFormChange?.();
  const updateRequirement = (id: string, patch: Partial<RequirementDraft>) => {
    setRequirements(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    markChanged();
  };
  const updateAuthorisation = (id: string, patch: Partial<AuthorisationDraft>) => {
    setAuthorisations(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    markChanged();
  };

  const save = React.useCallback(async () => {
    if (!user?.id || !canEdit) return;
    setSaving(true);
    try {
      for (const person of staff) {
        const requirement = requirements[person.id];
        if (requirement?.enabled) {
          const { error } = await supabase.from('instructor_supervision_requirements').upsert({
            instructor_id: person.id,
            supervision_required: true,
            activity_types: ['flight'],
            locations: parseLocations(requirement.locations),
            preflight_minutes: Math.max(0, requirement.preflightMinutes),
            postflight_minutes: Math.max(0, requirement.postflightMinutes),
            notes: requirement.notes.trim() || null,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'instructor_id' });
          if (error) throw error;
        } else {
          const { error } = await supabase.from('instructor_supervision_requirements').delete().eq('instructor_id', person.id);
          if (error) throw error;
        }

        const authorisation = authorisations[person.id];
        if (authorisation?.enabled) {
          const { error } = await supabase.from('senior_instructor_authorisations').upsert({
            instructor_id: person.id,
            is_active: true,
            priority: Math.max(1, Math.round(authorisation.priority)),
            locations: parseLocations(authorisation.locations),
            activity_types: ['flight'],
            maximum_concurrent: Math.max(1, Math.round(authorisation.maximumConcurrent)),
            remote_supervision_allowed: authorisation.remoteAllowed,
            qualification_expires_on: authorisation.qualificationExpiresOn || null,
            notes: authorisation.notes.trim() || null,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'instructor_id' });
          if (error) throw error;
        } else {
          const { error } = await supabase.from('senior_instructor_authorisations').delete().eq('instructor_id', person.id);
          if (error) throw error;
        }
      }
      toast.success('Duty and supervision settings saved');
      await load();
    } finally {
      setSaving(false);
    }
  }, [authorisations, canEdit, load, requirements, staff, user?.id]);

  useEffect(() => {
    const settingsWindow = window as Window & { __dutysupervisionSettingsSave?: () => Promise<void>; __dutysupervisionSettingsCancel?: () => Promise<void> };
    settingsWindow.__dutysupervisionSettingsSave = save;
    settingsWindow.__dutysupervisionSettingsCancel = load;
    return () => {
      delete settingsWindow.__dutysupervisionSettingsSave;
      delete settingsWindow.__dutysupervisionSettingsCancel;
    };
  }, [load, save]);

  const authorisedCount = useMemo(() => Object.values(authorisations).filter(value => value.enabled).length, [authorisations]);
  const supervisedCount = useMemo(() => Object.values(requirements).filter(value => value.enabled).length, [requirements]);

  if (loading) return <div className="p-8 text-center text-sm text-gray-500">Loading supervision settings…</div>;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-bold text-gray-950">Duty and supervision</h2></div>
        <p className="mt-1 text-sm text-gray-600">Designate instructors who require supervision and rank the senior instructors authorised to provide it.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Require supervision</p><p className="mt-1 text-2xl font-bold text-gray-950">{supervisedCount}</p></div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4"><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Authorised seniors</p><p className="mt-1 text-2xl font-bold text-gray-950">{authorisedCount}</p></div>
        <div className={`rounded-xl border p-4 ${supervisedCount > 0 && authorisedCount === 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="text-xs font-bold uppercase tracking-wide text-gray-500">Coverage setup</p><p className="mt-1 flex items-center gap-2 font-bold text-gray-950">{supervisedCount > 0 && authorisedCount === 0 ? <><AlertTriangle className="h-5 w-5 text-amber-600" /> Needs attention</> : <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Configured</>}</p></div>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2"><Users className="h-5 w-5 text-indigo-600" /><div><h3 className="font-bold text-gray-950">Instructor supervision requirements</h3><p className="text-xs text-gray-500">Only flight bookings are included. Blank locations mean all locations.</p></div></div>
        <div className="space-y-3">
          {staff.map(person => {
            const value = requirements[person.id];
            if (!value) return null;
            return (
              <div key={person.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-gray-950">{person.name}</p><p className="text-xs text-gray-500">{person.email}</p></div><label className="flex items-center gap-2 text-sm font-bold text-gray-700"><input type="checkbox" disabled={!canEdit} checked={value.enabled} onChange={event => updateRequirement(person.id, { enabled: event.target.checked })} className="h-4 w-4" /> Requires supervision</label></div>
                {value.enabled && <div className="mt-4 grid gap-3 sm:grid-cols-4"><label className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-gray-500"><MapPin className="mr-1 inline h-3.5 w-3.5" /> Locations<input disabled={!canEdit} value={value.locations} onChange={event => updateRequirement(person.id, { locations: event.target.value })} placeholder="Blank = all; or Bendigo, Shepparton" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal normal-case tracking-normal" /></label><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Pre-flight coverage<input disabled={!canEdit} type="number" min="0" value={value.preflightMinutes} onChange={event => updateRequirement(person.id, { preflightMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Post-flight coverage<input disabled={!canEdit} type="number" min="0" value={value.postflightMinutes} onChange={event => updateRequirement(person.id, { postflightMinutes: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label></div>}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3"><h3 className="font-bold text-gray-950">Authorised senior instructors</h3><p className="text-xs text-gray-500">The lowest priority number is tried first. Eligibility, availability, coverage location and capacity are checked before priority.</p></div>
        <div className="space-y-3">
          {staff.map(person => {
            const value = authorisations[person.id];
            if (!value) return null;
            return (
              <div key={person.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-gray-950">{person.name}</p><p className="text-xs text-gray-500">{person.roles.join(', ').replaceAll('_', ' ')}</p></div><label className="flex items-center gap-2 text-sm font-bold text-gray-700"><input type="checkbox" disabled={!canEdit} checked={value.enabled} onChange={event => updateAuthorisation(person.id, { enabled: event.target.checked })} className="h-4 w-4" /> Authorised to supervise</label></div>
                {value.enabled && <div className="mt-4 grid gap-3 sm:grid-cols-6"><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Priority<input disabled={!canEdit} type="number" min="1" value={value.priority} onChange={event => updateAuthorisation(person.id, { priority: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Capacity<input disabled={!canEdit} type="number" min="1" max="20" value={value.maximumConcurrent} onChange={event => updateAuthorisation(person.id, { maximumConcurrent: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label><label className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-gray-500">Locations<input disabled={!canEdit} value={value.locations} onChange={event => updateAuthorisation(person.id, { locations: event.target.value })} placeholder="Blank = all" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal normal-case tracking-normal" /></label><label className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-gray-500">Qualification expiry<input disabled={!canEdit} type="date" value={value.qualificationExpiresOn} onChange={event => updateAuthorisation(person.id, { qualificationExpiresOn: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal" /></label><label className="sm:col-span-6 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" disabled={!canEdit} checked={value.remoteAllowed} onChange={event => updateAuthorisation(person.id, { remoteAllowed: event.target.checked })} /> Remote supervision is permitted by club policy</label></div>}
              </div>
            );
          })}
        </div>
      </section>

      {saving && <p className="text-sm font-semibold text-blue-700">Saving and reassessing future bookings…</p>}
    </div>
  );
};

export default DutySupervisionSettings;
