/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */


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
  Info,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import type { OwnerFields } from "@/types/ownerReport";
import { useTheme } from "@/components/ThemeProvider";
import { usePreferences } from "@/components/PreferencesProvider";
import { extractBudgetTableFields } from "@/lib/extractBudget";
import { toNumber } from "@/lib/compute";
import {
  computeOwnerPerformance,
  type OwnerPerformancePreviewRow,
  type OwnerPerformanceTokenValues,
} from "@/lib/ownerPerformance";
import type { PropertyConfig } from "@/types/dailySummary";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
const TOTAL_STEPS = 7;

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

const STEP_SEQUENCE = (Object.keys(STEP_LABELS)
  .map((key) => Number(key) as Step)
  .sort((a, b) => a - b)) as Step[];

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
  { label: "Tenant Fee Income", baseKey: "ADMFEE", page: 0 },
  { label: "Tenant Income - Late Fees", baseKey: "LATEFEE", page: 0 },
  { label: "Tenant Protection Fee", baseKey: "INSUR", page: 0 },
  { label: "Tenant Income - Other", baseKey: "OTHER", page: 0 },
  { label: "Retail Sales", baseKey: "RETSAL", page: 0 },
  { label: "TOTAL INCOME", baseKey: "TOTALINC", page: 0 },
  { label: "Advertising & Marketing", baseKey: "ADVER", page: 1 },
  { label: "Auction Expenses", baseKey: "AUCT", page: 1 },
  { label: "CAM Charges", baseKey: "CAM", page: 1 },
  { label: "Credit Card Merchant Fees", baseKey: "CCM", page: 1 },
  { label: "Dues & Subscriptions", baseKey: "DUES", page: 1 },
  { label: "Fire Prevention", baseKey: "FIRE", page: 1 },
  { label: "Insurance", baseKey: "INSURXP", page: 1 },
  { label: "Licenses & Permits", baseKey: "PERM", page: 1 },
  { label: "Management Fees", baseKey: "MGMT", page: 1 },
  { label: "Payroll Costs", baseKey: "MGMSTF", page: 1 },
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
  { label: "Secure Payment Fee", baseKey: "SECPP", page: 1 },
];

const BUDGET_PAGES = [
  { page: 0, title: "{{CURRENTMONTH}} Data" },
  { page: 1, title: "{{CURRENTMONTH}} Data (continued)" },
];

const UPLOAD_FIELD_HINTS = {
  executiveSummary: [
    "Current date/month and property address",
    "Owner group and acquired date",
    "Total units and rentable square feet",
    "Rental income, total income, total expenses, net income",
    "Occupied area square feet, occupancy by units, occupancy percent",
    "Move-ins/move-outs today, MTD, YTD plus net",
    "Move-ins/move-outs square feet MTD and net square feet MTD",
    "Insurance penetration and overall penetration",
  ],
  budgetComparison: [
    "Rental Income, Discounts, Total Rental Income, Admin/Late/Insurance/Other tenant income",
    "Retail Sales and Total Income lines",
    "Expense lines: Advertising, Auction, CAM, Credit Card Fees, Dues, Fire, Insurance, Licenses/Permits, Management Fees (+ staff), Office Supplies, Professional Fees, Repairs & Maintenance, Retail Products, Security, Software, Building Supplies, Telephone & Internet, Utilities",
    "Totals for Property/Other/All Expenses, Interest Income, and Net Income (actual, budget, variance, % variance, YTD)",
  ],
  moveActivity: [
    "Move-ins and move-outs counts with net for the current month",
    "Trailing 3/6/12 month move activity",
    "Move-in/out square footage and rent per square foot metrics",
    "Promo counts/percent and length-of-stay averages",
  ],
  iprcChangeHistory: [
    "Letters repriced / units touched",
    "Total square feet repriced",
    "Base revenue vs new revenue and total increase",
    "Average percent increase for repriced units",
  ],
  availableSpaces: [
    "Web rates for 5x5, 10x5, 10x10, 10x15, 10x20, 15x5, 20x15 (ground/elevator when available)",
  ],
  ppcPerformance: [
    "Impressions and clicks",
    "Conversions",
    "Cost per conversion (averaged from uploaded sheets)",
  ],
  managementSummary: [
    "MTD/Daily rentals, vacates, net rentals",
    "Lead conversion, projected rent, rent per SF",
    "Occupied RSF/units and economic occupancy %",
  ],
} as const;

const TOTAL_BUDGET_TOKENS = BUDGET_LINES.length * BUDGET_COLUMNS.length;
const ALL_BUDGET_TOKENS = BUDGET_LINES.flatMap((line) =>
  BUDGET_COLUMNS.map((column) => `${line.baseKey}${column.suffix}`),
);

const LOG_DASH_CHARACTER = "-";
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
      return normalizeLogValue(`${percent.toFixed(2)}%`);
    }
    return normalizeLogValue(ownerLogNumber.format(raw));
  }
  return normalizeLogValue(String(raw));
}

