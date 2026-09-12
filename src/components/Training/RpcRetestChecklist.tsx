import React from "react";
import { format, parseISO } from "date-fns";
import toast from "react-hot-toast";
import type {
  FlightReviewRecord,
  FlightReviewRecordItem,
  useFlightReviews,
} from "../../hooks/useFlightReviews";
import {
  rpcRetestDeadline,
  rpcRetestGroups,
} from "../../utils/rpcReviewWorkflow";
import { flightReviewErrorMessage } from "../../utils/flightReviewFindings";
import { SearchableSelect } from "../common/SearchableSelect";

const dateLabel = (date?: string) =>
  date ? format(parseISO(date), "d MMM yyyy") : "Not available";
const inputClass =
  "mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

export function RpcRetestChecklist({
  items,
  previous,
  previousItems = [],
  originalDate,
  onUpdateItem,
}: {
  items: FlightReviewRecordItem[];
  previous?: FlightReviewRecord;
  previousItems?: FlightReviewRecordItem[];
  originalDate?: string;
  onUpdateItem: ReturnType<typeof useFlightReviews>["updateItem"];
}) {
  const groups = rpcRetestGroups(items);
  const previousByKey = new Map(
    previousItems.map((item) => [item.templateItemKey, item]),
  );
  const update = async (
    id: string,
    input: Parameters<typeof onUpdateItem>[1],
  ) => {
    try {
      await onUpdateItem(id, input);
    } catch (error) {
      toast.error(
        flightReviewErrorMessage(error, "Could not save this assessment"),
      );
    }
  };
  const renderItem = (item: FlightReviewRecordItem) => {
    const prior = previousByKey.get(item.templateItemKey);
    return (
      <article
        key={item.id}
        className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40"
      >
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {item.code} · {item.required ? "Required" : "Optional"}
        </p>
        <h4 className="mt-1 font-semibold">{item.title}</h4>
        {item.guidance && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {item.guidance}
          </p>
        )}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">
              {!prior
                ? "Previous result unavailable"
                : prior.result === "further_training"
                  ? "Previously unsuccessful"
                  : "Not assessed previously"}
            </p>
            <p className="mt-2 whitespace-pre-wrap">
              {prior?.notes.trim() ||
                "No item-specific notes recorded. Refer to the previous findings and training plan."}
            </p>
          </div>
          <div>
            <label className="block min-w-0 text-sm font-medium">
              <span className="mb-2 block">New result — {item.code}</span>
              <SearchableSelect
                aria-label={`New result — ${item.code}`}
                className={inputClass.replace("mt-2 ", "")}
                value={item.result}
                onChange={(event) =>
                  void update(item.id, {
                    result: event.target
                      .value as FlightReviewRecordItem["result"],
                  })
                }
              >
                <option value="not_assessed">Not assessed</option>
                <option value="satisfactory">Satisfactory</option>
                <option value="further_training">
                  Further training required
                </option>
                {!item.required && (
                  <option value="not_applicable">Not applicable</option>
                )}
              </SearchableSelect>
            </label>
            <label className="mt-3 block text-sm font-medium">
              New assessment notes — {item.code}
              <textarea
                key={item.id}
                className={inputClass}
                rows={3}
                defaultValue={item.notes}
                placeholder="Record what was demonstrated on this test flight."
                onBlur={(event) => {
                  if (event.target.value !== item.notes)
                    void update(item.id, { notes: event.target.value });
                }}
              />
            </label>
          </div>
        </div>
      </article>
    );
  };
  return (
    <section className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-slate-950 dark:border-blue-900 dark:bg-blue-950/20 dark:text-slate-100 sm:p-5">
      <div>
        <h3 className="text-lg font-bold">To assess this retest</h3>
        <p
          aria-live="polite"
          className="mt-1 text-sm font-semibold text-blue-800 dark:text-blue-200"
        >
          {groups.reassessed} of {groups.competencies.length} outstanding
          competencies reassessed
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              First unsuccessful test
            </dt>
            <dd className="font-semibold">{dateLabel(originalDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">
              Last eligible retest flight date
            </dt>
            <dd className="font-semibold">
              {dateLabel(
                originalDate ? rpcRetestDeadline(originalDate) : undefined,
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          The attached flight must fall within this window. Entering a draft
          does not extend it.
        </p>
      </div>
      {!previous && (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">
          Previous assessment details could not be loaded. Reopen the review
          before assessing these items.
        </p>
      )}
      {previous && (
        <div className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900">
          <h4 className="font-semibold">
            Previous findings · {dateLabel(previous.reviewDate)}
          </h4>
          <p className="mt-2 whitespace-pre-wrap">
            {previous.reviewerSummary || "No findings recorded."}
          </p>
          {previous.remedialPlan && (
            <>
              <p className="mt-3 font-semibold">
                Required improvement / training plan
              </p>
              <p className="mt-1 whitespace-pre-wrap">
                {previous.remedialPlan}
              </p>
            </>
          )}
        </div>
      )}
      <div className="space-y-3">
        {groups.competencies.length ? (
          groups.competencies.map(renderItem)
        ) : (
          <p className="text-sm">
            No flying competencies remain to assess. Complete the outstanding
            confirmation steps below.
          </p>
        )}
      </div>
      {groups.completion.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer font-semibold">
            Paperwork and confirmation steps · {groups.completion.length}
          </summary>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            These are completion requirements, separate from the flying
            competencies above.
          </p>
          <div className="mt-3 space-y-3">
            {groups.completion.map(renderItem)}
          </div>
        </details>
      )}
      <details className="rounded-lg border border-emerald-200 p-3 dark:border-emerald-900">
        <summary className="cursor-pointer font-semibold">
          Previously satisfactory — carried forward · {groups.carried.length}
        </summary>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Retained evidence from the previous attempt. These items do not need
          reassessment in this partial retest.
        </p>
        <div className="mt-3 space-y-3">
          {groups.carried.map((item) => (
            <article
              key={item.id}
              className="rounded-lg bg-white p-3 text-sm dark:bg-slate-900"
            >
              <h4 className="font-semibold">
                {item.code} · {item.title}
              </h4>
              <p className="mt-1 font-medium text-emerald-700 dark:text-emerald-300">
                Satisfactory · retained
              </p>
              <p className="mt-2 whitespace-pre-wrap">
                {item.notes || "No additional notes recorded."}
              </p>
            </article>
          ))}
        </div>
      </details>
    </section>
  );
}
