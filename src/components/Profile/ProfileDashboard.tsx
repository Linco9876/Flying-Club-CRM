import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Loader2,
  Mail,
  Plane,
  Phone,
  ShieldCheck,
  X,
  User as UserIcon
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { usePortalUxSettings } from '../../hooks/useSettings';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useStudentCourseEnrolments } from '../../hooks/useStudentCourseEnrolments';
import { useTrainingModules } from '../../context/TrainingModulesContext';
import { usePageLoadState } from '../../context/PageLoadContext';
import { supabase } from '../../lib/supabase';

interface ProfileStudentDetails {
  raausId?: string;
  casaId?: string;
  medicalType?: string;
  medicalExpiry?: Date;
  licenceExpiry?: Date;
  lastFlightReview?: Date;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

const formatCurrency = (amount: number, decimals: number) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(amount);

const formatHoursFromMinutes = (minutes: number) => (minutes / 60).toFixed(1);

export const ProfileDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { stats, loading } = useDashboardStats(user?.id, user?.role, 'user');
  const { settings: portalSettings } = usePortalUxSettings();
  const { trainingRecords, loading: trainingRecordsLoading } = useTrainingRecords(user?.id);
  const { modules: trainingCourses, loading: trainingCoursesLoading } = useTrainingModules();
  const { enrolments: courseEnrolments, loading: courseEnrolmentsLoading } = useStudentCourseEnrolments(user?.id);
  const [studentDetails, setStudentDetails] = useState<ProfileStudentDetails | null>(null);
  const [studentDetailsLoading, setStudentDetailsLoading] = useState(true);
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(false);
  const [showFlightStatsModal, setShowFlightStatsModal] = useState(false);
  const timePattern = portalSettings.time_format === '12h' ? 'h:mm a' : 'HH:mm';
  const datePattern = portalSettings.date_format || 'dd/MM/yyyy';
  const studentTrainingRecords = useMemo(
    () => trainingRecords.filter(record => record.studentId === user?.id),
    [trainingRecords, user?.id]
  );
  const activeCourseEnrolments = useMemo(
    () => courseEnrolments.filter((enrolment) => enrolment.status === 'active'),
    [courseEnrolments]
  );
  const courseProgressSummaries = useMemo(() => {
    return activeCourseEnrolments
      .map((enrolment) => {
        const course = trainingCourses.find((item) => item.id === enrolment.courseId);
        if (!course) return null;

        const courseRecords = studentTrainingRecords.filter((record) => record.courseId === course.id);
        const completedLessonIds = new Set(courseRecords.map((record) => record.lessonId).filter(Boolean));
        const totalLessons = course.lessons.length;
        const percent = totalLessons > 0 ? Math.min(100, Math.round((completedLessonIds.size / totalLessons) * 100)) : 0;
        const competentSequences = courseRecords.reduce(
          (sum, record) => sum + (record.sequences || []).filter((sequence) => sequence.competence === 'C').length,
          0
        );
        const recentRecords = [...courseRecords].sort((a, b) => {
          const aTime = (a.bookingStartTime || a.date).getTime();
          const bTime = (b.bookingStartTime || b.date).getTime();
          return bTime - aTime;
        }).slice(0, 3);
        const latestRecord = [...courseRecords].sort((a, b) => {
          const aTime = (a.bookingStartTime || a.date).getTime();
          const bTime = (b.bookingStartTime || b.date).getTime();
          return bTime - aTime;
        })[0];

        return {
          enrolment,
          course,
          completedLessons: completedLessonIds.size,
          totalLessons,
          percent,
          competentSequences,
          recentRecords,
          latestRecord,
          isComplete: totalLessons > 0 && completedLessonIds.size >= totalLessons,
        };
      })
      .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))
      .filter((summary) => !summary.isComplete);
  }, [activeCourseEnrolments, studentTrainingRecords, trainingCourses]);
  const currentCourseSummary = useMemo(() => {
    return [...courseProgressSummaries].sort((a, b) =>
      b.percent - a.percent ||
      b.completedLessons - a.completedLessons ||
      a.course.title.localeCompare(b.course.title)
    )[0] ?? null;
  }, [courseProgressSummaries]);
  const currentCourse = currentCourseSummary?.course ?? null;
  const nextLessonLabel = useMemo(() => {
    if (!currentCourseSummary) return null;
    if (currentCourseSummary.latestRecord?.nextLesson?.trim()) return currentCourseSummary.latestRecord.nextLesson.trim();
    if (!currentCourseSummary.latestRecord?.lessonId) {
      return currentCourseSummary.course.lessons[0]?.name || currentCourseSummary.course.lessons[0]?.sequenceTitle || null;
    }
    const currentIndex = currentCourseSummary.course.lessons.findIndex((lesson) => lesson.id === currentCourseSummary.latestRecord?.lessonId);
    const nextLesson = currentIndex >= 0 ? currentCourseSummary.course.lessons[currentIndex + 1] : undefined;
    return nextLesson?.name || nextLesson?.sequenceTitle || null;
  }, [currentCourseSummary]);
  const trainingOverview = currentCourseSummary
    ? {
        completedLessons: currentCourseSummary.completedLessons,
        totalLessons: currentCourseSummary.totalLessons,
        percent: currentCourseSummary.percent,
        competentSequences: currentCourseSummary.competentSequences,
        recentRecords: currentCourseSummary.recentRecords,
      }
    : null;
  const totalDualMinutes = studentTrainingRecords.reduce((sum, record) => sum + Number(record.dualTimeMin || 0), 0);
  const totalSoloMinutes = studentTrainingRecords.reduce((sum, record) => sum + Number(record.soloTimeMin || 0), 0);
  const totalFlightMinutes = totalDualMinutes + totalSoloMinutes;
  const lastFlightDate = useMemo(() => {
    return [...studentTrainingRecords]
      .map(record => record.bookingStartTime || record.date)
      .filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
  }, [studentTrainingRecords]);
  const isStudentUser = user?.role === 'student';
  const missingProfileFields = useMemo(() => {
    if (!user) return [];
    const missing: string[] = [];
    if (!(user.mobilePhone || user.phone || user.homePhone)) missing.push('phone');
    if (!user.dateOfBirth) missing.push('date of birth');
    if (!user.address?.trim()) missing.push('address');
    if (!studentDetails?.emergencyContact?.name?.trim()) missing.push('emergency contact');
    return missing;
  }, [studentDetails?.emergencyContact?.name, user]);
  const shouldShowProfilePrompt = Boolean(user && !profilePromptDismissed && missingProfileFields.length > 0);

  useEffect(() => {
    let mounted = true;

    const fetchStudentDetails = async () => {
      if (!user?.id) {
        setStudentDetailsLoading(false);
        return;
      }
      setStudentDetailsLoading(true);

      const { data, error } = await supabase
        .from('students')
        .select('raaus_id, casa_id, medical_type, medical_expiry, licence_expiry, last_flight_review, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship')
        .eq('id', user.id)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        console.error('Failed to load profile student details:', error);
        setStudentDetails(null);
        setStudentDetailsLoading(false);
        return;
      }

      setStudentDetails(data ? {
        raausId: data.raaus_id,
        casaId: data.casa_id,
        medicalType: data.medical_type,
        medicalExpiry: data.medical_expiry ? new Date(data.medical_expiry) : undefined,
        licenceExpiry: data.licence_expiry ? new Date(data.licence_expiry) : undefined,
        lastFlightReview: data.last_flight_review ? new Date(data.last_flight_review) : undefined,
        emergencyContact: data.emergency_contact_name ? {
          name: data.emergency_contact_name,
          phone: data.emergency_contact_phone || '',
          relationship: data.emergency_contact_relationship || ''
        } : user.emergencyContact
      } : {
        emergencyContact: user.emergencyContact
      });
      setStudentDetailsLoading(false);
    };

    fetchStudentDetails();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  usePageLoadState(
    loading || trainingRecordsLoading || trainingCoursesLoading || studentDetailsLoading || courseEnrolmentsLoading,
    'Loading your profile',
    'Preparing your schedule, training progress, compliance details and reminders...'
  );

  const complianceItems = useMemo(() => {
    const statusForDate = (date?: Date) => {
      if (!date) return { value: 'Not recorded', warn: true };
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const days = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (days < 0) return { value: `Expired ${format(date, datePattern)}`, warn: true };
      if (days <= 60) return { value: `Due ${format(date, datePattern)}`, warn: true };
      return { value: format(date, datePattern), warn: false };
    };
    const bfrDue = studentDetails?.lastFlightReview
      ? new Date(studentDetails.lastFlightReview.getFullYear() + 2, studentDetails.lastFlightReview.getMonth(), studentDetails.lastFlightReview.getDate())
      : undefined;

    return [
      { label: 'Membership', ...statusForDate(studentDetails?.licenceExpiry) },
      { label: 'Medical', ...statusForDate(studentDetails?.medicalExpiry) },
      ...(isStudentUser ? [] : [{ label: 'Flight review', ...statusForDate(bfrDue) }])
    ];
  }, [datePattern, isStudentUser, studentDetails]);

  if (loading || trainingRecordsLoading || trainingCoursesLoading || studentDetailsLoading || courseEnrolmentsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-transparent p-3 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        {shouldShowProfilePrompt && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-md shadow-blue-100/70 dark:border-blue-500/20 dark:bg-blue-500/10 dark:shadow-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-blue-950 dark:text-blue-100">Complete your profile</h2>
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Fill in your contact and emergency details so your account is ready to use properly.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProfilePromptDismissed(true)}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-transparent dark:text-blue-100 dark:hover:bg-blue-500/10"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/settings?tab=account-info')}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Update My Info
                </button>
              </div>
            </div>
          </div>
        )}
        <section className="relative h-[24rem] overflow-hidden rounded-2xl border border-gray-200 bg-[#dce8f6] shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#262b33] sm:h-[26rem] lg:h-[28rem]">
          <div className="absolute inset-0">
            {user?.coverPhoto && (
              <img src={user.coverPhoto} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5" />
          </div>

          <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div className="h-28 w-28 flex-shrink-0 overflow-hidden rounded-full border-4 border-white bg-blue-600 shadow-lg dark:border-[#171a21] sm:h-32 sm:w-32 md:h-40 md:w-40 xl:h-48 xl:w-48">
                  <div className="relative h-full w-full">
                  {user?.avatar ? (
                    <img src={user.avatar} alt={`${user.name} profile`} decoding="async" className="h-full w-full object-cover object-top" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center pt-1">
                      <UserIcon className="h-14 w-14 text-white sm:h-16 sm:w-16 md:h-20 md:w-20 xl:h-24 xl:w-24" />
                    </div>
                  )}
                  </div>
                </div>
                <div className="min-w-0 pb-1 text-white">
                  <h1 className="truncate text-2xl font-bold drop-shadow-sm sm:text-3xl">{user?.name}</h1>
                  <p className="truncate text-sm text-white/85 drop-shadow-sm">{user?.email}</p>
                </div>
              </div>

              <div className={`grid w-full min-w-0 gap-2 rounded-xl border border-white/20 bg-black/35 p-2 shadow-lg backdrop-blur-sm sm:w-[21rem] ${stats.myCreditVisible ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  onClick={() => setShowFlightStatsModal(true)}
                  className="min-w-0 rounded-lg bg-white/15 px-3 py-2 text-center text-white transition hover:bg-white/20"
                >
                  <p className="text-xs text-white/70">Hours</p>
                  <p className="truncate text-base font-bold tabular-nums sm:text-lg">{stats.myFlightHours.toFixed(portalSettings.flight_time_decimals)}</p>
                </button>
                {stats.myCreditVisible && (
                <button
                  type="button"
                  onClick={() => navigate('/billing')}
                  className="min-w-0 rounded-lg bg-white/15 px-3 py-2 text-center text-white transition hover:bg-white/20"
                >
                  <p className="text-xs text-white/70">Credit</p>
                  <p className="truncate text-base font-bold tabular-nums sm:text-lg">{formatCurrency(stats.myPrepaidBalance, portalSettings.currency_decimals)}</p>
                </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Today's Schedule</h2>
              </div>
              {stats.recentBookingsToday.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-[#363b45] dark:text-gray-400">
                  <p className="text-center">No bookings scheduled for today.</p>
                  {nextLessonLabel && (
                    <p className="mt-3 text-center text-xs font-semibold text-blue-700 dark:text-blue-200">Next lesson: {nextLessonLabel}</p>
                  )}
                  {stats.nextBooking && (
                    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 dark:border-[#2c2f36] dark:bg-[#11141a]">
                      <p className="text-sm font-semibold text-gray-950 dark:text-gray-100">
                        Next booking: {format(stats.nextBooking.startTime, datePattern)} at {format(stats.nextBooking.startTime, timePattern)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{stats.nextBooking.aircraftRegistration}</p>
                      {nextLessonLabel && (
                        <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-200">Next lesson: {nextLessonLabel}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.recentBookingsToday.map(booking => (
                    <div key={booking.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 dark:border-[#2c2f36] dark:bg-[#11141a]">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-950 dark:text-gray-100">
                          {format(booking.startTime, timePattern)} to {format(booking.endTime, timePattern)}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {booking.studentName} - {booking.aircraftRegistration}
                          {booking.instructorName ? ` - ${booking.instructorName}` : ''}
                        </p>
                        {nextLessonLabel && (
                          <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-200">
                            Next lesson: {nextLessonLabel}
                          </p>
                        )}
                      </div>
                      <Plane className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {isStudentUser && currentCourse && trainingOverview && (
              <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Training Progress Overview</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{currentCourse.title}</p>
                  </div>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                    {trainingOverview.percent}%
                  </span>
                </div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-[#11141a]">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${trainingOverview.percent}%` }} />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-200">Lessons</p>
                    <p className="text-xl font-bold text-blue-800 dark:text-blue-100">{trainingOverview.completedLessons}/{trainingOverview.totalLessons || '-'}</p>
                  </div>
                  <div className="rounded-xl bg-green-50 p-3 dark:bg-green-500/10">
                    <p className="text-xs font-semibold text-green-700 dark:text-green-200">Competent Sequences</p>
                    <p className="text-xl font-bold text-green-800 dark:text-green-100">{trainingOverview.competentSequences}</p>
                  </div>
                  <div className="rounded-xl bg-orange-50 p-3 dark:bg-orange-500/10">
                    <p className="text-xs font-semibold text-orange-700 dark:text-orange-200">Next Lesson</p>
                    <p className="truncate text-sm font-bold text-orange-800 dark:text-orange-100">{nextLessonLabel}</p>
                  </div>
                </div>
                {trainingOverview.recentRecords.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {trainingOverview.recentRecords.map(record => (
                      <div key={record.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a]">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {format(record.bookingStartTime || record.date, datePattern)} - {record.registration || 'Aircraft not recorded'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatHoursFromMinutes((record.dualTimeMin || 0) + (record.soloTimeMin || 0))} hrs - {record.status}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Next Booking</h2>
              </div>
              {stats.nextBooking ? (
                <div>
                  <p className="text-2xl font-bold text-gray-950 dark:text-gray-100">{format(stats.nextBooking.startTime, datePattern)}</p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {format(stats.nextBooking.startTime, timePattern)} - {stats.nextBooking.aircraftRegistration}
                  </p>
                  {stats.nextBooking.instructorName && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{stats.nextBooking.instructorName}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming booking.</p>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <UserIcon className="h-5 w-5 text-blue-600 dark:text-blue-300" />
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Personal Details</h2>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex gap-2 text-gray-600 dark:text-gray-300">
                  <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span className="min-w-0 break-all">{user?.email || 'Email not recorded'}</span>
                </div>
                <div className="flex gap-2 text-gray-600 dark:text-gray-300">
                  <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                  <span>{user?.mobilePhone || user?.phone || user?.homePhone || 'Phone not recorded'}</span>
                </div>
                {user?.dateOfBirth && (
                  <p className="text-gray-600 dark:text-gray-300">DOB: {format(user.dateOfBirth, datePattern)}</p>
                )}
                {user?.address && (
                  <p className="rounded-xl bg-gray-50 px-3 py-2 text-gray-600 dark:bg-[#11141a] dark:text-gray-300">{user.address}</p>
                )}
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-[#2c2f36] dark:bg-[#11141a]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Emergency Contact</p>
                  {studentDetails?.emergencyContact ? (
                    <div className="mt-1 text-gray-700 dark:text-gray-200">
                      <p className="font-semibold">{studentDetails.emergencyContact.name}</p>
                      <p>{studentDetails.emergencyContact.phone || 'Phone not recorded'}</p>
                      {studentDetails.emergencyContact.relationship && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">{studentDetails.emergencyContact.relationship}</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-gray-500 dark:text-gray-400">Not recorded</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Aviation Credentials</h2>
              </div>
              <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                <p>RAAus: <span className="font-semibold text-gray-900 dark:text-gray-100">{studentDetails?.raausId || 'Not recorded'}</span></p>
                <p>CASA ARN: <span className="font-semibold text-gray-900 dark:text-gray-100">{studentDetails?.casaId || 'Not recorded'}</span></p>
                <p>Medical: <span className="font-semibold text-gray-900 dark:text-gray-100">{studentDetails?.medicalType || 'Not recorded'}</span></p>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-md shadow-gray-200/70 dark:border-[#2c2f36] dark:bg-[#171a21] sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-300" />
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Compliance Snapshot</h2>
              </div>
              <div className="space-y-2">
                {complianceItems.map(item => (
                  <div key={item.label} className="flex justify-between gap-3 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">{item.label}</span>
                    <span className={`text-right font-semibold ${item.warn ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>

      {showFlightStatsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-[#2c2f36] dark:bg-[#171a21]">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-[#2c2f36]">
              <div>
                <h2 className="text-lg font-bold text-gray-950 dark:text-gray-100">Flight Stats</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Your logged time and recent activity summary.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFlightStatsModal(false)}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-[#11141a] dark:hover:text-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 text-sm">
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-[#11141a]">
                <p className="text-xs text-gray-500 dark:text-gray-400">Total</p>
                <p className="font-bold text-gray-900 dark:text-gray-100">{formatHoursFromMinutes(totalFlightMinutes)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-[#11141a]">
                <p className="text-xs text-gray-500 dark:text-gray-400">Dual</p>
                <p className="font-bold text-gray-900 dark:text-gray-100">{formatHoursFromMinutes(totalDualMinutes)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-[#11141a]">
                <p className="text-xs text-gray-500 dark:text-gray-400">Solo</p>
                <p className="font-bold text-gray-900 dark:text-gray-100">{formatHoursFromMinutes(totalSoloMinutes)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3 dark:bg-[#11141a]">
                <p className="text-xs text-gray-500 dark:text-gray-400">Records</p>
                <p className="font-bold text-gray-900 dark:text-gray-100">{studentTrainingRecords.length}</p>
              </div>
              {lastFlightDate && (
                <div className="col-span-2 rounded-xl bg-blue-50 p-3 dark:bg-blue-500/10">
                  <p className="text-xs text-blue-700 dark:text-blue-200">Last flight</p>
                  <p className="font-bold text-blue-900 dark:text-blue-100">{format(lastFlightDate, datePattern)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
