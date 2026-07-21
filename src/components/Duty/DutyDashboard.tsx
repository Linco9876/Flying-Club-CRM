import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock3, Coffee, Download, Edit3, History, LogIn, LogOut, Plus, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { DutyPeriod } from '../../types';
import { DutyPeriodInput, useDuty } from '../../hooks/useDuty';
import { DutyTimePicker } from './DutyTimePicker';

type StaffOption = { id: string; name: string };
type SupervisionBooking = { id: string; instructorId: string; instructorName: string; startTime: Date; endTime: Date; location: string; status: string; supervisionStatus: string };
type SupervisionBookingRow = { id: string; instructor_id: string; start_time: string; end_time: string; location?: string; status: string; supervision_status: string };
type LoggedFlightSummary = { minutes: number; count: number; loading: boolean; error?: string };
type BreakDraft = {
  breakStart: string;
  breakEnd: string;
  breakType: 'break' | 'rest' | 'split_duty_rest';
  freeOfDuty: boolean;
  affectsCalculation: boolean;
  facility: string;
  notes: string;
};

type FormState = {
  id?: string;
  instructorId: string;
  dutyDate: string;
  actualStart: string;
  actualEnd: string;
  plannedStart: string;
  plannedEnd: string;
  location: string;
  status: DutyPeriod['status'];
  isExternal: boolean;
  externalOrganisation: string;
  flightHours: string;
  notes: string;
  amendmentReason: string;
  fitForDuty: boolean;
  externalDutyDeclared: boolean;
  sleepOpportunityConfirmed: boolean;
  kssScore: string;
  privateNote: string;
  breaks: BreakDraft[];
};

