import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useStudents } from '../../hooks/useStudents';
import { useSafetySettings } from '../../hooks/useSafetySettings';
import type { FlightLog } from '../../hooks/useFlightLogs';
import { buildSafetyComplianceSummary, getBfrDueDate, isStudentOnly } from '../../utils/safetyCompliance';
import { Download, Search, AlertTriangle, CheckCircle, Clock, CalendarDays, ShieldCheck, Loader2 } from 'lucide-react';
import { hasAnyRole } from '../../utils/rbac';
import { supabase } from '../../lib/supabase';

interface PilotCurrency {
  id: string;
  name: string;
  lastFlightDate: Date | null;
  medicalExpiry: Date | null;
  licenceExpiry: Date | null;
  bfrDue: Date | null;
  endorsements: string[];
  daysUntilMedicalExpiry: number;
  daysUntilLicenceExpiry: number;
  daysUntilBfrDue: number;
  daysSinceLastFlight: number;
  urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
  isStudentOnly: boolean;
}

export const PilotCurrencyTab: React.FC = () => {
  const { user } = useAuth();
  const { students, loading: studentsLoading } = useStudents();
  const [flightLogs, setFlightLogs] = useState<Array<Pick<FlightLog, 'student_id' | 'instructor_id' | 'start_time' | 'solo_time' | 'flight_duration'>>>([]);
  const [flightLogsLoading, setFlightLogsLoading] = useState(true);
  const [flightLogsError, setFlightLogsError] = useState<string | null>(null);
  const { settings } = useSafetySettings();
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [endorsementFilter, setEndorsementFilter] = useState('');
  const isMemberSelfView = Boolean(
    (user?.role === 'student' || user?.role === 'pilot' || user?.roles?.some(role => role === 'student' || role === 'pilot')) &&
    !hasAnyRole(user, ['admin', 'instructor', 'senior_instructor'])
  );

  useEffect(() => {
    let active = true;

    const fetchCurrencyFlightLogs = async () => {
      setFlightLogsLoading(true);
      setFlightLogsError(null);
      try {
        const { data, error } = await supabase
          .from('flight_logs')
          .select('student_id, instructor_id, start_time, solo_time, flight_duration');

        if (error) throw error;
        if (active) setFlightLogs(data || []);
      } catch (error) {
        if (active) {
          setFlightLogsError(error instanceof Error ? error.message : 'Failed to load flight activity');
        }
      } finally {
        if (active) setFlightLogsLoading(false);
      }
    };

    void fetchCurrencyFlightLogs();
    return () => {
      active = false;
    };
  }, []);

  const calculatePilotCurrency = (): PilotCurrency[] => {
    const pilots = isMemberSelfView
      ? students.filter(candidate => candidate.id === user?.id)
      : students.filter(candidate =>
          !isStudentOnly(candidate) && (
            candidate.roles?.some(role => ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(role)) ||
            ['pilot', 'instructor', 'senior_instructor', 'admin'].includes(candidate.role)
          )
        );

    const today = new Date();

    return pilots.map(pilot => {
      const summary = buildSafetyComplianceSummary(pilot, settings, flightLogs);
      const bfrDue = getBfrDueDate(pilot);

      // Calculate days until expiry
      const daysUntilMedicalExpiry = pilot.medicalExpiry 
        ? Math.ceil((pilot.medicalExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      
      const daysUntilBfrDue = bfrDue 
        ? Math.ceil((bfrDue.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      const daysUntilLicenceExpiry = pilot.licenceExpiry
        ? Math.ceil((pilot.licenceExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      const daysSinceLastFlight = summary.daysSinceLastFlight ?? 999;

      // Determine urgency level
      const minDays = Math.min(daysUntilMedicalExpiry, daysUntilLicenceExpiry, daysUntilBfrDue);
      let urgencyLevel: 'overdue' | 'urgent' | 'warning' | 'current';
      
      if (summary.blockingConcerns.length > 0 || summary.warningConcerns.some(concern => concern.severity === 'lapsed')) urgencyLevel = 'overdue';
      else if (!summary.isStudentOnly && daysSinceLastFlight > settings.recencyDays) urgencyLevel = 'overdue';
      else if (minDays <= Math.min(settings.medicalWarningDays, settings.bfrWarningDays, 30)) urgencyLevel = 'urgent';
      else if (daysUntilMedicalExpiry <= settings.medicalWarningDays || daysUntilLicenceExpiry <= settings.licenceWarningDays || daysUntilBfrDue <= settings.bfrWarningDays) urgencyLevel = 'warning';
      else urgencyLevel = 'current';

      // Get endorsement labels
      const endorsements = pilot.endorsements
        .filter(e => e.isActive)
        .map(e => e.type.toUpperCase());

      return {
        id: pilot.id,
        name: pilot.name,
        lastFlightDate: summary.lastFlightDate,
        medicalExpiry: pilot.medicalExpiry || null,
        licenceExpiry: pilot.licenceExpiry || null,
        bfrDue,
        endorsements,
        daysUntilMedicalExpiry,
        daysUntilLicenceExpiry,
        daysUntilBfrDue,
        daysSinceLastFlight: summary.daysSinceLastFlight ?? 999,
        urgencyLevel,
        isStudentOnly: summary.isStudentOnly
      };
    });
  };

  const pilotCurrency = calculatePilotCurrency();

  // Apply filters
  const filteredPilots = pilotCurrency.filter(pilot => {
    const matchesSearch = pilot.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesEndorsement = !endorsementFilter || pilot.endorsements.includes(endorsementFilter);
    
    // Date range filter for last flight
    let matchesDateRange = true;
    if (dateRange.start && pilot.lastFlightDate) {
      matchesDateRange = pilot.lastFlightDate >= new Date(dateRange.start);
    }
    if (dateRange.end && pilot.lastFlightDate) {
      matchesDateRange = matchesDateRange && pilot.lastFlightDate <= new Date(dateRange.end);
    }
    
    return matchesSearch && matchesEndorsement && matchesDateRange;
  });

  // Sort by urgency (most urgent first)
  const sortedPilots = [...filteredPilots].sort((a, b) => {
    const urgencyOrder = { 'overdue': 0, 'urgent': 1, 'warning': 2, 'current': 3 };
    if (urgencyOrder[a.urgencyLevel] !== urgencyOrder[b.urgencyLevel]) {
      return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    }
    
    // Within same urgency, sort by soonest expiry
    const aMinDays = Math.min(a.daysUntilMedicalExpiry, a.daysUntilLicenceExpiry, a.daysUntilBfrDue);
    const bMinDays = Math.min(b.daysUntilMedicalExpiry, b.daysUntilLicenceExpiry, b.daysUntilBfrDue);
    return aMinDays - bMinDays;
  });

  const urgencyCounts = sortedPilots.reduce((counts, pilot) => {
    counts[pilot.urgencyLevel] = (counts[pilot.urgencyLevel] ?? 0) + 1;
    return counts;
  }, {} as Record<PilotCurrency['urgencyLevel'], number>);

  const handleExport = () => {
    const rows = sortedPilots.map(pilot => [
      pilot.name,
      pilot.urgencyLevel,
      formatDate(pilot.lastFlightDate),
      formatDate(pilot.medicalExpiry),
      formatDate(pilot.licenceExpiry),
      formatDate(pilot.bfrDue),
      pilot.endorsements.join('; ')
    ]);
    const csv = [['Pilot', 'Status', 'Last Flight', 'Medical Expiry', 'Membership Expiry', 'BFR Due', 'Endorsements'], ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pilot-currency.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
      case 'urgent': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'current': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getUrgencyIcon = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case 'overdue': return <AlertTriangle className="h-4 w-4 text-red-600" />;
      case 'urgent': return <Clock className="h-4 w-4 text-orange-600" />;
      case 'warning': return <Clock className="h-4 w-4 text-yellow-600" />;
      case 'current': return <CheckCircle className="h-4 w-4 text-green-600" />;
      default: return null;
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A';
    return date.toLocaleDateString();
  };

  const formatDaysUntil = (days: number) => {
    if (days === 999) return 'N/A';
    if (days < 0) return `${Math.abs(days)} days overdue`;
    if (days === 0) return 'Due today';
    return `${days} days`;
  };

  if (studentsLoading || flightLogsLoading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="text-center">
          <Loader2 className="mx-auto h-7 w-7 animate-spin text-blue-600" />
          <p className="mt-3 text-sm font-medium text-gray-700">Loading pilot currency</p>
          <p className="mt-1 text-xs text-gray-500">Checking flight activity, medicals, memberships and flight reviews...</p>
        </div>
      </div>
    );
  }

  if (flightLogsError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Pilot currency could not be calculated</p>
            <p className="mt-1 text-sm">{flightLogsError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isMemberSelfView) {
    const pilot = sortedPilots[0];

    if (!pilot) {
      return (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-gray-300" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">No currency record found</h2>
          <p className="mt-1 text-sm text-gray-500">Your profile has not loaded a safety and currency record yet.</p>
        </div>
      );
    }

    const statusText = pilot.urgencyLevel === 'current'
      ? 'Current'
      : pilot.urgencyLevel.charAt(0).toUpperCase() + pilot.urgencyLevel.slice(1);

    const currencyCards = [
      {
        label: 'Last flying activity',
        value: formatDate(pilot.lastFlightDate),
        detail: pilot.daysSinceLastFlight === 999 ? 'No recent flight in this system' : `${pilot.daysSinceLastFlight} days ago`,
        icon: <CalendarDays className="h-5 w-5" />
      },
      {
        label: 'Medical',
        value: formatDate(pilot.medicalExpiry),
        detail: formatDaysUntil(pilot.daysUntilMedicalExpiry),
        icon: <ShieldCheck className="h-5 w-5" />
      },
      {
        label: 'Membership',
        value: formatDate(pilot.licenceExpiry),
        detail: formatDaysUntil(pilot.daysUntilLicenceExpiry),
        icon: <CheckCircle className="h-5 w-5" />
      },
      {
        label: 'Flight review',
        value: pilot.isStudentOnly ? 'Not required for student solo hire' : formatDate(pilot.bfrDue),
        detail: pilot.isStudentOnly ? 'Students fly with an instructor' : formatDaysUntil(pilot.daysUntilBfrDue),
        icon: <Clock className="h-5 w-5" />
      }
    ];

    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Currency status</p>
              <h2 className="mt-1 text-2xl font-bold text-gray-950">{statusText}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {pilot.isStudentOnly
                  ? 'Student accounts do not have solo recency requirements because bookings require instructor oversight.'
                  : 'This is based on your logged flying, flight review, membership and medical information in this CRM.'}
              </p>
            </div>
            <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${getUrgencyColor(pilot.urgencyLevel)}`}>
              {getUrgencyIcon(pilot.urgencyLevel)}
              {statusText}
            </span>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {currencyCards.map(card => (
            <article key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-blue-700">
                {card.icon}
                <p className="text-xs font-semibold uppercase tracking-wide">{card.label}</p>
              </div>
              <p className="mt-3 text-lg font-bold text-gray-950">{card.value}</p>
              <p className="mt-1 text-sm text-gray-500">{card.detail}</p>
            </article>
          ))}
        </div>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Endorsements on file</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {pilot.endorsements.length > 0 ? pilot.endorsements.map(endorsement => (
              <span key={endorsement} className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-800">{endorsement}</span>
            )) : <span className="text-sm text-gray-500">No endorsements recorded yet.</span>}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Overdue', value: urgencyCounts.overdue ?? 0, color: 'border-red-200 bg-red-50 text-red-700' },
          { label: 'Urgent', value: urgencyCounts.urgent ?? 0, color: 'border-orange-200 bg-orange-50 text-orange-700' },
          { label: 'Warning', value: urgencyCounts.warning ?? 0, color: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
          { label: 'Current', value: urgencyCounts.current ?? 0, color: 'border-green-200 bg-green-50 text-green-700' },
        ].map(card => (
          <div key={card.label} className={`rounded-xl border p-3 sm:p-4 ${card.color}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-75">{card.label}</p>
            <p className="mt-1 text-2xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Search Pilot</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search by name..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Flight From</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Last Flight To</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Endorsement</label>
            <select
              value={endorsementFilter}
              onChange={(e) => setEndorsementFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Endorsements</option>
              <option value="PC">Pilot Certificate</option>
              <option value="PASSENGER">Passenger Carrying</option>
              <option value="CROSS-COUNTRY">Cross Country</option>
              <option value="RADIO">Radio Operator</option>
              <option value="NAVIGATION">Navigation</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-gray-600">
            Showing {sortedPilots.length} pilots
          </div>
          <div>
            <button
              onClick={handleExport}
              className="flex w-full items-center justify-center space-x-2 rounded-lg bg-green-600 px-3 py-2 text-white transition-colors hover:bg-green-700 sm:w-auto"
            >
              <Download className="h-4 w-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Currency Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="space-y-3 p-4 md:hidden">
          {sortedPilots.map(pilot => (
            <article key={pilot.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-gray-900">{pilot.name}</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {pilot.isStudentOnly ? 'Student - no solo recency requirement' : `Last flight: ${formatDate(pilot.lastFlightDate)}`}
                  </p>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${getUrgencyColor(pilot.urgencyLevel)}`}>
                  {getUrgencyIcon(pilot.urgencyLevel)}
                  {pilot.urgencyLevel.charAt(0).toUpperCase() + pilot.urgencyLevel.slice(1)}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Medical</p>
                  <p className="mt-1 font-semibold text-gray-900">{formatDate(pilot.medicalExpiry)}</p>
                  {pilot.medicalExpiry && <p className="text-xs text-gray-500">{formatDaysUntil(pilot.daysUntilMedicalExpiry)}</p>}
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Membership</p>
                  <p className="mt-1 font-semibold text-gray-900">{formatDate(pilot.licenceExpiry)}</p>
                  {pilot.licenceExpiry && <p className="text-xs text-gray-500">{formatDaysUntil(pilot.daysUntilLicenceExpiry)}</p>}
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">BFR</p>
                  <p className="mt-1 font-semibold text-gray-900">{formatDate(pilot.bfrDue)}</p>
                  {pilot.bfrDue && <p className="text-xs text-gray-500">{formatDaysUntil(pilot.daysUntilBfrDue)}</p>}
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Recency</p>
                  <p className="mt-1 font-semibold text-gray-900">{pilot.daysSinceLastFlight === 999 ? 'N/A' : `${pilot.daysSinceLastFlight} days`}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {pilot.endorsements.length > 0 ? pilot.endorsements.map(endorsement => (
                  <span key={endorsement} className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">{endorsement}</span>
                )) : <span className="text-xs text-gray-500">No endorsements recorded</span>}
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pilot Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Flight Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Medical Expiry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Membership Expiry
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  BFR Due Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Endorsements
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedPilots.map(pilot => (
                <tr key={pilot.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {getUrgencyIcon(pilot.urgencyLevel)}
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUrgencyColor(pilot.urgencyLevel)}`}>
                        {pilot.urgencyLevel.charAt(0).toUpperCase() + pilot.urgencyLevel.slice(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {pilot.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {formatDate(pilot.lastFlightDate)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(pilot.medicalExpiry)}</div>
                      {pilot.medicalExpiry && (
                        <div className="text-xs text-gray-500">
                          {formatDaysUntil(pilot.daysUntilMedicalExpiry)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(pilot.licenceExpiry)}</div>
                      {pilot.licenceExpiry && <div className="text-xs text-gray-500">{formatDaysUntil(pilot.daysUntilLicenceExpiry)}</div>}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <div>
                      <div>{formatDate(pilot.bfrDue)}</div>
                      {pilot.bfrDue && (
                        <div className="text-xs text-gray-500">
                          {formatDaysUntil(pilot.daysUntilBfrDue)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex flex-wrap gap-1">
                      {pilot.endorsements.map(endorsement => (
                        <span
                          key={endorsement}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full"
                        >
                          {endorsement}
                        </span>
                      ))}
                      {pilot.endorsements.length === 0 && (
                        <span className="text-gray-500">None</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sortedPilots.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No pilots found matching the selected filters.</p>
          </div>
        )}
      </div>
    </div>
  );
};
