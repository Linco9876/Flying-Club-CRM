import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const requestWindows = new Map<string, { count: number; resetsAt: number }>();
const REQUESTS_PER_MINUTE = 30;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
  },
});

type AddressSuggestion = {
  id: string;
  address: string;
  provider: "google" | "openstreetmap";
};

const clean = (value: unknown) => String(value || "").trim().replace(/\s+/g, " ");

const clientAddress = (request: Request) =>
  clean(
    request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || "unknown",
  );

const rateLimitExceeded = (request: Request) => {
  const now = Date.now();
  const key = clientAddress(request);
  const current = requestWindows.get(key);
  if (!current || current.resetsAt <= now) {
    requestWindows.set(key, { count: 1, resetsAt: now + 60_000 });
    if (requestWindows.size > 2_000) {
      for (const [entryKey, entry] of requestWindows) {
        if (entry.resetsAt <= now) requestWindows.delete(entryKey);
      }
    }
    return false;
  }
  current.count += 1;
  return current.count > REQUESTS_PER_MINUTE;
};

const uniqueSuggestions = (suggestions: AddressSuggestion[]) => {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = suggestion.address.toLocaleLowerCase("en-AU");
    if (!suggestion.address || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
};

const photonAddress = (properties: Record<string, unknown>) => {
  const street = clean(properties.street || properties.name);
  const firstLine = [clean(properties.housenumber), street].filter(Boolean).join(" ");
  const locality = clean(properties.city || properties.town || properties.village || properties.locality || properties.county);
  const state = clean(properties.state);
  const postcode = clean(properties.postcode);
  const country = clean(properties.country);
  return [firstLine, locality, [state, postcode].filter(Boolean).join(" "), country]
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index)
    .join(", ");
};

const searchPhoton = async (query: string): Promise<AddressSuggestion[]> => {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  url.searchParams.set("bbox", "112.8,-43.8,153.7,-10.6");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Bendigo-Flying-Club-CRM/1.0 (membership address lookup)",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Address provider returned ${response.status}`);
  const payload = await response.json();
  const features = Array.isArray(payload?.features) ? payload.features : [];
  return uniqueSuggestions(features.map((feature: Record<string, any>) => ({
    id: `osm:${clean(feature?.properties?.osm_type)}:${clean(feature?.properties?.osm_id)}`,
    address: photonAddress(feature?.properties || {}),
    provider: "openstreetmap" as const,
  })));
};

const searchGoogle = async (query: string, apiKey: string): Promise<AddressSuggestion[]> => {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["au"],
      languageCode: "en-AU",
      regionCode: "au",
      includeQueryPredictions: false,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Address provider returned ${response.status}`);
  const payload = await response.json();
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  return uniqueSuggestions(suggestions.map((suggestion: Record<string, any>) => ({
    id: `google:${clean(suggestion?.placePrediction?.placeId)}`,
    address: clean(suggestion?.placePrediction?.text?.text),
    provider: "google" as const,
  })));
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (rateLimitExceeded(request)) return json({ error: "Too many address searches. Wait a moment and try again." }, 429);

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 2_048) return json({ error: "Request is too large" }, 413);
    const body = await request.json().catch(() => ({}));
    const query = clean(body?.query);
    if (query.length < 3) return json({ suggestions: [], provider: "none" });
    if (query.length > 120) return json({ error: "Address search is too long" }, 400);

    const googleApiKey = clean(Deno.env.get("GOOGLE_MAPS_PLATFORM_API_KEY"));
    const configuredProvider = clean(Deno.env.get("ADDRESS_AUTOCOMPLETE_PROVIDER")).toLowerCase();
    const useGoogle = configuredProvider === "google" && Boolean(googleApiKey);
    const suggestions = useGoogle
      ? await searchGoogle(query, googleApiKey)
      : await searchPhoton(query);
    const provider = useGoogle ? "google" : "openstreetmap";
    return json({ suggestions, provider });
  } catch (error) {
    console.error("Address autocomplete failed:", error);
    return json({
      suggestions: [],
      provider: "unavailable",
      message: "Suggestions are temporarily unavailable. Enter the address manually.",
    });
  }
});
