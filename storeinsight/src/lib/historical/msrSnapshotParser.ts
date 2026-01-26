import * as XLSX from 'xlsx';

type CellValue = string | number | boolean | Date | null | undefined;
type Grid = CellValue[][];

export type MsrSnapshotPayload = {
  propertyId?: string;
  propertyCode?: string;
  propertyName?: string;
  propertyAddress?: string;
  reportDate?: string;
  reportMonthIso?: string;
  monthIso?: string;
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
    grossPotentialRevenue?: number;
    grossOccupiedRevenue?: number;
    occupiedRateVariancePct?: number;
  };
  rentals?: {
    moveInsMtd?: number;
    moveOutsMtd?: number;
    netMoveInsMtd?: number;
    netMtd?: number;
  };
  leads?: {
    webMtd?: number;
    walkInMtd?: number;
    phoneMtd?: number;
    otherMtd?: number;
    totalMtd?: number;
    convertedMtd?: number;
    conversionPct?: number;
    byChannelMtd?: {
      web?: number;
      walkIn?: number;
      phone?: number;
      other?: number;
    };
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
    aging?: {
      days0to10?: number;
      days11to30?: number;
      days31to60?: number;
      days61plus?: number;
    };
    topDelinquencies?: Array<{
      tenant?: string;
      unit?: string;
      daysLate?: number;
      balance?: number;
      startDate?: string;
    }>;
    overlock?: {
      overlockedUnitCount?: number;
      totalBalance?: number;
      avgDaysLate?: number;
      bucketPct?: {
        d0_10?: number;
        d11_30?: number;
        d31_60?: number;
        d61_plus?: number;
      };
    };
    overlockedUnitCount?: number;
    overlockTotalBalance?: number;
    overlockAvgDaysLate?: number;
    overlockBucketShare?: Array<{ label: string; percent: number }>;
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
    noRentChange12MoByType?: Record<string, number>;
  };
  autopay?: {
    enrolledCount?: number;
    enrolledPct?: number;
    autopayCount?: number;
    autopayPct?: number;
  };
  coverage?: {
    enrolledCount?: number;
    enrolledPct?: number;
    premiumSum?: number;
    premiumMtd?: number;
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
    totalOccupiedRsf?: number;
    totalRsf?: number;
  };
  inventory?: {
    vacantUnitsSample?: Array<{ unit?: string; type?: string; size?: string; status?: string }>;
  };
};

export type MsrParseSectionFlags = {
  occupancy: boolean;
  revenue: boolean;
  rentals: boolean;
  leads: boolean;
  ar: boolean;
  pricing: boolean;
  autopay: boolean;
  coverage: boolean;
  concessions: boolean;
  unitMix: boolean;
  inventory: boolean;
};

export type MsrParseResult = {
  snapshot: MsrSnapshotPayload;
  warnings: string[];
  sections: MsrParseSectionFlags;
};

const normalizeText = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

const normalizeSheetName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const isBlankCell = (value: CellValue): boolean =>
  value == null || (typeof value === 'string' && !value.trim());

const isBlankRow = (row: CellValue[]): boolean => row.every((cell) => isBlankCell(cell));

const coerceNumber = (value: CellValue): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isNegative = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed.replace(/[(),$%\s]/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return isNegative ? -parsed : parsed;
  }
  return null;
};

const coercePercent = (value: CellValue): number | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const hasPercent = trimmed.includes('%');
    const numeric = coerceNumber(trimmed);
    if (numeric == null) return null;
    if (hasPercent) return numeric;
    if (Math.abs(numeric) <= 1) return numeric * 100;
    return numeric;
  }
  const numeric = coerceNumber(value);
  if (numeric == null) return null;
  if (Math.abs(numeric) <= 1) return numeric * 100;
  return numeric;
};

const coerceDate = (value: CellValue): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value * 86400 * 1000);
    const date = new Date(excelEpoch.getTime() + ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatIsoDate = (date: Date | null): string | undefined => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatMonthIso = (date: Date | null): string | undefined => {
  if (!date) return undefined;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
};

const sheetToGrid = (sheet: XLSX.WorkSheet): Grid =>
  XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as Grid;

const readCellValue = (sheet: XLSX.WorkSheet | undefined, address: string): CellValue => {
  if (!sheet) return null;
  const cell = sheet[address];
  return (cell ? cell.v : null) as CellValue;
};

const findSheet = (workbook: XLSX.WorkBook, names: string[]): XLSX.WorkSheet | undefined => {
  const targetNames = names.map(normalizeSheetName);
  for (const name of workbook.SheetNames) {
    const normalized = normalizeSheetName(name);
    if (targetNames.includes(normalized)) {
      return workbook.Sheets[name];
    }
  }
  return undefined;
};

const findCellByAnchor = (
  grid: Grid,
  anchors: string[],
): { row: number; col: number } | null => {
  const normalizedAnchors = anchors.map((anchor) => normalizeText(anchor));
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const value = normalizeText(row[c]);
      if (!value) continue;
      if (normalizedAnchors.some((anchor) => value.includes(anchor))) {
        return { row: r, col: c };
      }
    }
  }
  return null;
};

