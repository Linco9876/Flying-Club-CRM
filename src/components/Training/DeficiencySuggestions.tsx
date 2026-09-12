import React, { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  suggestDeficiencies,
  type DeficiencySuggestion,
} from "../../utils/deficiencySuggestions";
import type { TrainingDeficiencyStage } from "../../hooks/useTrainingDeficiencies";
interface Props {
  comments: string;
  openDeficiencies: Array<{ id: string; description: string }>;
  pendingDescriptions: string[];
  resolvedIds: string[];
  defaultStage: TrainingDeficiencyStage;
  disabled?: boolean;
  onAdd: (description: string, stage: TrainingDeficiencyStage) => void;
  onResolve: (id: string, evidence: string) => void;
}
export function DeficiencySuggestions({
  comments,
  openDeficiencies,
  pendingDescriptions,
  resolvedIds,
  defaultStage,
  disabled,
  onAdd,
  onResolve,
}: Props) {
  const [result, setResult] = useState<{
    signature: string;
    suggestions: DeficiencySuggestion[];
    discarded: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [stages, setStages] = useState<Record<number, TrainingDeficiencyStage>>(
    {},
  );
  const [descriptions, setDescriptions] = useState<Record<number, string>>({});
  const request = useRef<AbortController | null>(null);
  const signature = JSON.stringify({ comments, openDeficiencies });
  const latest = useRef(signature);
  latest.current = signature;
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  const stale = result && result.signature !== signature;
  const run = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setDismissed([]);
    setStages({});
    setDescriptions({});
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await suggestDeficiencies(
        comments,
        openDeficiencies,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (latest.current !== signature) {
        setError(
          "Comments or open items changed while checking. Run suggestions again.",
        );
        return;
      }
      setResult({ ...response, signature });
    } catch (failure) {
      if (request.current === controller && latest.current === signature)
        setError(
          controller.signal.aborted
            ? "The request timed out. Try again; no deficiencies have changed."
            : failure instanceof Error
              ? failure.message
              : "Suggestions could not be loaded.",
        );
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void run()}
        disabled={disabled || busy || comments.trim().length < 12}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}{" "}
        {busy ? "Reading comments…" : "Suggest deficiencies"}
      </button>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Uses your flight and briefing comments. Review each suggestion; changes
        are saved with this lesson record. Improvement alone keeps an item open.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {stale && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
          Comments or open deficiencies changed. Run suggestions again before
          applying them.
        </p>
      )}
      {result && !stale && (
        <div aria-live="polite" className="space-y-2">
          {result.suggestions.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              No supported changes were found. Review the comments and open
              items manually.
            </p>
          )}
          {result.discarded > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Some suggestions lacked clear supporting evidence and were
              omitted.
            </p>
          )}
          {result.suggestions.map((item, index) => {
            if (dismissed.includes(index)) return null;
            const description = descriptions[index] ?? item.description;
            const applied =
              item.kind === "add"
                ? pendingDescriptions.some(
                    (value) =>
                      value.trim().toLowerCase() ===
                      description.trim().toLowerCase(),
                  )
                : item.deficiencyId
                  ? resolvedIds.includes(item.deficiencyId)
                  : false;
            return (
              <div
                key={index}
                className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {item.kind === "add"
                      ? "Suggested new deficiency"
                      : item.kind === "resolve"
                        ? "Suggested resolution — confirm it is fixed"
                        : "Improving — keep open"}
                  </p>
                  <button
                    type="button"
                    aria-label="Dismiss suggestion"
                    onClick={() => setDismissed((values) => [...values, index])}
                    className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                  >
                    <X size={14} />
                  </button>
                </div>
                {item.kind === "add" ? (
                  <label className="block text-xs text-slate-600 dark:text-slate-300">
                    Deficiency
                    <textarea
                      aria-label="Suggested deficiency"
                      value={description}
                      maxLength={2000}
                      disabled={applied}
                      onChange={(event) =>
                        setDescriptions((values) => ({
                          ...values,
                          [index]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                      rows={2}
                    />
                  </label>
                ) : (
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {item.description}
                  </p>
                )}
                <blockquote className="border-l-2 border-slate-300 pl-3 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">
                  {item.evidence}
                </blockquote>
                {item.kind === "add" && (
                  <label className="block text-xs text-slate-600 dark:text-slate-300">
                    Must be fixed before
                    <select
                      aria-label="Suggested deficiency stage"
                      disabled={applied}
                      value={stages[index] ?? defaultStage}
                      onChange={(event) =>
                        setStages((values) => ({
                          ...values,
                          [index]: event.target
                            .value as TrainingDeficiencyStage,
                        }))
                      }
                      className="ml-2 rounded border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-950"
                    >
                      <option value="pre_solo">Solo</option>
                      <option value="pre_test">Pilot test</option>
                    </select>
                  </label>
                )}
                {item.kind !== "improved" && (
                  <button
                    type="button"
                    disabled={
                      disabled || applied || description.trim().length < 3
                    }
                    onClick={() =>
                      item.kind === "add"
                        ? onAdd(
                            description.trim(),
                            stages[index] ?? defaultStage,
                          )
                        : item.deficiencyId &&
                          onResolve(item.deficiencyId, item.evidence)
                    }
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {applied
                      ? "Added to this record"
                      : item.kind === "add"
                        ? "Add to this record"
                        : "Confirm fixed in this lesson"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
