'use client';

import type { LineSeriesByLabel, SnapshotDetail } from '@/lib/types';

type OwnerDeckSeries = {
  toi?: number[];
  toe?: number[];
  noi?: number[];
};

export type OwnerReportDeckInput = {
  snapshot: Pick<SnapshotDetail, 'facility' | 'period' | 'totals' | 'createdBy'>;
  monthBand?: string[];
  series?: OwnerDeckSeries | null;
  seriesByLabel?: LineSeriesByLabel | null;
  vendorHint?: string | null;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number | undefined | null): string {
  if (value == null || Number.isNaN(value)) return '$0';
  return currencyFormatter.format(Math.round(value));
}

function defaultMonthBand(period: string, count: number): string[] {
  if (!period) {
    return Array.from({ length: count }, (_, idx) => `Month ${idx + 1}`);
  }

  const match = period.match(/^([A-Za-z]{3})[-\s](\d{4})$/);
  if (match) {
    const startMonth = match[1].slice(0, 3).toLowerCase();
    const year = Number(match[2]);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const startIdx = months.indexOf(startMonth);
    if (startIdx >= 0) {
      return Array.from({ length: count }, (_, idx) => {
        const idxYear = year + Math.floor((startIdx + idx) / 12);
        const idxMonth = months[(startIdx + idx) % 12]!;
        return `${idxMonth.toUpperCase()} ${idxYear}`;
      });
    }
  }

  return Array.from({ length: count }, (_, idx) => `Month ${idx + 1}`);
}

function summarizeSeries(series: number[] | undefined): { latest: number | null; rolling: number | null } {
  if (!series || !series.length) return { latest: null, rolling: null };
  const latest = series[series.length - 1] ?? null;
  const rolling = series.slice(-3).reduce((acc, val) => acc + val, 0) / Math.min(series.length, 3);
  return { latest, rolling: Number.isFinite(rolling) ? rolling : latest };
}

function summariseLineItems(seriesByLabel: LineSeriesByLabel | null | undefined): Array<{ name: string; total: number }> {
  if (!seriesByLabel) return [];
  const entries = Object.entries(seriesByLabel)
    .map(([name, values]) => ({
      name,
      total: values.reduce((acc, val) => acc + (Number.isFinite(val) ? val : 0), 0),
    }))
    .filter((entry) => entry.total !== 0);

  entries.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return entries.slice(0, 6);
}

