'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { JSX } from 'react';
import React from 'react';

import UploadZone from '@/components/UploadZone';
import HeaderMapper from '@/components/HeaderMapper';
import { useTheme } from '@/components/ThemeProvider';

import { parseExcelFile } from '@/lib/parseExcel';
import type { ParsedSheet, UploadParseResult } from '@/lib/types';
import { subscribeSnapshots, createSnapshotRow } from '@/lib/snapshots';

import {
  HeaderMapping,
  WizardStep,
  SnapshotDetail,
  SnapshotRowLite,
} from '@/lib/types';

import {
  saveSnapshotDetail,
  loadFacilityAssumptions,
  saveFacilityAssumptions,
} from '@/lib/storage';
import { computeTotalsFromSeries, computeTotalsFromSheet } from '@/lib/compute';

import {
  autoMapRequiredFields,
  detectFacilityPeriodFromFileName,
  detectVendor,
  learnMappings,
  type AutoOptions,
  type SuggestionsByField,
} from '@/lib/automation';
import type { RequiredField } from '@/lib/coa';

import type { Assumptions, LineAssumption, Method } from '@/lib/assumptions';
import { computeSeriesFromAssumptions } from '@/lib/assumptions';

const steps: string[] = ['Upload', 'Map', 'Validate', 'Generate', 'Export'];
const CORE_FIELDS: RequiredField[] = [
  'Total Operating Income',
  'Total Operating Expense',
  'Facility',
  'Period',
];
const EXTENDED_FIELDS: RequiredField[] = [
  'Gross Potential Income',
  'Net Operating Income',
  'Discounts',
  'Bad Debt/Rental Refunds',
  'Current Management Fees (5.25%)',
  'STORE Tenant Protection Split',
];
const MAPPABLE_FIELDS: RequiredField[] = [...CORE_FIELDS, ...EXTENDED_FIELDS];
const requiredFields: RequiredField[] = [...MAPPABLE_FIELDS];

function createEmptySuggestions(): SuggestionsByField {
  const base = {} as SuggestionsByField;
  MAPPABLE_FIELDS.forEach((field) => {
    base[field] = null;
  });
  return base;
}

function clampStep(n: number): WizardStep {
  if (n <= 0) return 0;
  if (n >= 4) return 4;
  return n as WizardStep;
}

const defaultAssumptions: Assumptions = {
  rentalIncome: { method: 'Latest', growthPct: 0.005 },
  discounts: { method: 'PercentOfRevenue', percent: -0.01 },
  badDebt: { method: 'PercentOfRevenue', percent: -0.02 },
  mgmtFee: { method: 'PercentOfRevenue', percent: 0.04 },
  opExTotal: { method: 'T12Avg', growthPct: 0.003 },
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '$0';
  return currencyFormatter.format(Math.round(value));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const pct = Math.abs(value) * 100;
  const decimals = pct < 10 ? 1 : 0;
  return `${sign}${pct.toFixed(decimals)}%`;
}

/* ----------------------- month + value utils ----------------------------- */

function excelSerialToDate(n: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const ms = Math.round(n * 86400 * 1000);
  return new Date(epoch.getTime() + ms);
}

function normalizeMonth(v: unknown): string {
  const asFmt = (d: Date) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
      .format(d)
      .replace(' ', '-')
      .toLowerCase();

  if (v instanceof Date) return asFmt(v);

  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return asFmt(excelSerialToDate(v));
  }

  if (typeof v === 'string') {
    const s = v.trim();

    let m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})$/i);
    if (m) return `${m[1].slice(0, 3).toLowerCase()}-${m[2]}`;

    m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s]?(\d{2})$/i);
    if (m) return `${m[1].slice(0, 3).toLowerCase()}-20${m[2]}`;

    m = s.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) {
      const mm = Number(m[1]) - 1;
      const y = m[2];
      const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][mm];
      if (mon) return `${mon}-${y}`;
    }

    m = s.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
      const y = m[1];
      const mm = Number(m[2]) - 1;
      const mon = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][mm];
      if (mon) return `${mon}-${y}`;
    }
  }
  return '';
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[\s$,()]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function baseNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/* --------------------- series extraction (grid-based) -------------------- */

type AnySheet = UploadParseResult['sheets'][number] & { grid?: unknown[][] };

/** Find 12-month band anywhere in grid */
function findMonthBand(grid: unknown[][]): { row: number; startCol: number; labels: string[] } | null {
  if (!grid?.length) return null;
  for (let r = 0; r < Math.min(grid.length, 160); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c <= Math.max(0, row.length - 12); c++) {
      const labels: string[] = [];
      for (let k = 0; k < 12; k++) {
        const norm = normalizeMonth(row[c + k]);
        if (!norm) {
          labels.length = 0;
          break;
        }
        labels.push(norm);
      }
      if (labels.length === 12) {
        // quick sequentiality check
        const idxs = labels
          .map((s) => s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{4})$/))
          .map((m) => (m ? Number(m[2]) * 12 + ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1]) : null));
        if (idxs.every((x) => x !== null)) {
          let ok = 0;
          for (let i = 1; i < idxs.length; i++) if ((idxs[i] as number) - (idxs[i - 1] as number) === 1) ok++;
          if (ok >= 9) return { row: r, startCol: c, labels };
        }
      }
    }
  }
  return null;
}

