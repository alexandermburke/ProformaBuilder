"use client";

import { useMemo, useState, type ChangeEvent, type JSX } from "react";
import BackLink from '@/components/BackLink';
import { Upload, FileSpreadsheet, FileArchive, CircleAlert, Download } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

type ProcessResult = {
  sourceFilename: string;
  outputFilename: string;
  accountName: string;
  statementRange: string;
  charges: number;
  payments: number;
  totalNewActivity: string;
  totalPaymentsReceived: string;
  success: boolean;
  error?: string;
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

export default function LsaAutomationPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const [artifact, setArtifact] = useState<{
    name: string;
    mimeType: string;
    base64: string;
  } | null>(null);

  const fileSummary = useMemo(() => {
    const pdfCount = files.filter((file) => /\.pdf$/i.test(file.name)).length;
    const zipCount = files.filter((file) => /\.zip$/i.test(file.name)).length;
    return { pdfCount, zipCount };
  }, [files]);

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []).filter((file) =>
      /\.(pdf|zip)$/i.test(file.name),
    );
    setFiles(nextFiles);
    setError(null);
    setResults([]);
    setArtifact(null);
  };

  const handleProcess = async () => {
    if (files.length === 0) {
      setError("Upload a ZIP or at least one PDF statement first.");
      return;
    }

    setBusy(true);
    setError(null);
    setResults([]);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file, file.name);
      }

      const response = await fetch("/api/lsa-automation/process", {
        method: "POST",
        body: formData,
      });
      const rawResponse = await response.text();
      let payload: {
        error?: string;
        artifactName?: string;
        artifactMimeType?: string;
        artifactBase64?: string;
        results?: ProcessResult[];
      } = {};

      if (rawResponse) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          payload = JSON.parse(rawResponse) as typeof payload;
        } else if (rawResponse.trim().startsWith("{")) {
          payload = JSON.parse(rawResponse) as typeof payload;
        } else if (rawResponse.trim().startsWith("<")) {
          throw new Error(
            `${extractHtmlErrorMessage(rawResponse)} If this is a dev server, restart it so /api/lsa-automation/process is loaded cleanly.`,
          );
        } else {
          throw new Error(rawResponse.trim());
        }
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to process uploaded statements.");
      }

      if (!payload.artifactName || !payload.artifactMimeType || !payload.artifactBase64) {
        throw new Error("The export completed without a downloadable artifact.");
      }

      setArtifact({
        name: payload.artifactName,
        mimeType: payload.artifactMimeType,
        base64: payload.artifactBase64,
      });
      setResults(payload.results ?? []);
      downloadBase64Artifact(payload.artifactBase64, payload.artifactMimeType, payload.artifactName);
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Unable to process uploaded statements.");
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
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">LSA Automation</h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Upload one or more Google Ads / LSA statement PDFs or a ZIP containing them. This tool extracts the
                statement data and exports matching Excel workbooks without touching the rest of the app.
              </p>
            </div>
            <BackLink href="/automations" label="Back to automations" />
          </div>
        </header>

        <section className="ios-card p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
            <div className="space-y-5">
              <div>
                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Upload source files</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Accepted: <code>.pdf</code> and <code>.zip</code>. ZIP uploads can include mixed files; only PDFs
                  are processed.
                </p>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-8 py-12 text-center transition hover:border-[color:var(--accent-strong)] hover:bg-[color:var(--surface)]/90">
                <Upload className="h-8 w-8 text-[color:var(--accent-strong)]" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Choose PDFs or a ZIP</p>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    Multiple PDFs are fine. The download will be one XLSX or a ZIP of XLSX files.
                  </p>
                </div>
                <input
                  type="file"
                  accept=".pdf,.zip,application/pdf,application/zip"
                  multiple
                  className="hidden"
                  onChange={handleFiles}
                />
              </label>

              {files.length > 0 && (
                <div className="rounded-2xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--text-secondary)]">
                    <span className="ios-pill text-[10px]" data-tone="neutral">
                      {files.length} file{files.length === 1 ? "" : "s"}
                    </span>
                    <span>{fileSummary.pdfCount} PDF</span>
                    <span>{fileSummary.zipCount} ZIP</span>
                  </div>
                  <div className="mt-3 max-h-56 overflow-y-auto space-y-2">
                    {files.map((file) => (
                      <div
                        key={`${file.name}-${file.size}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border-soft)]/60 bg-[color:var(--surface)] px-4 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[color:var(--text-primary)]">{file.name}</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        {file.name.toLowerCase().endsWith(".zip") ? (
                          <FileArchive className="h-4 w-4 shrink-0 text-[color:var(--accent-strong)]" aria-hidden />
                        ) : (
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-[color:var(--accent-strong)]" aria-hidden />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="ios-button px-5 py-2 text-sm"
                  data-variant="primary"
                  onClick={handleProcess}
                  disabled={busy || files.length === 0}
                >
                  {busy ? "Extracting..." : "Extract and export"}
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
                <li>Extracts the Google Ads / LSA statement text from the PDF.</li>
                <li>Maps statement summary, charge rows, and payment rows into an Excel sheet named <code>Table 1</code>.</li>
                <li>Exports one workbook per PDF, preserving the statement structure for accounting handoff.</li>
              </ul>
            </div>
          </div>
        </section>

        {results.length > 0 && (
          <section className="ios-card p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Extraction results</p>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Review the parsed statement counts below. Successful files were included in the download.
                </p>
              </div>
              <span className="ios-pill text-[10px]" data-tone="neutral">
                {results.filter((result) => result.success).length}/{results.length} succeeded
              </span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {results.map((result) => (
                <article
                  key={`${result.sourceFilename}-${result.outputFilename}`}
                  className="rounded-3xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                        {result.sourceFilename}
                      </p>
                      <p className="mt-1 text-xs text-[color:var(--text-secondary)]">{result.outputFilename}</p>
                    </div>
                    <span className="ios-pill text-[10px]" data-tone={result.success ? "success" : "warning"}>
                      {result.success ? "Ready" : "Failed"}
                    </span>
                  </div>

                  {result.success ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Account</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.accountName}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Range</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.statementRange}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Charges</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.charges}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Payments</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.payments}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">New activity</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.totalNewActivity}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Payments received</p>
                        <p className="mt-1 text-sm text-[color:var(--text-primary)]">{result.totalPaymentsReceived}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex items-start gap-2 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-sm text-[#92400E]">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <p>{result.error ?? "The file could not be parsed."}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