export async function downloadOwnerReportDeck(input: OwnerReportDeckInput): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default;

  const deck = new PptxGenJS();
  deck.layout = '16x9';
  const safeSeries = input.series ?? {};
  const monthLabels = input.monthBand && input.monthBand.length
    ? input.monthBand.map((label) => label.toUpperCase())
    : defaultMonthBand(input.snapshot.period, safeSeries.noi?.length ?? 12);

  /* -------------------------- Title slide --------------------------- */
  const titleSlide = deck.addSlide();
  titleSlide.background = { color: 'FFFFFF' };

  titleSlide.addText('STORE Owner Report', {
    x: 0.5,
    y: 0.4,
    w: 9,
    fontSize: 36,
    bold: true,
    color: '0B1120',
    fontFace: 'Segoe UI',
  });

  titleSlide.addText(input.snapshot.facility, {
    x: 0.5,
    y: 1.3,
    w: 9,
    fontSize: 26,
    bold: true,
    color: '2563EB',
    fontFace: 'Segoe UI',
  });

  titleSlide.addText(`Period ending ${input.snapshot.period}`, {
    x: 0.5,
    y: 1.9,
    fontSize: 16,
    color: '475569',
    fontFace: 'Segoe UI',
  });

  if (input.vendorHint) {
    titleSlide.addText(`Vendor: ${input.vendorHint}`, {
      x: 0.5,
      y: 2.3,
      fontSize: 14,
      color: '64748B',
      fontFace: 'Segoe UI',
    });
  }

  titleSlide.addText(`Prepared for STORE by ${input.snapshot.createdBy}`, {
    x: 0.5,
    y: 2.7,
    fontSize: 12,
    color: '94A3B8',
    fontFace: 'Segoe UI',
  });

  /* -------------------------- Summary slide ------------------------- */
  const summarySlide = deck.addSlide();
  summarySlide.background = { color: 'F8FAFC' };
  summarySlide.addText('Key Financial Metrics', {
    x: 0.6,
    y: 0.4,
    fontSize: 24,
    bold: true,
    color: '0B1120',
    fontFace: 'Segoe UI',
  });

  const summaryRows = [
    [
      { text: 'Metric', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 13, fontFace: 'Segoe UI' } },
      { text: 'Value', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 13, fontFace: 'Segoe UI' } },
    ],
    ['Total Operating Income (T12)', formatCurrency(input.snapshot.totals.totalOperatingIncome)],
    ['Total Operating Expense (T12)', formatCurrency(input.snapshot.totals.totalOperatingExpense)],
    ['Net Operating Income (T12)', formatCurrency(input.snapshot.totals.noi)],
  ];

  const noiSummary = summarizeSeries(safeSeries.noi);
  if (noiSummary.latest != null && noiSummary.rolling != null) {
    summaryRows.push([
      'Latest NOI (current month)',
      formatCurrency(noiSummary.latest),
    ]);
    summaryRows.push([
      'Rolling NOI (3-month avg)',
      formatCurrency(noiSummary.rolling),
    ]);
  }

  summarySlide.addTable(summaryRows, {
    x: 0.6,
    y: 1.1,
    w: 8.4,
    colW: [4.5, 3.9],
    fontFace: 'Segoe UI',
    fontSize: 12,
    color: '0F172A',
    border: { type: 'solid', pt: 1, color: 'CBD5F5' },
    fill: 'FFFFFF',
  });

  /* --------------------- NOI monthly detail slide ------------------- */
  if (safeSeries.noi && safeSeries.noi.length) {
    const noiSlide = deck.addSlide();
    noiSlide.background = { color: 'FFFFFF' };
    noiSlide.addText('NOI Trend (last 12 months)', {
      x: 0.6,
      y: 0.4,
      fontSize: 24,
      bold: true,
      color: '0B1120',
      fontFace: 'Segoe UI',
    });

    const noiRows = [
      [
        { text: 'Month', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 12, fontFace: 'Segoe UI' } },
        { text: 'NOI', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 12, fontFace: 'Segoe UI' } },
      ],
      ...safeSeries.noi.map((value, idx) => [
        monthLabels[idx] ?? `Month ${idx + 1}`,
        formatCurrency(value),
      ]),
    ];

    noiSlide.addTable(noiRows, {
      x: 0.6,
      y: 1.1,
      w: 8.4,
      colW: [4.5, 3.9],
      fontFace: 'Segoe UI',
      fontSize: 12,
      color: '0F172A',
      border: { type: 'solid', pt: 1, color: 'E2E8F0' },
      fill: 'FFFFFF',
    });
  }

  /* -------------------- COA breakdown slide ------------------------- */
  const lineSummaries = summariseLineItems(input.seriesByLabel);
  if (lineSummaries.length) {
    const breakdownSlide = deck.addSlide();
    breakdownSlide.background = { color: 'F8FAFC' };
    breakdownSlide.addText('Line Item Highlights', {
      x: 0.6,
      y: 0.4,
      fontSize: 24,
      bold: true,
      color: '0B1120',
      fontFace: 'Segoe UI',
    });

    const breakdownRows = [
      [
        { text: 'Line Item', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 12, fontFace: 'Segoe UI' } },
        { text: 'T12 Total', options: { bold: true, color: 'FFFFFF', fill: '2563EB', fontSize: 12, fontFace: 'Segoe UI' } },
      ],
      ...lineSummaries.map((entry) => [entry.name, formatCurrency(entry.total)]),
    ];

    breakdownSlide.addTable(breakdownRows, {
      x: 0.6,
      y: 1.1,
      w: 8.4,
      colW: [4.5, 3.9],
      fontFace: 'Segoe UI',
      fontSize: 12,
      color: '0F172A',
      border: { type: 'solid', pt: 1, color: 'CBD5F5' },
      fill: 'FFFFFF',
    });
  }

  /* ------------------- Next steps slide ----------------------------- */
  const notesSlide = deck.addSlide();
  notesSlide.background = { color: 'FFFFFF' };
  notesSlide.addText('Next Actions', {
    x: 0.6,
    y: 0.4,
    fontSize: 24,
    bold: true,
    color: '0B1120',
    fontFace: 'Segoe UI',
  });

  notesSlide.addText(
    [
      { text: '• Validate variance explanations for major line movements.', options: { fontSize: 14, fontFace: 'Segoe UI' } },
      { text: '\n• Insert narrative highlights before distributing to the owner.', options: { fontSize: 14, fontFace: 'Segoe UI' } },
      { text: '\n• Attach supporting schedules for operations and capital where needed.', options: { fontSize: 14, fontFace: 'Segoe UI' } },
    ],
    { x: 0.8, y: 1.2, color: '1F2937' },
  );

  const safeFacility = input.snapshot.facility.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const fileName = `OwnerReport_${safeFacility}_${input.snapshot.period.replace(/\s+/g, '-')}.pptx`;
  await deck.writeFile({ fileName });
}