/** Heuristic: choose label column to the left with many text cells below */
function chooseLabelCol(grid: unknown[][], bandRow: number, startCol: number): number | null {
  if (!grid?.length) return null;
  for (let c = startCol - 1; c >= 0; c--) {
    let textCount = 0;
    for (let r = bandRow + 1; r < Math.min(grid.length, bandRow + 80); r++) {
      const v = grid[r]?.[c];
      if (typeof v === 'string' && v.trim().length > 0) textCount++;
    }
    if (textCount >= 5) return c;
  }
  return null;
}

/** Build label -> 12 values from the *best* sheet */
function extractSeriesByLabelFromParsed(parsed: UploadParseResult): {
  sheetName: string | null;
  seriesByLabel: Record<string, number[]>;
} {
  const sheets = (parsed?.sheets ?? []) as AnySheet[];

  for (const s of sheets) {
    const grid = s.grid ?? [];
    const band = findMonthBand(grid);
    if (!band) continue;

    const labelCol = chooseLabelCol(grid, band.row, band.startCol);
    if (labelCol == null) continue;

    const out: Record<string, number[]> = {};
    const stopLabels = new Set(['income', 'expenses']); // section headers to skip if empty

    for (let r = band.row + 1; r < Math.min(grid.length, band.row + 200); r++) {
      const rawLabel = grid[r]?.[labelCol];
      const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
      if (!label) continue;

      const values = new Array(12).fill(0).map((_, i) => toNum(grid[r]?.[band.startCol + i]));
      const hasAny = values.some((n) => n !== 0);

      // skip pure headers with no values
      const norm = baseNormalize(label);
      if (!hasAny && stopLabels.has(norm)) continue;

      if (hasAny) out[label] = values;
    }

    const count = Object.keys(out).length;
    console.log('[series] built from sheet', {
      name: s.name,
      bandRow: band.row,
      startCol: band.startCol,
      labelCol,
      rows: count,
      months: band.labels,
    });

    if (count > 0) {
      return { sheetName: s.name, seriesByLabel: out };
    }
  }

  console.log('[series] failed to detect any month band in available sheets');
  return { sheetName: null, seriesByLabel: {} };
}

/* ------------------------------------------------------------------------- */

