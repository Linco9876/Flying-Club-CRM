import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Shield, Award, BookOpen, RefreshCw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { useSafetyReports } from '../../hooks/useSafetyReports';
import { supabase } from '../../lib/supabase';
import { StudentExamResult } from '../../types';

interface AccountTimelineSettingsProps {
  canEdit: boolean;
  onFormChange: () => void;
}

interface TimelineEvent {
  id: string;
  date: Date | null;
  title: string;
  detail: string;
  kind: 'Training' | 'Exam' | 'Safety';
}

export const AccountTimelineSettings: React.FC<AccountTimelineSettingsProps> = () => {
  const { user } = useAuth();
  const { trainingRecords, loading: recordsLoading, error: recordsError, refetch: refetchRecords } = useTrainingRecords(user?.id);
  const { modules, loading: modulesLoading, error: modulesError, refetch: refetchModules } = useTrainingModules();
  const { reports: safetyReports, loading: safetyLoading, error: safetyError, refetch: refetchSafety } = useSafetyReports({ participateInPageLoad: false });
  const [examResults, setExamResults] = useState<StudentExamResult[]>([]);
  const [loadingExams, setLoadingExams] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);
  const [examReloadKey, setExamReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadExams = async () => {
      if (!user?.id) return;
      setLoadingExams(true);
      const { data, error } = await supabase
        .from('student_exam_results')
        .select('id,student_id,course_id,exam_id,exam_name,score,pass_mark,result,exam_date,notes,created_at')
        .eq('student_id', user.id)
        .order('exam_date', { ascending: false });

      if (!mounted) return;
      if (error) {
        console.error('Failed to load student timeline exams:', error);
        setExamResults([]);
        setExamError(error.message);
      } else {
        setExamResults((data || []).map((result: any) => ({
          id: result.id,
          studentId: result.student_id,
          courseId: result.course_id,
          examId: result.exam_id,
          examName: result.exam_name,
          score: result.score,
          passMark: result.pass_mark,
          result: result.result,
          examDate: result.exam_date ? new Date(result.exam_date) : new Date(),
          notes: result.notes || '',
          createdAt: result.created_at ? new Date(result.created_at) : new Date(),
        })));
        setExamError(null);
      }
      setLoadingExams(false);
    };

    void loadExams();
    return () => {
      mounted = false;
    };
  }, [examReloadKey, user?.id]);

  const events = useMemo(() => {
    if (!user?.id) return [] as TimelineEvent[];

    const trainingEvents: TimelineEvent[] = trainingRecords
      .filter((record) => record.studentId === user.id)
      .map((record) => {
        const course = modules.find((item) => item.id === record.courseId);
        const lesson = course?.lessons.find((item) => item.id === record.lessonId);
        return {
          id: `training-${record.id}`,
          date: record.bookingStartTime || record.date,
          title: lesson?.name || lesson?.sequenceTitle || 'Training record',
          detail: [course?.title, record.registration || null].filter(Boolean).join(' | '),
          kind: 'Training',
        };
      });

    const examEvents: TimelineEvent[] = examResults.map((result) => {
      const course = modules.find((item) => item.id === result.courseId);
      return {
        id: `exam-${result.id}`,
        date: result.examDate,
        title: result.examName,
        detail: [course?.title, `${result.score}% (${result.result})`].filter(Boolean).join(' | '),
        kind: 'Exam',
      };
    });

    const safetyEvents: TimelineEvent[] = safetyReports
      .filter((report) => report.reporterId === user.id || report.involvedUserIds.includes(user.id))
      .map((report) => ({
        id: `safety-${report.id}`,
        date: report.createdAt,
        title: report.title,
        detail: [report.reportType.replace(/_/g, ' '), report.status.replace(/_/g, ' ')].join(' | '),
        kind: 'Safety',
      }));

    return [...trainingEvents, ...examEvents, ...safetyEvents].sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.getTime() - a.date.getTime();
    });
  }, [examResults, modules, safetyReports, trainingRecords, user?.id]);

  const loading = recordsLoading || modulesLoading || loadingExams || safetyLoading;
  const sourceErrors = [
    recordsError && `Training records: ${recordsError}`,
    modulesError && `Training courses: ${modulesError}`,
    examError && `Exam results: ${examError}`,
    safetyError && `Safety reports: ${safetyError}`,
  ].filter((message): message is string => Boolean(message));

  const iconFor = (kind: TimelineEvent['kind']) => {
    if (kind === 'Exam') return <Award className="h-4 w-4 text-amber-600" />;
    if (kind === 'Safety') return <Shield className="h-4 w-4 text-rose-600" />;
    return <BookOpen className="h-4 w-4 text-blue-600" />;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Timeline</h2>
        <p className="mt-1 text-sm text-gray-600">Recent training, exam and safety activity for your account.</p>
      </div>

      {sourceErrors.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Some timeline activity is unavailable</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {sourceErrors.map(message => <li key={message}>{message}</li>)}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => {
                setExamReloadKey(value => value + 1);
                void Promise.all([refetchRecords(), refetchModules(), refetchSafety()]);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-semibold"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Clock3 className="h-4 w-4 animate-pulse" />
            Loading timeline...
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-gray-500">No timeline items are recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {events.map((event, index) => (
              <div key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="rounded-full border border-gray-200 bg-gray-50 p-2">
                    {iconFor(event.kind)}
                  </div>
                  {index < events.length - 1 ? <div className="mt-2 h-full w-px bg-gray-200" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{event.title}</p>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600">
                      {event.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {event.date
                      ? event.date.toLocaleString('en-AU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'No recorded date'}
                  </p>
                  {event.detail ? <p className="mt-1 text-sm text-gray-600">{event.detail}</p> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
