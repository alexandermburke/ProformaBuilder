/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import {
  getHistoricalTemplatePayload,
  parsePropertyHistoricalInput,
  validatePropertyHistoricalPayload,
} from '@/lib/historical/dataInput';
import { PROPERTY_OPTIONS } from '@/lib/propertyDirectory';

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

type MsrPreviewResponse = {
  snapshot: MsrPreviewSnapshot;
  warnings: string[];
  sections: Record<string, boolean>;
  exists: boolean;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('en-US');

const formatPreviewValue = (value: unknown, kind: 'currency' | 'percent' | 'number' | 'text' = 'text'): string => {
  if (value == null || value === '') return 'N/A';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'N/A';
  if (kind === 'currency' && typeof value === 'number') return currencyFormatter.format(value);
  if (kind === 'percent' && typeof value === 'number') return `${value.toFixed(1)}%`;
  if (kind === 'number' && typeof value === 'number') return numberFormatter.format(Math.round(value));
  return String(value);
};

const normalizePropertyToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const resolvePropertyIdFromLabel = (label: string): string | null => {
  const normalized = normalizePropertyToken(label);
  if (!normalized) return null;
  const match = PROPERTY_OPTIONS.find((option) => {
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

const detectPropertyIdFromFile = (file: File | null): string | null => {
  if (!file) return null;
  const { propertyLabel } = parseMsrFilename(file.name);
  if (propertyLabel) {
    const fromLabel = resolvePropertyIdFromLabel(propertyLabel);
    if (fromLabel) return fromLabel;
  }
  const normalizedName = normalizePropertyToken(file.name);
  const match = PROPERTY_OPTIONS.find((option) => normalizedName.includes(normalizePropertyToken(option.id)));
  return match?.id ?? null;
};
export default function HistoricalDataUploadPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [propertyId, setPropertyId] = useState('');
  const [dataInput, setDataInput] = useState('');
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

  const templateString = useMemo(() => JSON.stringify(getHistoricalTemplatePayload(), null, 2), []);

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';
  const msrSnapshot = msrPreview?.snapshot;
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

  const handleLoadTemplate = () => {
    setDataInput(templateString);
    setDataError(null);
    setDataStatus('Template loaded. Update values and upload to Firebase.');
    setValidationSummary(null);
  };

  const handleCopyTemplate = async () => {
    setTemplateStatus(null);
    try {
      await navigator.clipboard.writeText(templateString);
      setTemplateStatus('Template copied.');
    } catch {
      setTemplateStatus('Copy failed.');
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

  const handleValidate = () => {
    setDataError(null);
    setDataStatus(null);
    if (!dataInput.trim()) {
      setDataError('Paste JSON or load the template first.');
      return null;
    }
    const parsed = parsePropertyHistoricalInput(dataInput, propertyId.trim() || undefined);
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
        <header className="ios-card ios-animate-up space-y-4 p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <span className="ios-badge text-[10px]">Historical data upload</span>
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                Upload historical data to Firebase
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                Paste the JSON payload for a single property. Data is validated before upload.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/historical-data" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
                Back to historical data
              </Link>
              <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                Directory
              </Link>
            </div>
          </div>
        </header>

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
                  const detectedId = detectPropertyIdFromFile(file);
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
                  <div>Conversion %: {formatPreviewValue(msrSnapshot?.leads?.conversionPct, 'percent')}</div>
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

        <section className="ios-card ios-animate-up space-y-4 p-6" data-tone="amber">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Historical data JSON</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Required: historicalByRange with 3M, 6M, 12M. Optional: momSeries or momSeriesByProperty.
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
              placeholder="propertyId"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            />
            <div className="flex items-center justify-between rounded-2xl border border-dashed border-[color:var(--border-soft)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
              <span>Last updated</span>
              <span>{lastUpdatedAt ?? 'n/a'}</span>
            </div>
          </div>

          <textarea
            className="owner-field-input min-h-[320px] w-full resize-y rounded-2xl p-4 font-mono text-[11px] text-[color:var(--text-primary)] shadow-inner focus:outline-none"
            placeholder="Paste the historical data JSON payload here."
            value={dataInput}
            onChange={(event) => setDataInput(event.target.value)}
            spellCheck={false}
          />

          {validationSummary ? (
            <div className="ios-list-card space-y-2 p-4 text-xs">
              <div className="text-[color:var(--text-primary)]">
                Validation: {validationSummary.ok ? 'OK' : 'Errors found'}
              </div>
              <div className="text-[color:var(--text-secondary)]">
                Months per range: 3M={validationSummary.summary.rangeMonthCounts['3M'] ?? 0}, 6M={
                  validationSummary.summary.rangeMonthCounts['6M'] ?? 0
                }, 12M={validationSummary.summary.rangeMonthCounts['12M'] ?? 0}
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

