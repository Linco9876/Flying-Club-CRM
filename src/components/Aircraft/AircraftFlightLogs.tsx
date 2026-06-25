import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plane, ArrowLeft, Calendar, Pencil, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAircraft } from '../../hooks/useAircraft';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import toast from 'react-hot-toast';
import { calculateFlightCost, isPrepaidPaymentMethod, isVoucherPaymentMethod } from '../../utils/billing';
import { fetchUserXeroBalance } from '../../lib/xeroMemberBalance';

interface FlightLog {
  id: string;
  booking_id: string | null;
  aircraft_id: string;
  student_id: string;
  instructor_id: string | null;
  start_time: string;
  end_time: string;
  start_tach: number;
  end_tach: number;
  flight_duration: number;
  landings: number;
  payment_type: string | null;
  flight_type_id: string | null;
  flight_type_name: string | null;
  observations: string | null;
  hobbs_start: number | null;
  hobbs_end: number | null;
  fuel_start: number | null;
  fuel_end: number | null;
  fuel_added: number | null;
  fuel_type: string | null;
  oil_start: number | null;
  oil_end: number | null;
  oil_added: number | null;
  aircraft_condition: string | null;
  maintenance_notes: string | null;
  created_at: string;
  student_name: string;
  instructor_name: string | null;
  total_cost: number;
}

interface EditLogForm {
  start_time: string;
  end_time: string;
  start_tach: string;
  end_tach: string;
  flight_duration: string;
  landings: string;
  payment_type: string;
  observations: string;
}

interface AircraftFlightLogsProps {
  aircraftIdOverride?: string;
  embedded?: boolean;
}

