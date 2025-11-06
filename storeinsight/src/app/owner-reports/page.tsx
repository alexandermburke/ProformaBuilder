// Presentation on hero page via Javascript - think Apple like presentation to update David & Mark on changes like UI, Logic, etc. 

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { OwnerFields } from "@/types/ownerReport";
import { useTheme } from "@/components/ThemeProvider";
import { extractBudgetTableFields } from "@/lib/extractBudget";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const FIELD_ORDER = [
  "CURRENTDATE",
  "ADDRESS",
  "OWNERGROUP",
  "ACQUIREDDATE",
  "TOTALUNITS",
  "RENTABLESQFT",
  "CURRENTMONTH",
  "TOTALRENTALINCOME",
  "TOTALINCOME",
  "TOTALEXPENSES",
  "NETINCOME",
  "OCCUPIEDAREASQFT",
  "OCCUPANCYBYUNITS",
  "OCCUPIEDAREAPERCENT",
  "MOVEINS_TODAY",
  "MOVEINS_MTD",
  "MOVEINS_YTD",
  "MOVEOUTS_TODAY",
  "MOVEOUTS_MTD",
  "MOVEOUTS_YTD",
  "NET_TODAY",
  "NET_MTD",
  "NET_YTD",
  "MOVEINS_SQFT_MTD",
  "MOVEOUTS_SQFT_MTD",
  "NET_SQFT_MTD",
] as const satisfies readonly (keyof OwnerFields)[];

type FieldKey = (typeof FIELD_ORDER)[number];
type OwnerFieldOverrides = Partial<Record<FieldKey, OwnerFields[FieldKey]>>;

const FIELD_TITLES: Record<FieldKey, string> = {
  CURRENTDATE: "Current Date",
  ADDRESS: "Property Address",
  OWNERGROUP: "Owner Group",
  ACQUIREDDATE: "Acquired Date",
  TOTALUNITS: "Total Units",
  RENTABLESQFT: "Rentable SqFt",
  CURRENTMONTH: "Current Month",
  TOTALRENTALINCOME: "Total Rental Income",
  TOTALINCOME: "Total Income",
  TOTALEXPENSES: "Total Expenses",
  NETINCOME: "Net Income",
  OCCUPIEDAREASQFT: "Occupied Area SqFt",
  OCCUPANCYBYUNITS: "Occupancy by Units",
  OCCUPIEDAREAPERCENT: "Occupied Area Percent",
  MOVEINS_TODAY: "Move-Ins Today",
  MOVEINS_MTD: "Move-Ins MTD",
  MOVEINS_YTD: "Move-Ins YTD",
  MOVEOUTS_TODAY: "Move-Outs Today",
  MOVEOUTS_MTD: "Move-Outs MTD",
  MOVEOUTS_YTD: "Move-Outs YTD",
  NET_TODAY: "Net Today",
  NET_MTD: "Net MTD",
  NET_YTD: "Net YTD",
  MOVEINS_SQFT_MTD: "Move-Ins SqFt MTD",
  MOVEOUTS_SQFT_MTD: "Move-Outs SqFt MTD",
  NET_SQFT_MTD: "Net SqFt MTD",
};

const NUMERIC_FIELDS = new Set<FieldKey>([
  "TOTALUNITS",
  "RENTABLESQFT",
  "TOTALRENTALINCOME",
  "TOTALINCOME",
  "TOTALEXPENSES",
  "NETINCOME",
  "OCCUPIEDAREASQFT",
  "OCCUPANCYBYUNITS",
  "OCCUPIEDAREAPERCENT",
  "MOVEINS_TODAY",
  "MOVEINS_MTD",
  "MOVEINS_YTD",
  "MOVEOUTS_TODAY",
  "MOVEOUTS_MTD",
  "MOVEOUTS_YTD",
  "NET_TODAY",
  "NET_MTD",
  "NET_YTD",
  "MOVEINS_SQFT_MTD",
  "MOVEOUTS_SQFT_MTD",
  "NET_SQFT_MTD",
]);
const REQUIRED_NUMERIC_FIELDS = new Set<FieldKey>(["TOTALUNITS", "RENTABLESQFT"]);

const STEP_LABELS: Record<Step, string> = {
  1: "Upload Summary",
  2: "Budget Inputs",
  3: "Map Budget Table",
  4: "Map Summary",
  5: "Validate",
  6: "Generate",
  7: "Export",
};

