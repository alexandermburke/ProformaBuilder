// Presentation on hero page via Javascript - think Apple like presentation to update David & Mark on changes like UI, Logic, etc. 

"use client";

import {
  CircleCheck,
  Circle,
  Pencil,
  TerminalSquare,
  Copy,
  Download,
  WrapText,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import type { OwnerFields } from "@/types/ownerReport";
import { useTheme } from "@/components/ThemeProvider";
import { extractBudgetTableFields } from "@/lib/extractBudget";
import { toNumber } from "@/lib/compute";
import {
  computeInventoryPerformance,
  type InventoryPreviewRow,
  type InventoryTokenValues,
} from "@/lib/inventoryPerformance";

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

type SummaryFieldConfig = {
  key: FieldKey;
  span?: "full";
};

type SummarySection = {
  id: string;
  title: string;
  description?: string;
  columns?: 1 | 2 | 3;
  fields: SummaryFieldConfig[];
};

const SUMMARY_SECTIONS: SummarySection[] = [
  {
    id: "context",
    title: "Report Overview",
    description: "Basics that drive the cover slide and hero stats.",
    columns: 2,
    fields: [
      { key: "CURRENTDATE" },
      { key: "CURRENTMONTH" },
      { key: "OWNERGROUP" },
      { key: "ACQUIREDDATE" },
      { key: "ADDRESS", span: "full" },
    ],
  },
  {
    id: "financials",
    title: "Financial Highlights",
    description: "Totals merged into the NOI summary.",
    columns: 2,
    fields: [
      { key: "TOTALRENTALINCOME" },
      { key: "TOTALINCOME" },
      { key: "TOTALEXPENSES" },
      { key: "NETINCOME" },
    ],
  },
  {
    id: "property",
    title: "Property Snapshot",
    description: "Units, rentable area, and occupancy.",
    columns: 3,
    fields: [
      { key: "TOTALUNITS" },
      { key: "RENTABLESQFT" },
      { key: "OCCUPIEDAREASQFT" },
      { key: "OCCUPANCYBYUNITS" },
      { key: "OCCUPIEDAREAPERCENT" },
    ],
  },
  {
    id: "move-activity",
    title: "Move Activity",
    description: "Counts shown on the performance slide.",
    columns: 3,
    fields: [
      { key: "MOVEINS_TODAY" },
      { key: "MOVEINS_MTD" },
      { key: "MOVEINS_YTD" },
      { key: "MOVEOUTS_TODAY" },
      { key: "MOVEOUTS_MTD" },
      { key: "MOVEOUTS_YTD" },
      { key: "NET_TODAY" },
      { key: "NET_MTD" },
      { key: "NET_YTD" },
    ],
  },
  {
    id: "sqft-moves",
    title: "Square Foot Moves",
    description: "Optional supporting stats for appendix slides.",
    columns: 3,
    fields: [
      { key: "MOVEINS_SQFT_MTD" },
      { key: "MOVEOUTS_SQFT_MTD" },
      { key: "NET_SQFT_MTD" },
    ],
  },
];

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
const ALL_BUDGET_TOKENS = BUDGET_LINES.flatMap((line) =>
  BUDGET_COLUMNS.map((column) => `${line.baseKey}${column.suffix}`),
);

const LOG_DASH_CHARACTER = "\u2013";
const LOG_BLANK_LITERALS = new Set(["", "NaN", "undefined"]);
const LOG_MAPPING_ALIASES: Record<string, string> = {
  TOTALINCOME: "TOTALINCCM",
  TOTALEXPENSES: "TOTEXPCM",
  NETINCOME: "NETINCCM",
};

const BUDGET_LOG_PERCENT_SUFFIX = /(VARPER|YTDVARPER)$/i;
const budgetLogCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ownerLogNumber = new Intl.NumberFormat("en-US");

function coerceNegativeZeroString(input: string): string {
  if (/^-\$0(\.0+)?$/.test(input)) return input.replace("-$", "$");
  if (/^\$-0(\.0+)?$/.test(input)) return input.replace("$-0", "$0");
  if (/^-0(\.0+)?%$/.test(input)) return input.replace("-0", "0");
  if (/^-0(\.0+)?$/.test(input)) return input.replace("-0", "0");
  return input;
}

function normalizeLogValue(value: unknown): string {
  if (value == null) return LOG_DASH_CHARACTER;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return LOG_DASH_CHARACTER;
    const normalized = coerceNegativeZeroString(String(value));
    return normalized === "" ? LOG_DASH_CHARACTER : normalized;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || LOG_BLANK_LITERALS.has(trimmed)) return LOG_DASH_CHARACTER;
    return coerceNegativeZeroString(trimmed);
  }
  return LOG_DASH_CHARACTER;
}

