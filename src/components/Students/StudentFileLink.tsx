import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { can } from '../../utils/rbac';

interface StudentFileLinkProps {
  studentId?: string | null;
  name?: string | null;
  className?: string;
  linkClassName?: string;
  title?: string;
}

const defaultLinkClassName = [
  'rounded-sm font-inherit text-inherit underline decoration-current/40 underline-offset-2',
  'transition hover:decoration-current focus:outline-none focus-visible:ring-2',
  'focus-visible:ring-blue-500 focus-visible:ring-offset-2',
].join(' ');

export const StudentFileLink: React.FC<StudentFileLinkProps> = ({
  studentId,
  name,
  className,
  linkClassName,
  title,
}) => {
  const { user } = useAuth();
  const displayName = name?.trim() || 'Unknown student';
  const canViewStudentFile = Boolean(studentId && can(user, 'view-students'));

  if (!canViewStudentFile) {
    return <span className={className}>{displayName}</span>;
  }

  return (
    <Link
      to={`/students/${encodeURIComponent(studentId!)}`}
      className={`${defaultLinkClassName} ${className || ''} ${linkClassName || ''}`.trim()}
      title={title || `Open ${displayName}'s student file`}
      aria-label={`Open ${displayName}'s student file`}
      data-student-file-link={studentId}
      onClick={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      {displayName}
    </Link>
  );
};
