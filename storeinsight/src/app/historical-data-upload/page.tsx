/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import BackLink from '@/components/BackLink';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, FormEvent, JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import {
  getHistoricalTemplatePayload,
  parsePropertyHistoricalInput,
  validatePropertyHistoricalPayload,
} from '@/lib/historical/dataInput';
import type { HistoricalPropertyOption } from '@/lib/historical/dashboardTypes';
import { buildHistoricalPropertyOptions } from '@/lib/historical/snapshotDashboard';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';
import type { PropertyConfig } from '@/types/dailySummary';

type MsrPreviewSnapshot = {
  propertyName?: string;
  reportDate?: string;
  reportMonthIso?: string;
  occupancy?: {
    rsfOccPct?: number;
    spaceOccPct?: number;
    occupiedCount?: number;
    vacantCount?: number;
    offlineCount?: number;
    totalCount?: number;
    occupiedRsf?: number;
    vacantRsf?: number;
    offlineRsf?: number;
    totalRsf?: number;
    avgRentPerSpaceOccupied?: number;
    avgRentPerSqftOccupied?: number;
  };
  revenue?: {
    netRevenueMtd?: number;
    netRevenueSameDayLastMonth?: number;
    netRevenueSameDayLastYear?: number;
    grossPotentialRevenue?: number;
    economicOccupancy?: number;
    economicOccPerSqft?: number;
    occupiedRateVariancePct?: number;
  };
  rentals?: {
    moveInsMtd?: number;
    moveOutsMtd?: number;
    netMoveInsMtd?: number;
  };
  leads?: {
    webMtd?: number;
    walkInMtd?: number;
    phoneMtd?: number;
    otherMtd?: number;
    totalMtd?: number;
    convertedMtd?: number;
    conversionPct?: number;
    conversionRatePctMtd?: number;
  };
  ar?: {
    totalPastDue?: number;
    pastDue61Plus?: number;
    delinquentTenantCount?: number;
    agingBuckets?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    topDelinquencies?: Array<{ tenant?: string; unit?: string; daysLate?: number; balance?: number }>;
    overlock?: {
      overlockedUnitCount?: number;
      totalBalance?: number;
      avgDaysLate?: number;
    };
    overlockedUnitCount?: number;
    overlockTotalBalance?: number;
    overlockAvgDaysLate?: number;
  };
  pricing?: {
    avgSellRateOccupied?: number;
    avgCurrentRentOccupied?: number;
    avgSellRatePerSqftOccupied?: number;
    avgCurrentRentPerSqftOccupied?: number;
    occupiedRateVariancePct?: number;
    rentChangeCount?: number;
    avgRentChangePct?: number;
    noRentChange12MoCount?: number;
  };
  autopay?: {
    enrolledCount?: number;
    enrolledPct?: number;
  };
  coverage?: {
    enrolledCount?: number;
    enrolledPct?: number;
    premiumSum?: number;
  };
  concessions?: {
    promosDiscountsMtd?: number;
    creditsAdjustmentsMtd?: number;
    refundsMtd?: number;
    writeOffsMtd?: number;
    refundsWriteoffsMtd?: number;
  };
  unitMix?: {
    occupiedRsfByType?: Record<string, number>;
    occupiedPctByType?: Record<string, number>;
  };
  inventory?: {
    vacantUnitsSample?: Array<{ unit?: string; type?: string; size?: string; status?: string }>;
  };
};

type OccupancyDiagnostics = {
  sheetName?: string;
  headerRowIndex?: number | null;
  columnMapping?: Record<string, string | null>;
  rowCounts?: {
    total: number;
    occupied: number;
    vacant: number;
    offline: number;
    unknown: number;
  };
  headerCandidates?: string[];
  error?: string | null;
};

type MsrDataSources = {
  occupancySummarySource?: 'msr' | 'occupancy';
  occupancySummaryRows?: {
    total: number;
    occupied: number;
    vacant: number;
    offline: number;
    unknown: number;
  };
  leadsSource?: 'msr';
  leadsRowCount?: number;
};

type KpiTableDiagnostics = {
  tableFound: boolean;
  headerRowIndex: number | null;
  headerValues?: string[];
  labelColumnIndex?: number | null;
  columnMap?: {
    daily?: number | null;
    mtd?: number | null;
    ytd?: number | null;
  };
  selectedMtdIndex?: number | null;
  matchedRowLabels?: string[];
  extracted?: Record<string, { daily?: number | null; mtd?: number | null; ytd?: number | null }>;
  candidateTables?: Array<{ headerRowIndex: number; headerValues: string[] }>;
};

type MsrTableDiagnostics = {
  rentalActivity?: KpiTableDiagnostics;
  leads?: KpiTableDiagnostics;
};

type MsrPreviewResponse = {
  snapshot: MsrPreviewSnapshot;
  warnings: string[];
  sections: Record<string, boolean>;
  exists: boolean;
  occupancyDiagnostics?: OccupancyDiagnostics | null;
  dataSources?: MsrDataSources | null;
  msrTableDiagnostics?: MsrTableDiagnostics | null;
};

type BudgetFinancialPreviewSnapshot = {
  propertyName?: string;
  reportMonthIso?: string;
  monthIso?: string;
  financials?: {
    expenses?: number;
    expensesMtd?: number;
    totalOperatingExpense?: number;
    totalOperatingExpenseMtd?: number;
    propertyExpenses?: number;
    propertyExpensesMtd?: number;
    totalExpenses?: number;
    totalExpensesMtd?: number;
    otherExpenses?: number;
    otherExpensesMtd?: number;
    noi?: number;
    noiMtd?: number;
    netOperatingIncome?: number;
    netOperatingIncomeMtd?: number;
  };
};

type BudgetFinancialPreviewSource = {
  token: string;
  cell?: string | null;
  sheet?: string | null;
  fallback?: boolean;
  formula?: string | null;
};

type BudgetFinancialPreviewContextValue = BudgetFinancialPreviewSource & { value?: number };

type BudgetFinancialPreviewResponse = {
  snapshot: BudgetFinancialPreviewSnapshot;
  warnings: string[];
  sourceSheet?: string | null;
  format?: 'quickbooks' | 'yardi' | 'l001' | null;
  formatLabel?: string | null;
  context?: {
    totalIncome?: BudgetFinancialPreviewContextValue;
    netIncome?: BudgetFinancialPreviewContextValue;
    otherIncome?: BudgetFinancialPreviewContextValue;
    entityName?: string;
  } | null;
  sources?: {
    propertyExpenses?: BudgetFinancialPreviewSource;
    totalExpenses?: BudgetFinancialPreviewSource;
    otherExpenses?: BudgetFinancialPreviewSource;
    noi?: BudgetFinancialPreviewSource;
  } | null;
  exists: boolean;
  hasFinancials: boolean;
  updatedAt?: string | null;
};

type NewHistoricalPropertyFormState = {
  name: string;
  propertyId: string;
  propertyCode: string;
  tenantPropertyId: string;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const budgetCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  currencySign: 'accounting',
});

const numberFormatter = new Intl.NumberFormat('en-US');

const formatPreviewValue = (value: unknown, kind: 'currency' | 'percent' | 'number' | 'text' = 'text'): string => {
  if (value == null || value === '') return 'N/A';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'N/A';
  if (kind === 'currency' && typeof value === 'number') return currencyFormatter.format(value);
  if (kind === 'percent' && typeof value === 'number') {
    const normalized = Math.abs(value) <= 1 ? value * 100 : value;
    return `${normalized.toFixed(1)}%`;
  }
  if (kind === 'number' && typeof value === 'number') return numberFormatter.format(Math.round(value));
  return String(value);
};

const formatBudgetPreviewCurrency = (value: unknown): string => {
  if (value == null || value === '') return 'N/A';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return budgetCurrencyFormatter.format(value);
};

const normalizePropertyToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildHistoricalPropertyCode = (value: string): string =>
  value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const createEmptyHistoricalPropertyForm = (): NewHistoricalPropertyFormState => ({
  name: '',
  propertyId: '',
  propertyCode: '',
  tenantPropertyId: '',
});

const fetchHistoricalPropertyConfigs = async (): Promise<PropertyConfig[] | null> => {
  const response = await fetch('/api/daily-summary/properties');
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as PropertyConfig[] | null;
  if (!Array.isArray(data)) return null;
  return data;
};