function formatOwnerFieldForLog(key: FieldKey, raw: OwnerFields[FieldKey]): string {
  if (raw == null) return LOG_DASH_CHARACTER;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return LOG_DASH_CHARACTER;
    if (key === "OCCUPIEDAREAPERCENT") {
      const percent = Math.abs(raw) <= 1 ? raw * 100 : raw;
      return normalizeLogValue(`${percent.toFixed(1)}%`);
    }
    return normalizeLogValue(ownerLogNumber.format(raw));
  }
  return normalizeLogValue(String(raw));
}

function formatBudgetTokenForLog(token: string, value: number): string {
  if (!Number.isFinite(value)) return LOG_DASH_CHARACTER;
  if (BUDGET_LOG_PERCENT_SUFFIX.test(token)) {
    return normalizeLogValue(`${Number(value).toFixed(1)}%`);
  }
  return normalizeLogValue(budgetLogCurrency.format(value));
}

type InventoryPreviewTableProps = {
  rows: InventoryPreviewRow[];
  dense?: boolean;
};

function InventoryPreviewTable({ rows, dense = false }: InventoryPreviewTableProps) {
  if (!rows || rows.length === 0) return null;
  const tableClasses = dense ? "text-xs" : "text-sm";
  return (
    <div className={`overflow-hidden rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)] ${tableClasses}`}>
      <table className="min-w-full divide-y divide-[rgba(148,163,255,0.25)]">
        <tbody className="divide-y divide-[rgba(148,163,255,0.2)]">
          {rows.map((row) => (
            <tr key={row.token}>
              <td className="px-3 py-2 font-medium text-[color:var(--text-secondary)]">{row.label}</td>
              <td className="px-3 py-2 text-right font-semibold text-[color:var(--accent-strong)]">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [inventoryTokens, setInventoryTokens] = useState<InventoryTokenValues | null>(null);
  const [inventoryPreview, setInventoryPreview] = useState<InventoryPreviewRow[]>([]);
  const [inventoryStatus, setInventoryStatus] = useState<{ variant: "error" | "warning"; text: string } | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [budgetTokens, setBudgetTokens] = useState<Record<string, number>>({});
  const [detectedCount, setDetectedCount] = useState(0);
  const [templateTokenCount, setTemplateTokenCount] = useState<number | null>(null);
  const [budgetOverrides, setBudgetOverrides] = useState<Record<string, string>>({});
  const [panelScroll, setPanelScroll] = useState(true);
  const [budgetDebugLog, setBudgetDebugLog] = useState<string[]>([]);
  const reportLogRef = useRef<string>("");
  const [reportLog, setReportLog] = useState<string>("");
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<string>("");
  const [logWrap, setLogWrap] = useState(false);
  const viewLogButtonRef = useRef<HTMLButtonElement | null>(null);
  const logModalRef = useRef<HTMLDivElement | null>(null);
  const wasLogModalOpen = useRef(false);
  const inventoryRequestRef = useRef(0);

  const resetReportLog = useCallback(() => {
    reportLogRef.current = "";
    setReportLog("");
  }, [setReportLog]);

  const resetInventoryUpload = useCallback(() => {
    setInventoryTokens(null);
    setInventoryPreview([]);
    setInventoryStatus(null);
  }, []);

  const appendReportLog = useCallback(
    (input: string | string[]) => {
      const lines = Array.isArray(input) ? input : [input];
      if (lines.length === 0) return;
      const serialized = lines.map((line) =>
        line == null ? "" : String(line),
      );
      const chunk = serialized.join("\n");
      const next = reportLogRef.current
        ? `${reportLogRef.current}\n${chunk}`
        : chunk;
      reportLogRef.current = next;
      setReportLog(next);
    },
    [setReportLog],
  );

  const track = useCallback((event: string, props?: Record<string, unknown>) => {
    if (typeof window === "undefined") return;
    if (props && Object.keys(props).length > 0) {
      console.log("[analytics]", event, props);
    } else {
      console.log("[analytics]", event);
    }
  }, []);

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
  const logLines = useMemo(
    () => (reportLog ? reportLog.split(/\r?\n/) : []),
    [reportLog],
  );
  const filteredLogLines = useMemo(() => {
    const query = logFilter.trim().toLowerCase();
    if (!query) return logLines;
    return logLines.filter((line) => line.toLowerCase().includes(query));
  }, [logFilter, logLines]);
  const filteredLogText = useMemo(
    () => filteredLogLines.join("\n"),
    [filteredLogLines],
  );
  const hasAnyLog = logLines.length > 0;
  const hasFilteredLog = filteredLogLines.length > 0;
  const filterActive = logFilter.trim().length > 0;
  const logDisplayText = hasFilteredLog
    ? filteredLogText
    : filterActive && hasAnyLog
    ? "No lines match this filter."
    : hasAnyLog
    ? "Console log is empty."
    : "No console output recorded yet.";
  const isInformationalLog = !hasFilteredLog;
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
        setTemplateTokenCount(null);
        setBudgetError(null);
        setBudgetLoading(false);
        setBudgetPage(0);
        setBudgetDebugLog([]);
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
        const { tokens, details, count, debug, templateTokens } = await extractBudgetTableFields(
          budgetBuffer,
          financialBuffer,
        );
        setBudgetTokens(tokens);
        setDetectedCount(count);
        setBudgetOverrides({});
        setBudgetPage(0);
        setTemplateTokenCount(
          Array.isArray(templateTokens) && templateTokens.length > 0 ? templateTokens.length : null,
        );
        setBudgetDebugLog(debug);

        if (typeof window !== "undefined" && "console" in window) {
          const preview = Object.entries(tokens)
            .slice(0, 25)
            .map(([token, value]) => {
              const detail = details[token];
              return {
                token,
                value,
                source: detail ? `${detail.sheet}!${detail.cell}` : "unknown",
                note: detail?.note ?? "",
              };
            });
          if (preview.length > 0 && typeof console.table === "function") {
            console.table(preview);
          }
          console.log("[budget] detected", count, "tokens");
        }

        const denominator =
          Array.isArray(templateTokens) && templateTokens.length > 0
            ? templateTokens.length
            : TOTAL_BUDGET_TOKENS;
        console.info(`[budget] detected ${count}/${denominator} tokens`);
        for (const line of debug) {
          console.log(line);
        }
        const missingTokens = ALL_BUDGET_TOKENS.filter((token) => tokens[token] === undefined);
        if (typeof console.groupCollapsed === "function") {
          console.groupCollapsed("[budget] missing");
          if (missingTokens.length === 0) {
            console.log("None (all detected)");
          } else {
            for (const token of missingTokens) {
              console.log(token);
            }
          }
          console.groupEnd();
        } else {
          console.log("[budget] missing");
          if (missingTokens.length === 0) {
            console.log("None (all detected)");
          } else {
            for (const token of missingTokens) {
              console.log(token);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to parse the budget workbook.";
        setBudgetError(message);
        setBudgetTokens({});
        setDetectedCount(0);
        setBudgetOverrides({});
        setBudgetDebugLog([]);
        setTemplateTokenCount(null);
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

  const handleInventoryFileChange = useCallback(
    async (next: File | null) => {
      inventoryRequestRef.current += 1;
      const requestId = inventoryRequestRef.current;
      if (!next) {
        setInventoryFile(null);
        resetInventoryUpload();
        setInventoryLoading(false);
        return;
      }

      const name = next.name?.toLowerCase() ?? "";
      const mime = next.type?.toLowerCase() ?? "";
      const isCsv =
        name.endsWith(".csv") ||
        mime === "text/csv" ||
        mime === "application/vnd.ms-excel";
      if (!isCsv) {
        setInventoryFile(null);
        resetInventoryUpload();
        if (inventoryRequestRef.current === requestId) {
          setInventoryStatus({
            variant: "error",
            text: "File must be CSV.",
          });
          setInventoryLoading(false);
        }
        return;
      }

      resetInventoryUpload();
      setInventoryFile(next);
      setInventoryLoading(true);
      try {
        const text = await next.text();
        if (inventoryRequestRef.current !== requestId) return;
        const result = computeInventoryPerformance(text);
        if (result.ok) {
          setInventoryTokens(result.tokens);
          setInventoryPreview(result.preview);
          setInventoryStatus(null);
        } else {
          resetInventoryUpload();
          setInventoryStatus({
            variant: result.code === "insufficient_history" ? "warning" : "error",
            text: result.message,
          });
        }
      } catch (err) {
        if (inventoryRequestRef.current !== requestId) return;
        resetInventoryUpload();
        setInventoryStatus({
          variant: "error",
          text: err instanceof Error ? err.message : "Unable to parse CSV.",
        });
      } finally {
        if (inventoryRequestRef.current === requestId) {
          setInventoryLoading(false);
        }
      }
    },
    [resetInventoryUpload],
  );

  const updateBudgetOverride = useCallback((token: string, value: string) => {
    setBudgetOverrides((prev) => {
      const next = { ...prev };
      const trimmed = value.trim();
      if (!trimmed) {
        delete next[token];
        return next;
      }
      const sanitized = token.endsWith("VARPER") ? trimmed.replace(/%/g, "").trim() : trimmed;
      if (!sanitized) {
        delete next[token];
      } else {
        next[token] = sanitized;
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
  const mapperScrollClass = panelScroll ? 'max-h-[calc(100vh-260px)] overflow-y-auto overflow-x-clip pr-2 scroll-smooth' : '';

  useEffect(() => {
    const el = typeof window !== "undefined" ? document.getElementById("budget-mapper-scroll") : null;
    if (el && panelScroll) {
      el.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [displayedBudgetPage, panelScroll]);

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [],
  );

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

  function renderSummaryFieldInput(key: FieldKey, span?: "full") {
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
    const placeholder = isNumeric ? "Enter a positive number" : "Enter a value";
    const spanClass =
      span === "full"
        ? "md:col-span-2"
        : "";
    return (
      <label
        key={key}
        className={`flex flex-col gap-2 rounded-xl border border-[color:var(--border-soft)] bg-white/60 p-3 shadow-sm transition focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/30 ${spanClass}`}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
          {FIELD_TITLES[key]}
        </span>
        <input
          className="owner-field-input w-full rounded-lg border border-transparent bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[#2563EB] focus:outline-none"
          type={isNumeric ? "number" : "text"}
          inputMode={isNumeric ? "decimal" : undefined}
          value={displayValue}
          onChange={(event) => onOverride(key, event.target.value)}
          placeholder={placeholder}
        />
      </label>
    );
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
      if (inventoryFile) {
        form.append("inventory", inventoryFile);
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
      if (inventoryTokens) {
        form.append("inventoryTokens", JSON.stringify(inventoryTokens));
      }
      const res = await fetch("/api/owner-reports/generate", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Generation failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename = `Owner-Report-${mergedFields.CURRENTDATE || "report"}.pptx`;

      const numericOverrides: Record<string, number> = {};
      for (const [token, raw] of Object.entries(budgetOverrides)) {
        const numeric = toNumber(raw);
        if (Number.isFinite(numeric)) numericOverrides[token] = numeric;
      }
      const ownerLogValues: Record<string, string> = {};
      for (const key of FIELD_ORDER) {
        ownerLogValues[key] = formatOwnerFieldForLog(
          key,
          mergedFields[key],
        );
      }
      const performanceLogValues: Record<string, string> = {};
      if (inventoryTokens) {
        for (const [token, rawValue] of Object.entries(inventoryTokens)) {
          if (typeof rawValue === "number") {
            performanceLogValues[token] = normalizeLogValue(ownerLogNumber.format(rawValue));
          } else {
            performanceLogValues[token] = normalizeLogValue(String(rawValue ?? ""));
          }
        }
      }
      const budgetLogValues: Record<string, string> = {};
      for (const [token, value] of Object.entries(budgetTokens)) {
        budgetLogValues[token] = formatBudgetTokenForLog(token, value);
      }
      for (const [token, value] of Object.entries(numericOverrides)) {
        budgetLogValues[token] = formatBudgetTokenForLog(token, value);
      }
      const combinedLogData: Record<string, string> = {
        ...ownerLogValues,
        ...performanceLogValues,
        ...budgetLogValues,
      };
      for (const [alias, source] of Object.entries(LOG_MAPPING_ALIASES)) {
        if (combinedLogData[alias] !== undefined) continue;
        if (combinedLogData[source] !== undefined) {
          combinedLogData[alias] = combinedLogData[source];
        }
      }
      const logKeys = Object.keys(combinedLogData).sort((a, b) => a.localeCompare(b));
      const consoleLines: string[] = [];
      consoleLines.push(`[export] completed ${new Date().toISOString()}`);
      consoleLines.push(`[pptx] rendering ${logKeys.length} unique keys`);
      for (const key of logKeys) {
        consoleLines.push(`[pptx] key ${key} -> ${combinedLogData[key]}`);
      }
      const placeholderEstimate = templateTokenCount ?? TOTAL_BUDGET_TOKENS;
      consoleLines.push(
        `[pptx] template contains ${placeholderEstimate} placeholders (unique estimate)`,
      );
      const detectedSummary = `[budget] detected ${detectedCount}/${templateTokenCount ?? TOTAL_BUDGET_TOKENS} tokens`;
      consoleLines.push(detectedSummary);
      const missingForLog = ALL_BUDGET_TOKENS.filter(
        (token) => budgetTokens[token] === undefined && numericOverrides[token] === undefined,
      );
      if (missingForLog.length > 0) {
        consoleLines.push(
          `[budget] WARNING: missing tokens not applied: ${
            missingForLog.length > 50 ? `${missingForLog.length} tokens` : missingForLog.join(", ")
          }`,
        );
      }
      if (budgetDebugLog.length > 0) {
        consoleLines.push("");
        consoleLines.push(...budgetDebugLog);
      }
      resetReportLog();
      appendReportLog(consoleLines);

      setLastDownload((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, name: filename, data: mergedFields };
      });
      downloadFromUrl(url, filename);
      setStep(7);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to generate the presentation.";
      setError(message);
      resetReportLog();
      const errorLines: string[] = [`[export] failed ${new Date().toISOString()}`];
      if (budgetDebugLog.length > 0) {
        errorLines.push(...budgetDebugLog, "");
      }
      errorLines.push(`[error] ${message}`);
      appendReportLog(errorLines);
      setStep(5);
    } finally {
      setBusy(false);
    }
  }

  const closeLogModal = useCallback(() => {
    setLogModalOpen(false);
  }, []);

  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setLogFilter(next);
      track("console_log_filtered", { queryLength: next.trim().length });
    },
    [track],
  );

  const handleCopyLog = useCallback(async () => {
    const text = filteredLogText || "";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      track("console_log_copied", { filtered: logFilter.trim().length > 0 });
    } catch (err) {
      console.warn("[console-log] unable to copy", err);
    }
  }, [filteredLogText, logFilter, track]);

  const handleDownloadLog = useCallback(() => {
    const text = filteredLogText || "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "owner-report-console-log.txt";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    track("console_log_downloaded", { bytes: blob.size });
  }, [filteredLogText, track]);

  const toggleWrap = useCallback(() => {
    setLogWrap((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!logModalOpen) return;
    wasLogModalOpen.current = true;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLogModal();
        return;
      }
      if (event.key !== "Tab") return;
      const modalNode = logModalRef.current;
      if (!modalNode) return;
      const focusable = Array.from(
        modalNode.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute("disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
    const frame = requestAnimationFrame(() => {
      const autoFocusTarget =
        logModalRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        logModalRef.current?.querySelector<HTMLElement>(
          'input, button, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
      autoFocusTarget?.focus();
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(frame);
    };
  }, [closeLogModal, logModalOpen]);

  useEffect(() => {
    if (!logModalOpen && wasLogModalOpen.current) {
      wasLogModalOpen.current = false;
      requestAnimationFrame(() => {
        viewLogButtonRef.current?.focus({ preventScroll: true });
      });
    }
  }, [logModalOpen]);

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
    setBudgetDebugLog([]);
    resetReportLog();
    setLogFilter("");
    setLogWrap(false);
    setLogModalOpen(false);
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
                  <p className="mt-3 text-[11px] text-[color:var(--text-muted)]">
                    Preview is available on Step 4 in the Summary mapper.
                  </p>
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
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Preview is available on Step 3 in the Budget mapper.
                      </p>
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
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Preview is available on Step 3 in the Budget mapper.
                      </p>
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Inventory Over Time (.csv)</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Optional. Used to auto-fill Performance tokens (Move-ins/outs, Net, trailing 3/6/12). CSV requires columns: dtDate, occ, n.
                          </p>
                        </div>
                        {inventoryFile && (
                          <button
                            type="button"
                            className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              void handleInventoryFileChange(null);
                            }}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".csv,text/csv,application/vnd.ms-excel"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          void handleInventoryFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {inventoryFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{inventoryFile.name}</span>
                        </p>
                      )}
                      {inventoryLoading && (
                        <p className="text-xs text-[color:var(--text-secondary)]">Parsing CSV...</p>
                      )}
                      {inventoryStatus && (
                        <div
                          className={`rounded-md border px-3 py-2 text-xs ${
                            inventoryStatus.variant === "error"
                              ? "border-[#FEE2E2] bg-[#FEF2F2] text-[#B91C1C]"
                              : "border-[#FEF3C7] bg-[#FFFBEB] text-[#92400E]"
                          }`}
                        >
                          {inventoryStatus.text}
                        </div>
                      )}
                      {!inventoryLoading && inventoryPreview.length > 0 && !inventoryStatus && (
                        <p className="text-[11px] text-[color:var(--text-muted)]">
                          Preview is available on Step 4 in the Performance tokens panel.
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
                        {detectedCount}/{templateTokenCount ?? TOTAL_BUDGET_TOKENS}
                      </span>
                    </span>
                    <span className="hidden opacity-50 text-[color:var(--text-muted)] sm:inline">|</span>
                    <span>
                      Manual overrides:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">{budgetOverrideCount}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPanelScroll((prev) => !prev)}
                      className="ml-auto rounded-md border border-[rgba(148,163,255,0.32)] px-2 py-1 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      {panelScroll ? "Disable panel scroll" : "Enable panel scroll"}
                    </button>
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
                    <div className="mt-4 owner-info-bar text-sm" data-variant="dashed">
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
                          className="rounded-full border border-[#CBD5F5] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:text-[#9CA3AF] hover:bg-blue-50"
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
                          className="rounded-full border border-[#CBD5F5] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:text-[#9CA3AF] hover:bg-blue-50"
                          onClick={() => setBudgetPage((prev) => Math.min(totalBudgetPages - 1, prev + 1))}
                          disabled={displayedBudgetPage >= totalBudgetPages - 1 || budgetLoading}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    <div
                      id="budget-mapper-scroll"
                      className={`space-y-6 ${mapperScrollClass}`}
                    >
                      {budgetLinesForPage.length === 0 ? (
                        <div className="owner-info-bar text-sm" data-variant="dashed">
                          No budget rows are configured for this page.
                        </div>
                      ) : (
                        budgetLinesForPage.map((line) => {
                          const rowHasOverride = BUDGET_COLUMNS.some(
                            (column) => budgetOverrides[`${line.baseKey}${column.suffix}`] !== undefined
                          );

                          return (
                            <div
                              key={line.baseKey}
                              className="owner-card owner-card--surface rounded-xl p-4 shadow-sm"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                                    {line.label}
                                  </p>
                                  <p className="text-xs text-[color:var(--text-secondary)]">
                                    Token prefix: {line.baseKey}
                                  </p>
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
                                  const baselineRaw = getBudgetInputValue(token);
                                  const hasOverride = budgetOverrides[token] !== undefined;
                                  const detectedValue = budgetTokens[token];

                                  const isPercentToken = token.endsWith("VARPER");
                                  const overrideRaw = budgetOverrides[token];

                                  const overrideNumeric =
                                    overrideRaw !== undefined ? toNumber(overrideRaw) : undefined;
                                  const overrideNumber =
                                    overrideNumeric !== undefined && Number.isFinite(overrideNumeric)
                                      ? overrideNumeric
                                      : undefined;
                                  const detectedNumeric =
                                    typeof detectedValue === "number" ? detectedValue : undefined;
                                  const baselineNumeric =
                                    baselineRaw && baselineRaw.trim().length > 0
                                      ? toNumber(baselineRaw)
                                      : undefined;
                                  const baselineNumber =
                                    baselineNumeric !== undefined && Number.isFinite(baselineNumeric)
                                      ? baselineNumeric
                                      : undefined;

                                  const effectiveNumeric =
                                    overrideNumber !== undefined ? overrideNumber : detectedNumeric;

                                  const formattedDetected =
                                    isPercentToken && detectedNumeric !== undefined
                                      ? `${percentFormatter.format(detectedNumeric)}%`
                                      : detectedNumeric !== undefined
                                        ? String(detectedNumeric)
                                        : "";

                                  const formattedBaseline =
                                    isPercentToken && baselineNumber !== undefined
                                      ? `${percentFormatter.format(baselineNumber)}%`
                                      : baselineRaw;

                                  const overrideDisplay =
                                    overrideRaw !== undefined
                                      ? isPercentToken
                                        ? overrideNumber !== undefined
                                          ? `${percentFormatter.format(overrideNumber)}%`
                                          : `${overrideRaw}%`
                                        : overrideRaw
                                      : undefined;

                                  const displayValue =
                                    overrideDisplay ??
                                    (formattedDetected || formattedBaseline || "");

                                  const placeholderValue =
                                    formattedDetected ||
                                    formattedBaseline ||
                                    (isPercentToken ? "0.0%" : "Enter value");

                                  const percentToneClass =
                                    isPercentToken &&
                                      effectiveNumeric !== undefined &&
                                      Number.isFinite(effectiveNumeric)
                                      ? effectiveNumeric > 0
                                        ? "text-[#16a34a]"
                                        : effectiveNumeric < 0
                                          ? "text-[#dc2626]"
                                          : ""
                                      : "";

                                  const { statusIcon, statusColorClass, statusTitle } = (() => {
                                    if (hasOverride) {
                                      return {
                                        statusIcon: <Pencil size={14} />,
                                        statusColorClass: "text-[#1d4ed8]",
                                        statusTitle: "Manual override",
                                      };
                                    }
                                    if (detectedValue !== undefined) {
                                      return {
                                        statusIcon: <CircleCheck size={14} />,
                                        statusColorClass: "text-emerald-500",
                                        statusTitle: "Detected",
                                      };
                                    }
                                    return {
                                      statusIcon: <Circle size={14} />,
                                      statusColorClass: "text-[#dc2626]",
                                      statusTitle: "Blank",
                                    };
                                  })();



                                  return (
                                    <label
                                      key={token}
                                      className="owner-input-tile flex flex-col gap-2 p-3"
                                    >
                                      <span className="flex flex-col gap-1">
                                        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#2563EB]">
                                          {column.label}
                                          <span
                                            className={`inline-flex items-center justify-center text-sm ${statusColorClass}`}
                                            aria-label={statusTitle}
                                            title={statusTitle}
                                          >
                                            {statusIcon}
                                          </span>
                                        </span>
                                        <span className="text-[11px] font-normal text-[color:var(--text-secondary)]">
                                          {column.description}
                                        </span>
                                      </span>

                                      <input
                                        className={`rounded-md border border-[#CBD5F5] px-2 py-1 text-sm text-[color:var(--text-primary)] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 ${percentToneClass}`}
                                        value={displayValue}
                                        onChange={(event) => updateBudgetOverride(token, event.target.value)}
                                        placeholder={placeholderValue}
                                      />

                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="owner-info-bar mt-4 text-sm" data-variant="dashed">
                    <p>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{templateTokenCount ?? TOTAL_BUDGET_TOKENS}
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
                  <div className="mt-6 space-y-6">
                    {SUMMARY_SECTIONS.map((section) => {
                      const gridClass =
                        section.columns === 3
                          ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
                          : section.columns === 1
                            ? "grid gap-4"
                            : "grid gap-4 md:grid-cols-2";
                      return (
                        <div
                          key={section.id}
                          className="rounded-2xl border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]/80 p-5 shadow-sm"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-[color:var(--accent-strong)]">{section.title}</p>
                              {section.description && (
                                <p className="text-xs text-[color:var(--text-secondary)]">{section.description}</p>
                              )}
                            </div>
                          </div>
                          <div className={`mt-4 ${gridClass}`}>
                            {section.fields.map((field) => renderSummaryFieldInput(field.key, field.span))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {inventoryPreview.length > 0 && (
                    <div className="mt-6 rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Performance tokens</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Auto-filled from the Inventory Over Time CSV upload
                          </p>
                        </div>
                        {inventoryFile && (
                          <p className="truncate text-[11px] text-[color:var(--text-muted)]">
                            Source: {inventoryFile.name}
                          </p>
                        )}
                      </div>
                      <div className="px-4 pb-4">
                        <InventoryPreviewTable rows={inventoryPreview} />
                      </div>
                    </div>
                  )}
                  <div className="owner-info-bar mt-4 text-sm" data-variant="dashed">
                    <p>
                      Detected tokens:{" "}
                      <span className="font-semibold text-[color:var(--accent-strong)]">
                        {detectedCount}/{templateTokenCount ?? TOTAL_BUDGET_TOKENS}
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
                  <div className="mt-4 flex justify-end">
                    <button
                      ref={viewLogButtonRef}
                      type="button"
                      onClick={() => {
                        setLogModalOpen(true);
                        track("console_log_opened", { screen: "export_step7" });
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-[#CBD5F5] bg-white px-4 py-2 text-sm font-medium text-[color:var(--accent-strong)] shadow-sm transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                      title="Inspect the console output captured during the last export"
                    >
                      <TerminalSquare className="h-4 w-4" aria-hidden />
                      View Console Log
                    </button>
                  </div>
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
                        {detectedCount}/{templateTokenCount ?? TOTAL_BUDGET_TOKENS}
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
      {logModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
          role="presentation"
          onClick={closeLogModal}
        >
          <div
            ref={logModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="console-log-title"
            aria-describedby="console-log-description"
            className="relative max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 id="console-log-title" className="text-lg font-semibold text-slate-900">
                Console Log
              </h2>
              <button
                type="button"
                onClick={closeLogModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                title="Close console log"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  type="text"
                  className="h-10 w-full rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 shadow-sm transition focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 sm:max-w-sm"
                  placeholder="Filter lines (e.g., pptx, key, error, warning)"
                  value={logFilter}
                  onChange={handleFilterChange}
                  data-autofocus
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleWrap}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40 ${
                      logWrap
                        ? "border-[#2563EB] bg-[#2563EB]/10 text-[#1E3A8A]"
                        : "border-slate-200 bg-white text-slate-600 hover:border-[#CBD5F5] hover:bg-[rgba(37,99,235,0.08)]"
                    }`}
                    aria-pressed={logWrap}
                    title="Toggle soft wrapping for log lines"
                  >
                    <WrapText className="h-4 w-4" aria-hidden />
                    Wrap lines
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLog}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-[#CBD5F5] hover:bg-[rgba(37,99,235,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                    title="Copy filtered log text to clipboard"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadLog}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:border-[#CBD5F5] hover:bg-[rgba(37,99,235,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
                    title="Download filtered log as .txt"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Download .txt
                  </button>
                </div>
              </div>
              <div
                id="console-log-description"
                className="relative max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-slate-950/95 p-4 text-sm shadow-inner"
              >
                <pre
                  className={`font-mono text-xs leading-relaxed text-slate-100 ${
                    logWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                  } ${isInformationalLog ? "text-slate-400" : ""}`}
                >
                  {logDisplayText}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
