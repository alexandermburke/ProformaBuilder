const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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

const geocodeCache = new Map<string, GeocodeResult>();

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const query = address.trim();
  if (!query) {
    return { status: "invalid", point: null, query: "" };
  }

  const cacheHit = geocodeCache.get(query);
  if (cacheHit) return cacheHit;

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "storeinsight-comp-sets/1.0",
      },
    });
    if (!res.ok) {
      const result: GeocodeResult = { status: "error", point: null, query };
      geocodeCache.set(query, result);
      return result;
    }

    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const first = data?.[0];
    const lat = first?.lat ? Number(first.lat) : Number.NaN;
    const lon = first?.lon ? Number(first.lon) : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const result: GeocodeResult = { status: "not_found", point: null, query };
      geocodeCache.set(query, result);
      return result;
    }

    const result: GeocodeResult = {
      status: "matched",
      point: { lat, lon },
      query,
    };
    geocodeCache.set(query, result);
    return result;
  } catch {
    const result: GeocodeResult = { status: "error", point: null, query };
    geocodeCache.set(query, result);
    return result;
  }
}