export const AircraftFlightLogs: React.FC<AircraftFlightLogsProps> = ({ aircraftIdOverride, embedded = false }) => {
  const { aircraftId: routeAircraftId } = useParams<{ aircraftId: string }>();
  const aircraftId = aircraftIdOverride || routeAircraftId;
  const navigate = useNavigate();
  const { aircraft: allAircraft } = useAircraft();
  const { deleteFlightLog, getFlightLogDeleteImpact } = useFlightLogs();
  const [flightLogs, setFlightLogs] = useState<FlightLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(
    new Date().toISOString().slice(0, 7)
  );
  const [actionLog, setActionLog] = useState<FlightLog | null>(null);
  const [editingLog, setEditingLog] = useState<FlightLog | null>(null);
  const [editForm, setEditForm] = useState<EditLogForm | null>(null);
  const [savingLog, setSavingLog] = useState(false);

  const aircraft = allAircraft.find(a => a.id === aircraftId);

  const fetchFlightLogs = async () => {
    if (!aircraftId) return;

    try {
      setLoading(true);
      setError(null);

      const { data: logsData, error: logsError } = await supabase
        .from('flight_logs')
        .select('*')
        .eq('aircraft_id', aircraftId)
        .order('created_at', { ascending: false });

      if (logsError) throw logsError;

      const studentIds = [...new Set(logsData?.map((log: any) => log.student_id) || [])];
      const instructorIds = [...new Set(
        logsData
          ?.map((log: any) => log.instructor_id)
          .filter((id): id is string => id !== null) || []
      )];

      const allUserIds = [...new Set([...studentIds, ...instructorIds])];

      const { data: usersData } = allUserIds.length > 0
        ? await supabase
          .from('users')
          .select('id, name')
          .in('id', allUserIds)
        : { data: [] };

      const usersMap = new Map(usersData?.map(u => [u.id, u.name]) || []);

      const { data: ratesData } = await supabase
        .from('aircraft_rates')
        .select('*, flight_types(name)')
        .eq('aircraft_id', aircraftId);

      const combinedLogs: FlightLog[] = (logsData || []).map((log: any) => {
        const rate = ratesData?.find((item: any) => item.flight_type_id === log.flight_type_id);
        const calculatedCost = log.calculated_cost != null
          ? parseFloat(log.calculated_cost)
          : calculateFlightCost({
            rate: rate ? {
              chargeType: rate.charge_type,
              soloRate: parseFloat(rate.solo_rate || 0),
              dualRate: parseFloat(rate.dual_rate || 0),
              flatSurcharge: parseFloat(rate.flat_surcharge || 0),
              weekendSurcharge: parseFloat(rate.weekend_surcharge || 0),
            } : null,
            durationHours: parseFloat(log.flight_duration || 0),
            isDual: !!log.instructor_id,
            passengerCount: log.passengers,
            startTime: log.start_time,
          });

        return {
          id: log.id,
          booking_id: log.booking_id,
          aircraft_id: log.aircraft_id,
          student_id: log.student_id,
          instructor_id: log.instructor_id,
          start_time: log.start_time,
          end_time: log.end_time,
          start_tach: parseFloat(log.start_tach),
          end_tach: parseFloat(log.end_tach),
          flight_duration: parseFloat(log.flight_duration),
          landings: log.landings || 0,
          payment_type: log.payment_type,
          flight_type_id: log.flight_type_id,
          flight_type_name: rate?.flight_types?.name || null,
          observations: log.observations,
          hobbs_start: log.hobbs_start != null ? parseFloat(log.hobbs_start) : null,
          hobbs_end: log.hobbs_end != null ? parseFloat(log.hobbs_end) : null,
          fuel_start: log.fuel_start != null ? parseFloat(log.fuel_start) : null,
          fuel_end: log.fuel_end != null ? parseFloat(log.fuel_end) : null,
          fuel_added: log.fuel_added != null ? parseFloat(log.fuel_added) : null,
          fuel_type: log.fuel_type,
          oil_start: log.oil_start != null ? parseFloat(log.oil_start) : null,
          oil_end: log.oil_end != null ? parseFloat(log.oil_end) : null,
          oil_added: log.oil_added != null ? parseFloat(log.oil_added) : null,
          aircraft_condition: log.aircraft_condition,
          maintenance_notes: log.maintenance_notes,
          created_at: log.created_at,
          student_name: usersMap.get(log.student_id) || 'Unknown',
          instructor_name: log.instructor_id ? usersMap.get(log.instructor_id) || 'Unknown' : null,
          total_cost: calculatedCost
        };
      });

      setFlightLogs(combinedLogs);
    } catch (err) {
      console.error('Error fetching flight logs:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch flight logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlightLogs();
  }, [aircraftId]);

  useEffect(() => {
    if (flightLogs.length === 0) return;

    const months = Array.from(
      new Set(flightLogs.map(log => new Date(log.start_time).toISOString().slice(0, 7)))
    ).sort().reverse();

    if (!months.includes(selectedMonth)) {
      setSelectedMonth(months[0]);
    }
  }, [flightLogs, selectedMonth]);

  const toDateTimeLocal = (value: string) => {
    const date = new Date(value);
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  };

  const openEditLog = (log: FlightLog) => {
    setActionLog(null);
    setEditingLog(log);
    setEditForm({
      start_time: toDateTimeLocal(log.start_time),
      end_time: toDateTimeLocal(log.end_time),
      start_tach: log.start_tach.toFixed(1),
      end_tach: log.end_tach.toFixed(1),
      flight_duration: log.flight_duration.toFixed(2),
      landings: String(log.landings || 0),
      payment_type: log.payment_type || '',
      observations: log.observations || '',
    });
  };

  const handleDeleteLog = async (log: FlightLog) => {
    const impact = await getFlightLogDeleteImpact(log.id);
    const xeroMode: 'auto' | 'void-delete' | 'credit-note' | 'crm-only' = impact.requiresXeroAction
      ? impact.recommendedAction
      : 'crm-only';
    const confirmMessage = impact.requiresXeroAction
      ? impact.recommendedAction === 'credit-note'
        ? `${impact.summary}\n\n${impact.detail}\n\nA reversing credit note will be created in Xero before the CRM record is removed.${impact.hasStripePayments ? '\n\nAdmin note: This reverses the accounting in Xero but does not refund the card automatically.' : ''}\n\nContinue?`
        : `${impact.summary}\n\n${impact.detail}\n\nThe Xero invoice will be voided or deleted before the CRM record is removed.\n\nContinue?`
      : 'Delete this flight log?';

    if (!window.confirm(confirmMessage)) return;

    const { error: deleteError } = await deleteFlightLog(log.id, { xeroMode });

    if (deleteError) {
      toast.error(deleteError);
      return;
    }

    setActionLog(null);
    await fetchFlightLogs();
    toast.success(impact.requiresXeroAction ? 'Flight log reversed in Xero and removed from the CRM' : 'Flight log deleted');
  };

  const handleSaveLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLog || !editForm) return;

    const startTach = parseFloat(editForm.start_tach);
    const endTach = parseFloat(editForm.end_tach);
    const duration = parseFloat(editForm.flight_duration);

    if (Number.isNaN(startTach) || Number.isNaN(endTach) || endTach <= startTach) {
      toast.error('End tach must be greater than start tach');
      return;
    }

    if (Number.isNaN(duration) || duration <= 0) {
      toast.error('Flight duration must be positive');
      return;
    }

    const { data: rate } = editingLog.flight_type_id
      ? await supabase
        .from('aircraft_rates')
        .select('*')
        .eq('aircraft_id', editingLog.aircraft_id)
        .eq('flight_type_id', editingLog.flight_type_id)
        .maybeSingle()
      : { data: null };
    const recalculatedCost = calculateFlightCost({
      rate: rate ? {
        chargeType: rate.charge_type,
        soloRate: parseFloat(rate.solo_rate || 0),
        dualRate: parseFloat(rate.dual_rate || 0),
        flatSurcharge: parseFloat(rate.flat_surcharge || 0),
        weekendSurcharge: parseFloat(rate.weekend_surcharge || 0),
      } : null,
      durationHours: duration,
      isDual: !!editingLog.instructor_id,
      startTime: new Date(editForm.start_time).toISOString(),
    });

    const voucherPayment = isVoucherPaymentMethod(editForm.payment_type);
    const prepaidPayment = isPrepaidPaymentMethod(editForm.payment_type);
    let prepaidBalanceAfter: number | null = null;

    if (!voucherPayment && prepaidPayment && recalculatedCost > 0) {
      const chargeUserId = editingLog.student_id;
      if (!chargeUserId) {
        toast.error('Prepaid payments need a linked member on the flight log.');
        return;
      }

      const xeroBalance = await fetchUserXeroBalance(chargeUserId);
      if (!xeroBalance.connected) {
        toast.error('Prepaid payments require Xero to be connected for this club.');
        return;
      }

      const availableCredit = Number(xeroBalance.overpaymentCredit ?? xeroBalance.availableCredit ?? 0);
      const minimumPrepaidPack = Number(xeroBalance.minimumPrepaidPack ?? 1000);
      if (availableCredit + 0.005 < minimumPrepaidPack) {
        toast.error(`Prepaid is locked until the member has at least $${minimumPrepaidPack.toFixed(2)} sitting in Xero overpayments. If they do not have enough, add a $${minimumPrepaidPack.toFixed(2)} package first.`);
        return;
      }

      if (availableCredit + 0.005 < recalculatedCost) {
        toast.error(`This member only has $${availableCredit.toFixed(2)} available in Xero overpayments, so prepaid cannot cover this flight. Add a $${minimumPrepaidPack.toFixed(2)} package first.`);
        return;
      }

      prepaidBalanceAfter = Math.round((availableCredit - recalculatedCost + Number.EPSILON) * 100) / 100;
    }

    setSavingLog(true);
    const { error: updateError } = await supabase
      .from('flight_logs')
      .update({
        start_time: new Date(editForm.start_time).toISOString(),
        end_time: new Date(editForm.end_time).toISOString(),
        start_tach: startTach,
        end_tach: endTach,
        flight_duration: duration,
        landings: parseInt(editForm.landings, 10) || 0,
        payment_type: editForm.payment_type || null,
        calculated_cost: recalculatedCost,
        total_cost: recalculatedCost,
        payment_status: recalculatedCost <= 0 ? 'free' : voucherPayment || prepaidPayment ? 'paid' : 'pending',
        observations: editForm.observations || null,
      })
      .eq('id', editingLog.id);

    setSavingLog(false);

    if (updateError) {
      toast.error('Failed to update flight log');
      return;
    }

    if (!voucherPayment && prepaidPayment) {
      const { data: charge } = await supabase
        .from('account_transactions')
        .select('id, amount, user_id')
        .eq('flight_log_id', editingLog.id)
        .eq('type', 'flight_charge')
        .maybeSingle();

      if (charge) {
        await supabase
          .from('account_transactions')
          .update({ amount: recalculatedCost, balance_after: prepaidBalanceAfter })
          .eq('id', charge.id);
      }
    }

    setEditingLog(null);
    setEditForm(null);
    await fetchFlightLogs();
    toast.success('Flight log updated');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading flight logs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (!aircraft) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Aircraft not found</div>
      </div>
    );
  }

  const filteredLogs = flightLogs.filter(log => {
    const logDate = new Date(log.start_time);
    const logMonth = logDate.toISOString().slice(0, 7);
    return logMonth === selectedMonth;
  });

  const totalFlightHours = filteredLogs.reduce((sum, log) => sum + log.flight_duration, 0);
  const totalLandings = filteredLogs.reduce((sum, log) => sum + log.landings, 0);
  const totalRevenue = filteredLogs.reduce((sum, log) => sum + log.total_cost, 0);

  const availableMonths = Array.from(
    new Set(
      flightLogs.map(log => new Date(log.start_time).toISOString().slice(0, 7))
    )
  ).sort().reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {!embedded && (
            <button
              onClick={() => navigate('/aircraft')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center">
              <Plane className="h-5 w-5 mr-2 text-blue-600" />
              Aircraft flight log for {aircraft.registration}
            </h1>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm text-gray-600">
            Below, the logs for
          </div>
          <div className="flex items-center space-x-2">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              {availableMonths.map(month => {
                const [year, monthNum] = month.split('-');
                const date = new Date(parseInt(year), parseInt(monthNum) - 1);
                const monthName = date.toLocaleDateString('en-US', { month: 'long' });
                return (
                  <option key={month} value={month}>
                    {monthName} {year}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">
            No flight logs found for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 text-left font-semibold">Date / Time</th>
                  <th className="px-3 py-2 text-left font-semibold">Crew</th>
                  <th className="px-3 py-2 text-left font-semibold">Flight</th>
                  <th className="px-3 py-2 text-left font-semibold">Notes / Aircraft</th>
                  <th className="px-3 py-2 text-left font-semibold">Tach</th>
                  <th className="px-3 py-2 text-right font-semibold">Billing</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log, index) => {
                  const startDate = new Date(log.start_time);
                  const endDate = new Date(log.end_time);
                  const isAlternateRow = index % 2 === 1;
                  const timeRange = `${startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                  const aircraftDetails = [
                    log.aircraft_condition ? `Condition: ${log.aircraft_condition}` : null,
                    log.hobbs_start != null || log.hobbs_end != null ? `Hobbs: ${log.hobbs_start ?? '–'}-${log.hobbs_end ?? '–'}` : null,
                    log.fuel_start != null || log.fuel_end != null ? `Fuel: ${log.fuel_start ?? '–'}-${log.fuel_end ?? '–'}` : null,
                    log.fuel_added != null ? `Fuel added: ${log.fuel_added}${log.fuel_type ? ` ${log.fuel_type}` : ''}` : null,
                    log.oil_start != null || log.oil_end != null ? `Oil: ${log.oil_start ?? '–'}-${log.oil_end ?? '–'}` : null,
                    log.oil_added != null ? `Oil added: ${log.oil_added}` : null,
                    log.maintenance_notes ? `Mx: ${log.maintenance_notes}` : null,
                  ].filter((detail): detail is string => Boolean(detail));
                  const aircraftDetailSummary = aircraftDetails.join(' | ');

                  return (
                    <tr
                      key={log.id}
                      className={`group border-b border-gray-100 cursor-pointer transition-colors hover:bg-blue-50 ${isAlternateRow ? 'bg-slate-50' : 'bg-white'}`}
                      onClick={() => setActionLog(log)}
                      title="Click to edit or delete this log"
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          <span>{startDate.toLocaleDateString('en-GB')}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">{timeRange}</div>
                        {startDate.toDateString() !== endDate.toDateString() && (
                          <div className="text-xs text-gray-400">Ends {endDate.toLocaleDateString('en-GB')}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">{log.student_name}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {log.instructor_name ? log.instructor_name : 'Solo / no instructor'}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">{log.flight_type_name || log.payment_type || 'Unknown flight'}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                            {log.flight_duration.toFixed(1)} hr
                          </span>
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
                            {log.landings} landing{log.landings === 1 ? '' : 's'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="max-w-md text-gray-700">
                          {log.observations ? (
                            <div className="line-clamp-1">{log.observations}</div>
                          ) : (
                            <span className="text-xs text-gray-400">No observations</span>
                          )}
                        </div>
                        {aircraftDetailSummary && (
                          <div className="mt-0.5 max-w-md truncate text-xs text-gray-500" title={aircraftDetailSummary}>
                            {aircraftDetailSummary}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-mono text-sm font-semibold text-gray-900">
                          {log.start_tach.toFixed(1)} - {log.end_tach.toFixed(1)}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">Tach +{log.flight_duration.toFixed(1)}</div>
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <div className="font-semibold text-gray-900">AUD{log.total_cost.toFixed(2)}</div>
                        <div className="mt-0.5 text-xs text-gray-500">{log.payment_type || 'No payment type'}</div>
                        <div className="mt-1 text-xs text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
                          Click for actions
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-600">Total Flight Hours</p>
            <p className="text-lg font-bold text-gray-900">{totalFlightHours.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-gray-600">Total Landings</p>
            <p className="text-lg font-bold text-gray-900">{totalLandings}</p>
          </div>
          <div>
            <p className="text-gray-600">Total Revenue</p>
            <p className="text-lg font-bold text-gray-900">AUD{totalRevenue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {actionLog && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setActionLog(null)}
        >
          <div
            className="w-full max-w-xs rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-sm font-semibold text-gray-900">
                {new Date(actionLog.start_time).toLocaleDateString('en-GB')} flight log
              </p>
              <p className="text-xs text-gray-500">
                {actionLog.student_name}{actionLog.instructor_name ? ` / ${actionLog.instructor_name}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openEditLog(actionLog)}
              className="mt-1 flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <Pencil className="mr-2 h-4 w-4 text-gray-400" />
              Edit log
            </button>
            <button
              type="button"
              onClick={() => handleDeleteLog(actionLog)}
              className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete log
            </button>
          </div>
        </div>
      )}

      {editingLog && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={handleSaveLog}
            className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Edit Flight Log</h2>
                <p className="text-sm text-gray-500">{aircraft.registration} · {editingLog.student_name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingLog(null);
                  setEditForm(null);
                }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">
                Start time
                <input
                  type="datetime-local"
                  value={editForm.start_time}
                  onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                End time
                <input
                  type="datetime-local"
                  value={editForm.end_time}
                  onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Start tach
                <input
                  type="number"
                  step="0.1"
                  value={editForm.start_tach}
                  onChange={(e) => setEditForm({ ...editForm, start_tach: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                End tach
                <input
                  type="number"
                  step="0.1"
                  value={editForm.end_tach}
                  onChange={(e) => setEditForm({ ...editForm, end_tach: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Duration
                <input
                  type="number"
                  step="0.1"
                  value={editForm.flight_duration}
                  onChange={(e) => setEditForm({ ...editForm, flight_duration: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Landings
                <input
                  type="number"
                  min="0"
                  value={editForm.landings}
                  onChange={(e) => setEditForm({ ...editForm, landings: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                Payment type
                <input
                  type="text"
                  value={editForm.payment_type}
                  onChange={(e) => setEditForm({ ...editForm, payment_type: e.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-sm font-medium text-gray-700 md:col-span-2">
                Observation
                <textarea
                  value={editForm.observations}
                  onChange={(e) => setEditForm({ ...editForm, observations: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setEditingLog(null);
                  setEditForm(null);
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingLog}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingLog ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
