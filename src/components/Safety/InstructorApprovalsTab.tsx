import React, { useMemo, useState } from 'react';
import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock, Download, ExternalLink, FileCheck, Loader2, LockKeyhole, Search, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useInstructorCompliance, type InstructorComplianceRecord } from '../../hooks/useInstructorCompliance';
import { hasRole } from '../../utils/rbac';

type CurrencyStatus = 'no_record' | 'overdue' | 'due_soon' | 'current' | 'remedial';

interface InstructorRegisterRow {
  id: string;
  name: string;
  email: string;
  level: 'Instructor' | 'Senior Instructor';
  intervalLabel: string;
  spDue?: Date;
  renewalDue?: Date;
  spStatus: CurrencyStatus;
  renewalStatus: CurrencyStatus;
  latestRecord?: InstructorComplianceRecord;
  records: InstructorComplianceRecord[];
}

const statusStyles: Record<CurrencyStatus, string> = {
  no_record: 'border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-500/30 dark:bg-gray-800 dark:text-gray-200',
  overdue: 'border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-950/40 dark:text-red-200',
  due_soon: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200',
  current: 'border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950/40 dark:text-emerald-200',
  remedial: 'border-red-400 bg-red-100 text-red-900 dark:border-red-400/40 dark:bg-red-950/50 dark:text-red-100',
};

const statusLabel: Record<CurrencyStatus, string> = {
  no_record: 'No record',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  current: 'Current',
  remedial: 'Remedial action',
};

const getDateStatus = (due?: Date): CurrencyStatus => {
  if (!due) return 'no_record';
  const days = differenceInCalendarDays(due, new Date());
  if (days < 0) return 'overdue';
  if (days <= 30) return 'due_soon';
  return 'current';
};

const formatDue = (due?: Date) => {
  if (!due) return 'Not recorded';
  const days = differenceInCalendarDays(due, new Date());
  if (days < 0) return `${format(due, 'd MMM yyyy')} (${Math.abs(days)} days overdue)`;
  if (days === 0) return `${format(due, 'd MMM yyyy')} (due today)`;
  return `${format(due, 'd MMM yyyy')} (${days} days)`;
};