const findHeaderRow = (
  grid: Grid,
  startRow: number,
  endRow: number,
  requiredHeaders: string[][],
): number | null => {
  const upper = Math.min(grid.length - 1, endRow);
  for (let r = startRow; r <= upper; r += 1) {
    const row = grid[r] ?? [];
    const normalized = row.map((cell) => normalizeText(cell));
    let hits = 0;
    for (const group of requiredHeaders) {
      if (group.some((token) => normalized.some((header) => header.includes(token)))) {
        hits += 1;
      }
    }
    if (hits >= Math.min(requiredHeaders.length, 3)) {
      return r;
    }
  }
  return null;
};

const findHeaderIndex = (headers: string[], keywords: string[]): number | null => {
  for (let idx = 0; idx < headers.length; idx += 1) {
    const header = headers[idx] ?? '';
    if (!header) continue;
    if (keywords.some((keyword) => header.includes(keyword))) return idx;
  }
  return null;
};

const findRowByLabel = (
  grid: Grid,
  startRow: number,
  endRow: number,
  label: string,
): { row: number; col: number } | null => {
  const target = normalizeText(label);
  const upper = Math.min(grid.length - 1, endRow);
  for (let r = startRow; r <= upper; r += 1) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c += 1) {
      const text = normalizeText(row[c]);
      if (text && text.includes(target)) {
        return { row: r, col: c };
      }
    }
  }
  return null;
};

const collectNumbersBelow = (
  grid: Grid,
  row: number,
  col: number,
  maxRows: number,
): number[] => {
  const values: number[] = [];
  const upper = Math.min(grid.length - 1, row + maxRows);
  for (let r = row + 1; r <= upper; r += 1) {
    const cell = grid[r]?.[col];
    const numeric = coerceNumber(cell);
    if (numeric == null) continue;
    values.push(numeric);
  }
  return values;
};

const collectRowNumbers = (row: CellValue[], startCol: number): number[] => {
  const values: number[] = [];
  for (let c = startCol; c < row.length; c += 1) {
    const numeric = coerceNumber(row[c]);
    if (numeric == null) continue;
    values.push(numeric);
  }
  return values;
};

const buildSectionFlags = (snapshot: MsrSnapshotPayload): MsrParseSectionFlags => ({
  occupancy: Boolean(snapshot.occupancy && Object.values(snapshot.occupancy).some((value) => value != null)),
  revenue: Boolean(snapshot.revenue && Object.values(snapshot.revenue).some((value) => value != null)),
  rentals: Boolean(snapshot.rentals && Object.values(snapshot.rentals).some((value) => value != null)),
  leads: Boolean(snapshot.leads && Object.values(snapshot.leads).some((value) => value != null)),
  ar: Boolean(snapshot.ar && Object.values(snapshot.ar).some((value) => value != null)),
  pricing: Boolean(snapshot.pricing && Object.values(snapshot.pricing).some((value) => value != null)),
  autopay: Boolean(snapshot.autopay && Object.values(snapshot.autopay).some((value) => value != null)),
  coverage: Boolean(snapshot.coverage && Object.values(snapshot.coverage).some((value) => value != null)),
  concessions: Boolean(snapshot.concessions && Object.values(snapshot.concessions).some((value) => value != null)),
  unitMix: Boolean(snapshot.unitMix && Object.values(snapshot.unitMix).some((value) => value != null)),
  inventory: Boolean(snapshot.inventory && Object.values(snapshot.inventory).some((value) => value != null)),
});

