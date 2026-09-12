import { supabase } from "../lib/supabase";
import { withCommentCleanupSessionRetry } from "./commentCleanupSession";
export interface DeficiencySuggestion {
  kind: "add" | "improved" | "resolve";
  description: string;
  deficiencyId: string | null;
  evidence: string;
}
export async function suggestDeficiencies(
  comments: string,
  openDeficiencies: Array<{ id: string; description: string }>,
  signal: AbortSignal,
): Promise<{ suggestions: DeficiencySuggestion[]; discarded: number }> {
  const endpoint = ["localhost", "127.0.0.1", "0.0.0.0"].includes(
    window.location.hostname,
  )
    ? "https://portal.bendigoflyingclub.com.au/api/deficiency-suggestions"
    : "/api/deficiency-suggestions";
  const response = await withCommentCleanupSessionRetry(
    supabase.auth,
    (token) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ comments, openDeficiencies }),
        signal,
      }),
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.suggestions))
    throw new Error(
      body?.error ||
        "Deficiency suggestions could not be loaded. Please try again.",
    );
  return body;
}
