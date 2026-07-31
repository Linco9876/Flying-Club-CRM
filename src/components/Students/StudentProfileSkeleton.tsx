import React from 'react';
import { ArrowLeft, User } from 'lucide-react';

interface StudentProfileSkeletonProps {
  onBack?: () => void;
  studentName?: string;
}

const SkeletonLine: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    aria-hidden="true"
    className={`block animate-pulse rounded-md bg-slate-200 dark:bg-white/10 motion-reduce:animate-none ${className}`}
  />
);

export const StudentProfileSkeleton: React.FC<StudentProfileSkeletonProps> = ({
  onBack,
  studentName,
}) => (
  <div
    className="min-h-[calc(100vh-5rem)] p-3 sm:p-6"
    role="status"
    aria-live="polite"
    aria-busy="true"
  >
    <span className="sr-only">
      {studentName ? `Opening ${studentName}'s pilot file` : 'Opening student pilot file'}
    </span>

    <section className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 px-4 py-4 text-white shadow-sm sm:px-5">
      <div className="flex items-center gap-3 sm:gap-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-2 text-blue-100 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Return to members"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <span aria-hidden="true" className="h-9 w-9 rounded-lg bg-white/10" />
        )}
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
          <User className="h-5 w-5 text-blue-100/70" />
        </span>
        <div className="min-w-0 flex-1">
          {studentName ? (
            <p className="truncate text-xl font-bold text-white sm:text-2xl">{studentName}</p>
          ) : (
            <SkeletonLine className="h-7 w-52 max-w-[70%] bg-white/15 dark:bg-white/15" />
          )}
          <p className="mt-1 text-sm text-blue-100/75">Preparing pilot file…</p>
        </div>
        <SkeletonLine className="hidden h-9 w-28 bg-white/15 dark:bg-white/15 sm:block" />
      </div>
    </section>

    <nav aria-hidden="true" className="mt-4 flex gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-white/10 dark:bg-[#151922]">
      {['w-28', 'w-32', 'w-24', 'w-36', 'w-24', 'w-28'].map((widthClass, index) => (
        <SkeletonLine key={index} className={`h-9 shrink-0 ${widthClass}`} />
      ))}
    </nav>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.7fr)]">
      <aside className="min-w-0 space-y-5">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151922]">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-14 w-14 animate-pulse rounded-full bg-slate-200 dark:bg-white/10 motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonLine className="h-5 w-3/5" />
              <SkeletonLine className="h-4 w-4/5" />
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <SkeletonLine className="h-4 w-full" />
            <SkeletonLine className="h-4 w-5/6" />
            <SkeletonLine className="h-4 w-2/3" />
            <SkeletonLine className="h-4 w-3/4" />
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151922]">
          <SkeletonLine className="h-5 w-36" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="rounded-lg bg-slate-50 p-3 dark:bg-white/5">
                <SkeletonLine className="h-3 w-14" />
                <SkeletonLine className="mt-2 h-6 w-20" />
              </div>
            ))}
          </div>
        </section>
      </aside>

      <section className="min-w-0 space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151922]">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonLine className="h-5 w-44" />
              <SkeletonLine className="h-4 w-64 max-w-full" />
            </div>
            <SkeletonLine className="h-9 w-24" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map(item => (
              <div key={item} className="rounded-xl border border-slate-100 p-4 dark:border-white/10">
                <SkeletonLine className="h-3 w-20" />
                <SkeletonLine className="mt-3 h-7 w-24" />
                <SkeletonLine className="mt-2 h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#151922]">
          <SkeletonLine className="h-5 w-48" />
          <div className="mt-5 space-y-4">
            {[0, 1, 2].map(item => (
              <div key={item} className="flex gap-3">
                <span aria-hidden="true" className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-white/10 motion-reduce:animate-none" />
                <div className="flex-1 space-y-2 pt-1">
                  <SkeletonLine className="h-4 w-2/5" />
                  <SkeletonLine className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  </div>
);