const splitPropertyHeader = (
  value: CellValue,
): { propertyCode?: string; propertyName?: string } => {
  const raw = String(value ?? '').trim();
  if (!raw) return {};
  const match = raw.match(/^([A-Za-z0-9]+)\s*-\s*(.+)$/);
  if (!match) return { propertyName: raw };
  return { propertyCode: match[1].trim(), propertyName: match[2].trim() };
};
const extractMsrSheet = (
  grid: Grid,
  sheet: XLSX.WorkSheet,
  warnings: string[],
): Partial<MsrSnapshotPayload> => {
  const snapshot: Partial<MsrSnapshotPayload> = {};
  const propertyHeader = readCellValue(sheet, 'K1');
  const propertyAddress = readCellValue(sheet, 'K2');
  const reportDateValue = readCellValue(sheet, 'A3');
  const reportDate = coerceDate(reportDateValue);

  Object.assign(snapshot, splitPropertyHeader(propertyHeader));
  if (propertyAddress) snapshot.propertyAddress = String(propertyAddress ?? '').trim();
  snapshot.reportDate = formatIsoDate(reportDate);
  snapshot.reportMonthIso = formatMonthIso(reportDate);
  if (snapshot.reportMonthIso) snapshot.monthIso = snapshot.reportMonthIso;

  if (!snapshot.propertyName) warnings.push('MSR sheet: property header not found at K1.');
  if (!snapshot.propertyAddress) warnings.push('MSR sheet: property address not found at K2.');
  if (!snapshot.reportDate) warnings.push('MSR sheet: report date not found at A3.');

  const netRevenueAnchor = findCellByAnchor(grid, ['net revenue']);
  if (!netRevenueAnchor) {
    warnings.push('MSR sheet: Net Revenue anchor not found.');
  } else {
    const values = collectNumbersBelow(grid, netRevenueAnchor.row, netRevenueAnchor.col, 6);
    if (!values.length) {
      warnings.push('MSR sheet: Net Revenue values missing.');
    } else {
      snapshot.revenue = {
        netRevenueMtd: values[0],
        netRevenueSameDayLastMonth: values[1],
        netRevenueSameDayLastYear: values[2],
      };
    }
  }

  const occupancyAnchor = findCellByAnchor(grid, ['space occupancy']);
  if (!occupancyAnchor) {
    warnings.push('MSR sheet: Space Occupancy anchor not found.');
  } else {
    const headerRow = findHeaderRow(
      grid,
      occupancyAnchor.row + 1,
      occupancyAnchor.row + 6,
      [['count', 'spaces'], ['% space', 'space %'], ['sq ft', 'sqft'], ['% sq ft', '% sqft']],
    );
    if (headerRow == null) {
      warnings.push('MSR sheet: Space Occupancy header row not found.');
    } else {
      const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
      const countCol = findHeaderIndex(headers, ['count', 'spaces']);
      const spacePctCol = findHeaderIndex(headers, ['% space', 'space %']);
      const sqftCol = findHeaderIndex(headers, ['sq ft', 'sqft']);
      const rsfPctCol = findHeaderIndex(headers, ['% sq ft', '% sqft']);
      const labelRows = [
        { key: 'occupied', label: 'occupied' },
        { key: 'vacant', label: 'vacant' },
        { key: 'offline', label: 'offline' },
        { key: 'total', label: 'total' },
      ];
      const occupancy = snapshot.occupancy ?? {};
      labelRows.forEach(({ key, label }) => {
        const rowInfo = findRowByLabel(grid, headerRow + 1, headerRow + 10, label);
        if (!rowInfo) return;
        const row = grid[rowInfo.row] ?? [];
        const countValue = countCol != null ? coerceNumber(row[countCol]) : null;
        const spacePct = spacePctCol != null ? coercePercent(row[spacePctCol]) : null;
        const sqftValue = sqftCol != null ? coerceNumber(row[sqftCol]) : null;
        const rsfPct = rsfPctCol != null ? coercePercent(row[rsfPctCol]) : null;
        if (key === 'occupied') {
          if (countValue != null) occupancy.occupiedCount = countValue;
          if (spacePct != null) occupancy.spaceOccPct = spacePct;
          if (sqftValue != null) occupancy.occupiedRsf = sqftValue;
          if (rsfPct != null) occupancy.rsfOccPct = rsfPct;
        }
        if (key === 'vacant') {
          if (countValue != null) occupancy.vacantCount = countValue;
          if (sqftValue != null) occupancy.vacantRsf = sqftValue;
        }
        if (key === 'offline') {
          if (countValue != null) occupancy.offlineCount = countValue;
          if (sqftValue != null) occupancy.offlineRsf = sqftValue;
        }
        if (key === 'total') {
          if (countValue != null) occupancy.totalCount = countValue;
          if (sqftValue != null) occupancy.totalRsf = sqftValue;
        }
      });
      snapshot.occupancy = occupancy;
    }
  }

  const revenueAnchor = findCellByAnchor(grid, ['revenue statistics']);
  if (!revenueAnchor) {
    warnings.push('MSR sheet: Revenue Statistics anchor not found.');
  } else {
    const revenue = snapshot.revenue ?? {};
    const econRow = findRowByLabel(grid, revenueAnchor.row + 1, revenueAnchor.row + 12, 'economic occupancy');
    if (econRow) {
      const row = grid[econRow.row] ?? [];
      const values = collectRowNumbers(row, econRow.col + 1);
      if (values[0] != null) revenue.economicOccupancy = values[0];
      if (values[1] != null) revenue.economicOccPerSqft = values[1];
    } else {
      warnings.push('MSR sheet: Economic Occupancy row not found.');
    }
    const varianceRow = findRowByLabel(grid, revenueAnchor.row + 1, revenueAnchor.row + 12, 'occupied rate variance');
    if (varianceRow) {
      const row = grid[varianceRow.row] ?? [];
      const values = collectRowNumbers(row, varianceRow.col + 1);
      if (values[0] != null) {
        const variancePct = coercePercent(values[0]);
        if (variancePct != null) {
          revenue.occupiedRateVariancePct = variancePct;
          const pricing = snapshot.pricing ?? {};
          pricing.occupiedRateVariancePct = variancePct;
          snapshot.pricing = pricing;
        }
      }
    } else {
      warnings.push('MSR sheet: Occupied Rate Variance row not found.');
    }
    snapshot.revenue = revenue;
  }

  const rentalAnchor = findCellByAnchor(grid, ['rental activity']);
  if (!rentalAnchor) {
    warnings.push('MSR sheet: Rental Activity anchor not found.');
  } else {
    const headerRow = findHeaderRow(grid, rentalAnchor.row + 1, rentalAnchor.row + 6, [['mtd']]);
    let mtdCol: number | null = null;
    if (headerRow != null) {
      const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
      mtdCol = findHeaderIndex(headers, ['mtd', 'month to date']);
    }
    const rentalRows = [
      { label: 'move ins', key: 'moveInsMtd' },
      { label: 'move-outs', key: 'moveOutsMtd' },
      { label: 'move outs', key: 'moveOutsMtd' },
      { label: 'net', key: 'netMoveInsMtd' },
    ] as const;
    const rentals = snapshot.rentals ?? {};
    rentalRows.forEach((rowMeta) => {
      const rowInfo = findRowByLabel(grid, rentalAnchor.row + 1, rentalAnchor.row + 12, rowMeta.label);
      if (!rowInfo) return;
      const row = grid[rowInfo.row] ?? [];
      let value: number | null = null;
      if (mtdCol != null) {
        value = coerceNumber(row[mtdCol]);
      }
      if (value == null) {
        const values = collectRowNumbers(row, rowInfo.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) rentals[rowMeta.key] = value;
    });
    snapshot.rentals = rentals;
  }

  const perfAnchor = findCellByAnchor(grid, ['performance indicators']);
  if (!perfAnchor) {
    warnings.push('MSR sheet: Performance Indicators anchor not found.');
  } else {
    const autopayRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'autopay enrollment');
    const coverageRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'coverage enrollment');
    const overlockRow = findRowByLabel(grid, perfAnchor.row + 1, perfAnchor.row + 16, 'overlocked spaces');
    const noChangeRow = findRowByLabel(
      grid,
      perfAnchor.row + 1,
      perfAnchor.row + 18,
      'no rent change',
    );

    if (autopayRow) {
      const row = grid[autopayRow.row] ?? [];
      const values = collectRowNumbers(row, autopayRow.col + 1);
      snapshot.autopay = {
        enrolledCount: values[0],
        enrolledPct: values[1] != null ? coercePercent(values[1]) : undefined,
        autopayCount: values[0],
        autopayPct: values[1] != null ? coercePercent(values[1]) : undefined,
      };
    } else {
      warnings.push('MSR sheet: Autopay Enrollment row not found.');
    }

    if (coverageRow) {
      const row = grid[coverageRow.row] ?? [];
      const values = collectRowNumbers(row, coverageRow.col + 1);
      snapshot.coverage = {
        enrolledCount: values[0],
        enrolledPct: values[1] != null ? coercePercent(values[1]) : undefined,
      };
    } else {
      warnings.push('MSR sheet: Coverage Enrollment row not found.');
    }

    if (overlockRow) {
      const row = grid[overlockRow.row] ?? [];
      const values = collectRowNumbers(row, overlockRow.col + 1);
      if (!snapshot.ar) snapshot.ar = {};
      if (values[0] != null) {
        snapshot.ar.overlockedUnitCount = values[0];
      }
    }

    if (noChangeRow) {
      const row = grid[noChangeRow.row] ?? [];
      const values = collectRowNumbers(row, noChangeRow.col + 1);
      if (!snapshot.pricing) snapshot.pricing = {};
      if (values[0] != null) snapshot.pricing.noRentChange12MoCount = values[0];
    }
  }

  const leadsAnchor = findCellByAnchor(grid, ['leads']);
  if (!leadsAnchor) {
    warnings.push('MSR sheet: Leads anchor not found.');
  } else {
    const headerRow = findHeaderRow(grid, leadsAnchor.row + 1, leadsAnchor.row + 6, [['mtd']]);
    let mtdCol: number | null = null;
    if (headerRow != null) {
      const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
      mtdCol = findHeaderIndex(headers, ['mtd', 'month to date']);
    }
    const leads = snapshot.leads ?? {};
    const labels = [
      { label: 'web leads', key: 'webMtd' },
      { label: 'walk-in leads', key: 'walkInMtd' },
      { label: 'walk in leads', key: 'walkInMtd' },
      { label: 'phone leads', key: 'phoneMtd' },
      { label: 'other leads', key: 'otherMtd' },
      { label: 'leads converted', key: 'convertedMtd' },
    ] as const;
    labels.forEach((entry) => {
      const rowInfo = findRowByLabel(grid, leadsAnchor.row + 1, leadsAnchor.row + 12, entry.label);
      if (!rowInfo) return;
      const row = grid[rowInfo.row] ?? [];
      let value: number | null = null;
      if (mtdCol != null) {
        value = coerceNumber(row[mtdCol]);
      }
      if (value == null) {
        const values = collectRowNumbers(row, rowInfo.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) leads[entry.key] = value;
    });
    snapshot.leads = leads;
  }

  const statsAnchor = findCellByAnchor(grid, ['space statistics']);
  if (statsAnchor) {
    const headerRow = findHeaderRow(grid, statsAnchor.row + 1, statsAnchor.row + 6, [['occupied']]);
    let occupiedCol: number | null = null;
    if (headerRow != null) {
      const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
      occupiedCol = findHeaderIndex(headers, ['occupied']);
    }
    const occupancy = snapshot.occupancy ?? {};
    const rentSpaceRow = findRowByLabel(grid, statsAnchor.row + 1, statsAnchor.row + 12, 'average rent/space');
    const rentSqftRow = findRowByLabel(grid, statsAnchor.row + 1, statsAnchor.row + 12, 'average rent sq');
    if (rentSpaceRow) {
      const row = grid[rentSpaceRow.row] ?? [];
      let value: number | null = null;
      if (occupiedCol != null) value = coerceNumber(row[occupiedCol]);
      if (value == null) {
        const values = collectRowNumbers(row, rentSpaceRow.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) occupancy.avgRentPerSpaceOccupied = value;
    }
    if (rentSqftRow) {
      const row = grid[rentSqftRow.row] ?? [];
      let value: number | null = null;
      if (occupiedCol != null) value = coerceNumber(row[occupiedCol]);
      if (value == null) {
        const values = collectRowNumbers(row, rentSqftRow.col + 1);
        value = values[0] ?? null;
      }
      if (value != null) occupancy.avgRentPerSqftOccupied = value;
    }
    snapshot.occupancy = occupancy;
  }

  return snapshot;
};

const extractOccupancySheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(
    grid,
    0,
    25,
    [
      ['space number', 'space #', 'space'],
      ['space type', 'type'],
      ['sell rate', 'sell'],
      ['current rent', 'current'],
      ['sq ft', 'sqft'],
      ['occupied', 'vacant', 'offline', 'status'],
    ],
  );
  if (headerRow == null) {
    warnings.push('Occupancy sheet: header row not found.');
    return {};
  }

  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colSpaceNumber = findHeaderIndex(headers, ['space number', 'space #', 'space']);
  const colSpaceType = findHeaderIndex(headers, ['space type', 'type']);
  const colSpaceSize = findHeaderIndex(headers, ['space size', 'size']);
  const colSellRate = findHeaderIndex(headers, ['sell rate', 'sell']);
  const colCurrentRent = findHeaderIndex(headers, ['current rent', 'current']);
  const colSqft = findHeaderIndex(headers, ['sq ft', 'sqft']);
  const colStatus = findHeaderIndex(headers, ['occupied', 'vacant', 'offline', 'status']);

  const occupiedRsfByType: Record<string, number> = {};
  const vacantUnitsSample: Array<{ unit?: string; type?: string; size?: string; status?: string }> = [];
  const typeBySpaceNumber = new Map<string, string>();

  let occupiedCount = 0;
  let totalSell = 0;
  let totalCurrent = 0;
  let totalSqft = 0;

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const spaceNumber = colSpaceNumber != null ? String(row[colSpaceNumber] ?? '').trim() : '';
    if (!spaceNumber) {
      if (row.every((cell) => isBlankCell(cell))) break;
      continue;
    }
    const type = colSpaceType != null ? String(row[colSpaceType] ?? '').trim() : '';
    const size = colSpaceSize != null ? String(row[colSpaceSize] ?? '').trim() : '';
    const statusRaw = colStatus != null ? String(row[colStatus] ?? '').trim() : '';
    const status = normalizeText(statusRaw);
    const sellRate = colSellRate != null ? coerceNumber(row[colSellRate]) : null;
    const currentRent = colCurrentRent != null ? coerceNumber(row[colCurrentRent]) : null;
    const sqft = colSqft != null ? coerceNumber(row[colSqft]) : null;

    if (type) typeBySpaceNumber.set(spaceNumber, type);

    if (status.includes('occupied')) {
      occupiedCount += 1;
      if (sellRate != null) totalSell += sellRate;
      if (currentRent != null) totalCurrent += currentRent;
      if (sqft != null) totalSqft += sqft;
      if (type && sqft != null) {
        occupiedRsfByType[type] = (occupiedRsfByType[type] ?? 0) + sqft;
      }
    } else if (vacantUnitsSample.length < 25) {
      vacantUnitsSample.push({
        unit: spaceNumber,
        type,
        size,
        status: statusRaw || undefined,
      });
    }
  }

  const pricing: MsrSnapshotPayload['pricing'] = {};
  if (occupiedCount > 0) {
    pricing.avgSellRateOccupied = totalSell / occupiedCount;
    pricing.avgCurrentRentOccupied = totalCurrent / occupiedCount;
  }
  if (totalSqft > 0) {
    pricing.avgSellRatePerSqftOccupied = totalSell / totalSqft;
    pricing.avgCurrentRentPerSqftOccupied = totalCurrent / totalSqft;
  }

  const unitMix: MsrSnapshotPayload['unitMix'] = {
    occupiedRsfByType,
    totalOccupiedRsf: Object.values(occupiedRsfByType).reduce((sum, value) => sum + value, 0),
  };

  return {
    pricing,
    unitMix,
    inventory: vacantUnitsSample.length ? { vacantUnitsSample } : undefined,
  };
};

const extractDelinquenciesSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(
    grid,
    0,
    25,
    [
      ['tenant', 'name'],
      ['space', 'unit'],
      ['days late', 'days'],
      ['past due', 'amount', 'balance'],
    ],
  );
  if (headerRow == null) {
    warnings.push('Delinquencies sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colTenant = findHeaderIndex(headers, ['tenant name', 'tenant']);
  const colUnit = findHeaderIndex(headers, ['space number', 'space', 'unit']);
  const colDays = findHeaderIndex(headers, ['days late', 'days']);
  const colPastDue = findHeaderIndex(headers, ['past due', 'amount', 'balance']);
  const colMoveIn = findHeaderIndex(headers, ['move in', 'start date', 'lease start']);

  const rows: Array<{
    tenant?: string;
    unit?: string;
    daysLate?: number;
    balance?: number;
    startDate?: string;
  }> = [];

  let totalPastDue = 0;
  let pastDue61 = 0;
  const aging = {
    days0to10: 0,
    days11to30: 0,
    days31to60: 0,
    days61plus: 0,
  };

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const tenant = colTenant != null ? String(row[colTenant] ?? '').trim() : '';
    const unit = colUnit != null ? String(row[colUnit] ?? '').trim() : '';
    const tenantNormalized = normalizeText(tenant);
    const unitNormalized = normalizeText(unit);
    const numericOnly = (value: string): boolean => /^\d+$/.test(value);
    const isNumericTenant = tenant ? numericOnly(tenant) : false;
    const isNumericUnit = unit ? numericOnly(unit) : false;
    const isTotalRow =
      ['total', 'totals', 'grand total'].includes(tenantNormalized) ||
      ['total', 'totals', 'grand total'].includes(unitNormalized) ||
      (tenantNormalized.includes('total') && !unitNormalized);
    if (isTotalRow || (isNumericTenant && isNumericUnit)) continue;
    const daysLate = colDays != null ? coerceNumber(row[colDays]) : null;
    const balance = colPastDue != null ? coerceNumber(row[colPastDue]) : null;
    const moveInRaw = colMoveIn != null ? row[colMoveIn] : null;
    const moveInDate = coerceDate(moveInRaw);
    if (!tenant && !unit) continue;

    const numericBalance = balance ?? 0;
    totalPastDue += numericBalance;
    if (daysLate != null) {
      if (daysLate <= 10) aging.days0to10 += numericBalance;
      else if (daysLate <= 30) aging.days11to30 += numericBalance;
      else if (daysLate <= 60) aging.days31to60 += numericBalance;
      else aging.days61plus += numericBalance;
      if (daysLate >= 61) pastDue61 += numericBalance;
    }

    rows.push({
      tenant: tenant || undefined,
      unit: unit || undefined,
      daysLate: daysLate ?? undefined,
      balance: balance ?? undefined,
      startDate: formatIsoDate(moveInDate),
    });
  }

  rows.sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0));

  return {
    ar: {
      totalPastDue,
      pastDue61Plus: pastDue61,
      delinquentTenantCount: rows.length,
      agingBuckets: { ...aging },
      aging: { ...aging },
      topDelinquencies: rows.slice(0, 10),
    },
  };
};

const extractOverlockedSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(
    grid,
    0,
    25,
    [['space', 'unit'], ['days late', 'days'], ['total balance', 'balance']],
  );
  if (headerRow == null) {
    warnings.push('Overlocked Spaces sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colDays = findHeaderIndex(headers, ['days late', 'days']);
  const colBalance = findHeaderIndex(headers, ['total balance', 'balance']);

  let count = 0;
  let totalBalance = 0;
  let totalDays = 0;
  const buckets = {
    d0_10: 0,
    d11_30: 0,
    d31_60: 0,
    d61_plus: 0,
  };

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const daysLate = colDays != null ? coerceNumber(row[colDays]) : null;
    const balance = colBalance != null ? coerceNumber(row[colBalance]) : null;
    if (daysLate == null && balance == null) continue;
    count += 1;
    if (balance != null) totalBalance += balance;
    if (daysLate != null) totalDays += daysLate;
    if (daysLate != null) {
      if (daysLate <= 10) buckets.d0_10 += 1;
      else if (daysLate <= 30) buckets.d11_30 += 1;
      else if (daysLate <= 60) buckets.d31_60 += 1;
      else buckets.d61_plus += 1;
    }
  }

  const hasOverlocks = count > 0;
  const bucketPct = hasOverlocks
    ? {
        d0_10: (buckets.d0_10 / count) * 100,
        d11_30: (buckets.d11_30 / count) * 100,
        d31_60: (buckets.d31_60 / count) * 100,
        d61_plus: (buckets.d61_plus / count) * 100,
      }
    : undefined;

  const bucketShare = bucketPct
    ? [
        { label: '0-10', percent: bucketPct.d0_10 },
        { label: '11-30', percent: bucketPct.d11_30 },
        { label: '31-60', percent: bucketPct.d31_60 },
        { label: '61+', percent: bucketPct.d61_plus },
      ]
    : undefined;

  const avgDaysLate = hasOverlocks ? totalDays / count : undefined;

  return {
    ar: {
      overlock: {
        overlockedUnitCount: count,
        totalBalance,
        avgDaysLate,
        bucketPct,
      },
      overlockedUnitCount: count,
      overlockTotalBalance: totalBalance,
      overlockAvgDaysLate: avgDaysLate,
      overlockBucketShare: bucketShare,
    },
  };
};

const extractRentChangeSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(grid, 0, 25, [['rent change', 'variance', '%']]);
  if (headerRow == null) {
    warnings.push('Rent Change sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colVariance = findHeaderIndex(headers, ['rent change % variance', 'rent change', 'variance']);

  let count = 0;
  let totalPct = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    if (colVariance == null) continue;
    const pct = coercePercent(row[colVariance]);
    if (pct == null) continue;
    count += 1;
    totalPct += pct;
  }
  return {
    pricing: {
      rentChangeCount: count,
      avgRentChangePct: count ? totalPct / count : undefined,
    },
  };
};

const extractNoRentChangeSheet = (
  grid: Grid,
  warnings: string[],
  occupancyTypeBySpace: Map<string, string>,
): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(grid, 0, 25, [['space', 'unit'], ['name']]);
  if (headerRow == null) {
    warnings.push('No Rent Change Last 12 Months sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colSpace = findHeaderIndex(headers, ['space name', 'space number', 'space', 'unit']);

  let count = 0;
  const byType: Record<string, number> = {};
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const spaceName = colSpace != null ? String(row[colSpace] ?? '').trim() : '';
    if (!spaceName) continue;
    count += 1;
    const type = occupancyTypeBySpace.get(spaceName) ?? 'Unknown';
    byType[type] = (byType[type] ?? 0) + 1;
  }

  return {
    pricing: {
      noRentChange12MoCount: count,
      noRentChange12MoByType: Object.keys(byType).length ? byType : undefined,
    },
  };
};

