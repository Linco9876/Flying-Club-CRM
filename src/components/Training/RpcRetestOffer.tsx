import React from "react";
import { format, parseISO } from "date-fns";
import { rpcRetestDeadline } from "../../utils/rpcReviewWorkflow";

export function RpcRetestOffer({
  previousDate,
  originalDate,
  busy,
  onContinue,
  onFull,
}: {
  previousDate: string;
  originalDate: string;
  busy: boolean;
  onContinue: () => void;
  onFull: () => void;
}) {
  return (
    <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
      <h3 className="font-bold">Recent unsuccessful RPC test</h3>
      <p className="mt-2">
        The attempt on {format(parseISO(previousDate), "d MMM yyyy")} has
        outstanding components. Continue those components or start a full
        assessment.
      </p>
      <p className="mt-2 font-semibold">
        Retest flight deadline:{" "}
        {format(parseISO(rpcRetestDeadline(originalDate)), "d MMM yyyy")}
      </p>
      <p className="mt-1 text-xs">
        A partial retest is opened for you as the reviewer and retains the
        previous satisfactory evidence.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onContinue}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          Continue outstanding components
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onFull}
          className="rounded-lg border border-amber-300 bg-white px-4 py-2 font-semibold text-slate-900 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        >
          Start a full test
        </button>
      </div>
    </aside>
  );
}
