"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import type { JSX } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import {
  extractDelinquencyMetrics,
  type DelinquencyExtractionResult,
} from "@/lib/extractDelinquency";
import {
  buildDelinquencyAuditRows,
  type DelinquencyAuditRow,
} from "@/lib/delinquencyAudit";
import {
  DELINQUENCY_BUCKET_KEYS,
  type DelinquencyBucketKey,
  type DelinquencyCellKind,
  DELINQ_CELL_MAP,
} from "@/lib/delinqCellMap";

type SuccessfulExtraction = Extract<DelinquencyExtractionResult, { ok: true }>;

const BUCKET_LABELS: Record<DelinquencyBucketKey, string> = {
  "0_10": "0-10 days",
  "11_30": "11-30 days",
  "31_60": "31-60 days",
  "61_90": "61-90 days",
  "91_120": "91-120 days",
  "121_180": "121-180 days",
  "181_360": "181-360 days",
  "361_PLUS": "361+ days",
};

const SUMMARY_GROUPS = [
  {
    id: "30",
    label: "0-30 days past due",
    tokens: [
      { key: "DELINDOL30", label: "Dollars" },
      { key: "DELINUNIT30", label: "Units" },
      { key: "DELINPER30", label: "Percent" },
    ],
  },
  {
    id: "60",
    label: "31-60 days past due",
    tokens: [
      { key: "DELINDOL60", label: "Dollars" },
      { key: "DELINUNIT60", label: "Units" },
      { key: "DELINPER60", label: "Percent" },
    ],
  },
  {
    id: "61plus",
    label: "61+ days past due",
    tokens: [
      { key: "DELINDOL61", label: "Dollars" },
      { key: "DELINUNIT61", label: "Units" },
      { key: "DELINPER61", label: "Percent" },
    ],
  },
] as const;

const metricFormatters: Record<DelinquencyCellKind, Intl.NumberFormat> = {
  dollars: new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }),
  units: new Intl.NumberFormat("en-US"),
  percent: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

const instructionList = [
  "Upload the Executive Summary (ESR) workbook – no PPT is required.",
  "We only read the ESR sheet, scanning cells L30-L37 (dollars), M30-M37 (units), and N30-N37 (percent).",
  "Each delinquency token sums one or more of those cells. Missing cells are treated as 0 so tokens never render blank.",
];