const extractCoverageEnrollmentSheet = (grid: Grid, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const headerRow = findHeaderRow(grid, 0, 25, [['premium']]);
  if (headerRow == null) {
    warnings.push('Coverage Enrollment sheet: header row not found.');
    return {};
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colPremium = findHeaderIndex(headers, ['premium']);

  let sum = 0;
  let rows = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    if (colPremium == null) continue;
    const value = coerceNumber(row[colPremium]);
    if (value == null) continue;
    sum += value;
    rows += 1;
  }

  return {
    coverage: {
      premiumSum: rows ? sum : undefined,
      premiumMtd: rows ? sum : undefined,
    },
  };
};

const sumColumnFromSheet = (
  grid: Grid,
  warnings: string[],
  sheetLabel: string,
  headerKeywords: string[],
): number | null => {
  const headerRow = findHeaderRow(grid, 0, 25, [headerKeywords]);
  if (headerRow == null) {
    warnings.push(`${sheetLabel} sheet: header row not found.`);
    return null;
  }
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const col = findHeaderIndex(headers, headerKeywords);
  if (col == null) {
    warnings.push(`${sheetLabel} sheet: amount column not found.`);
    return null;
  }
  let sum = 0;
  let rows = 0;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const value = coerceNumber(row[col]);
    if (value == null) continue;
    sum += value;
    rows += 1;
  }
  return rows ? sum : null;
};

const extractConcessions = (workbook: XLSX.WorkBook, warnings: string[]): Partial<MsrSnapshotPayload> => {
  const discountsSheet = findSheet(workbook, ['discounts&promotionsmtd', 'discounts promotions mtd', 'discounts promotions']);
  const creditsSheet = findSheet(workbook, ['credits&adjustmentsmtd', 'credits adjustments mtd', 'credits adjustments']);
  const refundsSheet = findSheet(workbook, ['refundsmtd', 'refunds mtd']);
  const writeOffsSheet = findSheet(workbook, ['write-offsmtd', 'write offs mtd', 'writeoffs mtd']);

  if (!discountsSheet) warnings.push('Workbook is missing "Discounts & Promotions MTD" worksheet.');
  if (!creditsSheet) warnings.push('Workbook is missing "Credits & Adjustments MTD" worksheet.');
  if (!refundsSheet) warnings.push('Workbook is missing "Refunds MTD" worksheet.');
  if (!writeOffsSheet) warnings.push('Workbook is missing "Write-Offs MTD" worksheet.');

  const promos = discountsSheet
    ? sumColumnFromSheet(sheetToGrid(discountsSheet), warnings, 'Discounts & Promotions MTD', ['promotion', 'amount'])
    : null;
  const credits = creditsSheet
    ? sumColumnFromSheet(sheetToGrid(creditsSheet), warnings, 'Credits & Adjustments MTD', ['amount'])
    : null;
  const refunds = refundsSheet
    ? sumColumnFromSheet(sheetToGrid(refundsSheet), warnings, 'Refunds MTD', ['refund', 'amount'])
    : null;
  const writeOffs = writeOffsSheet
    ? sumColumnFromSheet(sheetToGrid(writeOffsSheet), warnings, 'Write-Offs MTD', ['write', 'amount'])
    : null;

  const refundsWriteoffs =
    refunds != null || writeOffs != null ? (refunds ?? 0) + (writeOffs ?? 0) : null;

  return {
    concessions: {
      promosDiscountsMtd: promos ?? undefined,
      creditsAdjustmentsMtd: credits ?? undefined,
      refundsMtd: refunds ?? undefined,
      writeOffsMtd: writeOffs ?? undefined,
      refundsWriteoffsMtd: refundsWriteoffs ?? undefined,
    },
  };
};

