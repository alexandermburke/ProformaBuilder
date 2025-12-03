import fs from "node:fs";
import path from "node:path";

type TenantApiResponse<T> = {
  data: T;
  message: string;
  status: number;
};

type TenantProperty = {
  id: string;
  name: string;
  city?: string;
  state?: string;
  code?: string;
  [key: string]: unknown;
};


const TENANT_BASE_URL = "https://prod.edge.tenant.dev/api/v3/applications"; 
const TENANT_APP_ID = "app315c29fc40344c6c950ffd4ba006d049";       
const TENANT_API_KEY = "b5510aaea9794c6d8f7072c340b7477e";                              
const TENANT_COMPANY_ID = "236";


export async function fetchAllProperties(): Promise<TenantProperty[]> {
  const baseUrl = TENANT_BASE_URL.replace(/\/$/, "");
  const appId = TENANT_APP_ID;
  const companyId = TENANT_COMPANY_ID;
  const apiKey = TENANT_API_KEY;

  if (!baseUrl || !appId || !companyId || !apiKey) {
    throw new Error("Missing TENANT_BASE_URL / TENANT_APP_ID / TENANT_COMPANY_ID / TENANT_API_KEY");
  }

  const search = new URLSearchParams({ all: "true" });
  const url = `${baseUrl}/${appId}/companies/${companyId}/properties?${search.toString()}`;
  const apiDate = Math.floor(Date.now() / 1000).toString();

  console.log("[tenant] about to GET", url);
  console.log("[tenant] X-storageapi-key length:", apiKey.length);
  console.log("[tenant] X-storageapi-date:", apiDate);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-storageapi-key": apiKey,
      "X-storageapi-date": apiDate,
    },
    cache: "no-store",
  });

  console.log("[tenant] response status:", res.status, res.statusText);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Tenant properties request failed (${res.status} ${res.statusText}): ${body.slice(0, 500)}`
    );
  }

  const json = (await res.json()) as TenantApiResponse<TenantProperty[]>;
  if (!json || typeof json !== "object" || !Array.isArray(json.data)) {
    throw new Error("Tenant properties response missing data array.");
  }

  console.log("[tenant] received properties count:", json.data.length);
  return json.data;
}

const buildLookup = (
  properties: TenantProperty[]
): Record<string, { name: string; city?: string; state?: string; code?: string }> => {
  return properties.reduce<
    Record<string, { name: string; city?: string; state?: string; code?: string }>
  >((acc, prop) => {
    if (prop.id) {
      acc[prop.id] = {
        name: prop.name,
        city: prop.city,
        state: prop.state,
        code: prop.code,
      };
    }
    return acc;
  }, {});
};

async function main() {
  console.log("[tenant] starting fetchTenantProperties.ts");
  try {
    const properties = await fetchAllProperties();
    const lookup = buildLookup(properties);
    const outPath = path.join(process.cwd(), "properties.json");
    fs.writeFileSync(outPath, JSON.stringify(lookup, null, 2), "utf-8");
    console.log(`Wrote ${Object.keys(lookup).length} properties to ${outPath}`);
  } catch (err) {
    console.error(
      "Failed to fetch Tenant properties:",
      err instanceof Error ? err.message : err
    );
    process.exitCode = 1;
  }
  console.log("[tenant] script complete");
}

main().catch((err) => {
  console.error("[tenant] unhandled error in main:", err);
  process.exit(1);
});