const resolvePropertyIdFromLabel = (label: string, propertyOptions: HistoricalPropertyOption[]): string | null => {
  const normalized = normalizePropertyToken(label);
  if (!normalized) return null;
  const match = propertyOptions.find((option) => {
    const optionLabel = normalizePropertyToken(option.label);
    const optionId = normalizePropertyToken(option.id);
    return (
      normalized === optionLabel ||
      normalized === optionId ||
      optionLabel.includes(normalized) ||
      normalized.includes(optionLabel) ||
      optionId.includes(normalized) ||
      normalized.includes(optionId)
    );
  });
  return match?.id ?? null;
};

const parseMsrFilename = (name: string): { propertyLabel?: string } => {
  const match = name.match(/management\s+summary\s+report\s*-\s*(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})/i);
  if (!match) return {};
  return { propertyLabel: match[1]?.trim() };
};

const detectPropertyIdFromFile = (
  file: File | null,
  propertyOptions: HistoricalPropertyOption[],
): string | null => {
  if (!file) return null;
  const { propertyLabel } = parseMsrFilename(file.name);
  if (propertyLabel) {
    const fromLabel = resolvePropertyIdFromLabel(propertyLabel, propertyOptions);
    if (fromLabel) return fromLabel;
  }
  const normalizedName = normalizePropertyToken(file.name);
  const match = propertyOptions.find((option) => normalizedName.includes(normalizePropertyToken(option.id)));
  return match?.id ?? null;
};

type HistoricalJsonEditorProps = {
  value: string;
  onDraftChange: (value: string) => void;
  onCommit: (value: string) => void;
};

// The pasted payload runs to thousands of lines, so the textarea keeps its own
// draft state and only pushes into page state on blur. onDraftChange writes to a
// ref on the page so validate/upload always read the newest text without forcing
// a full page render on every keystroke.
const HistoricalJsonEditor = memo(function HistoricalJsonEditor({
  value,
  onDraftChange,
  onCommit,
}: HistoricalJsonEditorProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const syncedValueRef = useRef(value);

  // Adopt values pushed down from the page (Load template) without clobbering
  // text the user is still typing.
  useEffect(() => {
    if (value === syncedValueRef.current) return;
    syncedValueRef.current = value;
    setDraft(value);
  }, [value]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setDraft(next);
      onDraftChange(next);
    },
    [onDraftChange],
  );

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      if (next === syncedValueRef.current) return;
      syncedValueRef.current = next;
      onCommit(next);
    },
    [onCommit],
  );

  return (
    <textarea
      className="owner-field-input min-h-[320px] w-full resize-y rounded-2xl p-4 font-mono text-[11px] text-[color:var(--text-primary)] shadow-inner focus:outline-none"
      placeholder="Paste the historical data JSON payload here."
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      spellCheck={false}
    />
  );
});

