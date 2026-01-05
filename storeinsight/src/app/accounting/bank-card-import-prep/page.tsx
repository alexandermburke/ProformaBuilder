"use client";

import Link from "next/link";
import { Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

type UploadKey = "bank" | "card" | "otherBank" | "reference" | "exceptions";

type UploadCard = {
  key: UploadKey;
  title: string;
  detail: string;
  fileTypes: string;
  required: boolean;
  accept: string[];
  examples: string[];
  exampleLabel?: string;
};

const uploadCards: UploadCard[] = [
  {
    key: "bank",
    title: "Operating / trust bank activity",
    detail: "Statement or transaction export per account with running balance and dates.",
    fileTypes: "CSV",
    required: true,
    accept: ["csv", "xlsx"],
    examples: ['11. CSV Bank Export (9).csv'],
  },
  {
    key: "card",
    title: "Corporate card activity",
    detail: "P-card or travel card exports with merchant, memo, and employee fields.",
    fileTypes: "CSV",
    required: true,
    accept: ["csv", "xlsx"],
    examples: ['11. Excel CC Export.csv'],
  },
  {
    key: "otherBank",
    title: "Other bank activity",
    detail: "Additional bank activity that needs to be merged with the primary feed.",
    fileTypes: "XLSX",
    required: true,
    accept: ["xlsx", "csv"],
    examples: ['2025 1130 Other Bank Activity.xlsx'],
  },
  {
    key: "reference",
    title: "Reference mappings (optional)",
    detail: "Payee normalizations and GL/class crosswalks applied during mapping.",
    fileTypes: "XLSX",
    required: false,
    accept: ["csv", "xlsx"],
    examples: ['2025 1130 Bank Deposit Template.xlsx', '2025 1130 CC Activity Template.xlsx'],
    exampleLabel: "Examples (reference templates)",
  },
  {
    key: "exceptions",
    title: "Exceptions log (optional)",
    detail: "Prior-period exceptions to suppress duplicates and overlaps.",
    fileTypes: "CSV",
    required: false,
    accept: ["csv"],
    examples: ["(Optional) Prior-period Exceptions Log.csv"],
  },
];

const flowSteps = [
  { title: "Validate inputs", description: "Confirm required files and file types." },
  { title: "Parse bank export", description: "Read operating/trust bank activity." },
  { title: "Parse card export", description: "Pull card transactions with memo/merchant fields." },
  { title: "Parse other bank activity", description: "Merge secondary bank activity file." },
  { title: "Normalize to Yardi columns", description: "Map values into Yardi_Import schema." },
  { title: "Validate rows", description: "Check dates, accounts, debits/credits, and gaps." },
  { title: "Build workbook", description: "Generate Yardi-ready XLSX and prep download." },
];

const guardrails = [
  "Period detection blocks overlapping statements",
  "Debit/credit sign checks by source type",
  "Header templates per bank/card exporter",
  "Duplicate and gap detection on dates + refs",
  "Audit log of every normalization and override",
];

const outputTiles = [
  {
    title: "Yardi imports",
    detail: "Single workbook with Yardi_Import tab and validated debits/credits.",
    badge: "Primary",
  },
  {
    title: "Exception log",
    detail: "Warnings for missing accounts, invalid dates, or both debit/credit values.",
    badge: "Review",
  },
  {
    title: "Audit trail",
    detail: "Inline log of processing steps and normalization notes.",
    badge: "Trace",
  },
];

const REQUIRED_KEYS: UploadKey[] = ["bank", "card", "otherBank"];

const ACCEPT_MAP: Record<UploadKey, string[]> = {
  bank: ["csv", "xlsx"],
  card: ["csv", "xlsx"],
  otherBank: ["xlsx", "csv"],
  reference: ["csv", "xlsx"],
  exceptions: ["csv"],
};

type ReviewRow = {
  rowNumber: number;
  source: string;
  journalDate: string | null;
  notes: string | null;
  detailNotes: string | null;
  debit: number | null;
  credit: number | null;
  propertyName: string;
  account: string;
};

const DIGITS_ONLY = /^\d+$/;

const emptyUploads = (): Record<UploadKey, { file: File | null; error: string | null }> => ({
  bank: { file: null, error: null },
  card: { file: null, error: null },
  otherBank: { file: null, error: null },
  reference: { file: null, error: null },
  exceptions: { file: null, error: null },
});

const formatBytes = (size: number): string => {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const scaled = size / 1024 ** idx;
  return `${scaled.toFixed(scaled >= 10 ? 0 : 1)} ${units[idx]}`;
};

export default function BankCardImportPrepPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.26),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_62%)]"
    : "bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_62%)]";
  const [uploads, setUploads] = useState<Record<UploadKey, { file: File | null; error: string | null }>>(
    emptyUploads(),
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "ready" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState(0);
  const [step, setStep] = useState("Waiting to start");
  const [logs, setLogs] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [counts, setCounts] = useState<{ bank: number; card: number; otherBank: number; output: number }>({
    bank: 0,
    card: 0,
    otherBank: 0,
    output: 0,
  });
  const [downloadReady, setDownloadReady] = useState(false);
  const [lastDownloadName, setLastDownloadName] = useState<string | null>(null);
  const [lastDownloadAt, setLastDownloadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [copyActive, setCopyActive] = useState(false);
  const [defaultProperty, setDefaultProperty] = useState("");
  const [needsReview, setNeedsReview] = useState(false);
  const [unmappedRows, setUnmappedRows] = useState<ReviewRow[]>([]);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [unmappedError, setUnmappedError] = useState<string | null>(null);
  const [reviewToast, setReviewToast] = useState<string | null>(null);
  const [defaultAccount, setDefaultAccount] = useState("");
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showAdvancedUploads, setShowAdvancedUploads] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const downloadTriggeredRef = useRef(false);
  const reviewModalRef = useRef<HTMLDivElement | null>(null);
  const defaultAccountInputRef = useRef<HTMLInputElement | null>(null);
  const hasOpenedReviewRef = useRef(false);

  const filesReady = useMemo(
    () => REQUIRED_KEYS.every((key) => uploads[key].file && !uploads[key].error),
    [uploads],
  );
  const canProcess = useMemo(
    () => filesReady && Boolean(defaultProperty.trim()),
    [defaultProperty, filesReady],
  );

  useEffect(() => {
    if (processing) return;
    setStatus(canProcess ? "ready" : "idle");
  }, [canProcess, processing]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showReviewModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowReviewModal(false);
        return;
      }
      if (event.key !== "Tab") return;
      const modalNode = reviewModalRef.current;
      if (!modalNode) return;
      const focusables = modalNode.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !modalNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const focusTarget = defaultAccountInputRef.current || reviewModalRef.current?.querySelector<HTMLElement>("input");
    focusTarget?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showReviewModal]);

  const setFile = (key: UploadKey, file: File | null, errorMessage: string | null = null) => {
    setUploads((prev) => ({
      ...prev,
      [key]: { file, error: errorMessage },
    }));
  };

  const validateExtension = (file: File, key: UploadKey): string | null => {
    const allowed = ACCEPT_MAP[key];
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!allowed.includes(ext)) {
      return `Invalid type. Allowed: ${allowed.join(", ").toUpperCase()}`;
    }
    return null;
  };

  const handleFileSelect = (key: UploadKey, files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const errorMessage = validateExtension(file, key);
    setFile(key, errorMessage ? null : file, errorMessage);
  };

  const clearFile = (key: UploadKey) => {
    setFile(key, null, null);
  };

  const triggerDownload = async (id: string) => {
    try {
      const res = await fetch(`/api/accounting/bank-card-import-prep/download?jobId=${id}`, {
        method: "GET",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename=\"(.+)\"/);
      const filename = match?.[1] || `yardi_import_${Date.now()}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setLastDownloadName(filename);
      setLastDownloadAt(new Date().toLocaleString());
    } catch (err) {
      setError((err as Error)?.message ?? "Unable to download file.");
      setStatus("error");
    }
  };

  const formatDateValue = (value: string | number | Date | null | undefined): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return null;
    return date.toLocaleDateString();
  };

  const fetchReviewRows = async (id: string) => {
    setReviewLoading(true);
    setUnmappedError(null);
    setReviewToast(null);
    try {
      const res = await fetch(`/api/accounting/bank-card-import-prep/review?jobId=${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as {
        rows: Array<{
          rowNumber: number;
          source: string;
          journalDate: string | null;
          notes: string | null;
          detailNotes: string | null;
          debit: number | null;
          credit: number | null;
          propertyName: string | null;
          account: string | null;
        }>;
        needsReview?: boolean;
        unmappedCount?: number;
      };

      const mapped = (data.rows || []).map((row) => ({
        rowNumber: row.rowNumber,
        source: row.source,
        journalDate: formatDateValue(row.journalDate),
        notes: row.notes ?? null,
        detailNotes: row.detailNotes ?? null,
        debit: row.debit ?? null,
        credit: row.credit ?? null,
        propertyName: row.propertyName ?? "",
        account: row.account ?? "",
      }));

      setNeedsReview(Boolean(data.needsReview));
      setUnmappedRows(mapped);
      setUnmappedCount(data.unmappedCount ?? mapped.length);
      if (data.needsReview && !hasOpenedReviewRef.current) {
        hasOpenedReviewRef.current = true;
        setShowReviewModal(true);
      }
    } catch (err) {
      setUnmappedError((err as Error)?.message ?? "Unable to load unmapped rows.");
    } finally {
      setReviewLoading(false);
    }
  };

  const fetchStatus = async (id: string, options?: { autoDownload?: boolean }) => {
    const autoDownload = options?.autoDownload ?? true;
    try {
      const res = await fetch(`/api/accounting/bank-card-import-prep/status?jobId=${id}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as {
        status: string;
        percent: number;
        step: string;
        logs: string[];
        warnings: string[];
        downloadReady: boolean;
        needsReview?: boolean;
        unmappedCount?: number;
        counts?: { bank: number; card: number; otherBank: number; output: number };
        outputFilename?: string;
        errorMessage?: string;
      };

      setPercent(data.percent ?? 0);
      setStep(data.step ?? "Processing");
      setLogs(data.logs ?? []);
      setWarnings(data.warnings ?? []);
      setDownloadReady(Boolean(data.downloadReady));
      setNeedsReview(Boolean(data.needsReview));
      setUnmappedCount(data.unmappedCount ?? 0);
      setCounts(data.counts ?? { bank: 0, card: 0, otherBank: 0, output: 0 });

      if (data.status === "error") {
        setProcessing(false);
        setStatus("error");
        setError(data.errorMessage || "Processing failed.");
        if (pollRef.current) clearInterval(pollRef.current);
      } else if (data.needsReview) {
        setProcessing(false);
        setStatus("ready");
        if (pollRef.current) clearInterval(pollRef.current);
        if (id) fetchReviewRows(id);
      } else if (data.status === "done" && data.downloadReady) {
        setProcessing(false);
        setStatus("done");
        if (autoDownload && !downloadTriggeredRef.current) {
          downloadTriggeredRef.current = true;
          triggerDownload(id);
        }
        if (pollRef.current) clearInterval(pollRef.current);
      } else {
        setStatus("processing");
      }
    } catch (err) {
      setProcessing(false);
      setStatus("error");
      setError((err as Error)?.message ?? "Unable to fetch status.");
      if (pollRef.current) clearInterval(pollRef.current);
    }
  };

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    fetchStatus(id);
    pollRef.current = setInterval(() => fetchStatus(id), 750);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator?.clipboard?.writeText(text);
      setCopyToast(`${label} copied`);
      setTimeout(() => setCopyToast(null), 1800);
    } catch {
      setCopyToast(null);
    }
  };

  const buildCopyPayload = () => {
    const header = [
      "Counts",
      `Bank rows: ${counts.bank}`,
      `Card rows: ${counts.card}`,
      `Other bank rows: ${counts.otherBank}`,
      `Exported rows: ${counts.output}`,
    ];
    const warnSection = warnings.length > 0 ? ["Warnings", ...warnings] : ["Warnings", "None"];
    const logSection = logs.length > 0 ? ["Logs", ...logs] : ["Logs", "None"];
    return [...header, "", ...warnSection, "", ...logSection].join("\n");
  };

  const handleProcess = async () => {
    setError(null);
    setUnmappedError(null);
    setNeedsReview(false);
    setUnmappedRows([]);
    setUnmappedCount(0);
    setDefaultAccount("");
    setReviewToast(null);
    setDownloadReady(false);
    setFinalizing(false);
    setShowReviewModal(false);
    hasOpenedReviewRef.current = false;
    setLastDownloadName(null);
    setLastDownloadAt(null);
    if (!filesReady) {
      setError("Select all required files before processing.");
      return;
    }
    if (!defaultProperty.trim()) {
      setError("Default Property is required.");
      return;
    }
    setProcessing(true);
    setStatus("processing");
    setPercent(5);
    setStep("Validate inputs");
    setLogs([]);
    setWarnings([]);
    setDownloadReady(false);
    downloadTriggeredRef.current = false;

    const formData = new FormData();
    formData.append("defaultProperty", defaultProperty.trim());
    (Object.keys(uploads) as UploadKey[]).forEach((key) => {
      const file = uploads[key].file;
      if (file) formData.append(key, file);
    });

    try {
      const res = await fetch("/api/accounting/bank-card-import-prep/process", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Unable to start processing.");
      }
      const json = (await res.json()) as { jobId?: string };
      if (!json.jobId) throw new Error("Missing jobId in response.");
      setJobId(json.jobId);
      startPolling(json.jobId);
    } catch (err) {
      setProcessing(false);
      setStatus("error");
      setError((err as Error)?.message ?? "Failed to start processing.");
    }
  };

  const missingAccountCount = useMemo(
    () => unmappedRows.filter((row) => !row.account.trim()).length,
    [unmappedRows],
  );
  const missingPropertyCount = useMemo(
    () => unmappedRows.filter((row) => !row.propertyName.trim()).length,
    [unmappedRows],
  );
  const invalidAccountCount = useMemo(
    () =>
      unmappedRows.filter(
        (row) => Boolean(row.account.trim()) && !DIGITS_ONLY.test(row.account.trim()),
      ).length,
    [unmappedRows],
  );
  const defaultAccountValid = useMemo(
    () => Boolean(defaultAccount.trim()) && DIGITS_ONLY.test(defaultAccount.trim()),
    [defaultAccount],
  );
  const reviewInvalidCount = useMemo(
    () =>
      unmappedRows.filter(
        (row) => !row.propertyName.trim() || !DIGITS_ONLY.test(row.account.trim()),
      ).length,
    [unmappedRows],
  );
  const issuesRemainingText =
    reviewInvalidCount === 0 ? "0 issues remaining" : `${reviewInvalidCount} row(s) need fixes`;
  const canGenerateDownload =
    unmappedRows.length > 0 &&
    reviewInvalidCount === 0 &&
    !processing &&
    !finalizing &&
    Boolean(jobId);

  const applyDefaultAccount = () => {
    const trimmed = defaultAccount.trim();
    if (!trimmed || !DIGITS_ONLY.test(trimmed)) return;
    let applied = 0;
    setUnmappedRows((prev) =>
      prev.map((row) => {
        if (!row.account.trim()) {
          applied += 1;
          return { ...row, account: trimmed };
        }
        return row;
      }),
    );
    setReviewToast(`Applied to ${applied} rows.`);
    setTimeout(() => setReviewToast(null), 1800);
  };

  const handleGenerateDownload = async () => {
    if (!jobId) {
      setUnmappedError("Missing job ID. Please re-run processing.");
      return;
    }
    setUnmappedError(null);
    setError(null);
    setFinalizing(true);
    setProcessing(true);
    setStep("Build workbook");
    setPercent((prev) => Math.max(prev, 95));
    try {
      const updates = unmappedRows.map((row) => ({
        rowNumber: row.rowNumber,
        propertyName: row.propertyName.trim(),
        account: row.account.trim(),
      }));

      const res = await fetch("/api/accounting/bank-card-import-prep/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jobId, updates }),
      });
      const responseText = res.ok ? "" : await res.text();
      if (!res.ok) {
        throw new Error(responseText || "Unable to generate download.");
      }
      const data = (await res.json()) as {
        downloadReady?: boolean;
        needsReview?: boolean;
        unmappedCount?: number;
        error?: string;
      };

      setNeedsReview(Boolean(data.needsReview));
      setUnmappedCount(data.unmappedCount ?? 0);
      if (data.needsReview) {
        setProcessing(false);
        setUnmappedError(data.error || "Missing required Property_Name or Account.");
        return;
      }

      setDownloadReady(Boolean(data.downloadReady));
      setStatus("done");
      setShowReviewModal(false);
      hasOpenedReviewRef.current = false;
      setProcessing(false);
      downloadTriggeredRef.current = true;
      if (data.downloadReady) {
        await triggerDownload(jobId);
      }
      fetchStatus(jobId, { autoDownload: false });
      setUnmappedRows([]);
    } catch (err) {
      setProcessing(false);
      setUnmappedError((err as Error)?.message ?? "Unable to generate download.");
    } finally {
      setFinalizing(false);
    }
  };

  const statusLabel =
    needsReview
      ? "Needs review"
      : status === "processing"
        ? "Processing"
        : status === "done"
          ? "Complete"
          : status === "error"
            ? "Error"
            : canProcess
              ? "Ready"
              : "Not ready";
  const statusTone =
    needsReview
      ? "warning"
      : status === "done"
        ? "success"
        : status === "processing"
          ? "warning"
          : status === "error"
            ? "danger"
            : "neutral";
  const progressVisible = status === "processing" || status === "done" || percent > 0;
  const canDownloadAgain = downloadReady && status === "done";

  return (
    <div className="bank-card-page owner-reports-page relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 ${overlayBottom}`} />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 lg:gap-12 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up grid gap-6 p-8">
          <div className="flex items-center justify-between gap-3">
            <span className="owner-status-badge" data-tone={statusTone}>
              {statusLabel}
            </span>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <div className="grid gap-4 md:flex md:items-end md:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)]">
                Bank &amp; Card Import Prep
              </h1>
              <p className="text-base text-[color:var(--text-secondary)]">
                Clean, map, and validate bank and card spreadsheets with the same polish as Owner Reports—then export a
                Yardi-ready workbook.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Multi-source intake
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Templates
              </span>
              <span className="ios-pill text-[11px]" data-tone="neutral">
                Validation-first
              </span>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-5">
          <div className="ios-card ios-animate-up lg:col-span-3 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Intake kits</p>
                <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Upload per source</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Keep bank, card, and reference uploads discrete so mapping stays predictable.
                </p>
              </div>
              <span className="owner-status-badge" data-tone={statusTone}>
                {statusLabel}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {uploadCards.map((card) => {
                const current = uploads[card.key];
                return (
                  <div
                    key={card.key}
                    className="flex h-full min-h-[220px] flex-col gap-3 rounded-2xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/85 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[color:var(--text-primary)]">
                          {card.title}
                          {card.required ? " *" : ""}
                        </p>
                        <p className="text-xs text-[color:var(--text-secondary)]">{card.detail}</p>
                        <p className="text-[11px] text-[color:var(--text-muted)]">
                          {card.exampleLabel ?? (card.examples.length > 1 ? "Examples" : "Example")}:{" "}
                          {card.examples.map((ex, idx) => (
                            <span
                              key={ex}
                              className="inline-block rounded-md bg-[color:var(--surface)]/90 px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                            >
                              {ex}
                              {idx < card.examples.length - 1 ? "," : ""}
                            </span>
                          ))}
                        </p>
                      </div>
                      <span className="ios-pill text-[10px]" data-tone="neutral">
                        {card.fileTypes}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 text-sm text-[color:var(--text-secondary)]">
                      {current.file ? (
                        <div className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 px-3 py-2">
                          <p className="font-semibold text-[color:var(--text-primary)]">{current.file.name}</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            {formatBytes(current.file.size)}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-[color:var(--text-muted)]">No file selected.</p>
                      )}
                      {current.error && <p className="text-xs text-[#B91C1C]">{current.error}</p>}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="ios-button px-4 py-2 text-sm"
                        data-variant="primary"
                        onClick={() => document.getElementById(`file-${card.key}`)?.click()}
                      >
                        {current.file ? "Replace" : "Upload"}
                      </button>
                      {current.file && (
                        <button
                          type="button"
                          className="ios-button px-4 py-2 text-sm"
                          data-variant="secondary"
                          onClick={() => clearFile(card.key)}
                        >
                          Remove
                        </button>
                      )}
                      <input
                        id={`file-${card.key}`}
                        type="file"
                        className="hidden"
                        accept={card.accept.map((ext) => `.${ext}`).join(",")}
                        onChange={(event) => handleFileSelect(card.key, event.target.files)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/75 p-4 text-sm text-[color:var(--text-secondary)]">
              Separate uploads let us apply presets per bank/card exporter and reuse payee/GL crosswalks without
              collisions.
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="ios-card ios-animate-up space-y-4 p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Recap / Log</p>
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Processing details</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ios-pill text-[10px]" data-tone="neutral">
                    {counts.output} rows
                  </span>
                  <button
                    type="button"
                    className={`ios-icon-button ${copyActive ? "scale-95" : ""}`}
                    style={{ transition: "transform 180ms ease" }}
                    onClick={() => {
                      const payload = buildCopyPayload();
                      if (!payload.trim()) {
                        setCopyToast("No warnings or logs to copy");
                        setTimeout(() => setCopyToast(null), 1800);
                        return;
                      }
                      setCopyActive(true);
                      setTimeout(() => setCopyActive(false), 180);
                      copyText(payload, "Counts, warnings, and logs");
                    }}
                    title="Copy warnings and logs"
                    aria-label="Copy warnings and logs"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-3 text-xs text-[color:var(--text-secondary)]">
                <p className="font-semibold text-[color:var(--text-primary)]">Counts</p>
                <p>Bank rows: {counts.bank}</p>
                <p>Card rows: {counts.card}</p>
                <p>Other bank rows: {counts.otherBank}</p>
                <p>Exported rows: {counts.output}</p>
              </div>
              {warnings.length > 0 && (
                <div className="space-y-2 rounded-xl border border-[#FACC15]/50 bg-[#FEF9C3] p-3 text-[color:var(--text-primary)]">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#92400E]">Warnings</p>
                  <ul className="space-y-1 text-xs text-[#92400E]">
                    {warnings.map((warn) => (
                      <li key={warn}>• {warn}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-3 text-xs text-[color:var(--text-secondary)]">
                <p className="font-semibold text-[color:var(--text-primary)]">Logs</p>
                <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                  {logs.length === 0 ? (
                    <p className="text-[color:var(--text-muted)]">Logs will appear after processing starts.</p>
                  ) : (
                    logs.map((log, idx) => <p key={`${log}-${idx}`}>• {log}</p>)
                  )}
                </div>
              </div>
            </div>
            <div className="ios-card ios-animate-up space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Outputs</p>
                  <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Process &amp; download</h3>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    Upload required spreadsheets, process, and download the consolidated Yardi-ready workbook.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <label
                    htmlFor="default-property"
                    className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
                  >
                    Default Property *
                  </label>
                  <input
                    id="default-property"
                    name="default-property"
                    className="w-full rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent-strong)] focus:outline-none"
                    placeholder="e.g., STORE on the Grove"
                    value={defaultProperty}
                    onChange={(event) => setDefaultProperty(event.target.value)}
                    disabled={processing}
                    required
                  />
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    Applied whenever Property_Name is blank so Yardi has a property on every row.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  <button
                    type="button"
                    className="ios-button px-5 py-2 text-sm"
                    data-variant="primary"
                    onClick={handleProcess}
                    disabled={!canProcess || processing}
                  >
                    {processing ? "Processing..." : "Process"}
                  </button>
                  <button
                    type="button"
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="secondary"
                    onClick={() => jobId && triggerDownload(jobId)}
                    disabled={!canDownloadAgain}
                    aria-disabled={!canDownloadAgain}
                  >
                    Download again
                  </button>
                </div>
              </div>
              {progressVisible && (
                <div className="space-y-2">
                  <div className="relative h-4 rounded-full border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 shadow-inner">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full bg-[linear-gradient(135deg,rgba(37,99,235,0.9),rgba(59,130,246,0.8))] transition-[width]"
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
                    <span>{step}</span>
                    <span className="font-semibold text-[color:var(--accent-strong)]">{Math.round(percent)}%</span>
                  </div>
                </div>
              )}
              {(needsReview || (unmappedRows.length > 0 && !downloadReady)) && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/85 px-4 py-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                      Review
                    </p>
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      {needsReview ? "Resolve unmapped rows before download." : "Edit unmapped rows as needed."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="ios-pill text-[10px]" data-tone={needsReview ? "warning" : "neutral"}>
                      {unmappedCount || unmappedRows.length} rows
                    </span>
                    {reviewInvalidCount > 0 && (
                      <span className="ios-pill text-[10px]" data-tone="danger">
                        {reviewInvalidCount} invalid
                      </span>
                    )}
                    <button
                      type="button"
                      className="ios-button px-4 py-2 text-sm"
                      data-variant="primary"
                      onClick={() => {
                        if (!unmappedRows.length && jobId) {
                          fetchReviewRows(jobId);
                        }
                        hasOpenedReviewRef.current = true;
                        setShowReviewModal(true);
                      }}
                    >
                      Review unmapped rows ({unmappedCount || unmappedRows.length})
                    </button>
                  </div>
                </div>
              )}
              {lastDownloadName && (
                <div className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 px-3 py-2 text-xs text-[color:var(--text-secondary)]">
                  <p className="font-semibold text-[color:var(--text-primary)]">{lastDownloadName}</p>
                  <p>{lastDownloadAt ? `Generated: ${lastDownloadAt}` : "Ready to download."}</p>
                </div>
              )}
              {copyToast && (
                <div className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 px-3 py-2 text-xs text-[color:var(--accent-strong)]">
                  {copyToast}
                </div>
              )}
              {error && (
                <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">
                  {error}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
      {showReviewModal && (
        <div
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          aria-label="Review unmapped rows"
        >
          <div
            ref={reviewModalRef}
            className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[color:var(--border-soft)]/80 bg-[color:var(--surface)] text-[color:var(--text-primary)] shadow-2xl"
          >
            <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/95 px-6 py-4 backdrop-blur">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Review</p>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Review unmapped rows</h3>
                  <span className="ios-pill text-[10px]" data-tone={missingAccountCount > 0 ? "warning" : "neutral"}>
                    Missing Account: {missingAccountCount}
                  </span>
                  <span className="ios-pill text-[10px]" data-tone={missingPropertyCount > 0 ? "warning" : "neutral"}>
                    Missing Property: {missingPropertyCount}
                  </span>
                  {invalidAccountCount > 0 && (
                    <span className="ios-pill text-[10px]" data-tone="danger">
                      Invalid Account: {invalidAccountCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ios-icon-button"
                  onClick={() => setShowReviewModal(false)}
                  aria-label="Close review modal"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-hidden">
              <div className="h-full space-y-4 overflow-auto px-6 py-5">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-2">
                    <label
                      htmlFor="default-account"
                      className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]"
                    >
                      Default Account (optional)
                    </label>
                    <input
                      id="default-account"
                      ref={defaultAccountInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      className="w-full rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/85 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent-strong)] focus:outline-none"
                      placeholder="e.g., 5100"
                      value={defaultAccount}
                      onChange={(event) => setDefaultAccount(event.target.value.replace(/[^0-9]/g, ""))}
                      disabled={reviewLoading || finalizing}
                    />
                    <p className="text-xs text-[color:var(--text-secondary)]">
                      Fills Account for all rows that are missing Account. Use only if the batch should post to a single GL.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="ios-button px-4 py-2 text-xs"
                      data-variant="secondary"
                      onClick={() => jobId && fetchReviewRows(jobId)}
                      disabled={reviewLoading}
                    >
                      Refresh rows
                    </button>
                    <button
                      type="button"
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="primary"
                      onClick={applyDefaultAccount}
                      disabled={!defaultAccountValid || missingAccountCount === 0 || reviewLoading}
                    >
                      Apply to missing Accounts
                    </button>
                  </div>
                </div>
                {reviewToast && (
                  <div className="rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/85 px-3 py-2 text-xs text-[color:var(--accent-strong)]">
                    {reviewToast}
                  </div>
                )}
                {unmappedError && (
                  <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                    {unmappedError}
                  </div>
                )}
                {reviewLoading ? (
                  <p className="text-sm text-[color:var(--text-secondary)]">Loading unmapped rows...</p>
                ) : unmappedRows.length === 0 ? (
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    All rows have Property_Name and Account values.
                  </p>
                ) : (
                  <div className="overflow-auto rounded-xl border border-[color:var(--border-soft)]/70">
                    <table className="min-w-full divide-y divide-[rgba(148,163,255,0.3)] text-xs">
                      <thead className="bg-[color:var(--surface)]/90 text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
                        <tr className="divide-x divide-[rgba(148,163,255,0.25)]">
                          <th className="px-3 py-2 text-left">Source</th>
                          <th className="px-3 py-2 text-left">JournalDate</th>
                          <th className="px-3 py-2 text-left">Notes</th>
                          <th className="px-3 py-2 text-left">DetailNotes</th>
                          <th className="px-3 py-2 text-right">Debit</th>
                          <th className="px-3 py-2 text-right">Credit</th>
                          <th className="px-3 py-2 text-left">Property_Name</th>
                          <th className="px-3 py-2 text-left">Account</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(148,163,255,0.2)] bg-[color:var(--surface)]">
                        {unmappedRows.map((row) => {
                          const propertyInvalid = !row.propertyName.trim();
                          const accountInvalid = !row.account.trim() || !DIGITS_ONLY.test(row.account.trim());
                          return (
                            <tr key={row.rowNumber} className="divide-x divide-[rgba(148,163,255,0.15)]">
                              <td className="px-3 py-2 font-semibold text-[color:var(--text-primary)]">{row.source}</td>
                              <td className="px-3 py-2 text-[color:var(--text-secondary)]">
                                {row.journalDate || "—"}
                              </td>
                              <td className="px-3 py-2 text-[color:var(--text-secondary)]">
                                {row.notes || "—"}
                              </td>
                              <td className="px-3 py-2 text-[color:var(--text-secondary)]">
                                {row.detailNotes || "—"}
                              </td>
                              <td className="px-3 py-2 text-right text-[color:var(--text-primary)]">
                                {row.debit != null ? row.debit.toLocaleString() : "—"}
                              </td>
                              <td className="px-3 py-2 text-right text-[color:var(--text-primary)]">
                                {row.credit != null ? row.credit.toLocaleString() : "—"}
                              </td>
                              <td className="px-3 py-2">
                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    className={`w-full rounded-lg border px-2 py-1 text-sm text-[color:var(--text-primary)] shadow-sm focus:border-[color:var(--accent-strong)] focus:outline-none ${
                                      propertyInvalid
                                        ? "border-[#FCA5A5] bg-[#FEF2F2]"
                                        : "border-[color:var(--border-soft)] bg-[color:var(--surface)]/80"
                                    }`}
                                    value={row.propertyName}
                                    onChange={(event) =>
                                      setUnmappedRows((prev) =>
                                        prev.map((existing) =>
                                          existing.rowNumber === row.rowNumber
                                            ? { ...existing, propertyName: event.target.value }
                                            : existing,
                                        ),
                                      )
                                    }
                                  />
                                  {propertyInvalid && (
                                    <p className="text-[10px] text-[#B91C1C]">Property is required</p>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="space-y-1">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    className={`w-full rounded-lg border px-2 py-1 text-sm text-[color:var(--text-primary)] shadow-sm focus:border-[color:var(--accent-strong)] focus:outline-none ${
                                      accountInvalid
                                        ? "border-[#FCA5A5] bg-[#FEF2F2]"
                                        : "border-[color:var(--border-soft)] bg-[color:var(--surface)]/80"
                                    }`}
                                    value={row.account}
                                    onChange={(event) =>
                                      setUnmappedRows((prev) =>
                                        prev.map((existing) =>
                                          existing.rowNumber === row.rowNumber
                                            ? { ...existing, account: event.target.value.replace(/[^0-9]/g, "") }
                                            : existing,
                                        ),
                                      )
                                    }
                                  />
                                  {accountInvalid && (
                                    <p className="text-[10px] text-[#B91C1C]">Digits only</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/95 px-6 py-4 backdrop-blur">
              <div className="text-xs text-[color:var(--text-secondary)]">{issuesRemainingText}</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="secondary"
                  onClick={() => setShowReviewModal(false)}
                  disabled={finalizing}
                >
                  Cancel / Exit
                </button>
                <button
                  type="button"
                  className="ios-button px-5 py-2 text-sm"
                  data-variant="primary"
                  onClick={handleGenerateDownload}
                  disabled={!canGenerateDownload || reviewLoading || finalizing}
                >
                  {finalizing ? "Generating..." : "Generate Download"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