export const InstructorApprovalsTab: React.FC = () => {
  const { user } = useAuth();
  const isCfi = hasRole(user, 'cfi');
  const { users, loading: usersLoading } = useUsers(isCfi);
  const { records, loading, error, createFormUrl } = useInstructorCompliance(isCfi);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedInstructorId, setExpandedInstructorId] = useState<string | null>(null);

  const register = useMemo<InstructorRegisterRow[]>(() => {
    const instructors = users.filter(candidate => {
      const roles = candidate.roles?.length ? candidate.roles : [candidate.role];
      return candidate.isActive !== false && roles.some(role => role === 'instructor' || role === 'senior_instructor');
    });

    return instructors.map(instructor => {
      const isSenior = instructor.role === 'senior_instructor' || instructor.roles?.includes('senior_instructor');
      const candidateRecords = records
        .filter(record => record.candidateInstructorId === instructor.id && record.status !== 'voided')
        .sort((a, b) => b.checkDate.localeCompare(a.checkDate));
      const latestRecord = candidateRecords[0];
      const latestSatisfactory = candidateRecords.find(record => record.outcome === 'satisfactory');
      const latestRenewal = candidateRecords.find(record =>
        record.outcome === 'satisfactory' && (record.checkType === 'renewal' || record.checkType === 'initial_issue')
      );

      const spDue = latestSatisfactory
        ? latestSatisfactory.nextSpCheckDue
          ? parseISO(latestSatisfactory.nextSpCheckDue)
          : isSenior
            ? addMonths(parseISO(latestSatisfactory.checkDate), 12)
            : addDays(parseISO(latestSatisfactory.checkDate), 90)
        : undefined;
      const renewalDue = latestRenewal
        ? latestRenewal.nextRenewalDue
          ? parseISO(latestRenewal.nextRenewalDue)
          : addMonths(parseISO(latestRenewal.checkDate), 24)
        : undefined;
      const hasUnresolvedFailure = latestRecord?.outcome === 'unsatisfactory';

      return {
        id: instructor.id,
        name: instructor.name,
        email: instructor.email,
        level: isSenior ? 'Senior Instructor' : 'Instructor',
        intervalLabel: isSenior ? '12 months' : '90 days',
        spDue,
        renewalDue,
        spStatus: hasUnresolvedFailure ? 'remedial' : getDateStatus(spDue),
        renewalStatus: getDateStatus(renewalDue),
        latestRecord,
        records: candidateRecords,
      };
    }).sort((a, b) => {
      const order: Record<CurrencyStatus, number> = { remedial: 0, overdue: 1, no_record: 2, due_soon: 3, current: 4 };
      return order[a.spStatus] - order[b.spStatus] || a.name.localeCompare(b.name);
    });
  }, [records, users]);

  const visibleRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return register;
    return register.filter(row => `${row.name} ${row.email} ${row.level}`.toLowerCase().includes(query));
  }, [register, searchTerm]);

  const summary = useMemo(() => ({
    current: register.filter(row => row.spStatus === 'current').length,
    dueSoon: register.filter(row => row.spStatus === 'due_soon').length,
    action: register.filter(row => ['no_record', 'overdue', 'remedial'].includes(row.spStatus)).length,
  }), [register]);

  const exportRegister = () => {
    const rows = register.map(row => [
      row.name,
      row.level,
      row.intervalLabel,
      statusLabel[row.spStatus],
      row.spDue ? format(row.spDue, 'yyyy-MM-dd') : '',
      statusLabel[row.renewalStatus],
      row.renewalDue ? format(row.renewalDue, 'yyyy-MM-dd') : '',
      row.latestRecord?.checkDate || '',
      row.latestRecord?.outcome || '',
    ]);
    const csv = [
      ['Instructor', 'Level', 'S&P interval', 'S&P status', 'S&P due', 'Renewal status', 'Renewal due', 'Latest check', 'Latest outcome'],
      ...rows,
    ].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `instructor-compliance-register-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openForm = async (record: InstructorComplianceRecord) => {
    if (!record.raausFormPath) return;
    try {
      window.open(await createFormUrl(record.raausFormPath), '_blank', 'noopener,noreferrer');
    } catch (openError) {
      console.error('Could not open renewal form:', openError);
      toast.error('Could not open the protected renewal form');
    }
  };

  if (!isCfi) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
        <LockKeyhole className="mx-auto h-10 w-10 text-gray-400" />
        <h2 className="mt-3 text-lg font-bold text-gray-900 dark:text-gray-100">CFI access required</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Instructor compliance records are not available to an admin or instructor unless they also hold the CFI role.</p>
      </div>
    );
  }

  if (loading || usersLoading) {
    return <div className="flex min-h-72 flex-col items-center justify-center gap-3"><Loader2 className="h-8 w-8 animate-spin text-cyan-600" /><p className="font-semibold text-gray-700 dark:text-gray-200">Loading protected instructor register...</p></div>;
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-400/20 dark:bg-red-950/30 dark:text-red-200">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl bg-gradient-to-r from-slate-950 via-cyan-950 to-slate-900 text-white shadow-sm">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-200"><ShieldCheck className="h-4 w-4" /> CFI-only register</div>
              <h2 className="mt-2 text-2xl font-bold">Instructor Standards &amp; Proficiency</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-cyan-100">Routine S&amp;P is due every 90 days for Instructors and every 12 months for Senior Instructors. Both ratings require renewal every two years.</p>
            </div>
            <button type="button" onClick={exportRegister} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-50"><Download className="h-4 w-4" /> Export register</button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-white/10 p-4"><p className="text-xs font-bold uppercase text-cyan-200">Current</p><p className="mt-1 text-2xl font-bold">{summary.current}</p></div>
            <div className="rounded-lg border border-white/10 bg-white/10 p-4"><p className="text-xs font-bold uppercase text-cyan-200">Due within 30 days</p><p className="mt-1 text-2xl font-bold">{summary.dueSoon}</p></div>
            <div className="rounded-lg border border-white/10 bg-white/10 p-4"><p className="text-xs font-bold uppercase text-cyan-200">Needs action</p><p className="mt-1 text-2xl font-bold">{summary.action}</p></div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Search instructor or email..." className="w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm dark:border-[#3b414c] dark:bg-[#11141a]" />
        </label>
      </section>

      <section className="space-y-3">
        {visibleRows.map(row => {
          const expanded = expandedInstructorId === row.id;
          return (
            <article key={row.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c2f36] dark:bg-[#171a21]">
              <button type="button" onClick={() => setExpandedInstructorId(expanded ? null : row.id)} className="flex w-full flex-col gap-4 p-4 text-left sm:p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-gray-900 dark:text-gray-100">{row.name}</h3><span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200">{row.level}</span></div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{row.email} &middot; S&amp;P every {row.intervalLabel}</p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto lg:min-w-[520px]">
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-[#343943]"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase text-gray-500">S&amp;P</span><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[row.spStatus]}`}>{statusLabel[row.spStatus]}</span></div><p className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-100">{formatDue(row.spDue)}</p></div>
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-[#343943]"><div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase text-gray-500">2-year renewal</span><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusStyles[row.renewalStatus]}`}>{statusLabel[row.renewalStatus]}</span></div><p className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-100">{formatDue(row.renewalDue)}</p></div>
                </div>
                {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-gray-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />}
              </button>

              {expanded && (
                <div className="border-t border-gray-200 bg-gray-50 p-4 dark:border-[#343943] dark:bg-[#11141a] sm:p-5">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Protected check history</h4>
                  {row.records.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-950/20 dark:text-amber-100"><AlertTriangle className="mr-2 inline h-4 w-4" />No CFI compliance record has been completed for this instructor.</div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {row.records.map(record => (
                        <div key={record.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-[#343943] dark:bg-[#171a21] md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-gray-900 dark:text-gray-100">{record.checkType === 'sp_check' ? 'Standards & Proficiency' : record.checkType === 'renewal' ? 'Instructor renewal' : 'Initial issue'}</p><span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${record.outcome === 'satisfactory' ? statusStyles.current : statusStyles.remedial}`}>{record.outcome === 'satisfactory' ? 'Satisfactory' : 'Unsatisfactory'}</span></div>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{format(parseISO(record.checkDate), 'd MMM yyyy')} &middot; {record.groundMinutes} min ground &middot; {record.flightMinutes} min flight</p>
                          </div>
                          {record.raausFormPath && <button type="button" onClick={() => openForm(record)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-800 dark:border-cyan-400/30 dark:text-cyan-200"><FileCheck className="h-4 w-4" /> Renewal form <ExternalLink className="h-3.5 w-3.5" /></button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>

      {visibleRows.length === 0 && <div className="rounded-xl border border-gray-200 bg-white p-10 text-center dark:border-[#2c2f36] dark:bg-[#171a21]"><CheckCircle className="mx-auto h-10 w-10 text-gray-300" /><p className="mt-3 font-semibold text-gray-700 dark:text-gray-200">No instructors match this search.</p></div>}

      <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950 dark:border-cyan-400/20 dark:bg-cyan-950/20 dark:text-cyan-100">
        <p className="font-bold"><Clock className="mr-2 inline h-4 w-4" />How records enter this register</p>
        <p className="mt-1">Book the instructor as the pilot/student with a CFI as the instructor, log the flight, then complete the protected S&amp;P or renewal checklist from Outstanding Records. An ordinary admin cannot open this register or its attached forms unless they also hold the CFI role.</p>
      </section>
    </div>
  );
};
