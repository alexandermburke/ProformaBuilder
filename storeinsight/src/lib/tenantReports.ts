/**
 * Tenant/Hummingbird Management Summary JSON helpers.
 */

export interface TenantApiResponse<T> {
  data: T;
  message: string;
  status: number;
}

// TODO: refine fields once we inspect live responses from the Tenant API.
export interface TenantManagementSummary {
  asOfDate?: string;
  companyId?: string;
  propertyId?: string;
  occupancy?: {
    squareFeetPercent?: number;
    unitsPercent?: number;
    economicPercent?: number;
  };
  revenue?: {
    grossPotentialRent?: number;
    grossPotentialRentPerSf?: number;
    effectivePotentialRent?: number;
    projectedRent?: number;
    projectedRentPerSf?: number;
  };
  arAging?: {
    bucket0To10?: number;
    bucket11To30?: number;
    bucket31To60?: number;
    bucket61To90?: number;
    bucket91To120?: number;
    bucket121To180?: number;
    bucket181To360?: number;
    bucket361Plus?: number;
    total?: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type TenantSummaryTokens = Record<string, string | number>;

export async function getManagementSummary(options: {
  companyId: string;
  propertyId: string;
  date: string; // YYYY-MM-DD
  apiKey: string;
  appId: string;
  baseUrl: string;
}): Promise<TenantManagementSummary> {
  if (!options.companyId || !options.propertyId || !options.date || !options.apiKey || !options.appId) {
    throw new Error("getManagementSummary: companyId, propertyId, date, apiKey, and appId are required.");
  }

  const search = new URLSearchParams({
    property_id: options.propertyId,
    date: options.date,
  });
  const url = `${options.baseUrl.replace(/\/$/, "")}/v1/companies/${options.companyId}/reports/management-summary/get?${search.toString()}`;
  console.log("[tenant] GET", url);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": options.apiKey,
      "x-api-appid": options.appId,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    console.error("[tenant] management-summary failed", res.status, res.statusText, bodyText.slice(0, 400));
    throw new Error(`Tenant management summary failed (${res.status} ${res.statusText}): ${bodyText}`);
  }

  const json = (await res.json()) as TenantApiResponse<TenantManagementSummary>;
  if (!json || typeof json !== "object" || json.data === undefined) {
    throw new Error("Tenant management summary response is missing data.");
  }
  return json.data;
}

export function mapManagementSummaryToTokens(ms: TenantManagementSummary): TenantSummaryTokens {
  const occSqft = ms.occupancy?.squareFeetPercent ?? 0;
  const occUnits = ms.occupancy?.unitsPercent ?? 0;
  const occEcon = ms.occupancy?.economicPercent ?? 0;

  const gpr = ms.revenue?.grossPotentialRent ?? 0;
  const gprPerSf = ms.revenue?.grossPotentialRentPerSf ?? 0;
  const effPotRent = ms.revenue?.effectivePotentialRent ?? 0;
  const projRent = ms.revenue?.projectedRent ?? 0;
  const projRentPerSf = ms.revenue?.projectedRentPerSf ?? 0;

  const ar = ms.arAging ?? {};
  const tokens: TenantSummaryTokens = {
    OCCPCT_SQFT: occSqft,
    OCCPCT_UNITS: occUnits,
    OCCPCT_ECON: occEcon,
    GPR: gpr,
    GPRPERSF: gprPerSf,
    GROSSPOTRENTSF: gprPerSf,
    EFFPOTRENT: effPotRent,
    PROJRENT: projRent,
    PROJRENTPERSF: projRentPerSf,
    ARAGING_0_10: ar.bucket0To10 ?? 0,
    ARAGING_11_30: ar.bucket11To30 ?? 0,
    ARAGING_31_60: ar.bucket31To60 ?? 0,
    ARAGING_61_90: ar.bucket61To90 ?? 0,
    ARAGING_91_120: ar.bucket91To120 ?? 0,
    ARAGING_121_180: ar.bucket121To180 ?? 0,
    ARAGING_181_360: ar.bucket181To360 ?? 0,
    ARAGING_361_PLUS: ar.bucket361Plus ?? 0,
  };

  const arTotal =
    (ar.bucket0To10 ?? 0) +
    (ar.bucket11To30 ?? 0) +
    (ar.bucket31To60 ?? 0) +
    (ar.bucket61To90 ?? 0) +
    (ar.bucket91To120 ?? 0) +
    (ar.bucket121To180 ?? 0) +
    (ar.bucket181To360 ?? 0) +
    (ar.bucket361Plus ?? 0);

  tokens.TOTALARALL = ar.total ?? arTotal;
  tokens.AROVER30DAYSPCT = tokens.TOTALARALL ? ((arTotal - (ar.bucket0To10 ?? 0) - (ar.bucket11To30 ?? 0)) / tokens.TOTALARALL) * 100 : 0;

  return tokens;
}