const buildOccupancyTypeLookup = (grid: Grid): Map<string, string> => {
  const map = new Map<string, string>();
  const headerRow = findHeaderRow(
    grid,
    0,
    25,
    [['space number', 'space #', 'space'], ['space type', 'type']],
  );
  if (headerRow == null) return map;
  const headers = (grid[headerRow] ?? []).map((cell) => normalizeText(cell));
  const colSpace = findHeaderIndex(headers, ['space number', 'space #', 'space']);
  const colType = findHeaderIndex(headers, ['space type', 'type']);
  if (colSpace == null || colType == null) return map;
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    if (isBlankRow(row)) break;
    const space = String(row[colSpace] ?? '').trim();
    const type = String(row[colType] ?? '').trim();
    if (space && type) map.set(space, type);
  }
  return map;
};
export function parseMsrWorkbook(buffer: ArrayBuffer | Buffer): MsrParseResult {
  const warnings: string[] = [];
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Unable to read workbook.');
  }

  const msrSheet = findSheet(workbook, ['msr']);
  if (!msrSheet) {
    warnings.push('Workbook is missing required "MSR" worksheet.');
  }

  const snapshot: MsrSnapshotPayload = {};
  if (msrSheet) {
    const msrGrid = sheetToGrid(msrSheet);
    Object.assign(snapshot, extractMsrSheet(msrGrid, msrSheet, warnings));
  }

  const occupancySheet = findSheet(workbook, ['occupancy']);
  const occupancyTypeLookup = occupancySheet ? buildOccupancyTypeLookup(sheetToGrid(occupancySheet)) : new Map();
  if (occupancySheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractOccupancySheet(sheetToGrid(occupancySheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Occupancy" worksheet.');
  }

  const delinquenciesSheet = findSheet(workbook, ['delinquencies', 'delinquency']);
  if (delinquenciesSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractDelinquenciesSheet(sheetToGrid(delinquenciesSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Delinquencies" worksheet.');
  }

  const overlockedSheet = findSheet(workbook, ['overlockedspaces', 'overlocked spaces']);
  if (overlockedSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractOverlockedSheet(sheetToGrid(overlockedSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Overlocked Spaces" worksheet.');
  }

  const rentChangeSheet = findSheet(workbook, ['rentchange', 'rent change']);
  if (rentChangeSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractRentChangeSheet(sheetToGrid(rentChangeSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Rent Change" worksheet.');
  }

  const noRentChangeSheet = findSheet(workbook, ['norentchangelast12months', 'no rent change last 12 months']);
  if (noRentChangeSheet) {
    const existingNoChange = snapshot.pricing?.noRentChange12MoCount ?? null;
    const noChange = extractNoRentChangeSheet(sheetToGrid(noRentChangeSheet), warnings, occupancyTypeLookup);
    if (existingNoChange != null) {
      noChange.pricing = { ...noChange.pricing, noRentChange12MoCount: existingNoChange };
    }
    Object.assign(
      snapshot,
      mergeSnapshot(
        snapshot,
        noChange,
      ),
    );
  } else {
    warnings.push('Workbook is missing "No Rent Change Last 12 Months" worksheet.');
  }

  const coverageSheet = findSheet(workbook, ['coverageenrollment', 'coverage enrollment']);
  if (coverageSheet) {
    Object.assign(snapshot, mergeSnapshot(snapshot, extractCoverageEnrollmentSheet(sheetToGrid(coverageSheet), warnings)));
  } else {
    warnings.push('Workbook is missing "Coverage Enrollment" worksheet.');
  }

  Object.assign(snapshot, mergeSnapshot(snapshot, extractConcessions(workbook, warnings)));

  const leads = snapshot.leads ?? {};
  const channelTotals = [
    leads.webMtd ?? 0,
    leads.walkInMtd ?? 0,
    leads.phoneMtd ?? 0,
    leads.otherMtd ?? 0,
  ];
  const leadsTotal = channelTotals.reduce((sum, value) => sum + value, 0);
  leads.totalMtd = leadsTotal || leads.totalMtd;
  leads.byChannelMtd = {
    web: leads.webMtd,
    walkIn: leads.walkInMtd,
    phone: leads.phoneMtd,
    other: leads.otherMtd,
  };
  snapshot.leads = leads;

  const rentals = snapshot.rentals ?? {};
  if (rentals.netMoveInsMtd == null && rentals.moveInsMtd != null && rentals.moveOutsMtd != null) {
    rentals.netMoveInsMtd = rentals.moveInsMtd - rentals.moveOutsMtd;
  }
  if (rentals.netMtd == null && rentals.netMoveInsMtd != null) {
    rentals.netMtd = rentals.netMoveInsMtd;
  }
  snapshot.rentals = rentals;

  if (leadsTotal > 0 && rentals.moveInsMtd != null) {
    leads.conversionPct = (rentals.moveInsMtd / leadsTotal) * 100;
  }
  snapshot.leads = leads;

  const unitMix = snapshot.unitMix;
  if (unitMix?.occupiedRsfByType) {
    const total = unitMix.totalOccupiedRsf ?? Object.values(unitMix.occupiedRsfByType).reduce((sum, value) => sum + value, 0);
    unitMix.totalOccupiedRsf = total;
    unitMix.totalRsf = unitMix.totalRsf ?? snapshot.occupancy?.totalRsf;
    if (total > 0) {
      const pctByType: Record<string, number> = {};
      Object.entries(unitMix.occupiedRsfByType).forEach(([key, value]) => {
        pctByType[key] = (value / total) * 100;
      });
      unitMix.occupiedPctByType = pctByType;
    }
    snapshot.unitMix = unitMix;
  }

  const sections = buildSectionFlags(snapshot);
  return { snapshot, warnings, sections };
}

function mergeSnapshot(
  base: MsrSnapshotPayload,
  incoming: Partial<MsrSnapshotPayload>,
): MsrSnapshotPayload {
  return {
    ...base,
    ...incoming,
    occupancy: { ...base.occupancy, ...incoming.occupancy },
    revenue: { ...base.revenue, ...incoming.revenue },
    rentals: { ...base.rentals, ...incoming.rentals },
    leads: { ...base.leads, ...incoming.leads },
    ar: { ...base.ar, ...incoming.ar },
    pricing: { ...base.pricing, ...incoming.pricing },
    autopay: { ...base.autopay, ...incoming.autopay },
    coverage: { ...base.coverage, ...incoming.coverage },
    concessions: { ...base.concessions, ...incoming.concessions },
    unitMix: { ...base.unitMix, ...incoming.unitMix },
    inventory: { ...base.inventory, ...incoming.inventory },
  };
}
