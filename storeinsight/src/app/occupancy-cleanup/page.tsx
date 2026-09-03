"use client";

import { useState, type ChangeEvent, type JSX } from "react";
import BackLink from '@/components/BackLink';
import { Upload, FileSpreadsheet, Download } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

type ProcessSummary = {
  propertyName: string;
  standardStorageRows: number;
  parkingRows: number;
  outputFilename: string;
};

const overlayTopLight =
  "bg-[radial-gradient(circle_at_14%_10%,rgba(14,165,233,0.18),transparent_58%)]";
const overlayTopDark =
  "bg-[radial-gradient(circle_at_14%_10%,rgba(14,165,233,0.26),transparent_56%)]";
const overlayBottomLight =
  "bg-[radial-gradient(circle_at_86%_86%,rgba(16,185,129,0.14),transparent_62%)]";
const overlayBottomDark =
  "bg-[radial-gradient(circle_at_86%_86%,rgba(16,185,129,0.18),transparent_60%)]";

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
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }
  const headingMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (headingMatch?.[1]) {
    return headingMatch[1].trim();
  }
  return "The server returned an HTML error page instead of JSON.";
}

export default function OccupancyCleanupPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProcessSummary | null>(null);
  const [artifact, setArtifact] = useState<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>(null);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files ?? []).find((entry) => /\.xlsx$/i.test(entry.name));
    setFile(next ?? null);
    setError(null);
    setSummary(null);
    setArtifact(null);
  };

  const handleProcess = async () => {
    if (!file) {
      setError("Upload the Occupancy Statistics Report XLSX first.");
      return;
    }

    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.append("files", file, file.name);

      const response = await fetch("/api/occupancy-cleanup/process", {
        method: "POST",
        body: formData,
      });
      const rawResponse = await response.text();
      let payload: {
        error?: string;
        artifactName?: string;
        artifactMimeType?: string;
        artifactBase64?: string;
        propertyName?: string;
        standardStorageRows?: number;
        parkingRows?: number;
      } = {};

      if (rawResponse) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          payload = JSON.parse(rawResponse) as typeof payload;
        } else if (rawResponse.trim().startsWith("{")) {
          payload = JSON.parse(rawResponse) as typeof payload;
        } else if (rawResponse.trim().startsWith("<")) {
          throw new Error(
            `${extractHtmlErrorMessage(rawResponse)} If this is a dev server, restart it so /api/occupancy-cleanup/process is loaded cleanly.`,
          );
        } else {
          throw new Error(rawResponse.trim());
        }
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to process the uploaded workbook.");
      }

      if (!payload.artifactName || !payload.artifactMimeType || !payload.artifactBase64) {
        throw new Error("The export completed without a downloadable artifact.");
      }

      setArtifact({
        name: payload.artifactName,
        mimeType: payload.artifactMimeType,
        base64: payload.artifactBase64,
      });
      setSummary({
        propertyName: payload.propertyName ?? "",
        standardStorageRows: payload.standardStorageRows ?? 0,
        parkingRows: payload.parkingRows ?? 0,
        outputFilename: payload.artifactName,
      });
      downloadBase64Artifact(payload.artifactBase64, payload.artifactMimeType, payload.artifactName);
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Unable to process the uploaded workbook.");
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
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                Occupancy Stats Report Cleanup
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Drop the raw Occupancy Statistics Report from Tenant or Hummingbird. The tool aggregates
                the Standard Storage and Parking sheets and returns the same workbook with a new
                Lender Unit Mix sheet appended.
              </p>
            </div>
            <BackLink href="/automations" label="Back to automations" />
          </div>
        </header>

        <section className="ios-card p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Upload source workbook</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Accepted: a single <code>.xlsx</code> Occupancy Statistics Report. The original sheets
                  stay in place. Only the Lender Unit Mix sheet is added.
                </p>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-8 py-12 text-center transition hover:border-[color:var(--accent-strong)] hover:bg-[color:var(--surface)]/90">
                <Upload className="h-8 w-8 text-[color:var(--accent-strong)]" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Choose the Occupancy Statistics XLSX</p>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    One workbook at a time. The result downloads automatically when ready.
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={handleFiles}
                />
              </label>

              {file && (
                <div className="rounded-2xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-4">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border-soft)]/60 bg-[color:var(--surface)] px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[color:var(--text-primary)]">{file.name}</p>
                      <p className="text-xs text-[color:var(--text-secondary)]">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-[color:var(--accent-strong)]" aria-hidden />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="ios-button px-5 py-2 text-sm"
                  data-variant="primary"
                  onClick={handleProcess}
                  disabled={busy || !file}
                >
                  {busy ? "Processing..." : "Clean up and download"}
                </button>
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
              </div>

              {error && (
                <div className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                  {error}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-6">
              <p className="text-sm font-semibold text-[color:var(--accent-strong)]">What this does</p>
              <ul className="mt-4 space-y-3 text-sm text-[color:var(--text-secondary)]">
                <li>Reads every SS and P detail sheet in the source workbook.</li>
                <li>
                  Aggregates units by size with weighted average rent, occupied square footage, and
                  occupancy percentage.
                </li>
                <li>Appends a new Lender Unit Mix sheet named after the property and keeps the rest of the workbook intact.</li>
              </ul>
            </div>
          </div>
        </section>

        {summary && (
          <section className="ios-card p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Result</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  {summary.outputFilename}
                </p>
              </div>
              <span className="ios-pill text-[10px]" data-tone="success">
                Ready
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Property</p>
                <p className="mt-1 text-sm text-[color:var(--text-primary)]">{summary.propertyName || "-"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Standard Storage sizes</p>
                <p className="mt-1 text-sm text-[color:var(--text-primary)]">{summary.standardStorageRows}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Parking sizes</p>
                <p className="mt-1 text-sm text-[color:var(--text-primary)]">{summary.parkingRows}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
