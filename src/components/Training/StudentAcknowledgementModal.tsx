import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, FileText, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useStudentCourseEnrolments } from '../../hooks/useStudentCourseEnrolments';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useTrainingSettings } from '../../hooks/useTrainingSettings';
import { TrainingModule, TrainingRecord } from '../../types';

const stripHtml = (value: string) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const createAuditId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isUnder18 = (dateOfBirth?: Date) => {
  if (!dateOfBirth) return false;
  const today = new Date();
  const eighteenthBirthday = new Date(dateOfBirth);
  eighteenthBirthday.setFullYear(eighteenthBirthday.getFullYear() + 18);
  return today < eighteenthBirthday;
};

export const StudentAcknowledgementModal: React.FC = () => {
  const { user } = useAuth();
  const { modules } = useTrainingModules();
  const { trainingRecords, loading, updateTrainingRecord } = useTrainingRecords();
  const {
    enrolments,
    loading: enrolmentsLoading,
    signCourseDeclaration,
  } = useStudentCourseEnrolments(user?.id);
  const { settings } = useTrainingSettings();
  const [dismissed, setDismissed] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [acknowledgingAll, setAcknowledgingAll] = useState(false);
  const [signingDeclarationId, setSigningDeclarationId] = useState<string | null>(null);
  const [declarationSignatureName, setDeclarationSignatureName] = useState('');
  const [declarationMemberNumber, setDeclarationMemberNumber] = useState('');

  const isStudentLike = Boolean(user && (user.role === 'student' || user.role === 'pilot' || user.roles?.some(role => role === 'student' || role === 'pilot')));

  const pendingRecords = useMemo(() => {
    if (!user || !isStudentLike) return [];
    return trainingRecords
      .filter(record => {
        if (record.studentId !== user.id || record.status !== 'submitted' || record.studentAck) return false;
        if (settings.forceStudentAcknowledgementForAllCourses) return true;
        const course = modules.find(module => module.id === record.courseId);
        return Boolean(course?.requiresStudentAcknowledgement);
      })
      .sort((a, b) => (b.bookingStartTime || b.date).getTime() - (a.bookingStartTime || a.date).getTime());
  }, [isStudentLike, modules, settings.forceStudentAcknowledgementForAllCourses, trainingRecords, user]);

  const pendingDeclarations = useMemo(() => {
    if (!user || !isStudentLike) return [];
    return enrolments
      .filter(enrolment => enrolment.studentId === user.id && enrolment.status === 'active')
      .map(enrolment => {
        const course = modules.find(module => module.id === enrolment.courseId);
        if (!course?.requiresFlyingDeclaration || !course.flyingDeclarationText?.trim()) return null;
        const requiredVersion = course.flyingDeclarationVersion ?? 1;
        const signedVersion = enrolment.declarationVersion ?? 0;
        const studentIsMinor = isUnder18(user.dateOfBirth);
        const guardianRequired = studentIsMinor && (course.requiresGuardianDeclarationForMinors ?? true) && Boolean(course.guardianDeclarationText?.trim());
        const guardianSignedVersion = enrolment.guardianDeclarationVersion ?? 0;
        const needsStudentSignature = !enrolment.declarationSignedAt || signedVersion < requiredVersion;
        const needsGuardianSignature = guardianRequired && (!enrolment.guardianDeclarationSignedAt || guardianSignedVersion < requiredVersion);
        const needsSignature = needsStudentSignature || needsGuardianSignature;
        if (!needsSignature) return null;
        return { enrolment, course, guardianRequired, needsStudentSignature, needsGuardianSignature };
      })
      .filter((item): item is { enrolment: typeof enrolments[number]; course: TrainingModule; guardianRequired: boolean; needsStudentSignature: boolean; needsGuardianSignature: boolean } => Boolean(item))
      .sort((a, b) => a.course.title.localeCompare(b.course.title));
  }, [enrolments, isStudentLike, modules, user]);

  const activeDeclaration = pendingDeclarations[0];

  React.useEffect(() => {
    if (!activeDeclaration || !user) return;
    setDeclarationSignatureName(activeDeclaration.enrolment.declarationSignedName || user.name || user.email || '');
    setDeclarationMemberNumber(activeDeclaration.enrolment.declarationMemberNumber || '');
  }, [activeDeclaration?.enrolment.id, activeDeclaration?.enrolment.declarationSignedName, activeDeclaration?.enrolment.declarationMemberNumber, user]);

  const lessonNameForRecord = (record: TrainingRecord) => {
    const course = modules.find(module => module.id === record.courseId);
    const lesson = course?.lessons.find(item => item.id === record.lessonId);
    const fallbackLesson = record.lessonCodes
      .map(code => course?.lessons.find(item => item.sequenceCode === code))
      .find(Boolean);
    return lesson?.name || fallbackLesson?.name || record.lessonCodes[0] || 'Training record';
  };

  const acknowledgeRecord = async (record: TrainingRecord, silent = false) => {
    if (!user) return;
    const latestRevision = record.auditLog
      ?.filter(entry => entry.action === 'record_revised_after_student_acknowledgement')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
    const acknowledgementTime = new Date();
    await updateTrainingRecord(record.id, {
      studentAck: true,
      studentAckName: user.name || user.email,
      studentAckTimestamp: acknowledgementTime,
      status: settings.lockRecordAfterStudentAck ? 'locked' : 'submitted',
      auditLog: [
        ...(record.auditLog || []),
        {
          id: createAuditId(),
          timestamp: acknowledgementTime,
          userId: user.id,
          userName: user.name || user.email || 'Student',
          action: latestRevision ? 'student_acknowledged_revised_record' : 'student_acknowledged_record',
          changes: latestRevision ? {
            revisedRecordAcknowledged: true,
            revisionTimestamp: latestRevision.timestamp.toISOString(),
          } : {
            recordAcknowledged: true,
          },
        },
      ],
    });
    if (!silent) toast.success('Lesson record acknowledged');
  };

  const handleAcknowledgeOne = async (record: TrainingRecord) => {
    setAcknowledgingId(record.id);
    try {
      await acknowledgeRecord(record);
    } catch {
      // updateTrainingRecord already shows the error toast
    } finally {
      setAcknowledgingId(null);
    }
  };

  const handleAcknowledgeAll = async () => {
    setAcknowledgingAll(true);
    try {
      for (const record of pendingRecords) {
        await acknowledgeRecord(record, true);
      }
      toast.success('All lesson records acknowledged');
    } catch {
      // updateTrainingRecord already shows the error toast
    } finally {
      setAcknowledgingAll(false);
    }
  };

  const handleSignDeclaration = async () => {
    if (!activeDeclaration) return;
    if (activeDeclaration.needsStudentSignature && !declarationSignatureName.trim()) {
      toast.error('Type your full name to sign the declaration');
      return;
    }
    if (!activeDeclaration.needsStudentSignature && activeDeclaration.needsGuardianSignature) {
      toast.error('A parent/guardian must sign using their one-time signing link');
      return;
    }

    setSigningDeclarationId(activeDeclaration.enrolment.id);
    try {
      await signCourseDeclaration({
        enrolmentId: activeDeclaration.enrolment.id,
        signatureName: declarationSignatureName || activeDeclaration.enrolment.declarationSignedName || user?.name || user?.email || '',
        memberNumber: declarationMemberNumber || activeDeclaration.enrolment.declarationMemberNumber || '',
        declarationText: activeDeclaration.course.flyingDeclarationText || '',
        declarationVersion: activeDeclaration.course.flyingDeclarationVersion ?? 1,
      });
    } finally {
      setSigningDeclarationId(null);
    }
  };

  if (!isStudentLike || loading || enrolmentsLoading || dismissed || (pendingDeclarations.length === 0 && pendingRecords.length === 0)) {
    return null;
  }

  if (activeDeclaration) {
    const course = activeDeclaration.course;
    const isSigning = signingDeclarationId === activeDeclaration.enrolment.id;
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
          <div className="border-b border-gray-200 px-6 py-5">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-sm font-semibold uppercase tracking-wide">Flying declaration required</p>
            </div>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">
              {course.flyingDeclarationTitle || 'Flying Declaration'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              You are enrolled in {course.title}. Please read and digitally sign the required declaration before continuing your course records.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="whitespace-pre-line text-sm leading-6 text-gray-900">
                {course.flyingDeclarationText}
              </p>
            </div>

            {activeDeclaration.needsStudentSignature ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col text-sm font-medium text-gray-700">
                  Student full name electronic signature
                  <input
                    type="text"
                    value={declarationSignatureName}
                    onChange={(event) => setDeclarationSignatureName(event.target.value)}
                    className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
                <label className="flex flex-col text-sm font-medium text-gray-700">
                  Member number
                  <input
                    type="text"
                    value={declarationMemberNumber}
                    onChange={(event) => setDeclarationMemberNumber(event.target.value)}
                    placeholder="RAAus or club member number"
                    className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </label>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Student declaration already signed by {activeDeclaration.enrolment.declarationSignedName || 'student'} on {activeDeclaration.enrolment.declarationSignedAt?.toLocaleDateString('en-AU') || 'date recorded'}.
              </div>
            )}

            {activeDeclaration.needsGuardianSignature && (
              <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <h3 className="text-sm font-semibold text-blue-950">
                  {course.guardianDeclarationTitle || 'Under 18 Years - Parent/Guardian Declaration'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-blue-950">
                  A parent or legal guardian must sign this declaration using their own one-time signing link.
                  If they have not received it, ask an instructor or admin to resend the parent/guardian link from your course enrolment card.
                </p>
              </div>
            )}

            <p className="mt-4 text-xs leading-5 text-gray-500">
              By selecting Sign declaration, the CRM records the typed signature name, member/contact details, date, declaration version and exact declaration wording shown above.
              Declaration version {course.flyingDeclarationVersion ?? 1}.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              {pendingDeclarations.length > 1 ? `${pendingDeclarations.length - 1} more declaration${pendingDeclarations.length - 1 === 1 ? '' : 's'} will appear after this one.` : 'This declaration will stop appearing once signed.'}
            </p>
            <button
              type="button"
              onClick={handleSignDeclaration}
              disabled={isSigning || !activeDeclaration.needsStudentSignature}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              {activeDeclaration.needsStudentSignature ? 'Sign declaration' : 'Waiting for parent/guardian'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
          <div>
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-sm font-semibold uppercase tracking-wide">Acknowledgement required</p>
            </div>
            <h2 className="mt-1 text-xl font-semibold text-gray-900">
              {pendingRecords.length} lesson record{pendingRecords.length === 1 ? '' : 's'} waiting for you
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Review the lesson comments and assessment summary, then acknowledge the records below.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {pendingRecords.map(record => {
            const comments = stripHtml(record.comments);
            const briefing = stripHtml(record.briefingComments);
            const gradeCount = Object.values(record.criteriaGrades || {}).filter(grade => grade && grade !== '-').length;
            const isBusy = acknowledgingId === record.id || acknowledgingAll;

            return (
              <article key={record.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                      <FileText className="h-4 w-4 text-amber-700" />
                      {lessonNameForRecord(record)}
                    </h3>
                    <p className="mt-1 text-xs text-gray-600">
                      {format(record.bookingStartTime || record.date, 'dd MMM yyyy')} · {record.registration || record.aircraftType || 'Aircraft not recorded'} · {gradeCount} assessed criteria
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAcknowledgeOne(record)}
                    disabled={isBusy}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {acknowledgingId === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Acknowledge
                  </button>
                </div>

                {comments ? (
                  <div className="mt-3 rounded-md bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Instructor comments</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{comments}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-gray-500">No instructor comments recorded.</p>
                )}

                {briefing && (
                  <div className="mt-3 rounded-md bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Briefing comments</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-gray-800">{briefing}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-gray-500">
            Acknowledging confirms you have read the submitted lesson record.
          </p>
          <button
            type="button"
            onClick={handleAcknowledgeAll}
            disabled={acknowledgingAll || Boolean(acknowledgingId)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {acknowledgingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Acknowledge all
          </button>
        </div>
      </div>
    </div>
  );
};