export default function HistoricalDataUploadPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [historicalPropertyOptions, setHistoricalPropertyOptions] = useState<HistoricalPropertyOption[]>(
    buildHistoricalPropertyOptions([], PROPERTY_OPTIONS),
  );
  const [historicalPropertyConfigs, setHistoricalPropertyConfigs] = useState<PropertyConfig[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [dataInput, setDataInput] = useState('');
  // Mirrors the JSON editor draft between blurs so validate/upload never read a
  // stale payload.
  const dataInputRef = useRef('');
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [validationSummary, setValidationSummary] = useState<ReturnType<typeof validatePropertyHistoricalPayload> | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [msrPropertyId, setMsrPropertyId] = useState('');
  const [msrFile, setMsrFile] = useState<File | null>(null);
  const [msrPreview, setMsrPreview] = useState<MsrPreviewResponse | null>(null);
  const [msrWarnings, setMsrWarnings] = useState<string[]>([]);
  const [msrError, setMsrError] = useState<string | null>(null);
  const [msrStatus, setMsrStatus] = useState<string | null>(null);
  const [msrParsing, setMsrParsing] = useState(false);
  const [msrUploading, setMsrUploading] = useState(false);
  const [msrOverwrite, setMsrOverwrite] = useState(false);
  const [msrExisting, setMsrExisting] = useState(false);
  const [msrUpdatedAt, setMsrUpdatedAt] = useState<string | null>(null);
  const [budgetPropertyId, setBudgetPropertyId] = useState('');
  const [budgetFile, setBudgetFile] = useState<File | null>(null);
  // QuickBooks is the current export format for managed properties; Yardi is
  // legacy backfill, and L001 is the owned-property variant.
  const [budgetFormat, setBudgetFormat] = useState<'quickbooks' | 'yardi' | 'l001'>('quickbooks');
  const [budgetPreview, setBudgetPreview] = useState<BudgetFinancialPreviewResponse | null>(null);
  const [budgetWarnings, setBudgetWarnings] = useState<string[]>([]);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<string | null>(null);
  const [budgetParsing, setBudgetParsing] = useState(false);
  const [budgetUploading, setBudgetUploading] = useState(false);
  const [budgetOverwrite, setBudgetOverwrite] = useState(false);
  const [budgetExisting, setBudgetExisting] = useState(false);
  const [budgetFinancialsExisting, setBudgetFinancialsExisting] = useState(false);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);
  const [newPropertyForm, setNewPropertyForm] = useState<NewHistoricalPropertyFormState>(
    createEmptyHistoricalPropertyForm,
  );
  const [newPropertySaving, setNewPropertySaving] = useState(false);
  const [newPropertyError, setNewPropertyError] = useState<string | null>(null);
  const [newPropertyStatus, setNewPropertyStatus] = useState<string | null>(null);
  const [deletePropertyConfigId, setDeletePropertyConfigId] = useState('');
  const [deletePropertySaving, setDeletePropertySaving] = useState(false);
  const [deletePropertyError, setDeletePropertyError] = useState<string | null>(null);
  const [deletePropertyStatus, setDeletePropertyStatus] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadPropertyOptions = async () => {
      try {
        const configs = await fetchHistoricalPropertyConfigs();
        if (!isMounted || !configs) return;
        setHistoricalPropertyConfigs(configs);
        setHistoricalPropertyOptions(buildHistoricalPropertyOptions(configs, PROPERTY_OPTIONS));
      } catch {
        // keep static fallback options
      }
    };

    void loadPropertyOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  const templateString = useMemo(() => JSON.stringify(getHistoricalTemplatePayload(), null, 2), []);

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';
  const msrSnapshot = msrPreview?.snapshot;
  const budgetSnapshot = budgetPreview?.snapshot;
  const occupancyDiagnostics = msrPreview?.occupancyDiagnostics ?? null;
  const msrDataSources = msrPreview?.dataSources ?? null;
  const msrTableDiagnostics = msrPreview?.msrTableDiagnostics ?? null;
  const budgetSources = budgetPreview?.sources ?? null;
  const budgetPropertyExpensesValue =
    budgetSnapshot?.financials?.propertyExpensesMtd ??
    budgetSnapshot?.financials?.totalOperatingExpenseMtd ??
    budgetSnapshot?.financials?.expensesMtd;
  const budgetTotalExpensesValue =
    budgetSnapshot?.financials?.totalExpensesMtd ?? budgetSnapshot?.financials?.totalExpenses;
  const budgetOtherExpensesValue =
    budgetSnapshot?.financials?.otherExpensesMtd ?? budgetSnapshot?.financials?.otherExpenses;
  const budgetNoiValue =
    budgetSnapshot?.financials?.netOperatingIncomeMtd ?? budgetSnapshot?.financials?.noiMtd;
  const budgetContext = budgetPreview?.context ?? null;
  const budgetTotalIncomeValue = budgetContext?.totalIncome?.value;
  const budgetNetIncomeValue = budgetContext?.netIncome?.value;
  const budgetOtherIncomeValue = budgetContext?.otherIncome?.value;
  const budgetEntityName = budgetContext?.entityName;
  const budgetFormatLabel =
    budgetPreview?.formatLabel ??
    (budgetPreview?.format === 'quickbooks'
      ? 'QuickBooks financial package'
      : budgetPreview?.format === 'yardi'
        ? 'Yardi Budget Comparison (legacy)'
        : budgetPreview?.format === 'l001'
          ? 'L001 owned-property'
          : null);
  const occupancyHeaderRow =
    occupancyDiagnostics?.headerRowIndex != null ? occupancyDiagnostics.headerRowIndex + 1 : null;
  const occupancySummarySourceLabel =
    msrDataSources?.occupancySummarySource === 'msr'
      ? 'MSR Space Occupancy block'
      : msrDataSources?.occupancySummarySource === 'occupancy'
        ? 'Occupancy tab fallback'
        : 'N/A';
  const leadsSourceLabel =
    msrDataSources?.leadsSource === 'msr'
      ? 'MSR Leads block'
      : 'N/A';
  const formatHeaderList = (headers?: string[]) =>
    headers?.filter((header) => header && header.trim()).join(' | ') || 'N/A';
  const formatIndex = (index?: number | null) => (index == null ? 'N/A' : String(index + 1));
  const formatColumnSummary = (
    diagnostics: KpiTableDiagnostics | null,
    key: 'daily' | 'mtd' | 'ytd',
  ): string => {
    if (!diagnostics) return 'N/A';
    const index = diagnostics.columnMap?.[key] ?? null;
    const header = index != null ? diagnostics.headerValues?.[index] : null;
    const headerLabel = formatPreviewValue(header);
    return `${headerLabel} (col ${formatIndex(index)})`;
  };
  const formatDetectedHeaders = (diagnostics: KpiTableDiagnostics | null): string => {
    if (!diagnostics) return 'N/A';
    const headerValues = diagnostics.headerValues ?? [];
    const kpiHeader =
      diagnostics.labelColumnIndex != null ? headerValues[diagnostics.labelColumnIndex] : null;
    const dateHeader =
      diagnostics.columnMap?.daily != null ? headerValues[diagnostics.columnMap.daily] : null;
    const mtdHeader =
      diagnostics.columnMap?.mtd != null ? headerValues[diagnostics.columnMap.mtd] : null;
    const ytdHeader =
      diagnostics.columnMap?.ytd != null ? headerValues[diagnostics.columnMap.ytd] : null;
    const parts = [
      formatPreviewValue(kpiHeader),
      formatPreviewValue(dateHeader),
      formatPreviewValue(mtdHeader),
      formatPreviewValue(ytdHeader),
    ];
    return `[${parts.join(', ')}]`;
  };
  const formatMatchedLabels = (diagnostics: KpiTableDiagnostics | null): string => {
    const labels = diagnostics?.matchedRowLabels?.filter((label) => label && label.trim());
    return labels && labels.length ? labels.join(' | ') : 'N/A';
  };
  const formatCandidateHeaderRow = (candidate: { headerRowIndex: number; headerValues: string[] }) =>
    `Row ${candidate.headerRowIndex + 1}: ${formatHeaderList(candidate.headerValues)}`;
  const formatExtractedValue = (label: string, value: number | null | undefined): string => {
    const isRate = label.toLowerCase().includes('rate');
    return formatPreviewValue(value, isRate ? 'percent' : 'number');
  };
  const rentalDiagnostics = msrTableDiagnostics?.rentalActivity ?? null;
  const leadsDiagnostics = msrTableDiagnostics?.leads ?? null;
  const rentalHeaderRow =
    rentalDiagnostics?.headerRowIndex != null ? rentalDiagnostics.headerRowIndex + 1 : null;
  const leadsHeaderRow =
    leadsDiagnostics?.headerRowIndex != null ? leadsDiagnostics.headerRowIndex + 1 : null;
  const msrSectionEntries = msrPreview
    ? [
        { key: 'occupancy', label: 'Occupancy', ok: msrPreview.sections?.occupancy },
        { key: 'revenue', label: 'Revenue', ok: msrPreview.sections?.revenue },
        { key: 'rentals', label: 'Rentals', ok: msrPreview.sections?.rentals },
        { key: 'leads', label: 'Leads', ok: msrPreview.sections?.leads },
        { key: 'ar', label: 'Collections', ok: msrPreview.sections?.ar },
        { key: 'pricing', label: 'Pricing', ok: msrPreview.sections?.pricing },
        { key: 'autopay', label: 'Autopay', ok: msrPreview.sections?.autopay },
        { key: 'coverage', label: 'Coverage', ok: msrPreview.sections?.coverage },
        { key: 'concessions', label: 'Concessions', ok: msrPreview.sections?.concessions },
        { key: 'unitMix', label: 'Unit Mix', ok: msrPreview.sections?.unitMix },
        { key: 'inventory', label: 'Inventory', ok: msrPreview.sections?.inventory },
      ]
    : [];
  const deletableHistoricalProperties = useMemo(
    () =>
      historicalPropertyConfigs
        .filter((property) => property.enabled === false)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name)),
    [historicalPropertyConfigs],
  );

  const handleLoadTemplate = () => {
    setDataInput(templateString);
    dataInputRef.current = templateString;
    setDataError(null);
    setDataStatus('Template loaded. Update values and upload to Firebase.');
    setValidationSummary(null);
  };

  const handleDataDraftChange = useCallback((value: string) => {
    dataInputRef.current = value;
  }, []);

  const handleDataCommit = useCallback((value: string) => {
    dataInputRef.current = value;
    setDataInput(value);
  }, []);

  const handleCopyTemplate = async () => {
    setTemplateStatus(null);
    try {
      await navigator.clipboard.writeText(templateString);
      setTemplateStatus('Template copied.');
    } catch {
      setTemplateStatus('Copy failed.');
    }
  };

  const handleCreateHistoricalProperty = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNewPropertyError(null);
    setNewPropertyStatus(null);

    const name = newPropertyForm.name.trim();
    const resolvedPropertyId = newPropertyForm.propertyId.trim();
    const propertyCode = newPropertyForm.propertyCode.trim() || buildHistoricalPropertyCode(name);
    const tenantPropertyId = newPropertyForm.tenantPropertyId.trim() || resolvedPropertyId;

    if (!name) {
      setNewPropertyError('Property name is required.');
      return;
    }
    if (!resolvedPropertyId) {
      setNewPropertyError('Property ID is required.');
      return;
    }
    if (!propertyCode) {
      setNewPropertyError('Property code could not be generated. Enter one manually.');
      return;
    }

    setNewPropertySaving(true);
    try {
      const response = await fetch('/api/daily-summary/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          id: resolvedPropertyId,
          propertyId: resolvedPropertyId,
          propertyCode,
          tenantPropertyId,
          enabled: false,
          timezone: 'America/Phoenix',
          sendTimeLocal: '08:00',
          sendTimeMst: '08:00',
          ownerEmails: [],
        } satisfies Partial<PropertyConfig>),
      });
      const data = (await response.json().catch(() => null)) as Partial<PropertyConfig> & {
        error?: string;
      } | null;

      if (!response.ok) {
        setNewPropertyError(data?.error ?? 'Unable to add property.');
        return;
      }

      const selectedId = data?.propertyId?.trim() || data?.id?.trim() || resolvedPropertyId;
      const refreshedConfigs = await fetchHistoricalPropertyConfigs();
      if (refreshedConfigs) {
        setHistoricalPropertyConfigs(refreshedConfigs);
        setHistoricalPropertyOptions(buildHistoricalPropertyOptions(refreshedConfigs, PROPERTY_OPTIONS));
      }

      setPropertyId(selectedId);
      setMsrPropertyId(selectedId);
      setBudgetPropertyId(selectedId);
      setDeletePropertyConfigId(data?.id?.trim() || selectedId);
      setMsrPreview(null);
      setMsrWarnings([]);
      setMsrExisting(false);
      setMsrOverwrite(false);
      setBudgetPreview(null);
      setBudgetWarnings([]);
      setBudgetExisting(false);
      setBudgetFinancialsExisting(false);
      setBudgetOverwrite(false);
      setNewPropertyForm(createEmptyHistoricalPropertyForm());
      setNewPropertyStatus(`${name} added as a historical-only property and selected for uploads.`);
    } catch {
      setNewPropertyError('Unable to add property.');
    } finally {
      setNewPropertySaving(false);
    }
  };

  const handleDeleteHistoricalProperty = async () => {
    setDeletePropertyError(null);
    setDeletePropertyStatus(null);

    const selectedConfig = deletableHistoricalProperties.find((property) => property.id === deletePropertyConfigId);
    if (!selectedConfig) {
      setDeletePropertyError('Select a historical-only property to delete.');
      return;
    }

    setDeletePropertySaving(true);
    try {
      const response = await fetch('/api/daily-summary/properties', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedConfig.id }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setDeletePropertyError(data?.error ?? 'Unable to delete property.');
        return;
      }

      const refreshedConfigs = await fetchHistoricalPropertyConfigs();
      if (refreshedConfigs) {
        setHistoricalPropertyConfigs(refreshedConfigs);
        setHistoricalPropertyOptions(buildHistoricalPropertyOptions(refreshedConfigs, PROPERTY_OPTIONS));
      }

      const deletedIds = new Set(
        [selectedConfig.id, selectedConfig.propertyId, selectedConfig.tenantPropertyId, selectedConfig.propertyCode]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      );
      if (deletedIds.has(propertyId.trim())) setPropertyId('');
      if (deletedIds.has(msrPropertyId.trim())) {
        setMsrPropertyId('');
        setMsrPreview(null);
        setMsrWarnings([]);
        setMsrExisting(false);
        setMsrOverwrite(false);
      }
      if (deletedIds.has(budgetPropertyId.trim())) {
        setBudgetPropertyId('');
        setBudgetPreview(null);
        setBudgetWarnings([]);
        setBudgetExisting(false);
        setBudgetFinancialsExisting(false);
        setBudgetOverwrite(false);
      }
      setDeletePropertyConfigId('');
      setDeletePropertyStatus(`${selectedConfig.name} deleted from historical property options.`);
    } catch {
      setDeletePropertyError('Unable to delete property.');
    } finally {
      setDeletePropertySaving(false);
    }
  };

  const handleMsrParse = async () => {
    setMsrError(null);
    setMsrStatus(null);
    setMsrWarnings([]);
    setMsrPreview(null);
    setMsrExisting(false);
    setMsrOverwrite(false);

    if (!msrPropertyId.trim()) {
      setMsrError('Property ID is required.');
      return;
    }
    if (!msrFile) {
      setMsrError('Upload a .xlsx file first.');
      return;
    }

    setMsrParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', msrFile);
      formData.append('propertyId', msrPropertyId.trim());
      const response = await fetch('/api/firebase/property-historical/msr/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setMsrError(data?.message ?? 'Parse failed.');
        return;
      }
      setMsrPreview(data as MsrPreviewResponse);
      setMsrWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
      setMsrExisting(Boolean(data?.exists));
      setMsrStatus('Parsed MSR workbook. Review preview before upload.');
    } catch {
      setMsrError('Parse failed.');
    } finally {
      setMsrParsing(false);
    }
  };

  const handleMsrUpload = async () => {
    setMsrError(null);
    setMsrStatus(null);

    if (!msrPropertyId.trim()) {
      setMsrError('Property ID is required.');
      return;
    }
    if (!msrPreview?.snapshot) {
      setMsrError('Parse the workbook first.');
      return;
    }
    if (msrExisting && !msrOverwrite) {
      setMsrError('Snapshot already exists for this month. Enable overwrite to continue.');
      return;
    }

    setMsrUploading(true);
    try {
      const response = await fetch('/api/firebase/property-historical/msr/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: msrPropertyId.trim(),
          snapshot: msrPreview.snapshot,
          overwrite: msrOverwrite,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMsrError(data?.message ?? 'Upload failed.');
        return;
      }
      setMsrStatus('MSR snapshot uploaded to Firebase.');
      setMsrUpdatedAt(data?.updatedAt ?? null);
      setMsrExisting(true);
    } catch {
      setMsrError('Upload failed.');
    } finally {
      setMsrUploading(false);
    }
  };

  // Any change to the source file or format invalidates the parsed preview, so
  // stale numbers can never be uploaded against a different selection.
  const resetBudgetPreviewState = () => {
    setBudgetPreview(null);
    setBudgetWarnings([]);
    setBudgetExisting(false);
    setBudgetFinancialsExisting(false);
    setBudgetOverwrite(false);
    setBudgetUpdatedAt(null);
    setBudgetError(null);
    setBudgetStatus(null);
  };

  const handleBudgetParse = async () => {
    setBudgetError(null);
    setBudgetStatus(null);
    setBudgetWarnings([]);
    setBudgetPreview(null);
    setBudgetExisting(false);
    setBudgetFinancialsExisting(false);
    setBudgetOverwrite(false);
    setBudgetUpdatedAt(null);

    if (!budgetPropertyId.trim()) {
      setBudgetError('Property ID is required.');
      return;
    }
    if (!budgetFile) {
      setBudgetError('Upload a .xlsx file first.');
      return;
    }

    setBudgetParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', budgetFile);
      formData.append('propertyId', budgetPropertyId.trim());
      formData.append('format', budgetFormat);
      const response = await fetch('/api/firebase/property-historical/budget-financials/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setBudgetError(data?.message ?? 'Parse failed.');
        return;
      }
      setBudgetPreview(data as BudgetFinancialPreviewResponse);
      setBudgetWarnings(Array.isArray(data?.warnings) ? data.warnings : []);
      setBudgetExisting(Boolean(data?.exists));
      setBudgetFinancialsExisting(Boolean(data?.hasFinancials));
      setBudgetUpdatedAt(data?.updatedAt ?? null);
      setBudgetStatus('Parsed budget workbook. Review financial preview before upload.');
    } catch {
      setBudgetError('Parse failed.');
    } finally {
      setBudgetParsing(false);
    }
  };

  const handleBudgetUpload = async () => {
    setBudgetError(null);
    setBudgetStatus(null);

    if (!budgetPropertyId.trim()) {
      setBudgetError('Property ID is required.');
      return;
    }
    if (!budgetPreview?.snapshot) {
      setBudgetError('Parse the workbook first.');
      return;
    }
    if (budgetExisting && budgetFinancialsExisting && !budgetOverwrite) {
      setBudgetError('Financials already exist for this month. Enable overwrite to continue.');
      return;
    }

    setBudgetUploading(true);
    try {
      const response = await fetch('/api/firebase/property-historical/budget-financials/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId: budgetPropertyId.trim(),
          snapshot: budgetPreview.snapshot,
          overwrite: budgetOverwrite,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setBudgetError(data?.message ?? 'Upload failed.');
        return;
      }
      setBudgetStatus(
        data?.created
          ? 'Financial snapshot created in Firebase.'
          : data?.overwritten
            ? 'Financial snapshot overwritten in Firebase.'
            : 'Financials merged into the existing snapshot.',
      );
      setBudgetUpdatedAt(data?.updatedAt ?? null);
      setBudgetExisting(true);
      setBudgetFinancialsExisting(true);
    } catch {
      setBudgetError('Upload failed.');
    } finally {
      setBudgetUploading(false);
    }
  };

  const handleValidate = () => {
    setDataError(null);
    setDataStatus(null);
    const currentInput = dataInputRef.current;
    if (!currentInput.trim()) {
      setDataError('Paste JSON or load the template first.');
      return null;
    }
    const parsed = parsePropertyHistoricalInput(currentInput, propertyId.trim() || undefined);
    if (!parsed.data) {
      setDataError(parsed.error ?? 'Unable to parse historical data payload.');
      return null;
    }
    const validation = validatePropertyHistoricalPayload(parsed.data);
    setValidationSummary(validation);
    if (!validation.ok) {
      setDataError('Validation failed. Fix the errors and try again.');
      return null;
    }
    return parsed.data;
  };

  const handleUpload = async () => {
    setDataError(null);
    setDataStatus(null);
    if (!propertyId.trim()) {
      setDataError('Property ID is required.');
      return;
    }

    const payload = handleValidate();
    if (!payload) return;

    setIsUploading(true);
    try {
      const response = await fetch('/api/firebase/property-historical/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: propertyId.trim(), payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        setDataError(data?.message ?? 'Upload failed.');
        if (data?.validation) {
          setValidationSummary(data.validation);
        }
        return;
      }
      setDataStatus('Upload complete. Firebase data updated.');
      setLastUpdatedAt(data?.updatedAt ?? null);
      if (data?.validation) {
        setValidationSummary(data.validation);
      }
    } catch {
      setDataError('Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <datalist id="historical-property-options">
          {historicalPropertyOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </datalist>

        <header className="ios-card ios-animate-up space-y-4 p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 grow basis-full sm:basis-0 space-y-2">
              <span className="ios-badge text-[10px]">Historical data upload</span>
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                Upload historical data to Firebase
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                Paste the JSON payload for a single property. Data is validated before upload.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BackLink href="/other" label="Back to historical data" />
            </div>
          </div>
        </header>

        <section className="ios-card ios-animate-up space-y-4 p-6" data-tone="blue">
          <div className="space-y-2">
            <div className="text-base font-semibold text-[color:var(--text-primary)]">
              Add historical property
            </div>
            <p className="max-w-2xl text-xs text-[color:var(--text-secondary)]">
              Create a property for historical dashboards before uploading MSR or budget history. New properties are
              saved disabled for Daily Flash automation.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleCreateHistoricalProperty}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Property name
                </span>
                <input
                  className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                  placeholder="e.g. STORE on Main"
                  value={newPropertyForm.name}
                  onChange={(event) => {
                    setNewPropertyForm((prev) => ({ ...prev, name: event.target.value }));
                    setNewPropertyError(null);
                    setNewPropertyStatus(null);
                  }}
                  required
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Property ID
                </span>
                <input
                  className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                  placeholder="e.g. L004"
                  value={newPropertyForm.propertyId}
                  onChange={(event) => {
                    setNewPropertyForm((prev) => ({ ...prev, propertyId: event.target.value }));
                    setNewPropertyError(null);
                    setNewPropertyStatus(null);
                  }}
                  required
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Property code
                </span>
                <input
                  className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                  placeholder="Auto-generates from name"
                  value={newPropertyForm.propertyCode}
                  onChange={(event) => {
                    setNewPropertyForm((prev) => ({ ...prev, propertyCode: event.target.value }));
                    setNewPropertyError(null);
                    setNewPropertyStatus(null);
                  }}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Tenant property ID
                </span>
                <input
                  className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                  placeholder="Defaults to Property ID"
                  value={newPropertyForm.tenantPropertyId}
                  onChange={(event) => {
                    setNewPropertyForm((prev) => ({ ...prev, tenantPropertyId: event.target.value }));
                    setNewPropertyError(null);
                    setNewPropertyStatus(null);
                  }}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[color:var(--text-secondary)]">
                Daily Flash status: disabled until enabled from /daily-summary.
              </div>
              <button
                type="submit"
                className="ios-button px-4 py-2 text-xs"
                disabled={newPropertySaving}
              >
                {newPropertySaving ? 'Adding...' : 'Add property'}
              </button>
            </div>

            <div className="space-y-1 text-[11px]">
              {newPropertyError ? <p className="text-red-500">Error: {newPropertyError}</p> : null}
              {newPropertyStatus ? <p className="text-[color:var(--text-secondary)]">{newPropertyStatus}</p> : null}
            </div>
          </form>

          <div className="border-t border-[color:var(--border-soft)] pt-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Delete historical-only property
                </span>
                <select
                  className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                  value={deletePropertyConfigId}
                  onChange={(event) => {
                    setDeletePropertyConfigId(event.target.value);
                    setDeletePropertyError(null);
                    setDeletePropertyStatus(null);
                  }}
                  disabled={!deletableHistoricalProperties.length || deletePropertySaving}
                >
                  <option value="">
                    {deletableHistoricalProperties.length ? 'Select property' : 'No historical-only properties'}
                  </option>
                  {deletableHistoricalProperties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name} ({property.propertyId || property.id})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ios-button px-4 py-2 text-xs"
                data-variant="ghost"
                disabled={!deletePropertyConfigId || deletePropertySaving}
                onClick={handleDeleteHistoricalProperty}
              >
                {deletePropertySaving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            <div className="mt-2 space-y-1 text-[11px]">
              <p className="text-[color:var(--text-secondary)]">
                Only disabled historical-only property configs are shown here.
              </p>
              {deletePropertyError ? <p className="text-red-500">Error: {deletePropertyError}</p> : null}
              {deletePropertyStatus ? <p className="text-[color:var(--text-secondary)]">{deletePropertyStatus}</p> : null}
            </div>
          </div>
        </section>

        <section className="ios-card ios-animate-up space-y-4 p-6" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">
                Upload MSR Spreadsheet (.xlsx)
              </div>
              <p className="max-w-2xl text-xs text-[color:var(--text-secondary)]">
                Parse the Management Summary Report and preview extracted snapshot data before upload.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleMsrParse}
                className="ios-button px-4 py-2 text-xs"
                data-variant="secondary"
                disabled={msrParsing}
              >
                {msrParsing ? 'Parsing...' : 'Parse & Preview'}
              </button>
              <button
                type="button"
                onClick={handleMsrUpload}
                className="ios-button px-4 py-2 text-xs"
                disabled={msrUploading || !msrPreview}
              >
                {msrUploading ? 'Uploading...' : 'Upload to Firebase'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="owner-field-input rounded-2xl px-4 py-2 text-sm"
              list="historical-property-options"
              placeholder="propertyId for MSR upload"
              value={msrPropertyId}
              onChange={(event) => {
                setMsrPropertyId(event.target.value);
                setMsrPreview(null);
                setMsrWarnings([]);
                setMsrExisting(false);
                setMsrOverwrite(false);
                setMsrStatus(null);
              }}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>MSR snapshot updated</span>
              <span>{msrUpdatedAt ?? 'n/a'}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="owner-field-input rounded-2xl px-4 py-2 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[color:var(--surface-muted)] file:px-3 file:py-1 file:text-xs file:text-[color:var(--text-secondary)]"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setMsrFile(file);
                setMsrPreview(null);
                setMsrWarnings([]);
                setMsrExisting(false);
                setMsrOverwrite(false);
                if (!msrPropertyId.trim()) {
                  const detectedId = detectPropertyIdFromFile(file, historicalPropertyOptions);
                  if (detectedId) {
                    setMsrPropertyId(detectedId);
                    setMsrStatus(`Detected propertyId ${detectedId} from file name.`);
                  }
                }
              }}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>Selected file</span>
              <span>{msrFile?.name ?? 'n/a'}</span>
            </div>
          </div>

          {msrExisting ? (
            <label className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
              <input
                type="checkbox"
                checked={msrOverwrite}
                onChange={(event) => setMsrOverwrite(event.target.checked)}
              />
              Overwrite existing snapshot for {msrSnapshot?.reportMonthIso ?? 'this month'}
            </label>
          ) : null}

          {msrPreview ? (
            <div className="ios-list-card space-y-4 p-4 text-xs">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Snapshot metadata</div>
                  <div>Property: {formatPreviewValue(msrSnapshot?.propertyName)}</div>
                  <div>Report date: {formatPreviewValue(msrSnapshot?.reportDate)}</div>
                  <div>Report month: {formatPreviewValue(msrSnapshot?.reportMonthIso)}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-[color:var(--text-primary)]">Sections filled</div>
                  <div className="flex flex-wrap gap-2">
                    {msrSectionEntries.map((entry) => (
                      <span
                        key={entry.key}
                        className="ios-badge text-[10px]"
                        data-tone={entry.ok ? 'green' : 'neutral'}
                      >
                        {entry.label}: {entry.ok ? 'Ready' : 'Missing'}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {msrDataSources ? (
                <div className="ios-list-card space-y-2 p-4 text-xs">
                  <div className="text-[color:var(--text-primary)]">Data sources</div>
                  <div className="text-[color:var(--text-secondary)]">
                    Occupancy summary: {occupancySummarySourceLabel}
                  </div>
                  {msrDataSources.occupancySummarySource === 'occupancy' && msrDataSources.occupancySummaryRows ? (
                    <div className="text-[color:var(--text-secondary)]">
                      Rows: {formatPreviewValue(msrDataSources.occupancySummaryRows.total, 'number')} total /{' '}
                      {formatPreviewValue(msrDataSources.occupancySummaryRows.occupied, 'number')} occupied /{' '}
                      {formatPreviewValue(msrDataSources.occupancySummaryRows.vacant, 'number')} vacant /{' '}
                      {formatPreviewValue(msrDataSources.occupancySummaryRows.offline, 'number')} offline
                    </div>
                  ) : null}
                  <div className="text-[color:var(--text-secondary)]">Leads: {leadsSourceLabel}</div>
                  {msrDataSources.leadsSource === 'msr' ? (
                    <div className="text-[color:var(--text-secondary)]">
                      Leads rows parsed: {formatPreviewValue(msrDataSources.leadsRowCount, 'number')}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {occupancyDiagnostics ? (
                <div className="ios-list-card space-y-2 p-4 text-xs">
                  <div className="text-[color:var(--text-primary)]">Occupancy parser</div>
                  <div className="grid gap-2 sm:grid-cols-2 text-[color:var(--text-secondary)]">
                    <div>Sheet: {formatPreviewValue(occupancyDiagnostics.sheetName)}</div>
                    <div>Header row: {formatPreviewValue(occupancyHeaderRow, 'number')}</div>
                    <div>
                      Space number:{' '}
                      {formatPreviewValue(occupancyDiagnostics.columnMapping?.spaceNumber)}
                    </div>
                    <div>Space type: {formatPreviewValue(occupancyDiagnostics.columnMapping?.spaceType)}</div>
                    <div>Sq ft: {formatPreviewValue(occupancyDiagnostics.columnMapping?.sqft)}</div>
                    <div>Status: {formatPreviewValue(occupancyDiagnostics.columnMapping?.status)}</div>
                    <div>Sell rate: {formatPreviewValue(occupancyDiagnostics.columnMapping?.sellRate)}</div>
                    <div>Current rent: {formatPreviewValue(occupancyDiagnostics.columnMapping?.currentRent)}</div>
                  </div>
                  {occupancyDiagnostics.rowCounts ? (
                    <div className="text-[color:var(--text-secondary)]">
                      Rows: {formatPreviewValue(occupancyDiagnostics.rowCounts.total, 'number')} total /{' '}
                      {formatPreviewValue(occupancyDiagnostics.rowCounts.occupied, 'number')} occupied /{' '}
                      {formatPreviewValue(occupancyDiagnostics.rowCounts.vacant, 'number')} vacant /{' '}
                      {formatPreviewValue(occupancyDiagnostics.rowCounts.offline, 'number')} offline /{' '}
                      {formatPreviewValue(occupancyDiagnostics.rowCounts.unknown, 'number')} unknown
                    </div>
                  ) : null}
                  {occupancyDiagnostics.error ? (
                    <div className="text-red-500">{occupancyDiagnostics.error}</div>
                  ) : null}
                  {occupancyDiagnostics.headerCandidates?.length ? (
                    <div className="space-y-1 text-[10px] text-[color:var(--text-secondary)]">
                      {occupancyDiagnostics.headerCandidates.map((row) => (
                        <div key={row}>{row}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {rentalDiagnostics || leadsDiagnostics ? (
                <div className="ios-list-card space-y-3 p-4 text-xs">
                  <div className="text-[color:var(--text-primary)]">MSR table diagnostics</div>
                  {rentalDiagnostics ? (
                    <div className="space-y-2">
                      <div className="text-[color:var(--text-primary)]">Rental Activity</div>
                      <div className="grid gap-2 sm:grid-cols-2 text-[color:var(--text-secondary)]">
                        <div>Found table: {rentalDiagnostics.tableFound ? 'Yes' : 'No'}</div>
                        <div>Header row: {formatPreviewValue(rentalHeaderRow, 'number')}</div>
                        <div>Label column: {formatIndex(rentalDiagnostics.labelColumnIndex)}</div>
                        <div>MTD column index: {formatIndex(rentalDiagnostics.columnMap?.mtd)}</div>
                        <div>Daily column: {formatColumnSummary(rentalDiagnostics, 'daily')}</div>
                        <div>MTD column: {formatColumnSummary(rentalDiagnostics, 'mtd')}</div>
                        <div>YTD column: {formatColumnSummary(rentalDiagnostics, 'ytd')}</div>
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Detected headers: {formatDetectedHeaders(rentalDiagnostics)}
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Matched row labels: {formatMatchedLabels(rentalDiagnostics)}
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Headers: {formatHeaderList(rentalDiagnostics.headerValues)}
                      </div>
                      {!rentalDiagnostics.tableFound ? (
                        <div className="space-y-1 text-[color:var(--text-secondary)]">
                          <div>No matching KPI table found on MSR sheet.</div>
                          {rentalDiagnostics.candidateTables?.length ? (
                            <div className="space-y-1 text-[10px] text-[color:var(--text-secondary)]">
                              {rentalDiagnostics.candidateTables.map((candidate, index) => (
                                <div key={`${candidate.headerRowIndex}-${index}`}>
                                  {formatCandidateHeaderRow(candidate)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {rentalDiagnostics.extracted ? (
                        <div className="space-y-1 text-[color:var(--text-secondary)]">
                          {Object.entries(rentalDiagnostics.extracted).map(([label, values]) => (
                            <div key={label} className="flex flex-wrap gap-2">
                              <span className="text-[color:var(--text-primary)]">{label}</span>
                              <span>Daily: {formatExtractedValue(label, values.daily)}</span>
                              <span>MTD: {formatExtractedValue(label, values.mtd)}</span>
                              <span>YTD: {formatExtractedValue(label, values.ytd)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {leadsDiagnostics ? (
                    <div
                      className={`space-y-2 ${
                        rentalDiagnostics ? 'border-t border-[color:var(--border-soft)] pt-3' : ''
                      }`}
                    >
                      <div className="text-[color:var(--text-primary)]">Leads</div>
                      <div className="grid gap-2 sm:grid-cols-2 text-[color:var(--text-secondary)]">
                        <div>Found table: {leadsDiagnostics.tableFound ? 'Yes' : 'No'}</div>
                        <div>Header row: {formatPreviewValue(leadsHeaderRow, 'number')}</div>
                        <div>Label column: {formatIndex(leadsDiagnostics.labelColumnIndex)}</div>
                        <div>MTD column index: {formatIndex(leadsDiagnostics.columnMap?.mtd)}</div>
                        <div>Daily column: {formatColumnSummary(leadsDiagnostics, 'daily')}</div>
                        <div>MTD column: {formatColumnSummary(leadsDiagnostics, 'mtd')}</div>
                        <div>YTD column: {formatColumnSummary(leadsDiagnostics, 'ytd')}</div>
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Detected headers: {formatDetectedHeaders(leadsDiagnostics)}
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Matched row labels: {formatMatchedLabels(leadsDiagnostics)}
                      </div>
                      <div className="text-[color:var(--text-secondary)]">
                        Headers: {formatHeaderList(leadsDiagnostics.headerValues)}
                      </div>
                      {!leadsDiagnostics.tableFound ? (
                        <div className="space-y-1 text-[color:var(--text-secondary)]">
                          <div>No matching KPI table found on MSR sheet.</div>
                          {leadsDiagnostics.candidateTables?.length ? (
                            <div className="space-y-1 text-[10px] text-[color:var(--text-secondary)]">
                              {leadsDiagnostics.candidateTables.map((candidate, index) => (
                                <div key={`${candidate.headerRowIndex}-${index}`}>
                                  {formatCandidateHeaderRow(candidate)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {leadsDiagnostics.extracted ? (
                        <div className="space-y-1 text-[color:var(--text-secondary)]">
                          {Object.entries(leadsDiagnostics.extracted).map(([label, values]) => (
                            <div key={label} className="flex flex-wrap gap-2">
                              <span className="text-[color:var(--text-primary)]">{label}</span>
                              <span>Daily: {formatExtractedValue(label, values.daily)}</span>
                              <span>MTD: {formatExtractedValue(label, values.mtd)}</span>
                              <span>YTD: {formatExtractedValue(label, values.ytd)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Occupancy</div>
                  <div>RSF occ %: {formatPreviewValue(msrSnapshot?.occupancy?.rsfOccPct, 'percent')}</div>
                  <div>Space occ %: {formatPreviewValue(msrSnapshot?.occupancy?.spaceOccPct, 'percent')}</div>
                  <div>Occupied count: {formatPreviewValue(msrSnapshot?.occupancy?.occupiedCount, 'number')}</div>
                  <div>Occupied RSF: {formatPreviewValue(msrSnapshot?.occupancy?.occupiedRsf, 'number')}</div>
                  <div>Total RSF: {formatPreviewValue(msrSnapshot?.occupancy?.totalRsf, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Revenue</div>
                  <div>Net revenue MTD: {formatPreviewValue(msrSnapshot?.revenue?.netRevenueMtd, 'currency')}</div>
                  <div>
                    Gross potential rent: {formatPreviewValue(msrSnapshot?.revenue?.grossPotentialRevenue, 'currency')}
                  </div>
                  <div>Economic occupancy: {formatPreviewValue(msrSnapshot?.revenue?.economicOccupancy, 'currency')}</div>
                  <div>Occ variance %: {formatPreviewValue(msrSnapshot?.revenue?.occupiedRateVariancePct, 'percent')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Rentals</div>
                  <div>Move-ins MTD: {formatPreviewValue(msrSnapshot?.rentals?.moveInsMtd, 'number')}</div>
                  <div>Move-outs MTD: {formatPreviewValue(msrSnapshot?.rentals?.moveOutsMtd, 'number')}</div>
                  <div>Net move-ins: {formatPreviewValue(msrSnapshot?.rentals?.netMoveInsMtd, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Leads</div>
                  <div>Total MTD: {formatPreviewValue(msrSnapshot?.leads?.totalMtd, 'number')}</div>
                  <div>
                    Conversion %:{' '}
                    {formatPreviewValue(
                      msrSnapshot?.leads?.conversionRatePctMtd ?? msrSnapshot?.leads?.conversionPct,
                      'percent',
                    )}
                  </div>
                  <div>Web/Walk-in/Phone/Other: {formatPreviewValue(msrSnapshot?.leads?.webMtd, 'number')} / {formatPreviewValue(msrSnapshot?.leads?.walkInMtd, 'number')} / {formatPreviewValue(msrSnapshot?.leads?.phoneMtd, 'number')} / {formatPreviewValue(msrSnapshot?.leads?.otherMtd, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Collections & AR</div>
                  <div>Total past due: {formatPreviewValue(msrSnapshot?.ar?.totalPastDue, 'currency')}</div>
                  <div>61+ past due: {formatPreviewValue(msrSnapshot?.ar?.pastDue61Plus, 'currency')}</div>
                  <div>Delinquent tenants: {formatPreviewValue(msrSnapshot?.ar?.delinquentTenantCount, 'number')}</div>
                  <div>Top delinquencies: {formatPreviewValue(msrSnapshot?.ar?.topDelinquencies?.length, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Overlock</div>
                  <div>Overlocked units: {formatPreviewValue(msrSnapshot?.ar?.overlockedUnitCount, 'number')}</div>
                  <div>Overlock balance: {formatPreviewValue(msrSnapshot?.ar?.overlockTotalBalance, 'currency')}</div>
                  <div>Avg days late: {formatPreviewValue(msrSnapshot?.ar?.overlockAvgDaysLate, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Pricing</div>
                  <div>Sell rate (occ avg): {formatPreviewValue(msrSnapshot?.pricing?.avgSellRateOccupied, 'currency')}</div>
                  <div>Current rent (occ avg): {formatPreviewValue(msrSnapshot?.pricing?.avgCurrentRentOccupied, 'currency')}</div>
                  <div>Rent changes: {formatPreviewValue(msrSnapshot?.pricing?.rentChangeCount, 'number')}</div>
                  <div>Avg change %: {formatPreviewValue(msrSnapshot?.pricing?.avgRentChangePct, 'percent')}</div>
                  <div>No change 12 mo: {formatPreviewValue(msrSnapshot?.pricing?.noRentChange12MoCount, 'number')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Autopay & Coverage</div>
                  <div>Autopay count: {formatPreviewValue(msrSnapshot?.autopay?.enrolledCount, 'number')}</div>
                  <div>Autopay %: {formatPreviewValue(msrSnapshot?.autopay?.enrolledPct, 'percent')}</div>
                  <div>Coverage count: {formatPreviewValue(msrSnapshot?.coverage?.enrolledCount, 'number')}</div>
                  <div>Coverage %: {formatPreviewValue(msrSnapshot?.coverage?.enrolledPct, 'percent')}</div>
                  <div>Coverage premium: {formatPreviewValue(msrSnapshot?.coverage?.premiumSum, 'currency')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Concessions</div>
                  <div>Promos: {formatPreviewValue(msrSnapshot?.concessions?.promosDiscountsMtd, 'currency')}</div>
                  <div>Credits: {formatPreviewValue(msrSnapshot?.concessions?.creditsAdjustmentsMtd, 'currency')}</div>
                  <div>Refunds: {formatPreviewValue(msrSnapshot?.concessions?.refundsMtd, 'currency')}</div>
                  <div>Write-offs: {formatPreviewValue(msrSnapshot?.concessions?.writeOffsMtd, 'currency')}</div>
                </div>

                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Unit Mix</div>
                  <div>
                    Types populated:{' '}
                    {formatPreviewValue(
                      msrSnapshot?.unitMix?.occupiedRsfByType
                        ? Object.keys(msrSnapshot.unitMix.occupiedRsfByType).length
                        : null,
                      'number',
                    )}
                  </div>
                  <div>Vacant sample count: {formatPreviewValue(msrSnapshot?.inventory?.vacantUnitsSample?.length, 'number')}</div>
                </div>
              </div>
            </div>
          ) : null}

          {msrWarnings.length ? (
            <div className="ios-list-card space-y-1 p-4 text-xs">
              <div className="text-[color:var(--text-primary)]">Warnings</div>
              {msrWarnings.map((warning) => (
                <div key={warning} className="text-[color:var(--text-secondary)]">
                  - {warning}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-1 text-[11px]">
            {msrError ? <p className="text-red-500">Error: {msrError}</p> : null}
            {msrStatus ? <p className="text-[color:var(--text-secondary)]">{msrStatus}</p> : null}
          </div>
        </section>

        <section className="ios-card ios-animate-up space-y-4 p-6" data-tone="green">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">
                Upload Monthly Financials Spreadsheet (.xlsx)
              </div>
              <p className="max-w-2xl text-xs text-[color:var(--text-secondary)]">
                Parse a QuickBooks financial package (reads the Profit and Loss tab) and preview monthly Property
                Expenses, Total Expenses, and NOI before upload. Legacy Yardi Budget Comparison exports are still
                accepted for backfilling older months.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleBudgetParse}
                className="ios-button px-4 py-2 text-xs"
                data-variant="secondary"
                disabled={budgetParsing}
              >
                {budgetParsing ? 'Parsing...' : 'Parse & Preview'}
              </button>
              <button
                type="button"
                onClick={handleBudgetUpload}
                className="ios-button px-4 py-2 text-xs"
                disabled={budgetUploading || !budgetPreview}
              >
                {budgetUploading ? 'Uploading...' : 'Upload to Firebase'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="owner-field-input rounded-2xl px-4 py-2 text-sm"
              list="historical-property-options"
              placeholder="propertyId for budget upload"
              value={budgetPropertyId}
              onChange={(event) => {
                setBudgetPropertyId(event.target.value);
                setBudgetPreview(null);
                setBudgetWarnings([]);
                setBudgetExisting(false);
                setBudgetFinancialsExisting(false);
                setBudgetOverwrite(false);
                setBudgetStatus(null);
                setBudgetUpdatedAt(null);
              }}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>Budget snapshot updated</span>
              <span>{budgetUpdatedAt ?? 'n/a'}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="owner-field-input rounded-2xl px-4 py-2 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-[color:var(--surface-muted)] file:px-3 file:py-1 file:text-xs file:text-[color:var(--text-secondary)]"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setBudgetFile(file);
                setBudgetPreview(null);
                setBudgetWarnings([]);
                setBudgetExisting(false);
                setBudgetFinancialsExisting(false);
                setBudgetOverwrite(false);
                setBudgetUpdatedAt(null);
                if (!budgetPropertyId.trim()) {
                  const detectedId = detectPropertyIdFromFile(file, historicalPropertyOptions);
                  if (detectedId) {
                    setBudgetPropertyId(detectedId);
                    setBudgetStatus(`Detected propertyId ${detectedId} from file name.`);
                  }
                }
              }}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>Selected file</span>
              <span>{budgetFile?.name ?? 'n/a'}</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <label className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={budgetFormat === 'l001'}
                  onChange={(event) => {
                    setBudgetFormat(event.target.checked ? 'l001' : 'quickbooks');
                    resetBudgetPreviewState();
                  }}
                />
                L001 owned-property format
              </label>
              <label className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={budgetFormat === 'yardi'}
                  onChange={(event) => {
                    setBudgetFormat(event.target.checked ? 'yardi' : 'quickbooks');
                    resetBudgetPreviewState();
                  }}
                />
                Legacy Yardi Budget Comparison format
              </label>
            </div>
            <p className="pl-6 text-[10px] text-[color:var(--text-secondary)]">
              {budgetFormat === 'l001'
                ? 'Reading the L001 books (Profit and Loss, or the Budget vs. Actuals grid for a Revised Budget v Actual export). Subtotals are labelled "Total ..." and Other Income/Expenses cover interest, depreciation and asset management.'
                : budgetFormat === 'yardi'
                  ? 'Reading the Yardi Budget Comparison sheet (PTD Actual column). NOI is derived from Total Income minus Total Property Expenses.'
                  : 'Default: QuickBooks financial package for managed properties. Reads the Profit and Loss tab, where Net Operating Income is stated directly.'}
            </p>
          </div>

          {budgetExisting && budgetFinancialsExisting ? (
            <label className="flex items-center gap-2 text-xs text-[color:var(--text-secondary)]">
              <input
                type="checkbox"
                checked={budgetOverwrite}
                onChange={(event) => setBudgetOverwrite(event.target.checked)}
              />
              Overwrite existing financials for {budgetSnapshot?.reportMonthIso ?? 'this month'}
            </label>
          ) : null}

          {budgetPreview ? (
            <div className="ios-list-card space-y-4 p-4 text-xs">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Snapshot metadata</div>
                  <div>Property: {formatPreviewValue(budgetSnapshot?.propertyName)}</div>
                  <div>Report month: {formatPreviewValue(budgetSnapshot?.reportMonthIso)}</div>
                  <div>Source sheet: {formatPreviewValue(budgetPreview.sourceSheet)}</div>
                  <div>Detected format: {formatPreviewValue(budgetFormatLabel)}</div>
                  {budgetEntityName ? (
                    <div>
                      Entity: {formatPreviewValue(budgetEntityName)}
                      <div className="text-[10px]">
                        Owning entity from the sheet header. The configured property name is kept.
                      </div>
                    </div>
                  ) : null}
                  {budgetTotalIncomeValue != null || budgetNetIncomeValue != null ? (
                    <div className="pt-1">
                      Total Income: {formatBudgetPreviewCurrency(budgetTotalIncomeValue)}
                      {budgetOtherIncomeValue != null
                        ? ` | Other Income: ${formatBudgetPreviewCurrency(budgetOtherIncomeValue)}`
                        : ''}
                      {budgetNetIncomeValue != null
                        ? ` | Net Income: ${formatBudgetPreviewCurrency(budgetNetIncomeValue)}`
                        : ''}
                      <div className="text-[10px]">Shown for verification; only expenses and NOI are saved.</div>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <div className="text-[color:var(--text-primary)]">Upload target</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="ios-badge text-[10px]" data-tone={budgetExisting ? 'blue' : 'neutral'}>
                      Month exists: {budgetExisting ? 'Yes' : 'No'}
                    </span>
                    <span
                      className="ios-badge text-[10px]"
                      data-tone={budgetFinancialsExisting ? 'amber' : 'green'}
                    >
                      Existing financials: {budgetFinancialsExisting ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="ios-list-card space-y-2 p-4 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Property Expenses</div>
                  <div>
                    Value:{' '}
                    {formatBudgetPreviewCurrency(budgetPropertyExpensesValue)}
                  </div>
                  <div>
                    Definition:{' '}
                    {budgetPreview.format === 'quickbooks'
                      ? 'Total for Expenses (operating)'
                      : 'Total Property Expenses'}
                  </div>
                  <div>Used in NOI: Yes</div>
                  <div>Token: {formatPreviewValue(budgetSources?.propertyExpenses?.token)}</div>
                  <div>Source: {formatPreviewValue(budgetSources?.propertyExpenses?.sheet)}</div>
                  <div>Cell: {formatPreviewValue(budgetSources?.propertyExpenses?.cell)}</div>
                </div>
                <div className="ios-list-card space-y-2 p-4 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">Total Expenses</div>
                  <div>Value: {formatBudgetPreviewCurrency(budgetTotalExpensesValue)}</div>
                  <div>Definition: Total Property Expenses + Other Expenses</div>
                  <div>Other Expenses: {formatBudgetPreviewCurrency(budgetOtherExpensesValue)}</div>
                  <div>Used in NOI: No</div>
                  <div>Token: {formatPreviewValue(budgetSources?.totalExpenses?.token)}</div>
                  <div>Source: {formatPreviewValue(budgetSources?.totalExpenses?.sheet)}</div>
                  <div>Cell: {formatPreviewValue(budgetSources?.totalExpenses?.cell)}</div>
                </div>
                <div className="ios-list-card space-y-2 p-4 text-[color:var(--text-secondary)]">
                  <div className="text-[color:var(--text-primary)]">NOI</div>
                  <div>
                    Value: {formatBudgetPreviewCurrency(budgetNoiValue)}
                  </div>
                  <div>Method: {formatPreviewValue(budgetSources?.noi?.formula ?? 'Calculated')}</div>
                  <div>
                    Read directly: {budgetSources?.noi?.fallback === false ? 'Yes' : 'No (derived)'}
                  </div>
                  <div>Expense basis: Property Expenses only</div>
                  <div>Inputs: {formatPreviewValue(budgetSources?.noi?.token)}</div>
                  <div>Source: {formatPreviewValue(budgetSources?.noi?.sheet)}</div>
                  <div>Cell(s): {formatPreviewValue(budgetSources?.noi?.cell)}</div>
                </div>
              </div>

              <div className="space-y-1 text-[color:var(--text-secondary)]">
                <div>
                  Preview math:{' '}
                  {budgetSources?.noi?.formula ?? 'NOI = Total Income - Total Property Expenses'}. Other Expenses stay
                  out of NOI and are only included in Total Expenses.
                </div>
                {budgetExisting
                  ? budgetFinancialsExisting
                    ? 'Upload will replace the existing financials for this month if overwrite is enabled.'
                    : 'Upload will merge these financials into the existing month snapshot.'
                  : 'Upload will create a new financials-only snapshot for this month.'}
              </div>
            </div>
          ) : null}

          {budgetWarnings.length ? (
            <div className="ios-list-card space-y-1 p-4 text-xs">
              <div className="text-[color:var(--text-primary)]">Warnings</div>
              {budgetWarnings.map((warning) => (
                <div key={warning} className="text-[color:var(--text-secondary)]">
                  - {warning}
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-1 text-[11px]">
            {budgetError ? <p className="text-red-500">Error: {budgetError}</p> : null}
            {budgetStatus ? <p className="text-[color:var(--text-secondary)]">{budgetStatus}</p> : null}
          </div>
        </section>

        <section className="ios-card ios-animate-up space-y-4 p-6" data-tone="amber">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Historical data JSON</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Required: historicalByRange with 3M, 6M, 1Y, and 2Y. Optional: momSeries or momSeriesByProperty.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadTemplate}
                className="ios-button px-4 py-2 text-xs"
                data-variant="secondary"
              >
                Load template
              </button>
              <button type="button" onClick={handleUpload} className="ios-button px-4 py-2 text-xs" disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Upload to Firebase'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="owner-field-input rounded-2xl px-4 py-2 text-sm"
              list="historical-property-options"
              placeholder="propertyId"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>Last updated</span>
              <span>{lastUpdatedAt ?? 'n/a'}</span>
            </div>
          </div>

          <HistoricalJsonEditor
            value={dataInput}
            onDraftChange={handleDataDraftChange}
            onCommit={handleDataCommit}
          />

          {validationSummary ? (
            <div className="ios-list-card space-y-2 p-4 text-xs">
              <div className="text-[color:var(--text-primary)]">
                Validation: {validationSummary.ok ? 'OK' : 'Errors found'}
              </div>
              <div className="text-[color:var(--text-secondary)]">
                Months per range: 3M={validationSummary.summary.rangeMonthCounts['3M'] ?? 0}, 6M={
                  validationSummary.summary.rangeMonthCounts['6M'] ?? 0
                }, 1Y={validationSummary.summary.rangeMonthCounts['1Y'] ?? 0}, 2Y={
                  validationSummary.summary.rangeMonthCounts['2Y'] ?? 0
                }
              </div>
              {validationSummary.summary.momSeriesLength !== undefined ? (
                <div className="text-[color:var(--text-secondary)]">
                  momSeries length: {validationSummary.summary.momSeriesLength}
                </div>
              ) : null}
              {validationSummary.errors.length ? (
                <div className="space-y-1 text-red-500">
                  {validationSummary.errors.map((error) => (
                    <div key={error}>- {error}</div>
                  ))}
                </div>
              ) : null}
              {validationSummary.warnings.length ? (
                <div className="space-y-1 text-[color:var(--text-secondary)]">
                  {validationSummary.warnings.map((warning) => (
                    <div key={warning}>- {warning}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1 text-[11px]">
            {dataError ? <p className="text-red-500">Error: {dataError}</p> : null}
            {dataStatus ? <p className="text-[color:var(--text-secondary)]">{dataStatus}</p> : null}
          </div>

          <div className="ios-list-card space-y-2 p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[color:var(--text-primary)]">Template JSON</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplate((prev) => !prev);
                    setTemplateStatus(null);
                  }}
                  className="ios-button px-3 py-1 text-[10px]"
                  data-variant="ghost"
                >
                  {showTemplate ? 'Hide template' : 'Show template'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyTemplate}
                  className="ios-button px-3 py-1 text-[10px]"
                  data-variant="ghost"
                >
                  Copy template
                </button>
              </div>
            </div>
            <div className="text-[color:var(--text-secondary)]">
              {templateStatus ?? (showTemplate ? 'Previewing template.' : 'Use Show template to preview.')}
            </div>
            {showTemplate ? (
              <pre className="max-h-80 overflow-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-[11px] text-[color:var(--text-secondary)]">
                {templateString}
              </pre>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