export default function AuditPage(): JSX.Element {
  const [result, setResult] = useState<SuccessfulExtraction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const auditRows = useMemo<DelinquencyAuditRow[]>(() => {
    if (!result) return [];
    return buildDelinquencyAuditRows({
      tokens: result.tokens,
      provenance: result.provenance,
    });
  }, [result]);

  const bucketEntries = useMemo(() => {
    if (!result) return [];
    const data = result.debug.buckets;
    return DELINQUENCY_BUCKET_KEYS.map((bucketKey) => ({
      key: bucketKey,
      label: BUCKET_LABELS[bucketKey],
      metrics: data[bucketKey],
    }));
  }, [result]);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const extraction = extractDelinquencyMetrics(buffer);
      if (!extraction.ok) {
        setError(extraction.message);
        return;
      }
      setResult(extraction);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to read workbook. Please try again.",
      );
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
    setFileName("");
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.15),_transparent_55%)] px-4 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="rounded-3xl border border-white/10 bg-[rgba(2,6,23,0.75)] p-8 shadow-2xl shadow-blue-500/10 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-blue-300/80">Delinquency</p>
              <h1 className="mt-2 text-4xl font-semibold text-white">Audit workbook view</h1>
              <p className="mt-3 max-w-2xl text-base text-slate-200/90">
                Inspect the exact ESR cells that power the delinquency tokens we push into owner decks.
                Upload a workbook to see token values, sheet provenance, and the per-row math before exporting anything.
              </p>
            </div>
            {result && (
              <div className="flex flex-col items-end justify-end gap-2 text-right text-sm text-slate-300">
                <span className="text-xs uppercase tracking-wide text-slate-400">Workbook</span>
                <span className="font-medium text-white">{fileName || "Untitled"}</span>
                <span className="text-slate-400">Sheet detected: {result.debug.sheet}</span>
              </div>
            )}
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="h-6 w-6 text-blue-300" />
              <div>
                <h2 className="text-lg font-semibold text-white">Upload ESR workbook</h2>
                <p className="text-sm text-slate-300">Only the Executive Summary tab is required.</p>
              </div>
            </div>
            <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-blue-400/50 bg-blue-500/5 px-6 py-10 text-center text-slate-200 hover:border-blue-300 hover:bg-blue-400/10">
              <UploadCloud className="h-8 w-8 text-blue-300" />
              <span className="mt-3 text-base font-medium">Drop a workbook or click to browse</span>
              <span className="text-sm text-slate-400">.xlsx recommended</span>
              <input
                type="file"
                accept=".xlsx,.xlsm,.xls"
                className="sr-only"
                onChange={handleFileChange}
                disabled={isLoading}
              />
            </label>
            {isLoading && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-blue-900/40 px-4 py-3 text-blue-100">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Parsing workbook…</span>
              </div>
            )}
            {error && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-rose-100">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-300">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-slate-200 hover:border-white/30 hover:text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Reset
              </button>
              {result && (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  {result.debug.sheet} detected
                </span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-200 backdrop-blur">
            <p className="text-sm font-semibold text-white">What this page does</p>
            <ul className="mt-4 space-y-3">
              {instructionList.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-1 h-2 w-2 rounded-full bg-blue-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {result && (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              {SUMMARY_GROUPS.map((group) => (
                <div
                  key={group.id}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-900/40 p-5 text-slate-200 shadow-inner shadow-black/20"
                >
                  <p className="text-sm uppercase tracking-wide text-blue-200/80">{group.label}</p>
                  <div className="mt-4 space-y-3">
                    {group.tokens.map((token) => (
                      <div key={token.key} className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">{token.label}</span>
                        <span className="font-semibold text-white">
                          {result.tokens[token.key as keyof SuccessfulExtraction["tokens"]]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-6 text-slate-100 shadow-2xl shadow-blue-950/40">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-4">
                <div>
                  <h2 className="text-xl font-semibold">Token provenance</h2>
                  <p className="text-sm text-slate-400">
                    Every delinquency token, its rendered value, source sheet, and the ESR cells that feed it.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">
                  {auditRows.length} tokens
                </span>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border border-white/5">
                <table className="min-w-full divide-y divide-white/5 text-sm">
                  <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Token</th>
                      <th className="px-4 py-3">Value</th>
                      <th className="px-4 py-3">Sheet</th>
                      <th className="px-4 py-3">Cells</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {auditRows.map((row) => (
                      <tr key={row.token} className="bg-white/[0.01]">
                        <td className="px-4 py-3 font-mono text-xs text-blue-200">{row.token}</td>
                        <td className="px-4 py-3 font-semibold text-white">{row.value}</td>
                        <td className="px-4 py-3 text-slate-300">{row.sheet || "\u2013"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {row.cells.length > 0 ? (
                              row.cells.map((cell) => (
                                <span
                                  key={cell}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-100"
                                >
                                  {cell}
                                </span>
                              ))
                            ) : (
                              <span className="text-slate-500">None</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-6 text-slate-100">
                <div className="border-b border-white/5 pb-4">
                  <h3 className="text-lg font-semibold">Bucket math (live values)</h3>
                  <p className="text-sm text-slate-400">
                    Raw numbers captured from each delinquency row before formatting.
                  </p>
                </div>
                <div className="mt-4 overflow-auto">
                  <table className="min-w-full divide-y divide-white/5 text-sm">
                    <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Bucket</th>
                        <th className="px-3 py-2">L (Dollars)</th>
                        <th className="px-3 py-2">M (Units)</th>
                        <th className="px-3 py-2">N (Percent)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {bucketEntries.map((entry) => (
                        <tr key={entry.key}>
                          <td className="px-3 py-2 font-medium text-slate-200">{entry.label}</td>
                          <td className="px-3 py-2 text-right text-slate-100">
                            {formatMetric("dollars", entry.metrics?.dollars)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-100">
                            {formatMetric("units", entry.metrics?.units)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-100">
                            {formatMetric("percent", entry.metrics?.percent)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 text-slate-100">
                <div className="border-b border-white/5 pb-4">
                  <h3 className="text-lg font-semibold">Cell map reference</h3>
                  <p className="text-sm text-slate-400">
                    Columns stay locked: L = dollars, M = units, N = percent. Update the row numbers if the ESR layout moves.
                  </p>
                </div>
                <div className="mt-4 overflow-auto">
                  <table className="min-w-full divide-y divide-white/5 text-sm">
                    <thead className="bg-white/5 text-left text-xs uppercase tracking-wide text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Bucket</th>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">L (D)</th>
                        <th className="px-3 py-2">M (U)</th>
                        <th className="px-3 py-2">N (P)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {DELINQUENCY_BUCKET_KEYS.map((bucket) => {
                        const cells = DELINQ_CELL_MAP[bucket];
                        const row = extractRowNumber(cells.dollars);
                        return (
                          <tr key={bucket}>
                            <td className="px-3 py-2 font-medium text-slate-200">{BUCKET_LABELS[bucket]}</td>
                            <td className="px-3 py-2 text-slate-300">Row {row}</td>
                            <td className="px-3 py-2 font-mono text-blue-200">{cells.dollars}</td>
                            <td className="px-3 py-2 font-mono text-blue-200">{cells.units}</td>
                            <td className="px-3 py-2 font-mono text-blue-200">{cells.percent}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function formatMetric(kind: DelinquencyCellKind, value: number | undefined): string {
  if (!Number.isFinite(value)) return "\u2013";
  const formatter = metricFormatters[kind];
  if (kind === "percent") {
    return `${formatter.format(value)}%`;
  }
  return formatter.format(value);
}

function extractRowNumber(cellRef: string): number {
  const match = cellRef.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}
