import React from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StudentForm } from './StudentForm';
import { InviteUserModal } from './InviteUserModal';
import { Student, UserRole } from '../../types';
import {
  User,
  Phone,
  Mail,
  Clock,
  Award,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Search,
  UserPlus,
  Archive,
  RotateCcw,
  Trash2,
  Eye,
  Pencil,
  BookOpen,
  FileText,
  ArrowUpDown,
  X,
  MoreVertical
} from 'lucide-react';
import { useStudents } from '../../hooks/useStudents';
import { InviteUserResult, useInvitations } from '../../hooks/useInvitations';
import { useTrainingRecords } from '../../hooks/useTrainingRecords';
import { useFlightLogs } from '../../hooks/useFlightLogs';
import { useAuth } from '../../context/AuthContext';
import { usePageLoadState } from '../../context/PageLoadContext';

export const StudentList: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { students, loading, addStudent, updateStudent, deleteStudent, setStudentActive, refetch } = useStudents();
  const { inviteUser } = useInvitations();
  const { trainingRecords, loading: trainingRecordsLoading } = useTrainingRecords();
  const { flightLogs, loading: flightLogsLoading } = useFlightLogs();
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'instructor' | 'pilot' | 'student'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'hours' | 'lastFlight'>('name');
  const [viewMode, setViewMode] = useState<'detailed' | 'slim'>('detailed');
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const canManageMembers = user?.role === 'admin' || user?.roles?.includes('admin');
  const canReinstateTrialVoucherMembers =
    canManageMembers ||
    user?.role === 'instructor' ||
    user?.role === 'senior_instructor' ||
    user?.roles?.some(role => role === 'instructor' || role === 'senior_instructor');
  usePageLoadState(
    loading || trainingRecordsLoading || flightLogsLoading,
    'Loading members',
    'Preparing member cards, roles, recent activity and training counts...'
  );

  const normaliseSearch = (value?: string | null) =>
    (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const getMemberRoles = (student: Student): UserRole[] =>
    student.roles && student.roles.length > 0 ? student.roles : [student.role as UserRole];

  const matchesRoleFilter = (student: Student) => {
    if (roleFilter === 'all') return true;
    const roles = getMemberRoles(student);
    if (roleFilter === 'instructor') return roles.includes('instructor') || roles.includes('senior_instructor');
    return roles.includes(roleFilter);
  };

  const memberStatusCounts = useMemo(() => {
    const active = students.filter(student => student.isActive !== false).length;
    const archived = students.length - active;
    const roles = {
      admin: 0,
      instructor: 0,
      pilot: 0,
      student: 0
    };

    students.forEach(student => {
      const memberRoles = getMemberRoles(student);
      if (memberRoles.includes('admin')) roles.admin += 1;
      if (memberRoles.includes('instructor') || memberRoles.includes('senior_instructor')) roles.instructor += 1;
      if (memberRoles.includes('pilot')) roles.pilot += 1;
      if (memberRoles.includes('student')) roles.student += 1;
    });

    return { active, archived, total: students.length, roles };
  }, [students]);

  const rawVisibleMembers = useMemo(() => {
    const terms = normaliseSearch(searchTerm).split(/\s+/).filter(Boolean);

    return students.filter(student => {
      const isActive = student.isActive !== false;
      if (statusFilter === 'active' && !isActive) return false;
      if (statusFilter === 'archived' && isActive) return false;
      if (!matchesRoleFilter(student)) return false;
      if (terms.length === 0) return true;

      const haystack = normaliseSearch([
        student.name,
        student.email,
        student.phone,
        student.mobilePhone,
        student.homePhone,
        student.workPhone,
        student.raausId,
        student.casaId
      ].filter(Boolean).join(' '));

      return terms.every(term => haystack.includes(term));
    });
  }, [roleFilter, searchTerm, statusFilter, students]);

  const statsByStudent = useMemo(() => {
    const stats = new Map<string, { totalHours: number; lessonCount: number; lastFlight?: Date }>();

    rawVisibleMembers.forEach(student => {
      stats.set(student.id, { totalHours: 0, lessonCount: 0 });
    });

    flightLogs.forEach(log => {
      if (!stats.has(log.student_id)) return;
      const current = stats.get(log.student_id)!;
      const flightDate = log.start_time ? new Date(log.start_time) : undefined;
      stats.set(log.student_id, {
        ...current,
        totalHours: current.totalHours + Number(log.flight_duration || 0),
        lastFlight: flightDate && (!current.lastFlight || flightDate > current.lastFlight) ? flightDate : current.lastFlight
      });
    });

    trainingRecords.forEach(record => {
      if (!stats.has(record.studentId)) return;
      const current = stats.get(record.studentId)!;
      stats.set(record.studentId, {
        ...current,
        lessonCount: current.lessonCount + 1
      });
    });

    return stats;
  }, [flightLogs, trainingRecords, rawVisibleMembers]);

  const getStudentStats = (studentId: string) => statsByStudent.get(studentId) || { totalHours: 0, lessonCount: 0 };

  const visibleMembers = useMemo(() => {
    const roleRank: Record<UserRole, number> = {
      admin: 1,
      senior_instructor: 2,
      instructor: 3,
      pilot: 4,
      student: 5
    };

    return [...rawVisibleMembers].sort((a, b) => {
      const aStats = getStudentStats(a.id);
      const bStats = getStudentStats(b.id);

      if (sortBy === 'role') {
        return (roleRank[a.role] || 99) - (roleRank[b.role] || 99) || a.name.localeCompare(b.name);
      }

      if (sortBy === 'hours') {
        return bStats.totalHours - aStats.totalHours || a.name.localeCompare(b.name);
      }

      if (sortBy === 'lastFlight') {
        const aTime = aStats.lastFlight?.getTime() || 0;
        const bTime = bStats.lastFlight?.getTime() || 0;
        return bTime - aTime || a.name.localeCompare(b.name);
      }

      return a.name.localeCompare(b.name);
    });
  }, [rawVisibleMembers, sortBy, statsByStudent]);

  const roleFilters: { id: typeof roleFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'admin', label: 'Admin' },
    { id: 'instructor', label: 'Instructor' },
    { id: 'pilot', label: 'Pilot' },
    { id: 'student', label: 'Student' }
  ];

  const roleLabels: Record<UserRole, string> = {
    admin: 'Admin',
    senior_instructor: 'Senior Instructor',
    instructor: 'Instructor',
    pilot: 'Pilot',
    student: 'Student'
  };

  const sortOptions: { id: typeof sortBy; label: string }[] = [
    { id: 'name', label: 'Name' },
    { id: 'role', label: 'Role' },
    { id: 'hours', label: 'Hours' },
    { id: 'lastFlight', label: 'Last flight' }
  ];

  const roleBadgeClass = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-800';
      case 'senior_instructor':
        return 'bg-indigo-100 text-indigo-800';
      case 'instructor':
        return 'bg-green-100 text-green-800';
      case 'pilot':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  const getPrimaryPhone = (student: Student) =>
    student.mobilePhone || student.phone || student.homePhone || student.workPhone || student.alternatePhone || 'No number';

  const renderAvatar = (student: Student, sizeClass: string, iconClass: string) => (
    <div className={`${sizeClass} flex-shrink-0 overflow-hidden rounded-full bg-blue-600 shadow-sm ring-2 ring-white`}>
      {student.avatar ? (
        <img
          src={student.avatar}
          alt={`${student.name || 'Member'} avatar`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <User className={`${iconClass} text-white`} />
        </div>
      )}
    </div>
  );

  const isExpiryNear = (date?: Date) => {
    if (!date) return false;
    const daysUntilExpiry = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 60;
  };

  const isExpired = (date?: Date) => {
    if (!date) return false;
    return date.getTime() < new Date().setHours(0, 0, 0, 0);
  };

  const getComplianceSummary = (student: Student) => {
    const medicalMissing = !student.medicalExpiry;
    const membershipMissing = !student.licenceExpiry;
    const medicalExpired = isExpired(student.medicalExpiry);
    const membershipExpired = isExpired(student.licenceExpiry);
    const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
    const licenceNearExpiry = isExpiryNear(student.licenceExpiry);

    if (medicalMissing || membershipMissing) {
      return {
        label: 'Incomplete',
        detail: medicalMissing ? 'Medical not recorded' : 'Membership not recorded',
        className: 'border-gray-200 bg-gray-50 text-gray-700',
        icon: AlertTriangle
      };
    }

    if (medicalExpired || membershipExpired) {
      return {
        label: 'Expired',
        detail: medicalExpired ? 'Medical expired' : 'Membership expired',
        className: 'border-red-200 bg-red-50 text-red-700',
        icon: AlertTriangle
      };
    }

    if (medicalNearExpiry || licenceNearExpiry) {
      return {
        label: 'Review',
        detail: medicalNearExpiry ? 'Medical due soon' : 'Membership due soon',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
        icon: AlertTriangle
      };
    }

    return {
      label: 'Current',
      detail: 'No alerts',
      className: 'border-green-200 bg-green-50 text-green-700',
      icon: CheckCircle
    };
  };

  const resetFilters = () => {
    setSearchTerm('');
    setRoleFilter('all');
    setStatusFilter('active');
    setSortBy('name');
  };

  const closeActionsMenu = () => setOpenActionsId(null);

  const runMemberAction = async (action: () => void | Promise<void>) => {
    closeActionsMenu();
    await action();
  };

  const canEditMember = (student: Student) => {
    const roles = user?.roles || (user?.role ? [user.role] : []);
    return student.id === user?.id
      || roles.includes('admin')
      || roles.includes('instructor')
      || roles.includes('senior_instructor');
  };

  const renderActionsMenu = (student: Student, placement: 'mobile' | 'desktop') => {
    const isArchived = student.isActive === false;
    const menuId = `${placement}-${student.id}`;
    const isOpen = openActionsId === menuId;
    const menuItemClass = 'flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-gray-700 hover:bg-gray-50';

    return (
      <div className="relative">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpenActionsId(isOpen ? null : menuId);
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50"
          aria-label={`Actions for ${student.name}`}
          aria-expanded={isOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-9 z-30 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <button type="button" onClick={() => runMemberAction(() => openViewDetails(student))} className={menuItemClass}>
              <Eye className="h-3.5 w-3.5 text-blue-600" />
              View file
            </button>
            {canEditMember(student) && (
              <button type="button" onClick={() => runMemberAction(() => openEditForm(student))} className={menuItemClass}>
                <Pencil className="h-3.5 w-3.5 text-gray-500" />
                Edit
              </button>
            )}
            <button type="button" onClick={() => runMemberAction(() => openStudentTab(student, 'training'))} className={menuItemClass}>
              <BookOpen className="h-3.5 w-3.5 text-green-600" />
              Training
            </button>
            <button type="button" onClick={() => runMemberAction(() => openStudentTab(student, 'logbook'))} className={menuItemClass}>
              <Clock className="h-3.5 w-3.5 text-indigo-600" />
              Logbook
            </button>
            <button type="button" onClick={() => runMemberAction(() => openStudentTab(student, 'documents'))} className={menuItemClass}>
              <FileText className="h-3.5 w-3.5 text-gray-500" />
              Docs
            </button>

            {(canManageMembers || (isArchived && student.portalAccessScope === 'trial_voucher' && canReinstateTrialVoucherMembers)) && (
              <>
                <div className="my-1 border-t border-gray-100" />
                {isArchived ? (
                  <button type="button" onClick={() => runMemberAction(() => handleRestoreMember(student))} className={menuItemClass}>
                    <RotateCcw className="h-3.5 w-3.5 text-green-600" />
                    {student.portalAccessScope === 'trial_voucher' ? 'Restore as student' : 'Restore'}
                  </button>
                ) : canManageMembers ? (
                  <button type="button" onClick={() => runMemberAction(() => handleArchiveMember(student))} className={menuItemClass}>
                    <Archive className="h-3.5 w-3.5 text-amber-600" />
                    Archive
                  </button>
                ) : null}
                {canManageMembers && (
                  <button type="button" onClick={() => runMemberAction(() => handleRemoveMember(student))} className={`${menuItemClass} text-red-700 hover:bg-red-50`}>
                    <Trash2 className="h-3.5 w-3.5 text-red-600" />
                    Remove
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const handleAddStudent = async (studentData: Omit<Student, 'id'>) => {
    await addStudent(studentData);
    setShowStudentForm(false);
  };

  const handleEditStudent = async (studentData: Omit<Student, 'id'>) => {
    if (editingStudent) {
      await updateStudent(editingStudent.id, studentData);
      setEditingStudent(null);
      setShowStudentForm(false);
    }
  };

  const openEditForm = (student: Student) => {
    setEditingStudent(student);
    setShowStudentForm(true);
  };

  const openViewDetails = (student: Student) => {
    navigate(`/students/${student.id}`);
  };

  const openStudentTab = (student: Student, tab: string) => {
    navigate(`/students/${student.id}?tab=${tab}`);
  };

  const handleArchiveMember = async (student: Student) => {
    if (student.id === user?.id) {
      alert('You cannot archive your own account while logged in.');
      return;
    }

    const confirmed = window.confirm(`Archive ${student.name}? They will be hidden from the active members list but their records will remain available.`);
    if (!confirmed) return;
    await setStudentActive(student.id, false);
  };

  const handleRestoreMember = async (student: Student) => {
    if (student.portalAccessScope === 'trial_voucher') {
      const confirmed = window.confirm(
        `Restore ${student.name} as a regular student?\n\nThis will give them normal CRM login access. Only do this if they are continuing after their trial flight.`
      );
      if (!confirmed) return;
      await setStudentActive(student.id, true, { restoreAsFullStudent: true });
      return;
    }

    await setStudentActive(student.id, true);
  };

  const handleRemoveMember = async (student: Student) => {
    if (student.id === user?.id) {
      alert('You cannot remove your own account while logged in.');
      return;
    }

    const typed = window.prompt(
      `Remove ${student.name} from the CRM?\n\nThis is destructive and may fail if historical records still require this member. Type REMOVE to confirm.`
    );
    if (typed !== 'REMOVE') return;
    await deleteStudent(student.id);
  };

  const closeStudentForm = () => {
    setShowStudentForm(false);
    setEditingStudent(null);
  };

  const handleInviteUser = async (data: {
    email: string;
    name: string;
    phone?: string;
    roles?: UserRole[];
    resend?: boolean;
  }): Promise<InviteUserResult | undefined> => {
    const result = await inviteUser(data);
    if (result?.tempPassword || result?.emailSent || result?.manualLink) {
      await refetch();
    }
    return result;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-transparent p-3 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-2xl font-bold leading-tight text-white sm:text-xl">Members</h2>
              <p className="text-sm text-blue-100/80">{visibleMembers.length} shown from {memberStatusCounts.total}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="hidden gap-2 overflow-x-auto sm:flex">
                {[
                  { label: 'Active', value: memberStatusCounts.active, tone: 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100' },
                  { label: 'Archived', value: memberStatusCounts.archived, tone: 'border-white/20 bg-white/10 text-slate-100' },
                  { label: 'Instructors', value: memberStatusCounts.roles.instructor, tone: 'border-indigo-300/30 bg-indigo-400/15 text-indigo-100' },
                  { label: 'Students', value: memberStatusCounts.roles.student, tone: 'border-blue-300/30 bg-blue-400/15 text-blue-100' }
                ].map(item => (
                  <div key={item.label} className={`flex flex-shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${item.tone}`}>
                    <span>{item.label}</span>
                    <span className="text-sm font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
              {canManageMembers && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="inline-flex self-start items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-blue-50 sm:self-auto sm:px-3"
                >
                  <UserPlus className="h-4 w-4" />
                  Invite
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-[minmax(280px,1fr)_auto_auto_auto] xl:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="Search name, email, phone, RAAus or CASA..."
              className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-10 pr-10 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 lg:rounded-lg lg:py-2.5"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:hidden">
            <label className="block">
              <span className="sr-only">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm font-semibold text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active ({memberStatusCounts.active})</option>
                <option value="archived">Archived ({memberStatusCounts.archived})</option>
                <option value="all">All ({memberStatusCounts.total})</option>
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Role</span>
              <select
                value={roleFilter}
                onChange={event => setRoleFilter(event.target.value as typeof roleFilter)}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-sm font-semibold text-gray-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {roleFilters.map(filter => {
                  const count = filter.id === 'all' ? memberStatusCounts.total : memberStatusCounts.roles[filter.id];
                  return (
                    <option key={filter.id} value={filter.id}>
                      {filter.label} ({count})
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <div className="hidden gap-2 overflow-x-auto pb-1 sm:flex xl:overflow-visible xl:pb-0">
            {(['active', 'archived', 'all'] as const).map(status => {
              const count = status === 'active' ? memberStatusCounts.active : status === 'archived' ? memberStatusCounts.archived : memberStatusCounts.total;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                    statusFilter === status
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {status} <span className="ml-1 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="relative block">
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                value={sortBy}
                onChange={event => setSortBy(event.target.value as typeof sortBy)}
                className="w-full rounded-xl border border-gray-300 bg-white py-3 pl-10 pr-8 text-sm font-semibold text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 lg:rounded-lg lg:py-2.5"
              >
                {sortOptions.map(option => (
                  <option key={option.id} value={option.id}>Sort: {option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 lg:rounded-lg lg:py-2.5"
            >
              Reset
            </button>
          </div>

          <div className="flex rounded-xl bg-gray-100 p-1 sm:w-fit xl:justify-self-end">
            {([
              { id: 'detailed', label: 'Detailed' },
              { id: 'slim', label: 'Slim' }
            ] as const).map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setViewMode(option.id)}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
                  viewMode === option.id
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          </div>

          <div className="hidden border-t border-gray-100 px-4 pb-4 sm:block sm:px-5 sm:pb-5">
          <div className="flex gap-2 overflow-x-auto pt-4">
            {roleFilters.map(filter => {
              const count = filter.id === 'all' ? memberStatusCounts.total : memberStatusCounts.roles[filter.id];
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setRoleFilter(filter.id)}
                  className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    roleFilter === filter.id
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {filter.label} <span className="ml-1 opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          </div>
        </section>

      {viewMode === 'slim' ? (
        <div className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.4fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_auto] gap-3 border-b border-gray-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500 md:grid">
            <span>Name</span>
            <span>Email</span>
            <span>Number</span>
            <span>Role</span>
            <span className="sr-only">Actions</span>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleMembers.map(student => {
              const memberRoles = getMemberRoles(student);
              const isArchived = student.isActive === false;

              return (
                <div
                  key={student.id}
                  className="relative grid gap-2 px-3 py-3 pr-14 transition-colors hover:bg-gray-50 md:grid-cols-[minmax(180px,1.2fr)_minmax(180px,1.4fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_auto] md:items-center md:gap-3 md:px-4"
                >
                  <button
                    type="button"
                    onClick={() => openViewDetails(student)}
                    className="min-w-0 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold text-gray-900">{student.name}</p>
                      {isArchived && (
                        <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                          Archived
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => openViewDetails(student)}
                    className="truncate text-left text-sm text-gray-600"
                  >
                    {student.email}
                  </button>
                  <p className="truncate text-sm text-gray-700">{getPrimaryPhone(student)}</p>
                  <div className="flex flex-wrap gap-1">
                    {memberRoles.map(role => (
                      <span key={role} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleBadgeClass(role)}`}>
                        {roleLabels[role]}
                      </span>
                    ))}
                  </div>
                  <div className="absolute right-3 top-3 md:static">
                    {renderActionsMenu(student, 'desktop')}
                  </div>
                </div>
              );
            })}
          </div>
          {visibleMembers.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No members match your filters.
            </div>
          )}
        </div>
      ) : (
      <div className="grid gap-2 lg:grid-cols-2">
        {visibleMembers.map(student => {
          const stats = getStudentStats(student.id);
          const medicalNearExpiry = isExpiryNear(student.medicalExpiry);
          const licenceNearExpiry = isExpiryNear(student.licenceExpiry);
          const activeEndorsements = student.endorsements.filter(e => e.isActive).length;
          const memberRoles = getMemberRoles(student);
          const isArchived = student.isActive === false;
          const compliance = getComplianceSummary(student);
          const ComplianceIcon = compliance.icon;

          return (
            <article
              key={student.id}
              className="overflow-visible rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="flex items-start gap-3 px-3 py-3">
                <button
                  type="button"
                  onClick={() => openViewDetails(student)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  {renderAvatar(student, 'h-10 w-10', 'h-4 w-4')}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <h2 className="truncate text-sm font-semibold text-gray-900">{student.name}</h2>
                      {isArchived && (
                        <span className="flex-shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                          Archived
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-gray-500">{student.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {memberRoles.slice(0, 3).map(role => (
                        <span key={role} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${roleBadgeClass(role)}`}>
                          {roleLabels[role]}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
                {renderActionsMenu(student, 'mobile')}
              </div>

              <button
                type="button"
                onClick={() => openViewDetails(student)}
                className="block w-full border-t border-gray-100 px-3 py-2 text-left transition-colors hover:bg-gray-50"
              >
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <p className="font-medium text-gray-500">Hours</p>
                    <p className="text-sm font-semibold text-gray-900">{stats.totalHours.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-500">Lessons</p>
                    <p className="text-sm font-semibold text-gray-900">{stats.lessonCount}</p>
                  </div>
                  <div>
                    <p className="font-medium text-gray-500">Status</p>
                    <p className={`truncate text-sm font-semibold ${
                      compliance.label === 'Expired' ? 'text-red-700' : compliance.label === 'Review' ? 'text-amber-700' : compliance.label === 'Incomplete' ? 'text-gray-700' : 'text-green-700'
                    }`}>{compliance.label}</p>
                  </div>
                </div>
              </button>

              <div className="space-y-1.5 border-t border-gray-100 px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {student.raausId && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                      RAAus {student.raausId}
                    </span>
                  )}
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    {stats.lessonCount} lesson{stats.lessonCount === 1 ? '' : 's'}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    {activeEndorsements} endorsement{activeEndorsements === 1 ? '' : 's'}
                  </span>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${compliance.className}`}>
                    <ComplianceIcon className="mr-1 h-3 w-3" />
                    {compliance.detail}
                  </span>
                </div>

                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                  <span className={medicalNearExpiry ? 'text-yellow-700' : 'text-gray-600'}>
                    Medical {student.medicalExpiry?.toLocaleDateString() || 'not set'}
                  </span>
                  <span className={licenceNearExpiry ? 'text-yellow-700' : 'text-gray-600'}>
                    Membership {student.licenceExpiry?.toLocaleDateString() || 'not set'}
                  </span>
                  {student.phone && (
                    <span className="inline-flex items-center text-gray-600">
                      <Phone className="mr-1 h-3 w-3 text-gray-400" />
                      {student.phone}
                    </span>
                  )}
                </div>

              </div>
            </article>
          );
        })}
        {visibleMembers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No members match your filters.
          </div>
        )}
      </div>
      )}

      </div>

      {showStudentForm && (
        <StudentForm
          isOpen
          onClose={closeStudentForm}
          onSubmit={editingStudent ? handleEditStudent : handleAddStudent}
          student={editingStudent || undefined}
          isEdit={!!editingStudent}
          canEditEmail={!editingStudent || canManageMembers}
        />
      )}

      {showInviteModal && (
        <InviteUserModal
          isOpen
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInviteUser}
        />
      )}
    </div>
  );
};
