// US Census geocoder is primary: free, no API key, purpose-built for US
// addresses, and it resolves USPS city names (e.g. "Laveen Village") that
// OpenStreetMap does not recognize. Nominatim is kept as a fallback.
const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy requires an identifying User-Agent with contact info.
// Requests without it are throttled or blocked.
const NOMINATIM_USER_AGENT =
  process.env.GEOCODER_CONTACT ??
  "storeinsight-comp-sets/1.0 (+https://storestorage.com; contact: alex@storestorage.com)";

const PROVIDER_TIMEOUT_MS = 7000;
// Successful matches are cached for the life of the process. Negative results
// (not_found) get a short TTL so a transient outage never poisons the cache
// permanently; transport errors are never cached.
const NOT_FOUND_TTL_MS = 5 * 60 * 1000;

export type GeocodePoint = {
  lat: number;
  lon: number;
};

export type GeocodeStatus = "matched" | "not_found" | "invalid" | "error";

export type GeocodeResult = {
  status: GeocodeStatus;
  point: GeocodePoint | null;
  query: string;
};

type CacheEntry = { result: GeocodeResult; expiresAt: number };

const geocodeCache = new Map<string, CacheEntry>();

function getCached(query: string): GeocodeResult | null {
  const hit = geocodeCache.get(query);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    geocodeCache.delete(query);
    return null;
  }
  return hit.result;
}

function setCached(query: string, result: GeocodeResult): void {
  // Never cache transport errors; let the next attempt retry the provider.
  if (result.status === "error") return;
  const expiresAt =
    result.status === "matched" ? Number.POSITIVE_INFINITY : Date.now() + NOT_FOUND_TTL_MS;
  geocodeCache.set(query, { result, expiresAt });
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Returns a point on a clean match, null on a clean "no match", and throws on
// any transport/parse failure so the caller can decide whether to fall back.
async function geocodeViaCensus(query: string): Promise<GeocodePoint | null> {
  const url = new URL(CENSUS_URL);
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) {
    throw new Error(`census http ${res.status}`);
  }

  const data = (await res.json()) as {
    result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> };
  };
  const match = data?.result?.addressMatches?.[0];
  if (!match) return null;

  // Census returns x = longitude, y = latitude.
  const lon = Number(match.coordinates?.x);
  const lat = Number(match.coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

async function geocodeViaNominatim(query: string): Promise<GeocodePoint | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("q", query);

  const res = await fetchWithTimeout(url.toString(), {
    headers: { "User-Agent": NOMINATIM_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`nominatim http ${res.status}`);
  }

  const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  const first = data?.[0];
  const lat = first?.lat ? Number(first.lat) : Number.NaN;
  const lon = first?.lon ? Number(first.lon) : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return { lat, lon };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const query = address.trim();
  if (!query) {
    return { status: "invalid", point: null, query: "" };
  }

  const cacheHit = getCached(query);
  if (cacheHit) return cacheHit;

  let point: GeocodePoint | null = null;
  let sawError = false;

  // Primary: US Census.
  try {
    point = await geocodeViaCensus(query);
  } catch (err) {
    sawError = true;
    console.warn(`[geocode] census provider failed for "${query}":`, err);
  }

  // Fallback: Nominatim, only if Census did not produce a match.
  if (!point) {
    try {
      point = await geocodeViaNominatim(query);
    } catch (err) {
      sawError = true;
      console.warn(`[geocode] nominatim provider failed for "${query}":`, err);
    }
  }

  let result: GeocodeResult;
  if (point) {
    result = { status: "matched", point, query };
  } else if (sawError) {
    // Every provider we tried errored out; this is transient, not a real miss.
    result = { status: "error", point: null, query };
  } else {
    result = { status: "not_found", point: null, query };
  }

  setCached(query, result);
  return result;
}