type BudgetColumnMeta = {
  suffix: string;
  label: string;
  description: string;
};

type BudgetLine = {
  label: string;
  baseKey: string;
  page: 0 | 1;
};

const BUDGET_COLUMNS: BudgetColumnMeta[] = [
  { suffix: "CM", label: "Current Month Actual", description: "Column B - PTD Actual" },
  { suffix: "PTD", label: "PTD Budget", description: "Column C - PTD Budget" },
  { suffix: "VAR", label: "Variance", description: "Column D - Variance" },
  { suffix: "VARPER", label: "% Variance", description: "Column E - % Var" },
  { suffix: "YTD", label: "YTD Actual", description: "Column F - YTD Actual" },
  { suffix: "YTDBUD", label: "YTD Budget", description: "Column G - YTD Budget" },
  { suffix: "YTDVAR", label: "YTD Variance", description: "Column H - Variance" },
  { suffix: "YTDVARPER", label: "YTD % Variance", description: "Column I - % Var" },
];

const BUDGET_LINES: BudgetLine[] = [
  { label: "Rental Income", baseKey: "RENTINC", page: 0 },
  { label: "Discounts", baseKey: "DISC", page: 0 },
  { label: "TOTAL RENTAL INCOME", baseKey: "TOTRENINC", page: 0 },
  { label: "Tenant Income - Admin Fees", baseKey: "ADMFE", page: 0 },
  { label: "Tenant Income - Late Fees", baseKey: "LATEFEE", page: 0 },
  { label: "Tenant Income - Insurance", baseKey: "INSURT", page: 0 },
  { label: "Tenant Income - Other", baseKey: "OTHER", page: 0 },
  { label: "Retail Sales", baseKey: "RETSAL", page: 0 },
  { label: "TOTAL INCOME", baseKey: "TOTALINC", page: 0 },
  { label: "Advertising & Marketing", baseKey: "ADVER", page: 1 },
  { label: "Auction Expenses", baseKey: "AUCT", page: 1 },
  { label: "CAM Charges", baseKey: "CAM", page: 1 },
  { label: "Credit Card Merchant Fees", baseKey: "CCM", page: 1 },
  { label: "Dues & Subscriptions", baseKey: "DUES", page: 1 },
  { label: "Fire Prevention", baseKey: "FIRE", page: 1 },
  { label: "Insurance", baseKey: "INSUREXP", page: 1 },
  { label: "Licenses & Permits", baseKey: "PERM", page: 1 },
  { label: "Management Fees", baseKey: "MGMT", page: 1 },
  { label: "Management Fees - Staff Costs", baseKey: "MGMSTF", page: 1 },
  { label: "Office Supplies", baseKey: "OFFSUP", page: 1 },
  { label: "Professional Fees", baseKey: "PROF", page: 1 },
  { label: "Repairs & Maintenance", baseKey: "REP", page: 1 },
  { label: "Retail Products", baseKey: "RETPROD", page: 1 },
  { label: "Security", baseKey: "SEC", page: 1 },
  { label: "Software", baseKey: "SOFT", page: 1 },
  { label: "Supplies - Building", baseKey: "SUPP", page: 1 },
  { label: "Telephone & Internet", baseKey: "INTER", page: 1 },
  { label: "Utilities", baseKey: "UTIL", page: 1 },
  { label: "TOTAL PROPERTY EXPENSES", baseKey: "TOTALPROP", page: 1 },
  { label: "Other Expenses", baseKey: "OTHEREXP", page: 1 },
  { label: "TOTAL OTHER EXPENSES", baseKey: "TOTOTHEREXP", page: 1 },
  { label: "TOTAL EXPENSES", baseKey: "TOTEXP", page: 1 },
  { label: "Interest Income", baseKey: "INTINC", page: 1 },
  { label: "NET INCOME", baseKey: "NETINC", page: 1 },
];

const BUDGET_PAGES = [
  { page: 0, title: "{{CURRENTMONTH}} Data" },
  { page: 1, title: "{{CURRENTMONTH}} Data (continued)" },
];

const TOTAL_BUDGET_TOKENS = BUDGET_LINES.length * BUDGET_COLUMNS.length;

function downloadFromUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function OwnerReportsPage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.26),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_62%)]"
    : "bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_62%)]";
  const [guideOpen, setGuideOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<OwnerFields | null>(null);
  const [overrides, setOverrides] = useState<OwnerFieldOverrides>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDownload, setLastDownload] = useState<{
    url: string;
    name: string;
    data: OwnerFields;
  } | null>(null);
  const [budgetFile, setBudgetFile] = useState<File | null>(null);
  const [financialsFile, setFinancialsFile] = useState<File | null>(null);
  const [budgetTokens, setBudgetTokens] = useState<Record<string, number>>({});
  const [detectedCount, setDetectedCount] = useState(0);
  const [budgetOverrides, setBudgetOverrides] = useState<Record<string, string>>({});
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetPage, setBudgetPage] = useState(0);
  const lastProcessedFiles = useRef<{ budget: File | null; financial: File | null }>({ budget: null, financial: null });
  const budgetLinesByPage = useMemo(
    () => [
      BUDGET_LINES.filter((line) => line.page === 0),
      BUDGET_LINES.filter((line) => line.page === 1),
    ],
    [],
  );
  const budgetOverrideCount = useMemo(
    () => Object.keys(budgetOverrides).length,
    [budgetOverrides],
  );
  function formatNumericValue(key: FieldKey, raw: number | undefined | null): string {
    const value = Number(raw ?? 0);
    if (!Number.isFinite(value)) return "0";
    if (key === "OCCUPIEDAREAPERCENT") {
      const percent = Math.abs(value) <= 1 ? value * 100 : value;
      return `${percent.toFixed(1)}%`;
    }
    return value.toLocaleString();
  }

  const mergedFields = useMemo<OwnerFields | null>(() => {
    if (!fields) return null;
    const next: OwnerFields = { ...fields };
    const writableNext = next as Record<FieldKey, OwnerFields[FieldKey]>;
    for (const key of FIELD_ORDER) {
      const overrideValue = overrides[key];
      if (overrideValue === undefined) continue;
      if (NUMERIC_FIELDS.has(key)) {
        const cleaned = Number(String(overrideValue ?? "").replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(cleaned)) {
          writableNext[key] = cleaned as OwnerFields[FieldKey];
        }
        continue;
      }
      writableNext[key] = String(overrideValue ?? "") as OwnerFields[FieldKey];
    }
    return next;
  }, [fields, overrides]);

  const missingFields = useMemo(() => {
    const missing = new Set<FieldKey>();
    if (!mergedFields) return missing;
    for (const key of FIELD_ORDER) {
      const value = mergedFields[key];
      if (NUMERIC_FIELDS.has(key)) {
        if (REQUIRED_NUMERIC_FIELDS.has(key)) {
          const numeric = Number(value ?? 0);
          if (!Number.isFinite(numeric) || numeric <= 0) missing.add(key);
        }
      } else if (!String(value ?? "").trim()) {
        missing.add(key);
      }
    }
    return missing;
  }, [mergedFields]);

  const currentMonthLabel = useMemo(() => {
    return (
      mergedFields?.CURRENTMONTH ||
      fields?.CURRENTMONTH ||
      mergedFields?.CURRENTDATE ||
      fields?.CURRENTDATE ||
      "Current Month"
    );
  }, [mergedFields, fields]);
  const hasBudgetData = detectedCount > 0;
  const runBudgetExtract = useCallback(
    async (nextBudget: File | null, nextFinancial: File | null) => {
      if (!nextBudget) {
        lastProcessedFiles.current = {
          budget: null,
          financial: nextFinancial ?? null,
        };
        setBudgetTokens({});
        setDetectedCount(0);
        setBudgetOverrides({});
        setBudgetError(null);
        setBudgetLoading(false);
        setBudgetPage(0);
        return;
      }
      lastProcessedFiles.current = {
        budget: nextBudget,
        financial: nextFinancial ?? null,
      };
      setBudgetLoading(true);
      setBudgetError(null);
      try {
        const budgetBuffer = await nextBudget.arrayBuffer();
        const financialBuffer = nextFinancial ? await nextFinancial.arrayBuffer() : undefined;
        const { tokens, count } = await extractBudgetTableFields(budgetBuffer, financialBuffer);
        console.log("[budget] files", Boolean(nextBudget), Boolean(nextFinancial));
        console.log("[budget] count", count, "sample", Object.keys(tokens).slice(0, 6));
        setBudgetTokens(tokens);
        setDetectedCount(count);
        setBudgetOverrides({});
        setBudgetPage(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to parse the budget workbook.";
        setBudgetError(message);
        setBudgetTokens({});
        setDetectedCount(0);
        setBudgetOverrides({});
      } finally {
        setBudgetLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      budgetFile === lastProcessedFiles.current.budget &&
      financialsFile === lastProcessedFiles.current.financial
    ) {
      return;
    }
    void runBudgetExtract(budgetFile, financialsFile);
  }, [budgetFile, financialsFile, runBudgetExtract]);

  useEffect(() => {
    if (step === 3) setBudgetPage(0);
  }, [step]);

  const handleBudgetFileChange = useCallback(
    (next: File | null) => {
      setBudgetFile(next);
      void runBudgetExtract(next, financialsFile);
    },
    [financialsFile, runBudgetExtract],
  );

  const handleFinancialFileChange = useCallback(
    (next: File | null) => {
      setFinancialsFile(next);
      void runBudgetExtract(budgetFile, next);
    },
    [budgetFile, runBudgetExtract],
  );

  const updateBudgetOverride = useCallback((token: string, value: string) => {
    setBudgetOverrides((prev) => {
      const next = { ...prev };
      if (!value.trim()) {
        delete next[token];
      } else {
        next[token] = value;
      }
      return next;
    });
  }, []);
  const resetBudgetRow = useCallback((baseKey: string) => {
    setBudgetOverrides((prev) => {
      const next = { ...prev };
      for (const column of BUDGET_COLUMNS) {
        delete next[`${baseKey}${column.suffix}`];
      }
      return next;
    });
  }, []);
  const getBudgetInputValue = useCallback(
    (token: string): string => {
      if (budgetOverrides[token] !== undefined) {
        return budgetOverrides[token];
      }
      const detected = budgetTokens[token];
      if (detected === undefined) return "";
      return String(detected);
    },
    [budgetOverrides, budgetTokens],
  );
  const displayedBudgetPage = Math.min(budgetPage, Math.max(BUDGET_PAGES.length - 1, 0));
  const totalBudgetPages = BUDGET_PAGES.length;
  const budgetPageMeta = BUDGET_PAGES[displayedBudgetPage] ?? BUDGET_PAGES[0];
  const budgetPageTitle = budgetPageMeta.title.replace("{{CURRENTMONTH}}", currentMonthLabel);
  const budgetLinesForPage = budgetLinesByPage[displayedBudgetPage] ?? [];

  async function onUpload(f: File) {
    setFile(f);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/owner-reports/preview", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Upload failed.");
      }
      const json = await res.json();
      setFields(json.fields as OwnerFields);
      setOverrides({});
      setStep(2);
      if (lastDownload) {
        URL.revokeObjectURL(lastDownload.url);
        setLastDownload(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to parse the workbook.";
      setError(message);
      setFields(null);
      setOverrides({});
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  function fieldValue(key: FieldKey): string | number {
    if (overrides[key] !== undefined) {
      return overrides[key] as OwnerFields[FieldKey];
    }
    if (!fields) return "";
    return fields[key];
  }

  function onOverride(key: FieldKey, raw: string) {
    setOverrides((prev) => {
      const next: OwnerFieldOverrides = { ...prev };
      if (!raw.trim()) {
        delete next[key];
        return next;
      }
      if (NUMERIC_FIELDS.has(key)) {
        const cleaned = Number(raw.replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(cleaned)) {
          next[key] = cleaned as OwnerFields[FieldKey];
        }
        return next;
      }
      next[key] = raw as OwnerFields[FieldKey];
      return next;
    });
  }

  function isValid(): boolean {
    if (!mergedFields) return false;
    return mergedFields.TOTALUNITS > 0 && mergedFields.RENTABLESQFT > 0;
  }

  async function generate() {
    if (!file || !mergedFields) return;
    setBusy(true);
    setError(null);
    setStep(6);
    try {
      const form = new FormData();
      form.append("file", file);
      if (budgetFile) {
        form.append("budget", budgetFile);
      }
      if (financialsFile) {
        form.append("financial", financialsFile);
      }
      const overridesPayload: OwnerFieldOverrides = {};
      for (const key of FIELD_ORDER) {
        if (overrides[key] !== undefined) {
          overridesPayload[key] = overrides[key] as OwnerFields[FieldKey];
        }
      }
      if (Object.keys(overridesPayload).length > 0) {
        form.append("overrides", JSON.stringify(overridesPayload));
      }
      if (Object.keys(budgetTokens).length > 0) {
        form.append("budgetTokens", JSON.stringify(budgetTokens));
      }
      if (Object.keys(budgetOverrides).length > 0) {
        form.append("budgetOverrides", JSON.stringify(budgetOverrides));
      }
      const res = await fetch("/api/owner-reports/generate", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Generation failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename = `Owner-Report-${mergedFields.CURRENTDATE || "report"}.pptx`;
      setLastDownload((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, name: filename, data: mergedFields };
      });
      downloadFromUrl(url, filename);
      setStep(7);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to generate the presentation.";
      setError(message);
      setStep(5);
    } finally {
      setBusy(false);
    }
  }

  function downloadAgain() {
    if (!lastDownload) return;
    downloadFromUrl(lastDownload.url, lastDownload.name);
  }

  function startAnother() {
    if (lastDownload) {
      URL.revokeObjectURL(lastDownload.url);
    }
    setLastDownload(null);
    setFile(null);
    setFields(null);
    setOverrides({});
    setBudgetFile(null);
    setFinancialsFile(null);
    lastProcessedFiles.current = { budget: null, financial: null };
    setBudgetTokens({});
    setDetectedCount(0);
    setBudgetOverrides({});
    setBudgetError(null);
    setBudgetLoading(false);
    setBudgetPage(0);
    setError(null);
    setBusy(false);
    setStep(1);
  }
  return (
    <div className="owner-reports-page relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 ${overlayBottom}`} />
      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="owner-card owner-card--accent ios-animate-up space-y-6 p-6" data-tone="blue">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.32em] text-[color:var(--accent-strong)]">Store</div>
              <div className="text-[22px] font-semibold tracking-tight text-[color:var(--text-primary)]">Insight Workbench</div>
            </div>
            <div className="ios-pill text-[11px]" data-tone="neutral">
              Owner Reports
            </div>
            <div className="space-y-3 text-sm text-[color:var(--text-secondary)]">
              <p>Upload an Excel workbook, adjust detected values, and export a templated PPTX in minutes.</p>
              <p className="text-[color:var(--accent-strong)]">No data is stored; everything stays in memory during generation.</p>
            </div>
            <div className="rounded-[18px] border border-dashed border-[rgba(148,163,255,0.32)] bg-[rgba(37,99,235,0.08)] p-4 text-xs text-[color:var(--text-secondary)]">
              <div className="font-semibold text-[color:var(--accent-strong)]">Need help?</div>
              <p className="mt-1 leading-relaxed">
                Make sure the first worksheet contains the address, owner group, and key totals. Tokens in the PPTX should use
                double braces like {"{{ADDRESS}}"} for best results.
              </p>
            </div>
            <Link
              href="/guide"
              className="ios-button w-full justify-center px-3 py-1.5 text-xs"
              data-variant="secondary"
              role="button"
            >
              Guide
            </Link>
          </aside>

          <main className="ios-card ios-animate-up space-y-6 p-8">
            <div className="flex flex-col gap-6">
              <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                  <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Create Owner Report</h1>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    Follow the guided flow to review extracted fields and merge them into the PowerPoint template.
                  </p>
                </div>
                <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                  <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
                  Back
                </Link>
              </header>

              <ol className="owner-step-nav text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
                {(Object.keys(STEP_LABELS) as unknown as Step[]).map((keyStep) => (
                  <li
                    key={keyStep}
                    data-state={keyStep === step ? "active" : keyStep < step ? "complete" : "upcoming"}
                    className="owner-step-chip"
                  >
                    <span className="owner-step-number" data-state={keyStep === step ? "active" : keyStep < step ? "complete" : "upcoming"}>
                      {String(keyStep).padStart(2, "0")}
                    </span>
                    <span className="owner-step-label">{STEP_LABELS[keyStep]}</span>
                  </li>
                ))}
              </ol>

              {error && (
                <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                  {error}
                </div>
              )}

              {step === 1 && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 1 - Upload</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Drop your <span className="font-bold">Executive Summary Report</span> (.xlsx) below. Only the first sheet is parsed for now.
                  </p>
                  <div className="mt-5">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="text-sm text-[color:var(--text-primary)]"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0];
                        if (nextFile) onUpload(nextFile);
                      }}
                    />
                  </div>
                  {busy && <p className="mt-3 text-sm text-[color:var(--text-secondary)]">Parsing workbook…</p>}
                  {file && !busy && (
                    <p className="mt-3 text-sm text-[color:var(--text-secondary)]">
                      Last uploaded: <span className="font-medium text-[color:var(--text-primary)]">{file.name}</span>
                    </p>
                  )}
                </section>
              )}

              {step === 2 && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 2 - Budget Inputs</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Upload an optional Budget Comparison workbook and Financial Statements file. They are kept in memory
                    during this session so you can reuse them when generating the presentation.
                  </p>
                  <div className="mt-6 space-y-6">
                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Budget Comparison (.xlsx)</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">Recommended for Budget Variance autofill</p>
                        </div>
                        {budgetFile && (
                          <button
                            type="button"
                            className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => handleBudgetFileChange(null)}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          handleBudgetFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {budgetFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{budgetFile.name}</span>
                        </p>
                      )}
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Financial Statements (.xlsx)</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">Optional fallback file for budget values</p>
                        </div>
                        {financialsFile && (
                          <button
                            type="button"
                            className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => handleFinancialFileChange(null)}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          handleFinancialFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {financialsFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{financialsFile.name}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
                      type="button"
                      onClick={() => setStep(1)}
                    >
                      Back
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8]"
                      type="button"
                      disabled={budgetLoading}
                      onClick={() => setStep(3)}
                    >
                      Continue
                    </button>
                  </div>
                </section>
              )}
              {step === 3 && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 3 - Map Budget Table</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Review the detected budget values and override any amounts before continuing.
                  </p>
                  <div className="owner-info-bar mt-4 text-sm">
                    <span>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{TOTAL_BUDGET_TOKENS}
                      </span>
                    </span>
                    <span className="hidden opacity-50 text-[color:var(--text-muted)] sm:inline">|</span>
                    <span>
                      Manual overrides:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">{budgetOverrideCount}</span>
                    </span>
                  </div>
                  {budgetLoading && (
                    <div className="mt-4 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[color:var(--accent-strong)]">
                      Parsing budget workbook...
                    </div>
                  )}
                  {budgetError && (
                    <div className="mt-4 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                      {budgetError}
                    </div>
                  )}
                  {!budgetLoading && !budgetError && !hasBudgetData && budgetOverrideCount === 0 && (
                    <div className="mt-4 rounded-lg border border-dashed border-[#CBD5F5] bg-[#F9FAFF] px-4 py-3 text-sm text-[color:var(--text-primary)]">
                      No budget values were detected yet. You can still enter amounts manually in the table below.
                    </div>
                  )}
                  <div className="mt-6 space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--text-primary)]">{budgetPageTitle}</p>
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          {displayedBudgetPage === 0
                            ? "Income rows mapped to the first slide."
                            : "Expense rows mapped to the continued slide."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="rounded-full border border-[#CBD5F5] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
                          onClick={() => setBudgetPage((prev) => Math.max(0, prev - 1))}
                          disabled={displayedBudgetPage === 0 || budgetLoading}
                        >
                          Previous
                        </button>
                        <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                          Page {displayedBudgetPage + 1} of {totalBudgetPages}
                        </span>
                        <button
                          type="button"
                          className="rounded-full border border-[#CBD5F5] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
                          onClick={() => setBudgetPage((prev) => Math.min(totalBudgetPages - 1, prev + 1))}
                          disabled={displayedBudgetPage >= totalBudgetPages - 1 || budgetLoading}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    {budgetLinesForPage.length === 0 ? (
                      <div className="owner-info-bar text-sm" data-variant="dashed">
                        No budget rows are configured for this page.
                      </div>
                    ) : (
                      budgetLinesForPage.map((line) => {
                        const rowHasOverride = BUDGET_COLUMNS.some(
                          (column) => budgetOverrides[`${line.baseKey}${column.suffix}`] !== undefined,
                        );
                        return (
                          <div
                            key={line.baseKey}
                            className="owner-card owner-card--surface rounded-xl p-4 shadow-sm"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-semibold text-[color:var(--accent-strong)]">{line.label}</p>
                                <p className="text-xs text-[color:var(--text-secondary)]">Token prefix: {line.baseKey}</p>
                              </div>
                              <button
                                type="button"
                                className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline disabled:text-[#9CA3AF]"
                                onClick={() => resetBudgetRow(line.baseKey)}
                                disabled={!rowHasOverride}
                              >
                                Reset row
                              </button>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {BUDGET_COLUMNS.map((column) => {
                                const token = `${line.baseKey}${column.suffix}`;
                                const inputValue = getBudgetInputValue(token);
                                const hasOverride = budgetOverrides[token] !== undefined;
                                const detectedValue = budgetTokens[token];
                                const statusLabel = hasOverride
                                  ? "Manual"
                                  : detectedValue !== undefined
                                  ? "Detected"
                                  : "Blank";
                                const statusClass =
                                  hasOverride ? "text-[#1D4ED8]" : detectedValue !== undefined ? "text-[#047857]" : "text-[color:var(--text-secondary)]";
                                return (
                                  <label
                                    key={token}
                                    className="owner-input-tile flex flex-col gap-2 p-3"
                                  >
                                    <span className="text-xs font-semibold uppercase tracking-wide text-[#2563EB]">
                                      {column.label}
                                      <span className="ml-1 text-[11px] font-normal text-[color:var(--text-secondary)]">
                                        {column.description}
                                      </span>
                                    </span>
                                    <input
                                      className="rounded-md border border-[#CBD5F5] px-2 py-1 text-sm text-[color:var(--text-primary)] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                                      value={inputValue}
                                      onChange={(event) => updateBudgetOverride(token, event.target.value)}
                                      placeholder={detectedValue !== undefined ? String(detectedValue) : "Enter value"}
                                    />
                                    <div className="flex items-center justify-between text-[11px] text-[color:var(--text-secondary)]">
                                      <span>{`{{${token}}}`}</span>
                                      <span className={`font-semibold ${statusClass}`}>{statusLabel}</span>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div className="owner-info-bar mt-4 text-sm" data-variant="dashed">
                    <p>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{TOTAL_BUDGET_TOKENS}
                      </span>
                    </p>
                    <p>
                      Manual overrides ready: <span className="font-semibold text-[color:var(--accent-strong)]">{budgetOverrideCount}</span>
                    </p>
                  </div>
                  {budgetLoading && (
                    <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[color:var(--accent-strong)]">
                      Parsing budget workbook...
                    </div>
                  )}
                  {budgetError && (
                    <div className="mt-3 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                      {budgetError}
                    </div>
                  )}
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
                      type="button"
                      onClick={() => setStep(2)}
                    >
                      Back
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                      type="button"
                      onClick={() => setStep(4)}
                      disabled={budgetLoading}
                    >
                      Continue
                    </button>
                  </div>
                </section>
              )}
              {step === 4 && mergedFields && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 4 - Map Summary Fields</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Review the detected summary values and override anything that needs to be adjusted before validation.
                  </p>
                  <div className="mt-6 divide-y divide-[rgba(148,163,255,0.35)]">
                    {FIELD_ORDER.map((key) => {
                      const rawValue = fieldValue(key);
                      const isNumeric = NUMERIC_FIELDS.has(key);
                      const numericValue = Number(rawValue ?? 0);
                      const displayValue = isNumeric
                        ? REQUIRED_NUMERIC_FIELDS.has(key) && (!Number.isFinite(numericValue) || numericValue <= 0)
                          ? ""
                          : rawValue == null
                          ? ""
                          : String(rawValue)
                        : String(rawValue ?? "");
                      return (
                        <div key={key} className="grid gap-4 py-3 md:grid-cols-[200px_minmax(0,1fr)]">
                          <div className="text-sm font-medium uppercase tracking-wide text-[color:var(--accent-strong)]">
                            {FIELD_TITLES[key]}
                          </div>
                          <input
                            className="owner-field-input w-full px-3 py-2 text-sm"
                            type={isNumeric ? "number" : "text"}
                            inputMode={isNumeric ? "decimal" : undefined}
                            value={displayValue}
                            onChange={(event) => onOverride(key, event.target.value)}
                            placeholder={isNumeric ? "Enter a positive number" : "Enter a value"}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="owner-info-bar mt-4 text-sm" data-variant="dashed">
                    <p>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{TOTAL_BUDGET_TOKENS}
                      </span>
                    </p>
                    <p>
                      Manual overrides ready: <span className="font-semibold text-[color:var(--accent-strong)]">{budgetOverrideCount}</span>
                    </p>
                  </div>
                  {budgetLoading && (
                    <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[color:var(--accent-strong)]">
                      Parsing budget workbook...
                    </div>
                  )}
                  {budgetError && (
                    <div className="mt-3 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                      {budgetError}
                    </div>
                  )}
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
                      type="button"
                      onClick={() => setStep(3)}
                    >
                      Back
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                      type="button"
                      disabled={!isValid()}
                      onClick={() => setStep(5)}
                    >
                      Continue
                    </button>
                  </div>
                </section>
              )}
              {step === 5 && mergedFields && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 5 - Validate</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Quick check before generation. Required totals must be greater than zero.
                  </p>
                  <ul className="mt-5 space-y-2 text-sm text-[color:var(--text-primary)]">
                    {FIELD_ORDER.map((key) => {
                      const value = mergedFields[key];
                      const missing = missingFields.has(key);
                      return (
                        <li
                          key={key}
                          className="owner-validate-row"
                          data-state={missing ? 'error' : undefined}
                        >
                          <span className="font-medium">{FIELD_TITLES[key]}</span>
                          <span className="text-sm">
                            {NUMERIC_FIELDS.has(key)
                              ? formatNumericValue(key, typeof value === "number" ? value : Number(value ?? 0))
                              : String(value || "") || "(blank)"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
                      type="button"
                      onClick={() => setStep(4)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                      type="button"
                      onClick={generate}
                      disabled={busy}
                    >
                      Generate PPTX
                    </button>
                  </div>
                  {busy && <p className="mt-3 text-sm text-[color:var(--text-secondary)]">Generating presentation...</p>}
                </section>
              )}
              {step === 6 && (
                <section className="owner-card rounded-xl border border-[#DBEAFE] bg-[rgba(37,99,235,0.08)] px-6 py-8 text-[color:var(--accent-strong)] shadow-inner">
                  <h2 className="text-lg font-semibold">Step 6 - Generate</h2>
                  <p className="mt-2 text-sm">Hold tight while we merge your data into the PowerPoint template.</p>
                  <p className="mt-4 text-sm font-medium">This only takes a moment.</p>
                </section>
              )}

              {step === 7 && lastDownload && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 7 - Export complete</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Your PowerPoint has been downloaded. Review the values below or download the file again.
                  </p>
                  <div className="mt-5 overflow-hidden rounded-lg border border-[color:var(--border-soft)]/70">
                    <table className="min-w-full divide-y divide-[rgba(148,163,255,0.3)] text-sm">
                      <tbody className="divide-y divide-[rgba(148,163,255,0.25)] bg-[color:var(--surface)]">
                        {FIELD_ORDER.map((key) => (
                          <tr key={key}>
                            <td className="px-4 py-2 font-medium text-[color:var(--accent-strong)]">{FIELD_TITLES[key]}</td>
                            <td className="px-4 py-2 text-right text-[color:var(--text-primary)]">
                              {NUMERIC_FIELDS.has(key)
                                ? formatNumericValue(key, lastDownload.data[key] as number)
                                : String(lastDownload.data[key] || "") || "(blank)"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="owner-info-bar mt-4 text-sm" data-variant="dashed">
                    <p>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{TOTAL_BUDGET_TOKENS}
                      </span>
                    </p>
                    <p>
                      Manual overrides ready: <span className="font-semibold text-[color:var(--accent-strong)]">{budgetOverrideCount}</span>
                    </p>
                  </div>
                  {budgetLoading && (
                    <div className="mt-3 rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-sm text-[color:var(--accent-strong)]">
                      Parsing budget workbook...
                    </div>
                  )}
                  {budgetError && (
                    <div className="mt-3 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                      {budgetError}
                    </div>
                  )}
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8]"
                      type="button"
                      onClick={downloadAgain}
                    >
                      Download again
                    </button>
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]"
                      type="button"
                      onClick={startAnother}
                    >
                      Start another
                    </button>
                    <Link
                      href="/"
                      className="rounded-full border border-transparent bg-[rgba(255,255,255,0.9)] px-5 py-2 text-sm font-medium text-[color:var(--accent-strong)] shadow hover:border-[#CBD5F5] hover:bg-white"
                    >
                      Return home
                    </Link>
                  </div>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}





































