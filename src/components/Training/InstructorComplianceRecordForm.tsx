import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronUp, ClipboardCheck, FileUp, Loader2, ShieldCheck, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import type { User } from '../../types';
import type { OutstandingFlightLog } from '../../hooks/useOutstandingRecords';
import {
  InstructorComplianceCheckType,
  InstructorComplianceChecklistResult,
  InstructorComplianceItemResult,
  InstructorComplianceLevel,
  useInstructorCompliance,
} from '../../hooks/useInstructorCompliance';

interface InstructorComplianceRecordFormProps {
  flightLog: OutstandingFlightLog;
  candidate: User;
  examiner: User;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
}

const resultOptions: Array<{
  value: InstructorComplianceItemResult;
  label: string;
  className: string;
}> = [
  { value: 'not_assessed', label: 'Not assessed', className: 'border-gray-300 text-gray-600 dark:border-[#3b414c] dark:text-gray-300' },
  { value: 'satisfactory', label: 'Satisfactory', className: 'border-emerald-500 text-emerald-700 dark:text-emerald-300' },
  { value: 'unsatisfactory', label: 'Needs attention', className: 'border-red-500 text-red-700 dark:text-red-300' },
];

const checkTypeLabels: Record<InstructorComplianceCheckType, string> = {
  initial_issue: 'Initial instructor issue',
  sp_check: 'Standards & Proficiency check',
  renewal: 'Instructor rating renewal',
};