function formatBudgetTokenForLog(token: string, value: number): string {
  if (!Number.isFinite(value)) return LOG_DASH_CHARACTER;
  if (BUDGET_LOG_PERCENT_SUFFIX.test(token)) {
    return normalizeLogValue(`${Number(value).toFixed(2)}%`);
  }
  return normalizeLogValue(budgetLogCurrency.format(value));
}

type InventoryPreviewTableProps = {
  rows: OwnerPerformancePreviewRow[];
  dense?: boolean;
};

function InventoryPreviewTable({ rows, dense = false }: InventoryPreviewTableProps) {
  if (!rows || rows.length === 0) return null;
  const tableClasses = dense ? "text-xs" : "text-sm";
  const sections = rows.reduce<Map<OwnerPerformancePreviewRow["section"], OwnerPerformancePreviewRow[]>>(
    (map, row) => {
      const existing = map.get(row.section) ?? [];
      existing.push(row);
      map.set(row.section, existing);
      return map;
    },
    new Map(),
  );

  return (
    <div className={`space-y-4 ${tableClasses}`}>
      {Array.from(sections.entries()).map(([section, sectionRows]) => (
        <div
          key={section}
          className="overflow-hidden rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]"
        >
          <div className="border-b border-[color:var(--border-soft)]/60 bg-[color:var(--surface)]/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)]">
            {section}
          </div>
          <table className="min-w-full divide-y divide-[rgba(148,163,255,0.25)]">
            <tbody className="divide-y divide-[rgba(148,163,255,0.2)]">
              {sectionRows.map((row) => (
                <tr key={`${section}-${row.token}`}>
                  <td className="px-3 py-2 font-medium text-[color:var(--text-secondary)]">{row.label}</td>
                  <td className="px-3 py-2 text-right font-semibold text-[color:var(--accent-strong)]">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

type UploadFieldHintProps = {
  title: string;
  fields: readonly string[];
};

function UploadFieldHint({ title, fields }: UploadFieldHintProps) {
  return (
    <div className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--border-soft)] bg-white text-[color:var(--accent-strong)] shadow-sm transition hover:border-[color:var(--accent-strong)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent-strong)]/30 focus:ring-offset-1"
        aria-label={`Show fields filled by ${title}`}
      >
        <Info size={14} aria-hidden />
      </button>
      <div className="absolute left-1/2 top-full z-30 mt-2 hidden w-72 -translate-x-1/2 rounded-lg border border-[color:var(--border-soft)] bg-white p-3 text-[11px] text-[color:var(--text-secondary)] shadow-xl transition duration-150 group-hover:block group-focus-within:block">
        <p className="text-[11px] font-semibold text-[color:var(--text-primary)]">{title}</p>
        <ul className="mt-1 space-y-1">
          {fields.map((field) => (
            <li key={field} className="flex items-start gap-2 leading-snug">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[color:var(--accent-strong)]" aria-hidden />
              <span>{field}</span>
            </li>
          ))}
        </ul>
      </div>
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
  const { delinquencyAudit } = usePreferences();
  const isDark = theme === "dark";
  const [, startTransition] = useTransition();
  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.26),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_62%)]"
    : "bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_62%)]";
  const [step, setStep] = useState<Step>(1);
  const currentStepIndex = Math.max(0, STEP_SEQUENCE.indexOf(step));
  const progressPercent =
    STEP_SEQUENCE.length > 1 ? (currentStepIndex / (STEP_SEQUENCE.length - 1)) * 100 : 100;
  const progressSteps = STEP_SEQUENCE.map((keyStep) => ({
    keyStep,
    label: STEP_LABELS[keyStep],
    state: keyStep === step ? "active" : keyStep < step ? "complete" : "upcoming",
  }));
  const activeStepLabel = STEP_LABELS[step];
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
  const [msrFile, setMsrFile] = useState<File | null>(null);
  const [msrTokens, setMsrTokens] = useState<Record<string, string | number>>({});
  const [msrStatus, setMsrStatus] = useState<{ variant: "success" | "error"; text: string } | null>(null);
  const [msrLoading, setMsrLoading] = useState(false);
  const [budgetFile, setBudgetFile] = useState<File | null>(null);
  // L001 (Hibernia Camelback) exports a variant "Budget vs. Actuals" layout; this
  // toggle routes parsing to the separate L001 parser, leaving the standard one untouched.
  const [l001Format, setL001Format] = useState(false);
  const [hummingbirdFile, setHummingbirdFile] = useState<File | null>(null);
  const [iprcFile, setIprcFile] = useState<File | null>(null);
  const [availableSpacesFile, setAvailableSpacesFile] = useState<File | null>(null);
  const [ppcFile, setPpcFile] = useState<File | null>(null);
  const [repairsFile, setRepairsFile] = useState<File | null>(null);
  const [currentMonthOverride] = useState("");
  const [includeCurrentMonth] = useState(true);
  const [performanceTokens, setPerformanceTokens] = useState<OwnerPerformanceTokenValues | null>(null);
  const [performancePreview, setPerformancePreview] = useState<OwnerPerformancePreviewRow[]>([]);
  const [performanceStatus, setPerformanceStatus] = useState<{ variant: "error" | "warning"; text: string } | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [budgetTokens, setBudgetTokens] = useState<Record<string, number>>({});
  const [detectedCount, setDetectedCount] = useState(0);
  const [templateTokenCount, setTemplateTokenCount] = useState<number | null>(null);
  const [budgetOverrides, setBudgetOverrides] = useState<Record<string, string>>({});
  const [panelScroll, setPanelScroll] = useState(true);
  const [budgetDebugLog, setBudgetDebugLog] = useState<string[]>([]);
  const reportLogRef = useRef<string>("");
  const fieldsRef = useRef<OwnerFields | null>(null);
  const [reportLog, setReportLog] = useState<string>("");
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logFilter, setLogFilter] = useState<string>("");
  const [logWrap, setLogWrap] = useState(false);
  const viewLogButtonRef = useRef<HTMLButtonElement | null>(null);
  const logModalRef = useRef<HTMLDivElement | null>(null);
  const wasLogModalOpen = useRef(false);
  const [properties, setProperties] = useState<PropertyConfig[]>([]);
  const [propertyLoadError, setPropertyLoadError] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [sendOwnerEmail, setSendOwnerEmail] = useState(false);
  const performanceRequestRef = useRef(0);

  const resetReportLog = useCallback(() => {
    reportLogRef.current = "";
    setReportLog("");
  }, [setReportLog]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/daily-summary/properties");
        if (!res.ok) throw new Error("Unable to fetch properties");
        const data = (await res.json()) as PropertyConfig[];
        if (cancelled) return;
        setProperties(data);
        setSelectedPropertyId((prev) => {
          if (prev) return prev;
          const preferred = data.find((p) => p.enabled) ?? data[0];
          return preferred ? preferred.id : prev;
        });
      } catch (err) {
        if (cancelled) return;
        console.warn("[owner-reports] unable to load properties for email delivery", err);
        setPropertyLoadError("Unable to load properties for auto-email");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const resetPerformanceUpload = useCallback(() => {
    startTransition(() => {
      setPerformanceTokens(null);
      setPerformancePreview([]);
      setPerformanceStatus(null);
    });
  }, [startTransition]);

  const runPerformanceExtract = useCallback(
    async (hb: File | null, iprc: File | null) => {
      performanceRequestRef.current += 1;
      const requestId = performanceRequestRef.current;
      if (!hb) {
        if (requestId === performanceRequestRef.current) {
          resetPerformanceUpload();
          setPerformanceLoading(false);
          startTransition(() => {
            if (!hb && !iprc) {
              setPerformanceStatus(null);
            } else {
              setPerformanceStatus({
                variant: "warning",
                text: "Upload the Hummingbird workbook (.xlsx) to populate performance tokens.",
              });
            }
          });
        }
        return;
      }

      setPerformanceLoading(true);
      setPerformanceStatus(null);
      try {
        const [hbBuffer, iprcText] = await Promise.all([
          hb.arrayBuffer(),
          iprc ? iprc.text() : Promise.resolve(""),
        ]);
        if (performanceRequestRef.current !== requestId) return;
        const result = computeOwnerPerformance({
          hummingbirdWorkbook: hbBuffer,
          iprcCsvText: iprcText,
          options: {
            currentMonthOverride: currentMonthOverride.trim() || undefined,
            includeCurrentMonthInTrailing: includeCurrentMonth,
          },
        });
        if (result.ok) {
          startTransition(() => {
            setPerformanceTokens(result.tokens);
            setPerformancePreview(result.preview);
            setPerformanceStatus(
              iprc
                ? null
                : {
                    variant: "warning",
                    text: "IPRC CSV not uploaded. Move activity is populated from the workbook, but rate management fields will remain blank.",
                  },
            );
          });
        } else {
          resetPerformanceUpload();
          startTransition(() => {
            setPerformanceStatus({
              variant: result.code === "no_rows" ? "warning" : "error",
              text: result.message,
            });
          });
        }
      } catch (err) {
        if (performanceRequestRef.current !== requestId) return;
        resetPerformanceUpload();
        startTransition(() => {
          setPerformanceStatus({
            variant: "error",
            text:
              err instanceof Error
                ? err.message
                : "Unable to parse performance inputs. Confirm both files are valid.",
          });
        });
      } finally {
        if (performanceRequestRef.current === requestId) {
          setPerformanceLoading(false);
        }
      }
    },
    [currentMonthOverride, includeCurrentMonth, resetPerformanceUpload, startTransition],
  );

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
      startTransition(() => setReportLog(next));
    },
    [setReportLog, startTransition],
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
  const lastProcessedFiles = useRef<{ budget: File | null; format: string }>({ budget: null, format: "standard" });
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
      return `${percent.toFixed(2)}%`;
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
  const runMsrExtract = useCallback(async (nextMsr: File | null) => {
    if (!nextMsr) {
      startTransition(() => {
        setMsrFile(null);
        setMsrTokens({});
        setMsrStatus(null);
      });
      setMsrLoading(false);
      return;
    }
    startTransition(() => {
      setMsrFile(nextMsr);
      setMsrStatus(null);
    });
    setMsrLoading(true);
    try {
      const form = new FormData();
      form.append("file", nextMsr);
      const res = await fetch("/api/owner-reports/msr-preview", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Upload failed.");
      }
      const json = (await res.json()) as { tokens?: Record<string, string | number> };
      const tokens = json.tokens ?? {};
      const detected = Object.keys(tokens).length;
      startTransition(() => {
        setMsrTokens(tokens);
        setMsrStatus({
          variant: "success",
          text: detected > 0 ? `Detected ${detected} MSR tokens.` : "MSR uploaded; no tokens detected.",
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to parse the MSR workbook.";
      startTransition(() => {
        setMsrTokens({});
        setMsrStatus({ variant: "error", text: message });
      });
    } finally {
      setMsrLoading(false);
    }
  }, []);
  const runBudgetExtract = useCallback(
    async (nextBudget: File | null) => {
      if (!nextBudget) {
        lastProcessedFiles.current = {
          budget: null,
          format: l001Format ? "l001" : "standard",
        };
        startTransition(() => {
          setBudgetTokens({});
          setDetectedCount(0);
          setBudgetOverrides({});
          setTemplateTokenCount(null);
          setBudgetError(null);
          setBudgetPage(0);
          setBudgetDebugLog([]);
        });
        setBudgetLoading(false);
        return;
      }
      lastProcessedFiles.current = {
        budget: nextBudget,
        format: l001Format ? "l001" : "standard",
      };
      setBudgetLoading(true);
      setBudgetError(null);
      try {
        const budgetBuffer = await nextBudget.arrayBuffer();
        const { tokens, details, count, debug, templateTokens, ownerGroup } = await extractBudgetTableFields(
          budgetBuffer,
          undefined,
          l001Format ? "l001" : "standard",
        );
        startTransition(() => {
          setBudgetTokens(tokens);
          setDetectedCount(count);
          setBudgetOverrides({});
          setBudgetPage(0);
          setTemplateTokenCount(
            Array.isArray(templateTokens) && templateTokens.length > 0 ? templateTokens.length : null,
          );
          setBudgetDebugLog(debug);
          if (ownerGroup && ownerGroup.trim().length > 0) {
            setOverrides((prev) => {
              const existingOverride = prev.OWNERGROUP;
              if (typeof existingOverride === "string" && existingOverride.trim().length > 0) {
                return prev;
              }
              const existingField = fieldsRef.current?.OWNERGROUP;
              if (typeof existingField === "string" && existingField.trim().length > 0) {
                return prev;
              }
              return { ...prev, OWNERGROUP: ownerGroup };
            });
          }
        });

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
        startTransition(() => {
          setBudgetError(message);
          setBudgetTokens({});
          setDetectedCount(0);
          setBudgetOverrides({});
          setBudgetDebugLog([]);
          setTemplateTokenCount(null);
        });
      } finally {
        setBudgetLoading(false);
      }
    },
    [l001Format],
  );

  useEffect(() => {
    const currentFormat = l001Format ? "l001" : "standard";
    if (
      budgetFile === lastProcessedFiles.current.budget &&
      currentFormat === lastProcessedFiles.current.format
    ) {
      return;
    }
    void runBudgetExtract(budgetFile);
  }, [budgetFile, l001Format, runBudgetExtract]);

  useEffect(() => {
    if (step === 3) setBudgetPage(0);
  }, [step]);

  const handleBudgetFileChange = useCallback(
    (next: File | null) => {
      setBudgetFile(next);
      void runBudgetExtract(next);
    },
    [runBudgetExtract],
  );

  useEffect(() => {
    if (!hummingbirdFile && !iprcFile) {
      resetPerformanceUpload();
      setPerformanceStatus(null);
      setPerformanceLoading(false);
      return;
    }
    void runPerformanceExtract(hummingbirdFile, iprcFile);
  }, [hummingbirdFile, iprcFile, resetPerformanceUpload, runPerformanceExtract]);


  const handleHummingbirdFileChange = useCallback(
    (next: File | null) => {
      if (!next) {
        setHummingbirdFile(null);
        return;
      }
      const name = next.name?.toLowerCase() ?? "";
      const mime = next.type?.toLowerCase() ?? "";
      const isWorkbook =
        name.endsWith(".xlsx") ||
        name.endsWith(".xls") ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      if (!isWorkbook) {
        setHummingbirdFile(null);
        resetPerformanceUpload();
        setPerformanceStatus({
          variant: "error",
          text: "Upload a Hummingbird Move-In/Move-Out Activity report (.xlsx).",
        });
        setPerformanceLoading(false);
        return;
      }
      setHummingbirdFile(next);
    },
    [resetPerformanceUpload],
  );

  const handleIprcFileChange = useCallback(
    (next: File | null) => {
      if (!next) {
        setIprcFile(null);
        return;
      }
      const name = next.name?.toLowerCase() ?? "";
      const mime = next.type?.toLowerCase() ?? "";
      const isCsv = name.endsWith(".csv") || mime === "text/csv" || mime === "application/vnd.ms-excel";
      if (!isCsv) {
        setIprcFile(null);
        resetPerformanceUpload();
        setPerformanceStatus({
          variant: "error",
          text: "Upload the IPRC Change History export (.csv).",
        });
        setPerformanceLoading(false);
        return;
      }
      setIprcFile(next);
    },
    [resetPerformanceUpload],
  );

  const handleAvailableSpacesFileChange = useCallback((next: File | null) => {
    if (!next) {
      setAvailableSpacesFile(null);
      return;
    }
    const name = next.name?.toLowerCase() ?? "";
    const mime = next.type?.toLowerCase() ?? "";
    const isWorkbook =
      name.endsWith(".xlsx") ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isWorkbook) {
      setAvailableSpacesFile(null);
      return;
    }
    setAvailableSpacesFile(next);
  }, []);

  const handleRepairsFileChange = useCallback((next: File | null) => {
    if (!next) {
      setRepairsFile(null);
      return;
    }
    const name = next.name?.toLowerCase() ?? "";
    const mime = next.type?.toLowerCase() ?? "";
    const isCsv = name.endsWith(".csv") || mime === "text/csv" || mime === "application/vnd.ms-excel";
    const isWorkbook =
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isCsv && !isWorkbook) {
      setRepairsFile(null);
      return;
    }
    setRepairsFile(next);
  }, []);

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
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const selectedProperty = useMemo(
    () =>
      properties.find((p) => p.id === selectedPropertyId) ??
      properties.find((p) => p.tenantPropertyId === selectedPropertyId),
    [properties, selectedPropertyId],
  );
  const emailRecipients = useMemo(
    () => (selectedProperty?.ownerEmails ?? []).filter((email) => email && email.trim().length > 0),
    [selectedProperty],
  );
  useEffect(() => {
    if (!fields) return;
    const facilityDate = selectedProperty?.facilityOpenDate?.toString().trim();
    if (!facilityDate) return;
    const current = (overrides.ACQUIREDDATE ?? fields.ACQUIREDDATE ?? "").toString().trim();
    if (current) return;
    setOverrides((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, "ACQUIREDDATE")) return prev;
      return { ...prev, ACQUIREDDATE: facilityDate };
    });
  }, [fields, overrides.ACQUIREDDATE, selectedProperty?.facilityOpenDate]);
  const emailStatusMessage = useMemo(() => {
    if (!sendOwnerEmail) {
      return "Owner emails turned off for this export; the PPTX will only download locally.";
    }
    if (!selectedProperty) {
      return "Select a property to send owner emails after generation.";
    }
    if (!selectedProperty.enabled) {
      return "Property email delivery disabled for this property.";
    }
    if (emailRecipients.length === 0) {
      return "No owner emails configured; file will only download locally.";
    }
    return "Owner emails turned on for this export; the PPTX will be sent out via email.";
  }, [emailRecipients, selectedProperty, sendOwnerEmail]);

  async function onUpload(f: File) {
    startTransition(() => {
      setFile(f);
      setError(null);
    });
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/owner-reports/preview", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Upload failed.");
      }
      const json = await res.json();
      startTransition(() => {
        setFields(json.fields as OwnerFields);
        setOverrides({});
        setStep(2);
        if (lastDownload) {
          URL.revokeObjectURL(lastDownload.url);
          setLastDownload(null);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to parse the workbook.";
      startTransition(() => {
        setError(message);
        setFields(null);
        setOverrides({});
        setStep(1);
      });
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

  const handleExecutiveRemove = useCallback(() => {
    startTransition(() => {
      setFile(null);
      setFields(null);
      setOverrides({});
      setError(null);
      setStep(1);
    });
  }, [startTransition]);

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
      form.append("budgetFormat", l001Format ? "l001" : "standard");
      if (hummingbirdFile) {
        form.append("inventory", hummingbirdFile);
      }
      if (iprcFile) {
        form.append("iprc", iprcFile);
      }
      if (availableSpacesFile) {
        form.append("availableSpacesFile", availableSpacesFile);
      }
      if (repairsFile) {
        form.append("repairsFile", repairsFile);
      }
      if (msrFile) {
        form.append("msr", msrFile);
      }
      if (Object.keys(msrTokens).length > 0) {
        form.append("msrTokens", JSON.stringify(msrTokens));
      }
      if (ppcFile) {
        form.append("ppcFile", ppcFile);
      }
      const performanceOptionsPayload = {
        currentMonthOverride: currentMonthOverride.trim() || undefined,
        includeCurrentMonthInTrailing: includeCurrentMonth,
      };
      form.append("performanceOptions", JSON.stringify(performanceOptionsPayload));
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
      if (performanceTokens) {
        form.append("inventoryTokens", JSON.stringify(performanceTokens));
      }
      form.append("auditDelinquency", delinquencyAudit ? "true" : "false");
      form.append("sendEmail", sendOwnerEmail ? "true" : "false");
      if (selectedPropertyId) {
        form.append("propertyId", selectedPropertyId);
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
      if (performanceTokens) {
        for (const [token, rawValue] of Object.entries(performanceTokens)) {
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
          `[budget] WARNING: missing tokens not applied: ${missingForLog.length > 50 ? `${missingForLog.length} tokens` : missingForLog.join(", ")
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
    setMsrFile(null);
    setMsrTokens({});
    setMsrStatus(null);
    setMsrLoading(false);
    lastProcessedFiles.current = { budget: null, format: "standard" };
    setBudgetTokens({});
    setDetectedCount(0);
    setBudgetOverrides({});
    setBudgetError(null);
    setBudgetLoading(false);
    setBudgetPage(0);
    setBudgetDebugLog([]);
    setSendOwnerEmail(false);
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
          <aside className="owner-card owner-card--accent ios-animate-up relative overflow-hidden space-y-6 p-6" data-tone="blue">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.18),transparent_70%)] dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),transparent_75%)]"
            />
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

          <main className="ios-card ios-animate-up space-y-6 p-8" style={{ overflow: "visible" }}>
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

              <div>
                <div className="owner-progress" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
                  <div className="owner-progress__header">
                    <div className="owner-progress__stage-copy">
                      <span className="owner-progress__stage-step">Step {String(step).padStart(2, "0")}</span>
                      <span className="owner-progress__stage-label">{activeStepLabel}</span>
                    </div>
                    <div className="owner-progress__count" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
                      {step} / {TOTAL_STEPS}
                    </div>
                  </div>
                  <div className="owner-progress__body">
                    <div className="owner-progress__meter">
                      <span className="owner-progress__meter-fill" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="owner-progress__steps">
                      {progressSteps.map((progressStep) => (
                        <div
                          key={progressStep.keyStep}
                          className="owner-progress__step"
                          data-state={progressStep.state}
                        >
                          <span className="owner-progress__step-number">
                            {String(progressStep.keyStep).padStart(2, "0")}
                          </span>
                          <span className="owner-progress__step-label">{progressStep.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <span className="sr-only">Step {step} of {TOTAL_STEPS}</span>
              </div>

              {error && (
                <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                  {error}
                </div>
              )}

                            {step === 1 && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 1 - Upload</h2>
                  <div className="mt-4 owner-input-tile space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                            Executive Summary Report (.xlsx)
                          </p>
                          <UploadFieldHint title="Executive Summary fields" fields={UPLOAD_FIELD_HINTS.executiveSummary} />
                        </div>
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Drop your Executive Summary (.xlsx). Only the first sheet is parsed for now.
                        </p>
                      </div>
                      {file && (
                        <button
                          type="button"
                          className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                          onClick={handleExecutiveRemove}
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
                        const nextFile = event.target.files?.[0];
                        if (nextFile) onUpload(nextFile);
                        event.target.value = "";
                      }}
                    />
                    {busy && <p className="text-xs text-[color:var(--text-secondary)]">Parsing workbookƒ?İ</p>}
                    {file && !busy && (
                      <p className="text-xs text-[color:var(--text-secondary)]">
                        Selected: <span className="font-medium text-[color:var(--text-primary)]">{file.name}</span>
                      </p>
                    )}
                    <p className="text-[11px] text-[color:var(--text-muted)]">
                      Preview is available on Step 4 in the Summary mapper.
                    </p>
                  </div>
                </section>
              )}{step === 2 && (
                <section className="owner-card owner-card--surface rounded-xl px-6 py-8">
                  <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step 2 - Budget Inputs</h2>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    Upload the Management Summary Report plus optional supporting workbooks (Budget Comparison, performance, pricing).
                  </p>
                  <div className="mt-6 space-y-6">
                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                              Management Summary Report (.xlsx)
                            </p>
                            <UploadFieldHint title="MSR flash tokens" fields={UPLOAD_FIELD_HINTS.managementSummary} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload the MSR to pull flash tokens (MTD/Daily rentals, vacates, net, conversion, projected rent).
                          </p>
                        </div>
                        {msrFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              void runMsrExtract(null);
                            }}
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
                          void runMsrExtract(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {msrLoading && (
                        <p className="text-xs text-[color:var(--text-secondary)]">Parsing MSR...</p>
                      )}
                      {msrStatus?.variant === "error" && (
                        <div className="rounded-md border border-[#FEE2E2] bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">
                          {msrStatus.text}
                        </div>
                      )}
                      {msrFile && !msrLoading && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{msrFile.name}</span>
                        </p>
                      )}
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Parsed flash tokens are applied automatically during generation.
                      </p>
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Budget Comparison (.xlsx)</p>
                            <UploadFieldHint title="Budget table tokens" fields={UPLOAD_FIELD_HINTS.budgetComparison} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">Recommended for Budget Variance autofill</p>
                        </div>
                        {budgetFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
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
                      <label className="flex items-center gap-2 text-xs font-medium text-[color:var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={l001Format}
                          onChange={(event) => setL001Format(event.target.checked)}
                          className="h-4 w-4"
                        />
                        <span>
                          L001 format{" "}
                          <span className="font-normal text-[color:var(--text-muted)]">
                            (use only for L001&rsquo;s &ldquo;Budget vs. Actuals&rdquo; export)
                          </span>
                        </span>
                      </label>
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Preview is available on Step 3 in the Budget mapper.
                      </p>
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Move-In/Move-Out Activity (.xlsx)</p>
                            <UploadFieldHint title="Move activity fields" fields={UPLOAD_FIELD_HINTS.moveActivity} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload the Hummingbird Move-In/Move-Out Activity report (.xlsx) to capture move counts, promo %, and $/SqFt metrics.
                          </p>
                        </div>
                        {hummingbirdFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              void handleHummingbirdFileChange(null);
                            }}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          void handleHummingbirdFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {hummingbirdFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{hummingbirdFile.name}</span>
                        </p>
                      )}
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">IPRC Change History (.csv)</p>
                            <UploadFieldHint title="Rate management fields" fields={UPLOAD_FIELD_HINTS.iprcChangeHistory} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload the Shows In Place Rate Changes export (.csv) to populate Rate Management (letters, sqft, revenue, avg % increase).
                          </p>
                        </div>
                        {iprcFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              handleIprcFileChange(null);
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
                          handleIprcFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {iprcFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{iprcFile.name}</span>
                        </p>
                      )}
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                              Available Spaces by Attribute (.xlsx)
                            </p>
                            <UploadFieldHint title="Web rate fields" fields={UPLOAD_FIELD_HINTS.availableSpaces} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload the SSM Available Spaces by Attribute export to fill Web rates on Rate Management.
                          </p>
                        </div>
                        {availableSpacesFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              handleAvailableSpacesFileChange(null);
                            }}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".xlsx"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          handleAvailableSpacesFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {availableSpacesFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected:{" "}
                          <span className="font-medium text-[color:var(--text-primary)]">{availableSpacesFile.name}</span>
                        </p>
                      )}
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Optional: only used for the Web column on the Pricing slide.
                      </p>
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                            Repair and Maintenance Spreadsheet (.csv)
                          </p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload repair tickets to auto-fill REPAIRDATE, REPAIRDESCRIP, REPAIRCOST, and REPAIRSTATUS tokens.
                          </p>
                        </div>
                        {repairsFile && (
                          <button
                            type="button"
                            className="ml-auto whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => {
                              handleRepairsFileChange(null);
                            }}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <input
                        type="file"
                        accept=".csv"
                        className="text-sm text-[color:var(--text-primary)]"
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null;
                          handleRepairsFileChange(nextFile);
                          event.target.value = "";
                        }}
                      />
                      {repairsFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{repairsFile.name}</span>
                        </p>
                      )}
                    </div>

                    <div className="owner-input-tile space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-[color:var(--accent-strong)]">
                              PPC Performance sheets (.csv)
                            </p>
                            <UploadFieldHint title="PPC performance fields" fields={UPLOAD_FIELD_HINTS.ppcPerformance} />
                          </div>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Upload up to two marketing sheets (e.g., &quot;STORE Management PPC Report_PPC Performance_Table.csv&quot;) to fill Impressions, Clicks, Conversions, and Cost/Conversion.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <input
                          type="file"
                          accept=".csv"
                          className="text-sm text-[color:var(--text-primary)]"
                          onChange={(event) => {
                            const nextFile = event.target.files?.[0] ?? null;
                            setPpcFile(nextFile);
                            event.target.value = "";
                          }}
                        />
                        {ppcFile && (
                          <button
                            type="button"
                            className="text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] hover:underline"
                            onClick={() => setPpcFile(null)}
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      {ppcFile && (
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Selected: <span className="font-medium text-[color:var(--text-primary)]">{ppcFile.name}</span>
                        </p>
                      )}
                    </div>

                    {performanceLoading && (
                      <p className="text-xs text-[color:var(--text-secondary)]">Parsing performance inputs...</p>
                    )}
                    {performanceStatus && (
                      <div
                        className={`rounded-md border px-3 py-2 text-xs ${performanceStatus.variant === "error"
                            ? "border-[#FEE2E2] bg-[#FEF2F2] text-[#B91C1C]"
                            : "border-[#FEF3C7] bg-[#FFFBEB] text-[#92400E]"
                          }`}
                      >
                        {performanceStatus.text}
                      </div>
                    )}
                    {!performanceLoading &&
                      performancePreview.length > 0 &&
                      performanceStatus?.variant !== "error" && (
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        Preview is available on Step 4 in the Performance tokens panel.
                      </p>
                      )}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
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
                          className="owner-chip-button text-xs font-semibold uppercase tracking-wide"
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
                          className="owner-chip-button text-xs font-semibold uppercase tracking-wide"
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
                              className="bg-transparent rounded-xl p-4 shadow-sm"
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
                                    (isPercentToken ? "0.00%" : "Enter value");

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
                                        className={`owner-budget-input text-base ${percentToneClass}`}
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
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
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
                  {performancePreview.length > 0 && (
                    <div className="mt-6 rounded-lg border border-[color:var(--border-soft)]/70 bg-[color:var(--surface)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold text-[color:var(--accent-strong)]">Performance tokens</p>
                          <p className="text-xs text-[color:var(--text-secondary)]">
                            Auto-filled from the Hummingbird Move-In/Move-Out Activity + IPRC Change History uploads
                          </p>
                        </div>
                        {(hummingbirdFile || iprcFile) && (
                          <div className="text-[11px] text-[color:var(--text-muted)]">
                            {hummingbirdFile && (
                              <p className="truncate">
                                HB: {hummingbirdFile.name}
                              </p>
                            )}
                            {iprcFile && (
                              <p className="truncate">
                                IPRC: {iprcFile.name}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="px-4 pb-4">
                        <InventoryPreviewTable rows={performancePreview} />
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
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
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
                  <div className="mt-6 rounded-lg border border-[color:var(--border-soft)] bg-white/70 p-4 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[color:var(--text-primary)]">Automatic owner email</p>
                        <p className="text-xs text-[color:var(--text-secondary)]">
                          Control whether we email configured owner contacts after generation or just download the PPTX locally.
                        </p>
                      </div>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-soft)]/80 bg-white/80 px-3 py-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                              Email owners automatically
                            </p>
                            <p className="text-[11px] text-[color:var(--text-secondary)]">
                              Turn off to skip emailing owners for this export.
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={sendOwnerEmail}
                            onClick={() => setSendOwnerEmail((prev) => !prev)}
                            className={`relative inline-flex h-9 w-16 min-w-[64px] shrink-0 items-center justify-start rounded-full border p-1 transition-all duration-200 ease-out ${
                              sendOwnerEmail
                                ? "bg-[#2563EB] border-[#1D4ED8]"
                                : "bg-[rgba(148,163,255,0.18)] border-[color:var(--border-soft)]"
                            }`}
                            aria-label={sendOwnerEmail ? "Disable owner emails" : "Enable owner emails"}
                          >
                            <span
                              className={`inline-block h-7 w-7 rounded-full bg-white shadow transition-transform duration-200 ease-out ${
                                sendOwnerEmail ? "translate-x-7" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>
                        <select
                          className="rounded-md border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-sm focus:border-[#2563EB] focus:outline-none"
                          value={selectedPropertyId}
                          onChange={(event) => setSelectedPropertyId(event.target.value)}
                          disabled={properties.length === 0}
                        >
                          {properties.length === 0 && <option value="">No properties loaded</option>}
                          {properties.map((prop) => (
                            <option key={prop.id} value={prop.id}>
                              {prop.name || prop.id} {prop.enabled ? "" : "(disabled)"}
                            </option>
                          ))}
                        </select>
                        {propertyLoadError && (
                          <span className="text-xs text-[#B91C1C]">{propertyLoadError}</span>
                        )}
                        <span className="text-xs text-[color:var(--text-secondary)]">
                          {emailStatusMessage}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
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
                    Your PowerPoint/Canva has been downloaded. Review the values below or download the file again.
                  </p>
                  <div className="mt-4 flex justify-end">
                    <button
                      ref={viewLogButtonRef}
                      type="button"
                      onClick={() => {
                        setLogModalOpen(true);
                        track("console_log_opened", { screen: "export_step7" });
                      }}
                      className="ios-button px-4 py-2 text-sm"
                      data-variant="secondary"
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
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
                      type="button"
                      onClick={startAnother}
                    >
                      Start another
                    </button>
                    <Link
                      href="/"
                      className="ios-button px-5 py-2 text-sm"
                      data-variant="secondary"
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
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white"
                title="Close console log"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <input
                  type="text"
                  className="log-input h-10 w-full px-4 text-sm sm:max-w-sm"
                  placeholder="Filter lines (e.g., pptx, key, error, warning)"
                  value={logFilter}
                  onChange={handleFilterChange}
                  data-autofocus
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleWrap}
                    className={`log-pill-button text-xs ${logWrap ? "is-active" : ""}`}
                    aria-pressed={logWrap}
                    title="Toggle soft wrapping for log lines"
                  >
                    <WrapText className="h-4 w-4" aria-hidden />
                    Wrap lines
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLog}
                    className="log-pill-button text-xs"
                    title="Copy filtered log text to clipboard"
                  >
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadLog}
                    className="log-pill-button text-xs"
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
                  className={`font-mono text-xs leading-relaxed text-slate-100 ${logWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
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