export default function Home(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.26),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.14),transparent_60%)]';
  const [step, setStep] = React.useState<WizardStep>(0);

  const [parseResult, setParseResult] = React.useState<UploadParseResult | null>(null);
  const [mapper, setMapper] = React.useState<HeaderMapping>({});
  const [validateMsg, setValidateMsg] = React.useState<string>('');

  const [facility, setFacility] = React.useState<string>('Tempe I-10.8.Warner');
  const [period, setPeriod] = React.useState<string>('Jul 2025');

  const [recent, setRecent] = React.useState<SnapshotRowLite[]>([]);

  const [suggestions, setSuggestions] = React.useState<SuggestionsByField>(() => createEmptySuggestions());
  const [auto, setAuto] = React.useState<AutoOptions>({
    vendorHint: null,
    autoDetectFacilityPeriod: true,
    autoMap: true,
    threshold: 0.88,
  });

  const [assumptions, setAssumptions] = React.useState<Assumptions>(defaultAssumptions);
  const [seriesPreview, setSeriesPreview] = React.useState<null | {
    rentalIncome: number[];
    discounts: number[];
    badDebt: number[];
    mgmtFee: number[];
    opExTotal: number[];
    toi: number[];
    toe: number[];
    noi: number[];
  }>(null);
  const [previewNoi, setPreviewNoi] = React.useState<number>(134230);

  React.useEffect(() => {
    const unsub = subscribeSnapshots(
      (rows) => {
        const next = rows.slice(0, 4);
        console.log('[recent] firestore updated', { count: next.length, ids: next.map((r) => r.id) });
        setRecent(next);
      },
      12
    );
    return () => unsub();
  }, []);

  React.useEffect(() => {
    const saved = loadFacilityAssumptions(facility);
    if (saved) {
      console.log('[assump] loaded defaults', saved);
      setAssumptions(saved);
    }
  }, [facility]);

  const previewStats = React.useMemo(() => {
    if (!seriesPreview) {
      return [
        {
          key: 'noiRunRate',
          label: 'Monthly NOI Run Rate',
          value: formatCurrency(previewNoi),
          caption: 'Preview series will update this once you model assumptions.',
        },
        {
          key: 'facility',
          label: 'Facility',
          value: facility || 'Not set',
          caption: 'Appears in the export header and recent snapshots.',
        },
        {
          key: 'period',
          label: 'Reporting Period',
          value: period || 'Not set',
          caption: 'Used for export filenames and downstream analytics.',
        },
        {
          key: 'nextStep',
          label: 'Next Action',
          value: step < 1 ? 'Upload data' : step < 3 ? 'Validate mappings' : 'Generate snapshot',
          caption: 'Complete each wizard step to unlock the export buttons.',
        },
      ];
    }

    const totals = computeTotalsFromSeries(seriesPreview.toi, seriesPreview.toe);
    const latestNoi = seriesPreview.noi[seriesPreview.noi.length - 1] ?? 0;
    const firstNoi = seriesPreview.noi[0] ?? latestNoi;
    const noiTrend = firstNoi !== 0 ? (latestNoi - firstNoi) / Math.abs(firstNoi) : 0;
    const expenseRatio = totals.totalOperatingIncome !== 0
      ? totals.totalOperatingExpense / totals.totalOperatingIncome
      : 0;

    return [
      {
        key: 'noiRunRate',
        label: 'Monthly NOI Run Rate',
        value: formatCurrency(latestNoi),
        caption: 'Last modeled month (M12).',
      },
      {
        key: 'noiAnnual',
        label: '12-Month NOI',
        value: formatCurrency(totals.noi),
        caption: 'Sum of modeled NOI across the band.',
      },
      {
        key: 'noiTrend',
        label: 'Trend vs M1',
        value: formatPercent(noiTrend),
        caption: 'Change between the first and last modeled months.',
      },
      {
        key: 'expenseRatio',
        label: 'Expense Ratio',
        value: formatPercent(expenseRatio),
        caption: 'Total operating expense / income over the band.',
      },
    ];
  }, [seriesPreview, previewNoi, facility, period, step]);

  const stepGuidance = React.useMemo(() => {
    const missing = CORE_FIELDS.filter((field) => !mapper[field]);
    const mappedCount = CORE_FIELDS.length - missing.length;

    switch (step) {
      case 0:
        return {
          tone: 'neutral' as const,
          title: 'Upload checklist',
          items: [
            'Drop a monthly P&L export (.xlsx or .xls).',
            'Filenames that include facility + period help auto-detect metadata.',
            'We only read the first sheet-remove cover tabs to speed things up.',
          ],
        };
      case 1:
        return {
          tone: missing.length ? ('warn' as const) : ('neutral' as const),
          title: 'Map the required fields',
          items: [
            `Mapped ${mappedCount}/${CORE_FIELDS.length} required fields.`,
            'Use "Apply All" to accept high-confidence suggestions.',
            missing.length
              ? `Still to map: ${missing.join(', ')}.`
              : 'All required fields are mapped.',
          ],
          meta: auto.vendorHint ? `Vendor hint: ${auto.vendorHint}` : undefined,
        };
      case 2:
        return {
          tone: validateMsg.includes('Please') ? ('warn' as const) : ('neutral' as const),
          title: 'Validation step',
          items: [
            'Run the quick check to confirm TOI/TOE/Facility/Period look good.',
            'Resolve any flagged fields before generating assumptions.',
            'Validation learns vendor mappings for the next upload.',
          ],
        };
      case 3:
        return {
          tone: 'neutral' as const,
          title: 'Tuning assumptions',
          items: [
            'Adjust revenue assumptions to reflect expected rate changes.',
            'Preview the series to confirm NOI trend before saving.',
            'Generate snapshot to push totals to the right-rail and storage.',
          ],
        };
      case 4:
        return {
          tone: 'neutral' as const,
          title: 'Review & export',
          items: [
            'Scan the metrics below for reasonableness.',
            'Download the Excel proforma or share a PDF with owners.',
            recent.length ? 'Recent snapshots refresh automatically in the right rail.' : 'First export will populate recent snapshots.',
          ],
        };
      default:
        return null;
    }
  }, [step, mapper, validateMsg, auto.vendorHint, recent.length]);

  const onFile = async (file: File): Promise<void> => {
    const parsed = await parseExcelFile(file);
    setParseResult(parsed);

    const first: ParsedSheet | undefined = parsed.sheets[0];
    const vendor = first ? detectVendor(parsed.fileName, first) : 'Unknown';
    const vendorHint = vendor === 'Unknown' ? null : vendor;
    setAuto((a) => ({ ...a, vendorHint }));

    if (auto.autoDetectFacilityPeriod) {
      const guess = detectFacilityPeriodFromFileName(parsed.fileName);
      if (guess.facility) setFacility(guess.facility);
      if (guess.period) setPeriod(guess.period);
    }

    const headers = first?.headers ?? [];
    const { mapping, suggestions: sug } = autoMapRequiredFields(
      MAPPABLE_FIELDS,
      headers,
      { vendorHint, autoDetectFacilityPeriod: auto.autoDetectFacilityPeriod, autoMap: auto.autoMap, threshold: auto.threshold }
    );
    setMapper((m) => ({ ...m, ...mapping }));
    setSuggestions(sug);
    console.log('[wizard] auto mapping result', { mapping, vendor: vendorHint });

    setStep(1);
  };

  const prev = (): void => setStep((s): WizardStep => clampStep(Number(s) - 1));

  const applyAllSuggestions = (): void => {
    const nextMap: HeaderMapping = { ...mapper };
    (Object.keys(suggestions) as Array<keyof SuggestionsByField>).forEach((k) => {
      const s = suggestions[k];
      if (s && !nextMap[k]) nextMap[k] = s.header;
    });
    console.log('[mapper] applied all suggestions', nextMap);
    setMapper(nextMap);
  };

  const validate = (): void => {
    const missing = CORE_FIELDS.filter((r) => !mapper[r]);
    if (missing.length) {
      setValidateMsg(`Please map: ${missing.join(', ')}`);
      console.log('[validate] failed', { missing });
      return;
    }
    setValidateMsg('Checks passed. Continue to Generate.');
    console.log('[validate] ok', { mapper });
    learnMappings(mapper, auto.vendorHint ?? 'Unknown');
    setStep(3);
  };

  const buildPreviewSeries = (): void => {
    const rev = new Array(12).fill(
      assumptions.rentalIncome.method === 'PercentOfRevenue' ? 100_000 : 120_000,
    );
    const ctx = { revenueT12: rev };
    const out = computeSeriesFromAssumptions(assumptions, ctx);
    setSeriesPreview(out);
    setPreviewNoi(out.noi[11]);
    console.log('[assump] preview series ready', out);
  };

  const generateSnapshot = async (): Promise<void> => {
    if (!parseResult || !parseResult.sheets.length) {
      console.log('[generate] no parsed sheet available');
      return;
    }

    const { sheetName, seriesByLabel } = extractSeriesByLabelFromParsed(parseResult);

    const sheet0 = parseResult.sheets[0];
    const totals = computeTotalsFromSheet(sheet0, mapper);

    const id = `SNAP-${Math.floor(Math.random() * 9000 + 1000)}`;
    const row: SnapshotRowLite = {
      id,
      facility,
      period,
      noi: seriesPreview ? seriesPreview.noi[11] : totals.noi,
      createdBy: 'User',
      createdAt: new Date().toISOString(),
    };
    const detail: SnapshotDetail = {
      id,
      facility,
      period,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      sourceFile: parseResult.fileName,
      mapping: mapper,
      seriesByLabel,
      extracted: { fromSheet: sheetName ?? sheet0.name ?? 'Unknown', sampleCount: sheet0.rows.length ?? 0 },
      totals: {
        totalOperatingIncome: seriesPreview
          ? seriesPreview.toi.reduce((a, b) => a + b, 0)
          : totals.totalOperatingIncome,
        totalOperatingExpense: seriesPreview
          ? seriesPreview.toe.reduce((a, b) => a + b, 0)
          : totals.totalOperatingExpense,
        noi: seriesPreview
          ? seriesPreview.noi.reduce((a, b) => a + b, 0)
          : totals.noi,
      },
    };

    saveSnapshotDetail(detail);
    saveFacilityAssumptions(facility, assumptions);

    try {
      const ok = await createSnapshotRow(row);
      if (!ok) console.warn('[generate] Firestore write failed; continuing in offline mode');
    } catch (e) {
      console.warn('[generate] Firestore write exception; continuing offline', e);
    }

    setRecent((r) => [row, ...r].slice(0, 4));
    console.log('[generate] snapshot row+detail', {
      id: row.id,
      seriesKeys: Object.keys(seriesByLabel),
      fromSheet: sheetName,
    });
  };

  const onExportExcel = async (): Promise<void> => {
    const latest = recent[0];
    if (!latest) {
      alert('No snapshot yet. Generate first.');
      return;
    }

    const detailKey = `store-demo-snapshot:${latest.id}`;
    const raw = localStorage.getItem(detailKey);
    if (!raw) {
      alert('Snapshot detail not found.');
      return;
    }
    const detail = JSON.parse(raw) as SnapshotDetail;

    let seriesByLabel = detail.seriesByLabel || {};
    if (!seriesByLabel || Object.keys(seriesByLabel).length === 0) {
      const parsed = parseResult;
      if (parsed) {
        const res = extractSeriesByLabelFromParsed(parsed);
        seriesByLabel = res.seriesByLabel;
        console.log('[export] filled empty seriesByLabel from parsed grid', {
          keys: Object.keys(seriesByLabel).slice(0, 12),
          count: Object.keys(seriesByLabel).length,
        });
      }
    }

    const seriesForExport =
      seriesPreview ??
      (() => {
        const rev = new Array(12).fill(
          assumptions.rentalIncome.method === 'PercentOfRevenue' ? 100_000 : 120_000,
        );
        const out = computeSeriesFromAssumptions(assumptions, { revenueT12: rev });
        setSeriesPreview(out);
        return out;
      })();

    console.log('[ui] Export Proforma (.xlsx) clicked', {
      id: detail.id,
      facility: detail.facility,
      period: detail.period,
      hasSeriesByLabel: Boolean(seriesByLabel && Object.keys(seriesByLabel).length),
    });

    const res = await fetch('/api/export/proforma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: detail.id,
        facility: detail.facility,
        period: detail.period,
        totals: detail.totals,
        series: seriesForExport,
        seriesByLabel,
      }),
    });

    if (!res.ok) {
      console.log('[export] failed', { status: res.status });
      alert('Export failed.');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Proforma_${detail.facility.replace(/\s+/g, '_')}_${detail.period.replace(/\s+/g, '-')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    console.log('[export] download triggered');
  };

  const onSaveOwnerPdf = (): void => {
    console.log('[ui] Save Owner PDF clicked');
    alert('Prototype: owner PDF would download here.');
  };

  const currentStepIndex = step;

  function labelWithAcronym(label: string): JSX.Element {
    const map: Record<string, string> = {
      toi: 'Total Operating Income',
      toe: 'Total Operating Expense',
      noi: 'Net Operating Income',
      gpi: 'Gross Potential Income',
      ecri: 'Existing Customer Rate Increase',
      nsc: 'National Sales Center',
    };
    const lower = label.toLowerCase();
    const title = map[lower];
    if (!title) return <>{label}</>;
    return <abbr title={title}>{label}</abbr>;
  }

  function AssumptionRow(props: {
    label: string;
    value: LineAssumption;
    onChange(next: LineAssumption): void;
  }): JSX.Element {
    const { label, value, onChange } = props;
    const setMethod = (m: Method): void => onChange({ ...value, method: m });
    return (
      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,180px)_minmax(0,300px)]">
        <div className="truncate text-sm text-[#111827]">{labelWithAcronym(label)}</div>
        <select
          className="h-10 rounded-xl border border-white/20 bg-white/90 px-3 text-sm text-[color:var(--text-primary)] shadow-sm transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
          value={value.method}
          onChange={(e) => setMethod(e.target.value as Method)}
          title="Method used to compute this line"
        >
          <option>Latest</option>
          <option>T12Avg</option>
          <option>PercentOfRevenue</option>
          <option>Growth</option>
        </select>
        <div className="flex flex-wrap gap-2">
          {value.method === 'PercentOfRevenue' && (
            <input
              type="number"
              step="0.001"
              className="h-10 w-36 rounded-xl border border-white/20 bg-white/90 px-3 text-sm text-[color:var(--text-primary)] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
              placeholder="Percent (0.04)"
              value={value.percent ?? ''}
              onChange={(e) => onChange({ ...value, percent: Number(e.target.value) })}
              title="Fraction of revenue (e.g., 0.04 = 4%)"
            />
          )}
          {(value.method === 'PercentOfRevenue' || value.method === 'Growth') && (
            <input
              type="number"
              step="0.001"
              className="h-10 w-36 rounded-xl border border-white/20 bg-white/90 px-3 text-sm text-[color:var(--text-primary)] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
              placeholder="Growth (0.005)"
              value={value.growthPct ?? ''}
              onChange={(e) => onChange({ ...value, growthPct: Number(e.target.value) })}
              title="Monthly growth rate (e.g., 0.005 = 0.5%)"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="proforma-page relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 ${overlayBottom}`} />
      <div className="relative mx-auto max-w-[1440px] px-6 py-10 lg:px-10 lg:py-14">
        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6 lg:gap-8">
          {/* Sidebar */}
          <aside className="owner-card rounded-2xl border border-white/25 bg-white/85 shadow-lg backdrop-blur-md">
            <div className="space-y-6 px-6 py-7">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.35em] text-[#2563EB]">Store</div>
                  <div className="text-[22px] font-semibold tracking-tight text-[color:var(--text-primary)]">Insight Workbench</div>
                </div>
                <span className="rounded-full bg-[rgba(37,99,235,0.08)] px-3 py-1 text-[11px] font-semibold text-[color:var(--accent-strong)]">
                  Proforma
                </span>
              </div>
              <nav className="flex flex-col gap-1.5">
                <a
                  className="owner-card rounded-xl px-3 py-2 text-sm font-medium text-[color:var(--text-primary)] outline-none ring-0 transition hover:bg-[#2563EB]/10 hover:text-[#1D4ED8] data-[active=true]:bg-[#2563EB]/15 data-[active=true]:text-[color:var(--accent-strong)]"
                  data-active="true"
                  href="#create"
                >
                  Create Report
                </a>
                <Link
                  className="owner-card rounded-xl px-3 py-2 text-sm font-medium text-[color:var(--text-secondary)] outline-none ring-0 transition hover:bg-[#2563EB]/10 hover:text-[#1D4ED8]"
                  href="/snapshots"
                  id="snapshots-link"
                  onClick={() => console.log('[nav] go to /snapshots')}
                >
                  Snapshots
                </Link>
            </nav>
            </div>
          </aside>

          {/* Main column */}
          <main className="space-y-6">
            {/* Header + Stepper */}
            <section className="owner-card rounded-2xl border border-white/30 bg-white/90 p-6 shadow-xl backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-[18px] font-semibold">Create Report</div>
                <div className="owner-status-badge text-[11px]" data-tone={auto.vendorHint ? 'neutral' : 'neutral'}>
                  {auto.vendorHint ? `Vendor: ${auto.vendorHint}` : 'Vendor: Auto'}
                </div>
              </div>
              <ol className="owner-step-nav flex flex-wrap items-center gap-3">
                {steps.map((label, idx) => {
                  const isActive = idx === currentStepIndex;
                  const isDone = idx < currentStepIndex;
                  return (
                    <li key={label} className="flex items-center gap-2" data-state={isActive ? 'active' : isDone ? 'complete' : 'upcoming'}>
                      <div className="owner-pill px-3 py-1 text-[12px]" data-tone={isDone ? 'success' : undefined} aria-current={isActive ? 'step' : undefined}>
                        {idx + 1}
                      </div>
                      <span className={`text-sm ${isActive ? 'font-semibold text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'}`}>
                        {label}
                      </span>
                      {idx < steps.length - 1 && <span className="mx-1 h-px w-8 bg-[#E5E7EB]" />}
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* Content grid */}
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Left Card (wizard body) */}
              <div className="owner-card rounded-2xl border border-white/30 bg-white/90 p-6 shadow-xl backdrop-blur-md">
                {stepGuidance && (
                  <div
                    className={[
                      'mb-5 rounded-xl border p-4 text-sm',
                      stepGuidance.tone === 'warn'
                        ? 'border-[#F59E0B] bg-[#FFFBEB] text-[#7C2D12]'
                        : 'border-[#E5E7EB] bg-[rgba(255,255,255,0.9)] text-[color:var(--text-secondary)]',
                    ].join(' ')}
                  >
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-[#111827]">
                      {stepGuidance.title}
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {stepGuidance.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {stepGuidance.meta && (
                      <div className="mt-3 text-xs text-[color:var(--text-secondary)]">{stepGuidance.meta}</div>
                    )}
                  </div>
                )}

                {step === 0 && (
                  <div className="space-y-5">
                    <UploadZone onFile={onFile} />
                    <div className="flex gap-2">
                      <button
                        className="h-10 rounded-full border border-[#CBD5F5] bg-white/80 px-5 text-sm font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)] text-[#111827]"
                        onClick={() => console.log('[wizard] waiting for upload')}
                        title="Upload a file to continue"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {step === 1 && parseResult && (
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-[15px] font-semibold">{parseResult.fileName}</div>
                        <div className="mt-1 text-sm text-[color:var(--text-secondary)]">
                          Mapping helps align headers. If skipped, the extractor still attempts to read totals.
                        </div>
                      </div>
                    </div>
                    <div className="owner-card rounded-xl border border-white/20 p-3">
                      <HeaderMapper
                        requiredFields={requiredFields}
                        detectedHeaders={parseResult.sheets[0]?.headers ?? []}
                        value={mapper}
                        onChange={setMapper}
                        hints={suggestions}
                        onApplyAll={applyAllSuggestions}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button className="h-10 rounded-full border border-[#CBD5F5] bg-white/80 px-5 text-sm font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]" onClick={prev}>
                        Back
                      </button>
                      <button
                        className="h-10 rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-md transition hover:bg-[#1D4ED8]"
                        onClick={() => setStep(2)}
                        title="Move to validation"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <div className="text-[15px] font-semibold">Validate</div>
                    <div className="owner-card rounded-xl border border-white/20 p-4 text-sm">
                      <div className="mb-2 font-medium text-[#111827]">Checks</div>
                      <ul className="list-disc pl-5 text-[#374151]">
                        <li>Required fields mapped (optional for this prototype)</li>
                        <li>Month band detection from the grid</li>
                        <li>Series-by-label will be saved alongside totals</li>
                      </ul>
                    <div className="mt-3 text-[color:var(--text-secondary)]">Result: {validateMsg || '-'}</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="h-10 rounded-full border border-[#CBD5F5] bg-white/80 px-5 text-sm font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]" onClick={prev}>
                        Back
                      </button>
                      <button
                        className="h-10 rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-md transition hover:bg-[#1D4ED8]"
                        onClick={validate}
                        title="Run basic checks"
                      >
                        Run Validation
                      </button>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-6">
                    <div className="text-[15px] font-semibold">Generate - Assumptions</div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1 block text-[color:var(--text-secondary)]">Facility</span>
                        <input
                          className="h-10 w-full rounded-xl border border-white/25 bg-white/90 px-4 text-sm text-[color:var(--text-primary)] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
                          value={facility}
                          onChange={(e) => setFacility(e.target.value)}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-[color:var(--text-secondary)]">Period</span>
                        <input
                          className="h-10 w-full rounded-xl border border-white/25 bg-white/90 px-4 text-sm text-[color:var(--text-primary)] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
                          value={period}
                          onChange={(e) => setPeriod(e.target.value)}
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-[color:var(--text-secondary)]">
                          <abbr title="Net Operating Income">Preview NOI</abbr> (auto)
                        </span>
                        <input
                          className="h-10 w-full rounded-xl border border-white/25 bg-white/90 px-4 text-sm text-[color:var(--text-primary)] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
                          type="number"
                          value={previewNoi}
                          onChange={(e) => setPreviewNoi(Number(e.target.value))}
                        />
                      </label>
                    </div>

                    <div className="owner-card rounded-xl border border-white/20 p-4 space-y-4">
                      <AssumptionRow
                        label="rentalIncome"
                        value={assumptions.rentalIncome}
                        onChange={(v) => setAssumptions({ ...assumptions, rentalIncome: v })}
                      />
                      <AssumptionRow
                        label="discounts"
                        value={assumptions.discounts}
                        onChange={(v) => setAssumptions({ ...assumptions, discounts: v })}
                      />
                      <AssumptionRow
                        label="badDebt"
                        value={assumptions.badDebt}
                        onChange={(v) => setAssumptions({ ...assumptions, badDebt: v })}
                      />
                      <AssumptionRow
                        label="mgmtFee"
                        value={assumptions.mgmtFee}
                        onChange={(v) => setAssumptions({ ...assumptions, mgmtFee: v })}
                      />
                      <AssumptionRow
                        label="opExTotal"
                        value={assumptions.opExTotal}
                        onChange={(v) => setAssumptions({ ...assumptions, opExTotal: v })}
                      />
                      <div className="text-[12px] text-[#9CA3AF]">
                      <div className="text-[12px] text-[#9CA3AF]">Tip: use negative percent for discounts/bad debt (e.g., -0.02).</div>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-2xl border border-[#DBEAFE]/80 bg-[rgba(37,99,235,0.08)]/70 p-5 text-xs text-[color:var(--accent-strong)] shadow-inner sm:grid-cols-2">
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-[#1D4ED8]">
                          Revenue focus
                        </div>
                        <p className="mt-1 leading-snug">
                          Latest and Growth methods keep NOI aligned with recent performance. Use Percent of
                          Revenue when discounts or bad debt naturally move with topline results.
                        </p>
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold uppercase tracking-wide text-[#1D4ED8]">
                          Expense outlook
                        </div>
                        <p className="mt-1 leading-snug">
                          Management fees and OpEx defaults mirror recent history. Adjust growth to reflect
                          known initiatives, then preview the series to confirm the NOI slope looks realistic.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button className="h-10 rounded-full border border-[#CBD5F5] bg-white/80 px-5 text-sm font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]" onClick={prev}>
                        Back
                      </button>
                      <button className="h-10 rounded-full border border-[#CBD5F5] bg-white/80 px-5 text-sm font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[rgba(37,99,235,0.08)]" onClick={buildPreviewSeries}>
                        Preview Series
                      </button>
                      <button
                        className="h-10 rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-md transition hover:bg-[#1D4ED8]"
                        onClick={async () => {
                          try {
                            await generateSnapshot();
                          } finally {
                            // Always open Export even if Firestore write fails
                            setStep(4);
                          }
                        }}
                        title="Create a snapshot and go to export"
                      >
                        Generate
                      </button>
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-5">
                    <div>
                      <div className="text-[15px] font-semibold">Preview</div>
                      <div className="mt-1 text-sm text-[color:var(--text-secondary)]">
                      <div className="mt-1 text-sm text-[color:var(--text-secondary)]">Period <span className="tabular-nums">{period}</span> - Facility {facility}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {previewStats.map((stat) => (
                        <div
                          key={stat.key}
                          className="owner-card rounded-xl border border-white/20 bg-[#F3F4F6] p-4"
                        >
                          <div className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-secondary)]">
                            {stat.label}
                          </div>
                          <div className="mt-1 text-[20px] font-semibold text-[#111827]">
                            {stat.value}
                          </div>
                          <div className="mt-1 text-xs text-[color:var(--text-secondary)]">{stat.caption}</div>
                        </div>
                      ))}
                    </div>

                    {seriesPreview && (
                      <div className="overflow-auto rounded-xl border border-white/20">
                        <table className="w-full table-fixed text-left text-sm">
                          <thead className="sticky top-0 z-10 bg-[rgba(255,255,255,0.9)] text-[color:var(--text-secondary)]">
                            <tr>
                              <th className="w-48 px-3 py-2">Line</th>
                              {Array.from({ length: 12 }).map((_, i) => (
                                <th key={i} className="w-24 px-3 py-2 text-right">
                                  M{i + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(
                              [
                                ['rentalIncome', 'rentalIncome'],
                                ['discounts', 'discounts'],
                                ['badDebt', 'badDebt'],
                                ['mgmtFee', 'mgmtFee'],
                                ['opExTotal', 'opExTotal'],
                                ['toi', 'toi'],
                                ['toe', 'toe'],
                                ['noi', 'noi'],
                              ] as Array<[keyof NonNullable<typeof seriesPreview>, string]>
                            ).map(([key, label]) => (
                              <tr key={label} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFB]">
                                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">
                                  {labelWithAcronym(label)}
                                </td>
                                {seriesPreview[key]!.map((v, i) => (
                                  <td key={i} className="px-3 py-2 text-right tabular-nums">
                                    {Math.round(v).toLocaleString()}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="mb-1 flex flex-wrap items-center gap-4 text-[14px]">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex h-5 items-center justify-center rounded-full bg-[#DEF7EC] px-2 text-[11px] font-semibold text-[#065F46]">
                          NOI
                        </span>
                        <abbr title="Net Operating Income">NOI</abbr>{' '}
                        <span className="tabular-nums text-[#111827]">{previewNoi.toLocaleString()}</span>
                      </span>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={onExportExcel}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-[#2563EB]/70 bg-[#F5F7FF] px-5 text-sm font-semibold text-[color:var(--accent-strong)] transition hover:border-[#1D4ED8] hover:bg-[#E0ECFF]"
                        title="Download an .xlsx export"
                      >
                        Export Proforma (.xlsx)
                      </button>
                      <button
                        type="button"
                        onClick={onSaveOwnerPdf}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-md transition hover:bg-[#1E3A8A]"
                      >
                        Save Owner PDF
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right rail */}
              <div className="space-y-6">
                {/* Recent Snapshots */}
                <div className="owner-card rounded-2xl border border-white/30 bg-white/90 p-6 shadow-xl backdrop-blur-md">
                  <div className="mb-4 text-[15px] font-semibold">Recent Snapshots</div>
                  <div className="overflow-hidden rounded-xl border border-white/20">
                    <table className="w-full text-left text-[13px]">
                      <thead className="bg-[rgba(255,255,255,0.9)] text-[color:var(--text-secondary)]">
                        <tr>
                          <th className="px-3 py-2 font-medium">Facility</th>
                          <th className="px-3 py-2 font-medium">Period</th>
                          <th className="px-3 py-2 font-medium text-right">
                            <abbr title="Net Operating Income">NOI</abbr>
                          </th>
                          <th className="px-3 py-2 font-medium">Created By</th>
                          <th className="px-3 py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((row) => (
                          <tr key={row.id} className="border-t border-[#E5E7EB] hover:bg-[#FAFAFB]">
                            <td className="px-3 py-2">
                              <div className="max-w-[160px] break-words leading-[1.2]">
                                {row.facility}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[12px] text-[#374151]">
                                {row.period}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {row.noi.toLocaleString()}
                            </td>
                            <td className="px-3 py-2">{row.createdBy}</td>
                            <td className="px-3 py-2">
                              <Link
                                href="/snapshots"
                                className="text-[#2563EB] underline-offset-2 hover:underline"
                                onClick={() => console.log('[ui] open snapshot list')}
                              >
                                Open
                              </Link>
                            </td>
                          </tr>
                        ))}
                        {recent.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-[color:var(--text-secondary)]">
                              No snapshots yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Automation snapshot */}
                <div className="owner-card rounded-2xl border border-white/30 bg-white/90 p-6 shadow-xl backdrop-blur-md">
                  <div className="mb-3 text-[15px] font-semibold">Automation Snapshot</div>
                  <div className="space-y-3 text-[13px] text-[color:var(--text-secondary)]">
                    <div className="flex items-center justify-between">
                      <span>Auto-map headers</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          auto.autoMap ? 'bg-[#DCFCE7] text-[#047857]' : 'bg-[#FEE2E2] text-[#B91C1C]'
                        }`}
                      >
                        {auto.autoMap ? 'On' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Detect facility &amp; period</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          auto.autoDetectFacilityPeriod ? 'bg-[rgba(37,99,235,0.12)] text-[#1D4ED8]' : 'bg-[#FEE2E2] text-[#B91C1C]'
                        }`}
                      >
                        {auto.autoDetectFacilityPeriod ? 'Active' : 'Off'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Vendor recognition</span>
                      <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-xs text-[#374151]">
                        {auto.vendorHint ?? 'Learning'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-dashed border-[#DBEAFE]/70 bg-[rgba(37,99,235,0.08)]/70 p-5 text-xs text-[color:var(--accent-strong)] shadow-inner">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium uppercase tracking-wide">Confidence threshold</span>
                      <span>{Math.round(auto.threshold * 100)}%</span>
                    </div>
                    <p className="mt-2 leading-snug">
                      Lower the threshold to accept broader header matches. Raise it when vendor exports are
                      noisy.
                    </p>
                  </div>
                </div>

                {/* Export checklist */}
                <div className="owner-card rounded-2xl border border-white/30 bg-white/90 p-6 shadow-xl backdrop-blur-md">
                  <div className="mb-3 text-[15px] font-semibold">Export Checklist</div>
                  <ul className="space-y-2 text-[13px] text-[color:var(--text-secondary)]">
                    <li className="flex items-start gap-2">
                      <span className="mt-[3px] inline-block h-3 w-3 flex-none rounded-full bg-[#2563EB]" />
                      <span>Validate headers and facility metadata before generating.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-[3px] inline-block h-3 w-3 flex-none rounded-full bg-[#A855F7]" />
                      <span>Preview the NOI trend to ensure the story matches expectations.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-[3px] inline-block h-3 w-3 flex-none rounded-full bg-[#F59E0B]" />
                      <span>Share exports from the right rail to keep stakeholders aligned.</span>
                    </li>
                    {recent.length > 0 && (
                      <li className="flex items-start gap-2 text-[color:var(--accent-strong)]">
                        <span className="mt-[3px] inline-block h-3 w-3 flex-none rounded-full bg-[#1E3A8A]" />
                        <span>Latest snapshot: {recent[0]?.facility ?? ''} - {recent[0]?.period ?? ''}</span>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>

      <div className="sr-only">
        <Image src="/next.svg" alt="" width={1} height={1} />
        <Image src="/vercel.svg" alt="" width={1} height={1} />
        <Image src="/file.svg" alt="" width={1} height={1} />
        <Image src="/window.svg" alt="" width={1} height={1} />
        <Image src="/globe.svg" alt="" width={1} height={1} />
      </div>
    </div>
  );
}













