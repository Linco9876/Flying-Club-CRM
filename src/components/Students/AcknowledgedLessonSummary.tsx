import React from 'react';
import { format } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import type { TrainingRecord } from '../../types';
import { buildCompactLessonRecordSummary } from '../../utils/lessonRecordPresentation';

interface AcknowledgedLessonSummaryProps {
  record: TrainingRecord;
  instructorName?: string;
  lessonName?: string;
  onExpand?: () => void;
}

export const AcknowledgedLessonSummary: React.FC<AcknowledgedLessonSummaryProps> = ({
  record,
  instructorName,
  lessonName,
  onExpand,
}) => {
  const summary = buildCompactLessonRecordSummary({ record, instructorName, lessonName });
  const summaryContent = (
    <>
      <SummaryField label="Lesson" value={summary.lessonName} prominent />
      <SummaryField label="Date" value={format(summary.date, 'dd MMM yyyy')} />
      <SummaryField label="Aircraft" value={summary.aircraft} />
      <SummaryField label="Instructor" value={summary.instructor} />
      <div className="grid grid-cols-2 gap-3 lg:flex lg:gap-4">
        <SummaryField label="Dual" value={summary.dualHours} />
        <SummaryField label="Solo" value={summary.soloHours} />
      </div>
    </>
  );

  return (
    <article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-[#2c3440] dark:bg-[#171a21]">
      {onExpand ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label={`View full lesson record for ${summary.lessonName}`}
          className="relative grid w-full gap-3 px-4 py-3 pr-10 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-[#11141a] sm:grid-cols-2 lg:grid-cols-[minmax(160px,1.4fr)_repeat(3,minmax(100px,1fr))_auto]"
        >
          {summaryContent}
          <ChevronDown className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" aria-hidden="true" />
        </button>
      ) : (
        <div className="grid w-full gap-3 px-4 py-3 text-left sm:grid-cols-2 lg:grid-cols-[minmax(160px,1.4fr)_repeat(3,minmax(100px,1fr))_auto]">
          {summaryContent}
        </div>
      )}
    </article>
  );
};

const SummaryField = ({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
    <p
      className={`mt-0.5 truncate ${prominent ? 'text-sm font-semibold text-gray-950 dark:text-gray-100' : 'text-sm text-gray-700 dark:text-gray-200'}`}
      title={value}
    >
      {value}
    </p>
  </div>
);
