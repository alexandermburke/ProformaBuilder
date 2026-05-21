"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent, type JSX } from "react";
import { CheckCircle2, CircleAlert, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

type UploadKey =
  | "siteInfo"
  | "siteUnits"
  | "accounts"
  | "notes"
  | "pcd"
  | "dispositionReport";

type UploadSlot = {
  key: UploadKey;
  label: string;
  description: string;
  accept: string;
};

type ProcessSummary = {
  siteNumber: string;
  siteName: string;
  sourceUnitCount: number;
  includedUnitCount: number;
  excludedUnitCount: number;
  occupiedCount: number;
  vacantCount: number;
  promotionUnitCount: number;
  prepaidTenantCount: number;
  warningCount: number;
  warnings: string[];
};

const UPLOAD_SLOTS: UploadSlot[] = [
  {
    key: "siteInfo",
    label: "Site Info.txt",
    description: "Site name, number, and address.",
    accept: ".txt,text/plain",
  },
  {
    key: "siteUnits",
    label: "stage_op_site_units.csv",
    description: "EXR unit inventory and rent rates.",
    accept: ".csv,text/csv",
  },
  {
    key: "accounts",
    label: "stage_op_accounts.csv",
    description: "Tenant, payment, access, and insurance data.",
    accept: ".csv,text/csv",
  },
  {
    key: "notes",
    label: "stage_op_notes.csv",
    description: "Notes scan for lien or military references.",
    accept: ".csv,text/csv",
  },
  {
    key: "pcd",
    label: "stage_op_pcd.csv",
    description: "Promotion/discount control data for validation.",
    accept: ".csv,text/csv",
  },
  {
    key: "dispositionReport",
    label: "Disposition Final Reports.xlsx",
    description: "Walk Thru and Promo Usage sheets.",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
];

const overlayTopLight =
  "bg-[radial-gradient(circle_at_14%_10%,rgba(124,58,237,0.18),transparent_58%)]";
const overlayTopDark =
  "bg-[radial-gradient(circle_at_14%_10%,rgba(168,85,247,0.25),transparent_56%)]";
const overlayBottomLight =
  "bg-[radial-gradient(circle_at_86%_86%,rgba(14,165,233,0.14),transparent_62%)]";
const overlayBottomDark =
  "bg-[radial-gradient(circle_at_86%_86%,rgba(56,189,248,0.18),transparent_60%)]";

function downloadBase64Artifact(base64: string, mimeType: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function extractHtmlErrorMessage(html: string): string {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const headingMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  return "The server returned an HTML error page instead of JSON.";
}

export default function ExrHummingbirdPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  const [files, setFiles] = useState<Partial<Record<UploadKey, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProcessSummary | null>(null);
  const [artifact, setArtifact] = useState<{ name: string; mimeType: string; base64: string } | null>(null);

  const readyCount = useMemo(
    () => UPLOAD_SLOTS.filter((slot) => Boolean(files[slot.key])).length,
    [files],
  );
  const canProcess = readyCount === UPLOAD_SLOTS.length && !busy;

  const handleFileChange = (slot: UploadSlot, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFiles((prev) => {
      const next = { ...prev };
      if (file) {
        next[slot.key] = file;
      } else {
        delete next[slot.key];
      }
      return next;
    });
    setError(null);
    setSummary(null);
    setArtifact(null);
  };

  const handleProcess = async () => {
    if (!canProcess) {
      setError("Upload all six EXR source files before generating the Hummingbird workbook.");
      return;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const form = new FormData();
      for (const slot of UPLOAD_SLOTS) {
        const file = files[slot.key];
        if (!file) throw new Error(`Missing ${slot.label}.`);
        form.append(slot.key, file, file.name);
      }

      const response = await fetch("/api/exr-hummingbird/process", {
        method: "POST",
        body: form,
      });
      const rawResponse = await response.text();
      let payload: {
        error?: string;
        artifactName?: string;
        artifactMimeType?: string;
        artifactBase64?: string;
        summary?: ProcessSummary;
      } = {};

      if (rawResponse) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json") || rawResponse.trim().startsWith("{")) {
          payload = JSON.parse(rawResponse) as typeof payload;
        } else if (rawResponse.trim().startsWith("<")) {
          throw new Error(
            `${extractHtmlErrorMessage(rawResponse)} If this is a dev server, restart it so /api/exr-hummingbird/process is loaded cleanly.`,
          );
        } else {
          throw new Error(rawResponse.trim());
        }
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to process the EXR transfer bundle.");
      }
      if (!payload.artifactName || !payload.artifactMimeType || !payload.artifactBase64 || !payload.summary) {
        throw new Error("The export completed without a downloadable workbook.");
      }

      setArtifact({
        name: payload.artifactName,
        mimeType: payload.artifactMimeType,
        base64: payload.artifactBase64,
      });
      setSummary(payload.summary);
      downloadBase64Artifact(payload.artifactBase64, payload.artifactMimeType, payload.artifactName);
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Unable to process the EXR transfer bundle.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 lg:px-10 lg:py-16">
        <header className="ios-card flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">Automation tools</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                EXR to Hummingbird Tenant Transfer
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Upload the standard Extra Space transfer bundle and generate the populated Hummingbird/Tenant
                import workbook from the managed template.
              </p>
            </div>
            <Link href="/automations" className="ios-button shrink-0 px-4 py-2 text-sm" data-variant="ghost">
              <span aria-hidden className="-ml-1 mr-1 text-base">
                &larr;
              </span>
              Back to automations
            </Link>
          </div>
        </header>

        <section className="ios-card p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Required source files</p>
              <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                {readyCount}/{UPLOAD_SLOTS.length} uploaded
              </p>
            </div>
            <button
              type="button"
              className="ios-button px-5 py-2 text-sm"
              data-variant="primary"
              disabled={!canProcess}
              onClick={handleProcess}
            >
              {busy ? "Generating..." : "Generate workbook"}
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {UPLOAD_SLOTS.map((slot) => {
              const file = files[slot.key];
              return (
                <label
                  key={slot.key}
                  className="flex cursor-pointer items-start gap-4 rounded-3xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 p-5 transition hover:border-[color:var(--accent-strong)] hover:bg-[color:var(--surface)]/90"
                >
                  <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--accent-soft)] text-[color:var(--accent-strong)]">
                    {file ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <Upload className="h-5 w-5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{slot.label}</span>
                    <span className="mt-1 block text-xs text-[color:var(--text-secondary)]">{slot.description}</span>
                    {file && (
                      <span className="mt-3 flex items-center gap-2 rounded-2xl border border-[color:var(--border-soft)]/60 bg-[color:var(--surface)] px-3 py-2 text-xs">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-[color:var(--accent-strong)]" aria-hidden />
                        <span className="truncate">{file.name}</span>
                      </span>
                    )}
                  </span>
                  <input
                    type="file"
                    accept={slot.accept}
                    className="hidden"
                    onChange={(event) => handleFileChange(slot, event)}
                  />
                </label>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {artifact && (
              <button
                type="button"
                className="ios-button px-5 py-2 text-sm"
                data-variant="secondary"
                onClick={() => downloadBase64Artifact(artifact.base64, artifact.mimeType, artifact.name)}
              >
                <Download className="h-4 w-4" aria-hidden />
                Download again
              </button>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>{error}</p>
              </div>
            )}
          </div>
        </section>

        {summary && (
          <section className="ios-card p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Export summary</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  {summary.siteNumber} - {summary.siteName}
                </p>
              </div>
              <span className="ios-pill text-[10px]" data-tone={summary.warningCount > 0 ? "warning" : "success"}>
                {summary.warningCount > 0 ? `${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"}` : "Ready"}
              </span>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryStat label="Source units" value={summary.sourceUnitCount} />
              <SummaryStat label="Included units" value={summary.includedUnitCount} />
              <SummaryStat label="Excluded units" value={summary.excludedUnitCount} />
              <SummaryStat label="Occupied / vacant" value={`${summary.occupiedCount} / ${summary.vacantCount}`} />
              <SummaryStat label="Promos" value={summary.promotionUnitCount} />
              <SummaryStat label="Prepaid tenants" value={summary.prepaidTenantCount} />
            </div>

            {summary.warnings.length > 0 && (
              <div className="mt-6 rounded-3xl border border-[#FDE68A] bg-[#FFFBEB] p-5 text-sm text-[#92400E]">
                <p className="font-semibold">Review warnings</p>
                <ul className="mt-3 space-y-2">
                  {summary.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-3xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-5">
      <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[color:var(--text-primary)]">{value}</p>
    </div>
  );
}