export const InstructorComplianceRecordForm: React.FC<InstructorComplianceRecordFormProps> = ({
  flightLog,
  candidate,
  examiner,
  onClose,
  onCompleted,
}) => {
  const { courses, items, loading, error, saveRecord, uploadRenewalForm } = useInstructorCompliance(true);
  const isSenior = candidate.roles?.includes('senior_instructor') || candidate.role === 'senior_instructor';
  const instructorLevel: InstructorComplianceLevel = isSenior ? 'senior_instructor' : 'instructor';
  const [checkType, setCheckType] = useState<InstructorComplianceCheckType>('sp_check');
  const [checkDate, setCheckDate] = useState(() => format(new Date(flightLog.start_time), 'yyyy-MM-dd'));
  const [groundMinutes, setGroundMinutes] = useState(60);
  const [flightMinutes, setFlightMinutes] = useState(() => Math.max(0, Math.round(((flightLog.dual_time || 0) + (flightLog.solo_time || 0)) * 60)));
  const [briefingLesson, setBriefingLesson] = useState('');
  const [emergencyControlPlanConfirmed, setEmergencyControlPlanConfirmed] = useState(false);
  const [medicalSighted, setMedicalSighted] = useState(false);
  const [results, setResults] = useState<Record<string, InstructorComplianceChecklistResult>>({});
  const [strengths, setStrengths] = useState('');
  const [deficiencies, setDeficiencies] = useState('');
  const [developmentPlan, setDevelopmentPlan] = useState('');
  const [cfiComments, setCfiComments] = useState('');
  const [renewalForm, setRenewalForm] = useState<File | null>(null);
  const [showTolerances, setShowTolerances] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const course = courses[0];
  const applicableItems = useMemo(
    () => items.filter(item =>
      item.courseId === course?.id
      && item.applicableLevels.includes(instructorLevel)
      && item.applicableCheckTypes.includes(checkType)
    ),
    [checkType, course?.id, instructorLevel, items]
  );

  const sections = useMemo(() => {
    const grouped = new Map<string, typeof applicableItems>();
    applicableItems.forEach(item => grouped.set(item.section, [...(grouped.get(item.section) || []), item]));
    return [...grouped.entries()];
  }, [applicableItems]);

  useEffect(() => {
    setResults(current => {
      const next = { ...current };
      applicableItems.forEach(item => {
        if (!next[item.id]) {
          next[item.id] = {
            itemId: item.id,
            code: item.code,
            title: item.title,
            result: 'not_assessed',
            notes: '',
          };
        }
      });
      return next;
    });
  }, [applicableItems]);

  const assessedCount = applicableItems.filter(item => {
    const result = results[item.id]?.result;
    return Boolean(result && result !== 'not_assessed');
  }).length;
  const unsatisfactoryCount = applicableItems.filter(item => results[item.id]?.result === 'unsatisfactory').length;
  const requiredIncomplete = applicableItems.filter(
    item => item.required && (results[item.id]?.result || 'not_assessed') === 'not_assessed'
  );

  const setItemResult = (itemId: string, result: InstructorComplianceItemResult) => {
    setResults(current => ({
      ...current,
      [itemId]: { ...current[itemId], result },
    }));
  };

  const setItemNotes = (itemId: string, notes: string) => {
    setResults(current => ({
      ...current,
      [itemId]: { ...current[itemId], notes },
    }));
  };

  const handleSubmit = async () => {
    if (!course) {
      toast.error('The CFI compliance course is not available');
      return;
    }
    if (!briefingLesson.trim()) {
      toast.error('Record the examiner-nominated briefing lesson');
      return;
    }
    if (!medicalSighted || !emergencyControlPlanConfirmed) {
      toast.error('Confirm the medical and emergency control plan before completing the check');
      return;
    }
    if (requiredIncomplete.length > 0) {
      toast.error(`Complete all required checklist items (${requiredIncomplete.length} remaining)`);
      return;
    }
    if (checkType === 'renewal' && !renewalForm) {
      toast.error('Attach the completed RAAus instructor renewal form');
      return;
    }
    if (unsatisfactoryCount > 0 && !developmentPlan.trim()) {
      toast.error('Add a remedial development plan for the below-standard items');
      return;
    }

    try {
      setSubmitting(true);
      let formUpload: { path: string; name: string } | undefined;
      if (renewalForm) {
        formUpload = await uploadRenewalForm(candidate.id, renewalForm);
      }

      const outcome = unsatisfactoryCount > 0 ? 'unsatisfactory' : 'satisfactory';
      await saveRecord({
        courseId: course.id,
        candidateInstructorId: candidate.id,
        examinerCfiId: examiner.id,
        bookingId: flightLog.booking_id,
        flightLogId: flightLog.id,
        checkType,
        instructorLevel,
        checkDate,
        status: outcome === 'satisfactory' ? 'completed' : 'remedial_required',
        outcome,
        groundMinutes,
        flightMinutes,
        briefingLesson: briefingLesson.trim(),
        emergencyControlPlanConfirmed,
        medicalSighted,
        checklist: applicableItems.map(item => results[item.id] || {
          itemId: item.id,
          code: item.code,
          title: item.title,
          result: 'not_assessed',
          notes: '',
        }),
        strengths: strengths.trim(),
        deficiencies: deficiencies.trim(),
        developmentPlan: developmentPlan.trim(),
        cfiComments: cfiComments.trim(),
        raausFormPath: formUpload?.path,
        raausFormName: formUpload?.name,
      });

      await onCompleted();
      toast.success(outcome === 'satisfactory' ? 'Instructor check completed' : 'Remedial action recorded');
      onClose();
    } catch (submitError) {
      console.error('Failed to save instructor compliance record:', submitError);
      toast.error(submitError instanceof Error ? submitError.message : 'Failed to save instructor check');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-900/20 bg-white shadow-sm dark:border-cyan-400/20 dark:bg-[#171a21]">
      <header className="bg-gradient-to-r from-slate-950 via-cyan-950 to-slate-900 px-4 py-5 text-white sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-200">
              <ShieldCheck className="h-4 w-4" /> CFI protected record
            </div>
            <h2 className="mt-2 text-xl font-bold">Instructor Standards &amp; Proficiency</h2>
            <p className="mt-1 text-sm text-cyan-100">
              {candidate.name} &middot; {isSenior ? 'Senior Instructor' : 'Instructor'} &middot; {format(new Date(flightLog.start_time), 'd MMM yyyy')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-cyan-100 hover:bg-white/10" aria-label="Close instructor check">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-gray-600 dark:text-gray-300">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
          <p className="font-semibold">Loading the protected CFI checklist...</p>
        </div>
      ) : error ? (
        <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : (
        <div className="space-y-6 p-4 sm:p-6">
          <section className="grid gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-[#343943] dark:bg-[#11141a] md:grid-cols-2 xl:grid-cols-4">
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Check type
              <select value={checkType} onChange={event => setCheckType(event.target.value as InstructorComplianceCheckType)} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#171a21]">
                {Object.entries(checkTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Check date
              <input type="date" value={checkDate} onChange={event => setCheckDate(event.target.value)} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#171a21]" />
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Ground component
              <div className="mt-2 flex items-center gap-2"><input type="number" min="0" step="15" value={groundMinutes} onChange={event => setGroundMinutes(Number(event.target.value))} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#171a21]" /><span className="text-xs text-gray-500">min</span></div>
            </label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
              Flight component
              <div className="mt-2 flex items-center gap-2"><input type="number" min="0" step="5" value={flightMinutes} onChange={event => setFlightMinutes(Number(event.target.value))} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#171a21]" /><span className="text-xs text-gray-500">min</span></div>
            </label>
          </section>

          <section className="rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950 dark:border-cyan-400/20 dark:bg-cyan-950/20 dark:text-cyan-100">
            <p className="font-semibold">RAAP 7 planning note</p>
            <p className="mt-1 leading-6">Initial issue and renewal should be a substantial assessment, commonly 3-4 hours overall with at least one hour in flight. A routine S&amp;P remains a genuine competence and standardisation check, not a circuit-only review.</p>
            <button type="button" onClick={() => setShowTolerances(value => !value)} className="mt-3 inline-flex items-center gap-1 font-semibold text-cyan-800 dark:text-cyan-200">
              {showTolerances ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} RAAP 7 flight tolerances
            </button>
            {showTolerances && (
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                <span>Taxi centreline: +/-1 m</span><span>Heading: +/-10 degrees</span><span>Level flight: +/-150 ft, +/-10 kt</span>
                <span>Climb: -0/+5 kt</span><span>Turns: +/-5 degrees bank</span><span>Steep turn: +/-150 ft, +/-10 degrees</span>
                <span>Final: -0/+5 kt</span><span>Touchdown: +/-60 m</span><span>Landing centreline: +/-2 m</span>
              </div>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100 md:col-span-2">
              Examiner-nominated briefing lesson
              <input value={briefingLesson} onChange={event => setBriefingLesson(event.target.value)} placeholder="For example: Forced landings" className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#11141a]" />
            </label>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 dark:border-[#343943] dark:text-gray-100">
              <input type="checkbox" checked={medicalSighted} onChange={event => setMedicalSighted(event.target.checked)} className="h-5 w-5 rounded border-gray-300 text-cyan-600" />
              Current Class 2 or MED003 sighted
            </label>
            <label className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-800 dark:border-[#343943] dark:text-gray-100">
              <input type="checkbox" checked={emergencyControlPlanConfirmed} onChange={event => setEmergencyControlPlanConfirmed(event.target.checked)} className="h-5 w-5 rounded border-gray-300 text-cyan-600" />
              Real-emergency control plan agreed
            </label>
          </section>

          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">CFI checklist</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{course?.name} &middot; version {course?.version}</p>
              </div>
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700 dark:bg-[#262b33] dark:text-gray-200">
                {assessedCount}/{applicableItems.length} assessed
              </div>
            </div>

            <div className="space-y-5">
              {sections.map(([section, sectionItems]) => (
                <div key={section} className="overflow-hidden rounded-lg border border-gray-200 dark:border-[#343943]">
                  <div className="border-b border-gray-200 bg-slate-900 px-4 py-3 text-sm font-bold text-white dark:border-[#343943]">{section}</div>
                  <div className="divide-y divide-gray-200 dark:divide-[#343943]">
                    {sectionItems.map(item => {
                      const result = results[item.id]?.result || 'not_assessed';
                      return (
                        <article key={item.id} className="p-4">
                          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-600 dark:bg-[#262b33] dark:text-gray-300">{item.code}</span>
                                <p className="font-semibold leading-6 text-gray-900 dark:text-gray-100">{item.title}</p>
                              </div>
                              {item.guidance && <p className="mt-1 text-sm leading-5 text-gray-500 dark:text-gray-400">{item.guidance}</p>}
                            </div>
                            <div className="grid shrink-0 grid-cols-3 gap-2">
                              {resultOptions.map(option => (
                                <button key={option.value} type="button" onClick={() => setItemResult(item.id, option.value)} className={`min-h-10 rounded-md border px-2 py-2 text-xs font-bold transition ${option.className} ${result === option.value ? 'ring-2 ring-cyan-500 ring-offset-1 dark:ring-offset-[#171a21]' : 'opacity-65 hover:opacity-100'}`}>
                                  {option.value === 'satisfactory' && <Check className="mx-auto mb-0.5 h-3.5 w-3.5" />}
                                  {option.value === 'unsatisfactory' && <XCircle className="mx-auto mb-0.5 h-3.5 w-3.5" />}
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {result === 'unsatisfactory' && (
                            <textarea value={results[item.id]?.notes || ''} onChange={event => setItemNotes(item.id, event.target.value)} placeholder="Record the observed deficiency and evidence..." rows={2} className="mt-3 w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950 dark:border-red-400/20 dark:bg-red-950/20 dark:text-red-100" />
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Strengths<textarea value={strengths} onChange={event => setStrengths(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#11141a]" /></label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Deficiencies<textarea value={deficiencies} onChange={event => setDeficiencies(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#11141a]" /></label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">Development / remedial plan<textarea value={developmentPlan} onChange={event => setDevelopmentPlan(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#11141a]" /></label>
            <label className="block text-sm font-semibold text-gray-800 dark:text-gray-100">CFI comments<textarea value={cfiComments} onChange={event => setCfiComments(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal dark:border-[#3b414c] dark:bg-[#11141a]" /></label>
          </section>

          {checkType === 'renewal' && (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-950/20">
              <label className="block text-sm font-bold text-amber-950 dark:text-amber-100">
                RAAus instructor renewal form <span className="text-red-600">*</span>
                <span className="mt-1 block text-xs font-normal leading-5 text-amber-800 dark:text-amber-200">Attach the completed INS002 or the current replacement form. The renewal cannot be completed without it.</span>
                <span className="mt-3 flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-dashed border-amber-400 bg-white px-4 py-3 dark:bg-[#11141a]">
                  <FileUp className="h-5 w-5" /> {renewalForm?.name || 'Choose renewal form'}
                  <input type="file" className="sr-only" onChange={event => setRenewalForm(event.target.files?.[0] || null)} />
                </span>
              </label>
            </section>
          )}

          <section className={`rounded-lg border p-4 ${unsatisfactoryCount > 0 ? 'border-red-200 bg-red-50 dark:border-red-400/20 dark:bg-red-950/20' : 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/20 dark:bg-emerald-950/20'}`}>
            <div className="flex items-start gap-3">
              {unsatisfactoryCount > 0 ? <AlertTriangle className="mt-0.5 h-5 w-5 text-red-600" /> : <ClipboardCheck className="mt-0.5 h-5 w-5 text-emerald-600" />}
              <div>
                <p className="font-bold text-gray-900 dark:text-gray-100">{unsatisfactoryCount > 0 ? 'Remedial action required' : 'Satisfactory when all required items are assessed'}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{requiredIncomplete.length} required item{requiredIncomplete.length === 1 ? '' : 's'} remaining; {unsatisfactoryCount} below standard.</p>
              </div>
            </div>
          </section>

          <footer className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-5 dark:border-[#343943] sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="min-h-11 rounded-md border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 dark:border-[#3b414c] dark:text-gray-200">Cancel</button>
            <button type="button" disabled={submitting || requiredIncomplete.length > 0} onClick={handleSubmit} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-cyan-700 px-5 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {submitting ? 'Saving protected record...' : 'Complete CFI check'}
            </button>
          </footer>
        </div>
      )}
    </div>
  );
};