const toLocalInput = (date?: Date) => date ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
const fromLocalInput = (value: string) => value ? new Date(value) : undefined;
const hoursFromMinutes = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
const readableMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} h` : '', remainder ? `${remainder} min` : ''].filter(Boolean).join(' ') || '0 min';
};

const emptyForm = (instructorId: string, mode: 'record' | 'start' = 'record'): FormState => {
  const now = new Date();
  return {
    instructorId,
    dutyDate: format(now, 'yyyy-MM-dd'),
    actualStart: mode === 'start' ? toLocalInput(now) : '',
    actualEnd: '',
    plannedStart: '',
    plannedEnd: '',
    location: 'Bendigo',
    status: mode === 'start' ? 'active' : 'completed',
    isExternal: false,
    externalOrganisation: '',
    flightHours: '0',
    notes: '',
    amendmentReason: '',
    fitForDuty: true,
    externalDutyDeclared: false,
    sleepOpportunityConfirmed: true,
    kssScore: '',
    privateNote: '',
    breaks: [],
  };
};

export const DutyDashboard: React.FC = () => {
  const { user } = useAuth();
  const roles = user?.roles?.length ? user.roles : user?.role ? [user.role] : [];
  const admin = roles.includes('admin');
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selectedInstructorId, setSelectedInstructorId] = useState(user?.id || '');
  const { periods, loading, savePeriod, endDuty } = useDuty(selectedInstructorId);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [flightTimeTouched, setFlightTimeTouched] = useState(false);
  const [loggedFlightSummary, setLoggedFlightSummary] = useState<LoggedFlightSummary>({ minutes: 0, count: 0, loading: false });
  const [assignedSupervision, setAssignedSupervision] = useState<SupervisionBooking[]>([]);
  const [uncoveredBookings, setUncoveredBookings] = useState<SupervisionBooking[]>([]);

  const loadSupervision = React.useCallback(async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    const assignedResponse = await supabase.from('bookings').select('id,instructor_id,start_time,end_time,location,status,supervision_status').eq('supervising_instructor_id', user.id).gte('end_time', now).in('status', ['confirmed', 'pending_approval']).order('start_time');
    const uncoveredResponse = admin
      ? await supabase.from('bookings').select('id,instructor_id,start_time,end_time,location,status,supervision_status').eq('supervision_required', true).eq('supervision_status', 'pending').gte('end_time', now).order('start_time')
      : { data: [] as SupervisionBookingRow[], error: null };
    if (assignedResponse.error || uncoveredResponse.error) return;
    const rows = [...(assignedResponse.data || []), ...(uncoveredResponse.data || [])];
    const ids = Array.from(new Set(rows.map(row => row.instructor_id).filter(Boolean)));
    const { data: users } = ids.length ? await supabase.from('users').select('id,name').in('id', ids) : { data: [] as StaffOption[] };
    const names = new Map((users || []).map(row => [row.id, row.name]));
    const mapRow = (row: SupervisionBookingRow): SupervisionBooking => ({ id: row.id, instructorId: row.instructor_id, instructorName: names.get(row.instructor_id) || 'Instructor', startTime: new Date(row.start_time), endTime: new Date(row.end_time), location: row.location || 'Bendigo', status: row.status, supervisionStatus: row.supervision_status });
    setAssignedSupervision((assignedResponse.data || []).map(mapRow));
    setUncoveredBookings((uncoveredResponse.data || []).map(mapRow));
  }, [admin, user?.id]);

  useEffect(() => {
    const loadStaff = async () => {
      const { data: roleRows } = await supabase.from('user_roles').select('user_id,role').in('role', ['admin', 'senior_instructor', 'instructor']);
      const ids = Array.from(new Set((roleRows || []).map(row => row.user_id)));
      const { data } = ids.length
        ? await supabase.from('users').select('id,name').in('id', ids).eq('is_active', true).order('name')
        : { data: [] as StaffOption[] };
      setStaff((data || []) as StaffOption[]);
      if (admin && !selectedInstructorId && data?.[0]) setSelectedInstructorId(data[0].id);
    };
    void loadStaff();
  }, [admin, selectedInstructorId]);

  useEffect(() => {
    void loadSupervision();
    const channel = supabase.channel(`duty-supervision-${user?.id || 'none'}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => void loadSupervision()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadSupervision, user?.id]);

  const activePeriod = periods.find(period => period.status === 'active');
  const completedThisMonth = useMemo(() => {
    const month = format(new Date(), 'yyyy-MM');
    return periods.filter(period => period.status === 'completed' && period.dutyDate.startsWith(month));
  }, [periods]);
  const monthDutyHours = completedThisMonth.reduce((total, period) => {
    const start = period.actualStart || period.plannedStart;
    const end = period.actualEnd || period.plannedEnd;
    return total + (start && end ? Math.max(0, end.getTime() - start.getTime()) / 3_600_000 : 0);
  }, 0);

  const openNew = (mode: 'record' | 'start') => {
    setFlightTimeTouched(false);
    setLoggedFlightSummary({ minutes: 0, count: 0, loading: true });
    setForm(emptyForm(selectedInstructorId, mode));
  };

  const openEdit = (period: DutyPeriod) => {
    setFlightTimeTouched(period.status !== 'active');
    setLoggedFlightSummary({ minutes: 0, count: 0, loading: true });
    setForm({
    id: period.id,
    instructorId: period.instructorId,
    dutyDate: period.dutyDate,
    actualStart: toLocalInput(period.actualStart),
    actualEnd: toLocalInput(period.actualEnd),
    plannedStart: toLocalInput(period.plannedStart),
    plannedEnd: toLocalInput(period.plannedEnd),
    location: period.location,
    status: period.status,
    isExternal: period.isExternal,
    externalOrganisation: period.externalOrganisation || '',
    flightHours: hoursFromMinutes(period.flightMinutes),
    notes: period.notes || '',
    amendmentReason: '',
    fitForDuty: true,
    externalDutyDeclared: period.isExternal,
    sleepOpportunityConfirmed: true,
    kssScore: '',
    privateNote: '',
    breaks: period.breaks.map(item => ({
      breakStart: toLocalInput(item.breakStart),
      breakEnd: toLocalInput(item.breakEnd),
      breakType: item.breakType,
      freeOfDuty: item.freeOfDuty,
      affectsCalculation: item.affectsCalculation,
      facility: item.facility || '',
      notes: item.notes || '',
    })),
    });
  };

  useEffect(() => {
    if (!form?.instructorId || !form.dutyDate) return;
    let cancelled = false;
    setLoggedFlightSummary(current => ({ ...current, loading: true, error: undefined }));

    const loadLoggedFlightTime = async () => {
      const { data, error } = await supabase.rpc('get_logged_instructor_flight_summary', {
        p_instructor_id: form.instructorId,
        p_duty_date: form.dutyDate,
      });
      if (cancelled) return;
      if (error) {
        setLoggedFlightSummary({ minutes: 0, count: 0, loading: false, error: 'Logged flight time could not be loaded' });
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      const minutes = Number(row?.flight_minutes || 0);
      const count = Number(row?.flight_count || 0);
      setLoggedFlightSummary({ minutes, count, loading: false });
      if ((!form.id || form.status === 'active') && !flightTimeTouched) {
        setForm(current => current && current.instructorId === form.instructorId && current.dutyDate === form.dutyDate
          ? { ...current, flightHours: hoursFromMinutes(minutes) }
          : current);
      }
    };

    void loadLoggedFlightTime();
    return () => { cancelled = true; };
  }, [flightTimeTouched, form?.dutyDate, form?.id, form?.instructorId, form?.status]);

  const submit = async () => {
    if (!form) return;
    if (!form.actualStart && !form.plannedStart) {
      toast.error('Enter an actual or planned duty start');
      return;
    }
    if (form.status === 'completed' && !form.actualEnd) {
      toast.error('Completed duty requires an actual end time');
      return;
    }
    const invalidBreak = form.breaks.some(item => !item.breakStart || !item.breakEnd || new Date(item.breakEnd) <= new Date(item.breakStart));
    if (invalidBreak) {
      toast.error('Every break needs a valid start and end');
      return;
    }
    setSaving(true);
    try {
      const input: DutyPeriodInput = {
        id: form.id,
        instructorId: form.instructorId,
        dutyDate: form.dutyDate,
        actualStart: fromLocalInput(form.actualStart),
        actualEnd: fromLocalInput(form.actualEnd),
        plannedStart: fromLocalInput(form.plannedStart),
        plannedEnd: fromLocalInput(form.plannedEnd),
        location: form.location,
        status: form.status,
        isExternal: form.isExternal,
        externalOrganisation: form.externalOrganisation,
        flightMinutes: Math.round(Math.max(0, Number(form.flightHours) || 0) * 60),
        notes: form.notes,
        amendmentReason: form.amendmentReason,
        breaks: form.breaks.map(item => ({
          breakStart: new Date(item.breakStart),
          breakEnd: new Date(item.breakEnd),
          breakType: item.breakType,
          freeOfDuty: item.freeOfDuty,
          affectsCalculation: item.affectsCalculation,
          facility: item.facility,
          notes: item.notes,
        })),
        ...(!form.id && form.status === 'active' ? { declaration: {
          fitForDuty: form.fitForDuty,
          externalDutyDeclared: form.externalDutyDeclared,
          sleepOpportunityConfirmed: form.sleepOpportunityConfirmed,
          kssScore: form.kssScore ? Number(form.kssScore) : undefined,
          privateNote: form.privateNote,
        } } : {}),
      };
      await savePeriod(input);
      setForm(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Duty record could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const exportAudit = async () => {
    const { data, error } = await supabase.from('operations_audit_events').select('created_at,entity_type,entity_id,action,actor_id,metadata').order('created_at', { ascending: false }).limit(5000);
    if (error) { toast.error('Audit export could not be prepared'); return; }
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [['Timestamp', 'Entity type', 'Entity ID', 'Action', 'Actor ID', 'Metadata'], ...(data || []).map(row => [row.created_at, row.entity_type, row.entity_id, row.action, row.actor_id, JSON.stringify(row.metadata || {})])].map(row => row.map(escape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `duty-supervision-audit-${format(new Date(), 'yyyy-MM-dd')}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-3 sm:p-6 dark:bg-[#0f1117]">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Operations</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950 dark:text-gray-100">Duty</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">Actual duty records are the historical source of truth. Bookings are used only to forecast a proposed duty day.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {admin && <button type="button" onClick={() => void exportAudit()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"><Download className="h-4 w-4" /> Audit CSV</button>}
            <button type="button" onClick={() => openNew('record')} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
              <Plus className="h-4 w-4" /> Add record
            </button>
            {!activePeriod && (
              <button type="button" onClick={() => openNew('start')} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
                <LogIn className="h-4 w-4" /> Start duty
              </button>
            )}
          </div>
        </div>

        {admin && (
          <label className="block max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Instructor</span>
            <select value={selectedInstructorId} onChange={event => setSelectedInstructorId(event.target.value)} className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {staff.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-600">Current status</span><Clock3 className="h-5 w-5 text-blue-500" /></div>
            <p className="mt-2 text-xl font-bold text-gray-950">{activePeriod ? 'On duty' : 'Off duty'}</p>
            {activePeriod?.actualStart && <p className="mt-1 text-xs text-gray-500">Started {format(activePeriod.actualStart, 'dd MMM, HH:mm')}</p>}
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-600">This month</span><History className="h-5 w-5 text-indigo-500" /></div>
            <p className="mt-2 text-xl font-bold text-gray-950">{monthDutyHours.toFixed(1)} hours</p>
            <p className="mt-1 text-xs text-gray-500">{completedThisMonth.length} completed duty periods</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold text-gray-600">Data quality</span><ShieldCheck className="h-5 w-5 text-emerald-500" /></div>
            <p className="mt-2 text-xl font-bold text-gray-950">Actual + forecast</p>
            <p className="mt-1 text-xs text-gray-500">Recorded duty is never replaced by booking time</p>
          </div>
        </div>

        {activePeriod && (
          <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-bold text-blue-950">Duty is currently active</p><p className="text-sm text-blue-800">{activePeriod.entrySource === 'automatic_booking' ? 'Started automatically 30 minutes before your flight. Clock out when your duty finishes.' : 'Remember to add breaks and actual flight time before ending duty.'}</p></div>
            <button type="button" onClick={() => void endDuty(activePeriod).catch(error => toast.error(error.message))} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"><LogOut className="h-4 w-4" /> End duty now</button>
          </div>
        )}

        {(assignedSupervision.length > 0 || uncoveredBookings.length > 0) && (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-4 py-3"><h2 className="font-bold text-gray-950">My supervision assignments</h2><p className="text-xs text-gray-500">Acknowledge that you have seen each assigned flight.</p></div>
              <div className="divide-y divide-gray-100">
                {assignedSupervision.length === 0 ? <p className="p-4 text-sm text-gray-500">No upcoming assignments.</p> : assignedSupervision.map(booking => <div key={booking.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-gray-950">{booking.instructorName}</p><p className="text-sm text-gray-600">{format(booking.startTime, 'dd MMM, HH:mm')}–{format(booking.endTime, 'HH:mm')} · {booking.location}</p></div>{booking.supervisionStatus === 'acknowledged' ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800">Acknowledged</span> : <button type="button" onClick={async () => { const { error } = await supabase.rpc('acknowledge_booking_supervision', { p_booking_id: booking.id }); if (error) toast.error(error.message); else { toast.success('Supervision acknowledged'); await loadSupervision(); } }} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">Acknowledge</button>}</div></div>)}
              </div>
            </div>
            {admin && <div className="overflow-hidden rounded-xl border border-orange-200 bg-white shadow-sm"><div className="border-b border-orange-200 bg-orange-50 px-4 py-3"><h2 className="font-bold text-orange-950">Uncovered supervision</h2><p className="text-xs text-orange-800">These bookings remain pending until coverage is available.</p></div><div className="divide-y divide-orange-100">{uncoveredBookings.length === 0 ? <p className="p-4 text-sm text-gray-500">All required flights have coverage.</p> : uncoveredBookings.map(booking => <div key={booking.id} className="p-4"><p className="font-bold text-gray-950">{booking.instructorName}</p><p className="text-sm text-gray-600">{format(booking.startTime, 'dd MMM, HH:mm')}–{format(booking.endTime, 'HH:mm')} · {booking.location}</p><p className="mt-1 text-xs font-semibold text-orange-700">Pending supervision</p></div>)}</div></div>}
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3"><h2 className="font-bold text-gray-950">Duty history</h2></div>
          {loading ? <div className="p-8 text-center text-sm text-gray-500">Loading duty records…</div> : periods.length === 0 ? (
            <div className="p-10 text-center"><Clock3 className="mx-auto h-8 w-8 text-gray-300" /><p className="mt-3 font-semibold text-gray-700">No duty periods recorded</p><p className="mt-1 text-sm text-gray-500">Start duty or add a previous duty record.</p></div>
          ) : (
            <div className="divide-y divide-gray-100">
              {periods.map(period => {
                const start = period.actualStart || period.plannedStart;
                const end = period.actualEnd || period.plannedEnd;
                const hours = start && end ? (end.getTime() - start.getTime()) / 3_600_000 : null;
                return (
                  <article key={period.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-gray-950">{format(new Date(`${period.dutyDate}T12:00:00`), 'EEE, dd MMM yyyy')}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${period.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : period.status === 'active' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>{period.status}</span>
                        {period.isExternal && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-800">External duty</span>}
                        {period.entrySource === 'automatic_booking' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">Automatic start</span>}
                        {period.entrySource === 'mobile' && <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-bold text-cyan-800">Mobile clock</span>}
                        {period.autoClosedAtLimit && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Maximum assumed</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-700">{start ? format(start, 'HH:mm') : '—'} – {end ? format(end, 'HH:mm') : 'In progress'}{hours !== null ? ` · ${hours.toFixed(1)} h` : ''}</p>
                      <p className="mt-1 text-xs text-gray-500">{period.location} · {(period.flightMinutes / 60).toFixed(1)} flight h · {period.breaks.length} {period.breaks.length === 1 ? 'break' : 'breaks'}</p>
                    </div>
                    <button type="button" onClick={() => openEdit(period)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"><Edit3 className="h-4 w-4" /> Edit</button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {form && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3">
          <div className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
              <div><h2 className="text-lg font-bold text-gray-950">{form.id ? 'Edit duty period' : form.status === 'active' ? 'Start duty' : 'Add duty period'}</h2><p className="text-xs text-gray-500">{form.status === 'active' && !form.id ? 'Confirm you are fit, then record your start time.' : 'Enter when duty started and finished. Logged flight time is filled automatically.'}</p></div>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-5 overflow-y-auto p-5">
              {!form.id && form.status === 'active' && (
                <div className={`rounded-xl border p-4 ${form.fitForDuty ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="flex items-center gap-2">{form.fitForDuty ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}<h3 className="font-bold text-gray-950">Pre-duty declaration</h3></div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-gray-700">Fit for duty<select value={String(form.fitForDuty)} onChange={event => setForm({ ...form, fitForDuty: event.target.value === 'true' })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="true">Yes</option><option value="false">No</option></select></label>
                    <label className="text-sm font-semibold text-gray-700">KSS sleepiness (optional)<select value={form.kssScore} onChange={event => setForm({ ...form, kssScore: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="">Not entered</option>{Array.from({ length: 9 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
                  </div>
                  <div className="mt-3 flex flex-col gap-2 text-sm text-gray-700 sm:flex-row sm:gap-5"><label className="flex items-center gap-2"><input type="checkbox" checked={form.externalDutyDeclared} onChange={event => setForm({ ...form, externalDutyDeclared: event.target.checked })} /> Relevant external duty has been entered</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.sleepOpportunityConfirmed} onChange={event => setForm({ ...form, sleepOpportunityConfirmed: event.target.checked })} /> Adequate sleep opportunity</label></div>
                  {!form.fitForDuty && <p className="mt-3 text-sm font-semibold text-red-800">Duty cannot be started while marked not fit. Contact operations or a senior instructor.</p>}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-gray-700">Duty date<input type="date" value={form.dutyDate} onChange={event => { setFlightTimeTouched(false); setForm({ ...form, dutyDate: event.target.value }); }} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
                <label className="text-sm font-semibold text-gray-700">Location<input value={form.location} onChange={event => setForm({ ...form, location: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
                <DutyTimePicker label="Duty started" value={form.actualStart} defaultDate={form.dutyDate} onChange={nextValue => { const nextDate = nextValue.slice(0, 10); if (nextDate && nextDate !== form.dutyDate) setFlightTimeTouched(false); setForm({ ...form, actualStart: nextValue, dutyDate: nextDate || form.dutyDate }); }} />
                {(form.id || form.status !== 'active') && <DutyTimePicker label="Duty finished" value={form.actualEnd} defaultDate={form.dutyDate} onChange={nextValue => setForm({ ...form, actualEnd: nextValue })} />}
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <label className="min-w-0 flex-1 text-sm font-semibold text-blue-950">Actual flight time
                    <div className="relative mt-1">
                      <input type="number" min="0" step="0.01" value={form.flightHours} onChange={event => { setFlightTimeTouched(true); setForm({ ...form, flightHours: event.target.value }); }} className="w-full rounded-lg border border-blue-300 bg-white px-3 py-2 pr-16 text-gray-950" />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">hours</span>
                    </div>
                  </label>
                  {!loggedFlightSummary.loading && loggedFlightSummary.minutes !== Math.round((Number(form.flightHours) || 0) * 60) && (
                    <button type="button" onClick={() => { setFlightTimeTouched(true); setForm({ ...form, flightHours: hoursFromMinutes(loggedFlightSummary.minutes) }); }} className="mt-6 whitespace-nowrap text-xs font-bold text-blue-700 hover:text-blue-900">Use logged total</button>
                  )}
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-blue-800">
                  {loggedFlightSummary.loading ? <><Clock3 className="h-3.5 w-3.5 animate-spin" /> Checking logged flights…</> : loggedFlightSummary.error ? <><AlertTriangle className="h-3.5 w-3.5" /> {loggedFlightSummary.error}</> : loggedFlightSummary.count > 0 ? <><CheckCircle2 className="h-3.5 w-3.5" /> Prefilled from {loggedFlightSummary.count} logged {loggedFlightSummary.count === 1 ? 'flight' : 'flights'} ({readableMinutes(loggedFlightSummary.minutes)}).</> : <>No flights have been logged for this date yet.</>}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Coffee className="h-4 w-4 text-amber-600" /><div><h3 className="font-bold text-gray-900">Breaks</h3><p className="text-xs text-gray-500">Optional</p></div></div><button type="button" onClick={() => setForm({ ...form, breaks: [...form.breaks, { breakStart: '', breakEnd: '', breakType: 'break', freeOfDuty: false, affectsCalculation: false, facility: '', notes: '' }] })} className="text-sm font-bold text-blue-600 hover:text-blue-800">+ Add break</button></div>
                <div className="mt-3 space-y-3">
                  {form.breaks.map((item, index) => (
                    <div key={index} className="rounded-lg bg-gray-50 p-3">
                      <div className="grid gap-2 sm:grid-cols-2"><DutyTimePicker label="Break started" value={item.breakStart} defaultDate={form.dutyDate} onChange={nextValue => setForm({ ...form, breaks: form.breaks.map((value, itemIndex) => itemIndex === index ? { ...value, breakStart: nextValue } : value) })} /><DutyTimePicker label="Break finished" value={item.breakEnd} defaultDate={form.dutyDate} onChange={nextValue => setForm({ ...form, breaks: form.breaks.map((value, itemIndex) => itemIndex === index ? { ...value, breakEnd: nextValue } : value) })} /></div>
                      <select aria-label="Break type" value={item.breakType} onChange={event => setForm({ ...form, breaks: form.breaks.map((value, itemIndex) => itemIndex === index ? { ...value, breakType: event.target.value as BreakDraft['breakType'] } : value) })} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"><option value="break">Break</option><option value="rest">Rest</option><option value="split_duty_rest">Split-duty rest</option></select>
                      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-700"><label className="flex items-center gap-1.5"><input type="checkbox" checked={item.freeOfDuty} onChange={event => setForm({ ...form, breaks: form.breaks.map((value, itemIndex) => itemIndex === index ? { ...value, freeOfDuty: event.target.checked } : value) })} /> Free of all duty</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={item.affectsCalculation} onChange={event => setForm({ ...form, breaks: form.breaks.map((value, itemIndex) => itemIndex === index ? { ...value, affectsCalculation: event.target.checked } : value) })} /> Affects approved calculation</label><button type="button" onClick={() => setForm({ ...form, breaks: form.breaks.filter((_, itemIndex) => itemIndex !== index) })} className="ml-auto font-bold text-red-600">Remove</button></div>
                    </div>
                  ))}
                  {form.breaks.length === 0 && <p className="text-sm text-gray-500">No breaks recorded.</p>}
                </div>
              </div>

              <details className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <summary className="cursor-pointer text-sm font-bold text-gray-800">More details</summary>
                <div className="mt-4 space-y-4">
                  {form.id && <label className="block text-sm font-semibold text-gray-700">Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as DutyPeriod['status'] })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"><option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option></select></label>}
                  <div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" checked={form.isExternal} onChange={event => setForm({ ...form, isExternal: event.target.checked })} /> Duty outside this club</label>{form.isExternal && <input value={form.externalOrganisation} onChange={event => setForm({ ...form, externalOrganisation: event.target.value })} placeholder="External organisation" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />}</div>
                  <label className="block text-sm font-semibold text-gray-700">Notes<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2" /></label>
                </div>
              </details>
              {form.id && <label className="block text-sm font-semibold text-gray-700">Amendment reason{periods.find(period => period.id === form.id)?.status === 'completed' && <span className="text-red-600"> *</span>}<textarea value={form.amendmentReason} onChange={event => setForm({ ...form, amendmentReason: event.target.value })} rows={2} placeholder="Why is this record being changed?" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" /></label>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-4"><button type="button" onClick={() => setForm(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">Cancel</button><button type="button" disabled={saving || (!form.id && !form.fitForDuty && form.status === 'active')} onClick={() => void submit()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : form.id ? 'Save changes' : form.status === 'active' ? 'Start duty' : 'Add duty period'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DutyDashboard;
