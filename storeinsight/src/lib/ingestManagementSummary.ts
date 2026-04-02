import https from "node:https";
import admin from "firebase-admin";
import type { PropertyConfig } from "@/types/dailySummary";
import { firestore, storage } from "@/server/firebaseAdmin";
import { recordMsrReceipt } from "./dailySummaryRuns";

export type IngestedMsr = {
  propertyCode: string;
  reportDate: string; // YYYY-MM-DD
  storagePath: string;
  cloudfrontUrl: string;
  ownerId: string;
  folderId: string;
  docId: string;
  emailDate?: string;
};

type ManualRequestResult = {
  status: number;
  statusText: string;
  headers: Headers;
  bodyText: string;
};

const MAX_REDIRECTS = 8;

const isRedirectStatus = (status: number): boolean => status >= 300 && status < 400;

const isDnsResolutionError = (error: unknown): boolean => {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: string } }).cause : null;
  if (cause?.code === "ENOTFOUND") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /ENOTFOUND/i.test(message);
};

const resolveHostnameViaDoh = async (hostname: string): Promise<string[]> => {
  const dnsUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
  const res = await fetch(dnsUrl, {
    headers: { accept: "application/dns-json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`DNS-over-HTTPS lookup failed (${res.status} ${res.statusText}) for ${hostname}`);
  }
  const json = (await res.json()) as { Answer?: Array<{ data?: string; type?: number }> };
  const ips = (json.Answer ?? [])
    .filter((answer) => answer.type === 1 && typeof answer.data === "string" && answer.data.length > 0)
    .map((answer) => answer.data as string);
  if (!ips.length) {
    throw new Error(`No A records returned for ${hostname}`);
  }
  return ips;
};

const requestViaResolvedIp = async (urlStr: string): Promise<ManualRequestResult> => {
  const url = new URL(urlStr);
  const ips = await resolveHostnameViaDoh(url.hostname);
  let lastError: unknown = null;

  for (const ip of ips) {
    try {
      return await new Promise<ManualRequestResult>((resolve, reject) => {
        const req = https.request(
          {
            host: ip,
            servername: url.hostname,
            port: url.port ? Number(url.port) : 443,
            method: "GET",
            path: `${url.pathname}${url.search}`,
            headers: {
              Host: url.host,
              Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
              "User-Agent": "store-msr-ingest/1.0",
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on("end", () => {
              const headers = new Headers();
              for (const [key, value] of Object.entries(res.headers)) {
                if (Array.isArray(value)) {
                  headers.set(key, value.join(", "));
                } else if (typeof value === "string") {
                  headers.set(key, value);
                }
              }
              resolve({
                status: res.statusCode ?? 0,
                statusText: res.statusMessage ?? "",
                headers,
                bodyText: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        req.on("error", reject);
        req.end();
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error(`Unable to request ${url.hostname} via resolved IPs`);
};

const requestUrlManual = async (urlStr: string): Promise<ManualRequestResult> => {
  try {
    const res = await fetch(urlStr, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
    });
    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      bodyText: await res.text(),
    };
  } catch (err) {
    if (!isDnsResolutionError(err)) {
      throw err;
    }
    const hostname = new URL(urlStr).hostname;
    console.warn("[msr-ingest] retrying request with DNS fallback", { url: urlStr, hostname });
    return requestViaResolvedIp(urlStr);
  }
};

const resolveViewerRequest = async (startUrl: string): Promise<{ finalUrl: string; bodyText: string }> => {
  let currentUrl = startUrl;

  for (let redirectCount = 0; redirectCount < MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestUrlManual(currentUrl);
    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`Redirect missing location header for ${currentUrl}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      console.error("[msr-ingest] failed to resolve viewer URL", {
        viewerUrl: startUrl,
        currentUrl,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Failed to resolve viewer URL (${response.status} ${response.statusText})`);
    }
    return { finalUrl: currentUrl, bodyText: response.bodyText };
  }

  throw new Error(`Too many redirects while resolving viewer URL: ${startUrl}`);
};

const parseMetaFromUrl = (urlStr: string) => {
  try {
    const url = new URL(urlStr);
    const fileName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    const match = fileName.match(/managementsummaryreport-([^-]+)-(\d{8})-\d{6}\.xlsx/i);
    if (!match) return null;
    const propertyCode = match[1];
    const dateRaw = match[2];
    const reportDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    return { propertyCode, reportDate, fileName, normalizedUrl: url.toString() };
  } catch (err) {
    console.warn("[msr-ingest] unable to parse URL", urlStr, err);
    return null;
  }
};

export async function ingestManagementSummariesFromViewer(
  viewerUrl: string,
  options?: { propertyConfigs?: PropertyConfig[]; emailDate?: string },
): Promise<IngestedMsr[]> {
  if (!firestore || !storage) {
    throw new Error("Firebase is not initialized (firestore/storage missing). Check environment variables.");
  }

  const propertyMap = new Map<string, PropertyConfig>();
  (options?.propertyConfigs ?? []).forEach((config) => {
    const slug = (config.propertyCode ?? "").toLowerCase();
    const idKey = (config.propertyId ?? config.tenantPropertyId ?? config.id ?? "").toLowerCase();
    if (slug) {
      propertyMap.set(slug, config);
    }
    if (idKey && !propertyMap.has(idKey)) {
      propertyMap.set(idKey, config);
    }
  });

  const resolvePropertyConfig = (code: string): PropertyConfig | undefined => {
    const key = code.toLowerCase();
    return propertyMap.get(key);
  };

  const { finalUrl, bodyText: initialHtml } = await resolveViewerRequest(viewerUrl);

  const cookieProbe = await requestUrlManual(finalUrl);
  const setCookie = cookieProbe.headers.get("set-cookie");
  if (setCookie) {
    const cookiePreview = setCookie.split(";")[0] ?? "";
    console.log("[msr-ingest] viewer cookie captured", {
      status: cookieProbe.status,
      cookiePreview,
    });
  }

  const parsed = new URL(finalUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const ownerIdx = segments.indexOf("owners");
  const folderIdx = segments.indexOf("folders");
  const ownerId = ownerIdx >= 0 && ownerIdx + 1 < segments.length ? segments[ownerIdx + 1] : null;
  const folderId = folderIdx >= 0 && folderIdx + 1 < segments.length ? segments[folderIdx + 1] : null;

  const docIds = extractDocIdsFromHtml(initialHtml);
  if (!docIds.length && setCookie) {
    try {
      const htmlWithCookie = await fetch(finalUrl, {
        method: "GET",
        cache: "no-store",
        headers: { Cookie: setCookie },
      }).then((r) => r.text());
      const moreDocIds = extractDocIdsFromHtml(htmlWithCookie);
      docIds.push(...moreDocIds);
    } catch {
      // ignore
    }
  }

  const uniqueDocIds = [...new Set(docIds)];
  console.log("[msr-ingest] extracted doc ids", { count: uniqueDocIds.length, docIds: uniqueDocIds });

  if (!ownerId || !folderId || !uniqueDocIds.length) {
    console.error("[msr-ingest] unable to parse ownerId/folderId/docIds from final URL", { finalUrl });
    throw new Error("Invalid viewer URL: missing owner, folder, or doc id.");
  }

  console.log("[msr-ingest] resolved viewer URL", { viewerUrl, finalUrl, ownerId, folderId });

  const allMatched: Array<{ url: string; docId: string }> = [];

  for (const docId of uniqueDocIds) {
    const apiUrl = `${parsed.origin}/api/download?owner=${encodeURIComponent(ownerId)}&docId=${encodeURIComponent(docId)}&docType=csv&reportTitle=Management_Summary_Report`;
    const cookiePreview = setCookie ? setCookie.split(";")[0] ?? "" : "";
    console.log("[msr-ingest] calling download manifest", {
      apiUrl,
      hasCookie: Boolean(setCookie),
      cookiePreview,
      ownerId,
      docId,
      docType: "csv",
      reportTitle: "Management_Summary_Report",
    });

    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*" };
    if (setCookie) {
      headers.Cookie = setCookie;
    }

    const apiRes = await fetch(apiUrl, {
      method: "GET",
      headers,
    });
    const apiText = await apiRes.text();
    if (!apiRes.ok) {
      console.error("[msr-ingest] download manifest failed", {
        method: "GET",
        apiUrl,
        status: apiRes.status,
        statusText: apiRes.statusText,
        bodySnippet: apiText.slice(0, 300),
      });
      throw new Error(`Failed to fetch download manifest (${apiRes.status} ${apiRes.statusText})`);
    }

    let json: unknown;
    try {
      json = JSON.parse(apiText);
    } catch (err) {
      console.error("[msr-ingest] unable to parse manifest JSON", { apiUrl, snippet: apiText.slice(0, 300) }, err);
      throw new Error("Unable to parse download manifest JSON.");
    }

    const urls = extractXlsxUrls(json, viewerUrl);
    const matchedUrls = urls.filter((url) => {
      const [base] = url.split("?");
      const lower = base.toLowerCase();
      return lower.endsWith(".xlsx") && lower.includes("managementsummaryreport");
    });

    console.info("[msr-ingest] discovered XLSX urls for doc", {
      docId,
      count: matchedUrls.length,
      first: matchedUrls[0]?.slice(0, 80),
    });

    matchedUrls.forEach((url) => allMatched.push({ url, docId }));
  }

  if (!allMatched.length) {
    console.error("[msr-ingest] no XLSX URLs discovered from viewer page", {
      viewerUrl,
      candidates: [],
    });
    throw new Error("No XLSX URLs discovered from viewer page");
  }

  console.info("[msr-ingest] total matched XLSX urls", { count: allMatched.length, first: allMatched[0]?.url.slice(0, 80) });

  const results: IngestedMsr[] = [];
  const filenameDeduper = new Map<string, number>();

  for (const { url: rawUrl, docId } of allMatched) {
    const meta = parseMetaFromUrl(rawUrl);
    const fallbackDate = new Date().toISOString().slice(0, 10);
    const normalizedUrl = meta?.normalizedUrl ?? rawUrl;

    const fileName = decodeURIComponent(new URL(normalizedUrl).pathname.split("/").pop() ?? "");
    const { propertyName, propertyCode: derivedCode, reportDate: derivedDate } = derivePropertyDetails(
      fileName,
      meta?.propertyCode ?? docId,
    );

    const reportDate = meta?.reportDate ?? derivedDate ?? fallbackDate;
    const propertyCode = meta?.propertyCode ?? derivedCode ?? `doc-${docId}`;

    const baseKey = `${reportDate}|${propertyName}`;
    const count = filenameDeduper.get(baseKey) ?? 0;
    filenameDeduper.set(baseKey, count + 1);
    const suffix = count > 0 ? ` (${count + 1})` : "";
    const finalFilename = `Management Summary Report - ${propertyName}${suffix} - ${reportDate}.xlsx`;
    const storagePath = `msr_raw/${reportDate}/${finalFilename}`;
    const docKey = `${propertyCode}_${reportDate}`;
    const docRef = firestore.collection("msrReports").doc(docKey);

    const propertyConfig = resolvePropertyConfig(propertyCode);
    const sendTimeMst = propertyConfig?.sendTimeMst ?? propertyConfig?.sendTimeLocal;
    const propertyId = propertyConfig?.propertyId ?? propertyConfig?.tenantPropertyId ?? propertyConfig?.id;
    const propertyNameForStatus = propertyConfig?.name ?? propertyName;
    const emailDate = options?.emailDate;

    try {
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data() as {
          propertyCode?: string;
          reportDate?: string;
          storagePath?: string;
          cloudfrontUrl?: string;
          emailDate?: string;
        };
        const msrPath = data?.storagePath ?? storagePath;
        if (emailDate && emailDate !== data?.emailDate) {
          await docRef.set({ emailDate }, { merge: true }).catch(() => undefined);
        }
        try {
          await recordMsrReceipt({
            propertyCode: data?.propertyCode ?? propertyCode,
            propertyId,
            propertyName: propertyNameForStatus,
            reportDate: data?.reportDate ?? reportDate,
            msrPath,
            sendTimeMst,
          });
        } catch (statusErr) {
          console.warn("[msr-ingest] unable to update run status (existing)", { propertyCode, reportDate }, statusErr);
        }
        results.push({
          propertyCode: data?.propertyCode ?? propertyCode,
          reportDate: data?.reportDate ?? reportDate,
          storagePath: msrPath ?? storagePath,
          cloudfrontUrl: data?.cloudfrontUrl ?? normalizedUrl,
          emailDate: data?.emailDate ?? emailDate ?? reportDate,
          ownerId,
          folderId,
          docId,
        });
        continue;
      }

      console.info("[msr-ingest] downloading", normalizedUrl);
      const fileRes = await fetch(normalizedUrl, { method: "GET" });
      if (!fileRes.ok) {
        throw new Error(`Download failed (${fileRes.status} ${fileRes.statusText})`);
      }
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.info("[msr-ingest] uploading to storage", storagePath);
      await storage.file(storagePath).save(buffer, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        resumable: false,
        metadata: { cacheControl: "private,max-age=0" },
      });

      try {
        await docRef.create({
          propertyCode,
          reportDate,
          emailDate: emailDate ?? reportDate,
          cloudfrontUrl: normalizedUrl,
          storagePath,
          ownerId,
          folderId,
          docId,
          parseStatus: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        try {
          await recordMsrReceipt({
            propertyCode,
            propertyId,
            propertyName: propertyNameForStatus,
            reportDate,
            msrPath: storagePath,
            sendTimeMst,
          });
        } catch (statusErr) {
          console.warn("[msr-ingest] unable to update run status (new)", { propertyCode, reportDate }, statusErr);
        }
        results.push({ propertyCode, reportDate, storagePath, cloudfrontUrl: normalizedUrl, ownerId, folderId, docId });
      } catch (docErr) {
        const code = (docErr as { code?: number; message?: string })?.code;
        const msg = (docErr as { message?: string })?.message ?? "";
          if (code === 6 || msg.includes("ALREADY_EXISTS")) {
            const latest = await docRef.get();
            const data = latest.data() as {
              propertyCode?: string;
              reportDate?: string;
              storagePath?: string;
            cloudfrontUrl?: string;
            ownerId?: string;
            folderId?: string;
              docId?: string;
              emailDate?: string;
            } | null;
            const msrPath = data?.storagePath ?? storagePath;
            try {
              await recordMsrReceipt({
                propertyCode: data?.propertyCode ?? propertyCode,
                propertyId,
                propertyName: propertyNameForStatus,
                reportDate: data?.reportDate ?? reportDate,
                msrPath,
                sendTimeMst,
              });
            } catch (statusErr) {
              console.warn("[msr-ingest] unable to update run status (race)", { propertyCode, reportDate }, statusErr);
            }
            results.push({
              propertyCode: data?.propertyCode ?? propertyCode,
              reportDate: data?.reportDate ?? reportDate,
              storagePath: msrPath,
              cloudfrontUrl: data?.cloudfrontUrl ?? normalizedUrl,
              ownerId: data?.ownerId ?? ownerId,
              folderId: data?.folderId ?? folderId,
              docId: data?.docId ?? docId,
              emailDate: data?.emailDate ?? emailDate ?? reportDate,
            });
        } else {
          throw docErr;
        }
      }
    } catch (err) {
      console.error("[msr-ingest] failed to process", { url: normalizedUrl, propertyCode, reportDate }, err);
    }
  }

  return results;
}

function extractXlsxUrls(manifest: unknown, viewerUrl: string): string[] {
  const urls = new Set<string>();
  const prefersMsr = (url: string) => url.toLowerCase().includes("managementsummaryreport");
  const addUrl = (url: string) => {
    if (!url || !url.toLowerCase().includes(".xlsx")) return;
    urls.add(url);
  };

  const normalize = (href: string): string => {
    try {
      if (href.startsWith("http://") || href.startsWith("https://")) return href;
      return new URL(href, viewerUrl).toString();
    } catch {
      return href;
    }
  };

  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      addUrl(normalize(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v));
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const urlFields = ["downloadUrl", "url", "href", "link"];
      for (const field of urlFields) {
        const v = obj[field];
        if (typeof v === "string") {
          addUrl(normalize(v));
        }
      }
      const listFields = ["files", "reports", "items", "data"];
      for (const lf of listFields) {
        const v = obj[lf];
        if (Array.isArray(v)) {
          v.forEach((item) => walk(item));
        }
      }
    }
  };

  // First check if manifest itself is an array or has nested arrays
  walk(manifest);

  // Prefer MSR-specific URLs if any, otherwise return all
  const all = Array.from(urls);
  const msrOnly = all.filter(prefersMsr);
  return msrOnly.length > 0 ? msrOnly : all;
}

function extractDocIdsFromHtml(html: string): string[] {
  if (!html) return [];
  const matches = html.match(/doc[0-9a-z]{10,}/gi) ?? [];
  return matches;
}

function derivePropertyDetails(fileName: string, fallbackCode?: string): {
  propertyName: string;
  propertyCode: string;
  reportDate?: string;
} {
  const decoded = decodeURIComponent(fileName || "").replace(/\+/g, " ");
  const lower = decoded.toLowerCase();
  const dateMatch = lower.match(/(\d{8})-\d{6}\.xlsx$/);
  const reportDate = dateMatch ? `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}` : undefined;

  const slugMatch =
    decoded.match(/managementsummaryreport-[^-]+-(.+?)-\d{8}-\d{6}\.xlsx/i) ||
    decoded.match(/managementsummaryreport-(.+?)-\d{8}-\d{6}\.xlsx/i);
  // Do not remove this normalization. Some upstream viewer/manifests now append
  // transient timestamp/index suffixes (for example `storeatthegrove-1773476121417-0`)
  // and those must never become the persisted propertyCode in msrReports.
  const normalizePropertySlug = (value: string): string =>
    value
      .trim()
      .replace(/-\d{10,}-\d+$/i, "")
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/gi, "")
      .toLowerCase();

  const propertySlug = normalizePropertySlug(slugMatch?.[1] ?? fallbackCode ?? "unknown-property");
  const propertyName = titleCase(propertySlug.replace(/[-_]+/g, " ").trim() || "Unknown Property");

  return {
    propertyName,
    propertyCode: propertySlug,
    reportDate,
  };
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
