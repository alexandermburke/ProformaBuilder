import * as XLSX from 'xlsx';

export type DealTrackerEntry = {
  dealNumber: string;
  dealType: string;
  facilityName: string;
  fullAddress: string;
  city: string;
  state: string;
  region: string;
  currentManagement: string;
  nrsf: number | null;
  totalUnits: number | null;
  occupancyPct: number | null;
  effectiveRatePerSf: number | null;
  grossRevenue: number | null;
  noi: number | null;
  askingPrice: number | null;
  pricePerSf: number | null;
  capRatePct: number | null;
  active: boolean | null;
  dealStatus: string;
  callForOffersDate: string;
  brokerContact: string;
  yearBuilt: string;
  climateControlled: string;
  proformaStatus: string;
  notes: string;
  raw: Record<string, string>;
};

const HEADER_KEYS = {
  dealNumber: ['Deal #', 'Deal Number', 'Deal No', 'Deal#', 'Priority', 'Priority #'],
  dealType: ['Deal Type', 'Type'],
  facilityName: ['Facility Name', 'Property', 'Property Name'],
  fullAddress: ['Full Address', 'Address'],
  city: ['City'],
  state: ['State'],
  region: ['Region'],
  currentManagement: ['Current Management', 'Management', 'Current Mgmt'],
  nrsf: ['NRSF', 'Net Rentable SF', 'Rentable SF'],
  totalUnits: ['Total Units', 'Units'],
  occupancyPct: ['Occupancy %', 'Occupancy', 'Occ %'],
  effectiveRatePerSf: ['Effective Rate ($/SF)', 'Effective Rate', 'Eff Rate'],
  grossRevenue: ['Gross Revenue', 'Revenue'],
  noi: ['NOI'],
  askingPrice: ['Asking Price', 'Price'],
  pricePerSf: ['Price / SF', 'Price/SF', '$/SF', 'Price per SF'],
  capRatePct: ['Cap Rate', 'Cap'],
  active: ['Active Deal?', 'Active?', 'Active'],
  dealStatus: ['Deal Status', 'Status'],
  callForOffersDate: ['Call for Offers Date', 'Call for Offers', 'CFO Date'],
  brokerContact: ['Broker / Contact', 'Broker', 'Broker/Contact'],
  yearBuilt: ['Year Built'],
  climateControlled: ['Climate Controlled?', 'Climate Controlled', 'CC?'],
  proformaStatus: ['Proforma Status', 'Proforma'],
  notes: ['Notes', 'Comments'],
} as const satisfies Record<string, readonly string[]>;

type FieldKey = keyof typeof HEADER_KEYS;

function normalizeHeader(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildHeaderIndex(headers: string[]): Partial<Record<FieldKey, number>> {
  const lookup = new Map<string, number>();
  headers.forEach((h, i) => {
    lookup.set(normalizeHeader(h), i);
  });
  const result: Partial<Record<FieldKey, number>> = {};
  for (const key of Object.keys(HEADER_KEYS) as FieldKey[]) {
    for (const candidate of HEADER_KEYS[key]) {
      const idx = lookup.get(normalizeHeader(candidate));
      if (idx !== undefined) {
        result[key] = idx;
        break;
      }
    }
  }
  return result;
}

function cellString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function parseNumeric(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[$,]/g, '')
    .replace(/\s/g, '')
    .replace(/%$/, '')
    .replace(/^\(/, '-')
    .replace(/\)$/, '');
  if (cleaned === '' || cleaned === '-') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseBooleanish(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['yes', 'y', 'true', '1', 'active'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'inactive'].includes(v)) return false;
  return null;
}

function getCell(row: unknown[], idx: number | undefined): string {
  if (idx === undefined) return '';
  return cellString(row[idx]);
}

export type ParsedDealTracker = {
  entries: DealTrackerEntry[];
  detectedHeaders: string[];
  missingHeaders: FieldKey[];
};

export function parseDealTrackerWorkbook(buffer: Buffer): ParsedDealTracker {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames.find((n) => /deal/i.test(n)) ?? workbook.SheetNames[0];
  if (!sheetName) {
    return { entries: [], detectedHeaders: [], missingHeaders: Object.keys(HEADER_KEYS) as FieldKey[] };
  }
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  }) as unknown[][];
  if (aoa.length === 0) {
    return { entries: [], detectedHeaders: [], missingHeaders: Object.keys(HEADER_KEYS) as FieldKey[] };
  }
  const headerRow = aoa[0].map(cellString);
  const idx = buildHeaderIndex(headerRow);
  const missingHeaders = (Object.keys(HEADER_KEYS) as FieldKey[]).filter((k) => idx[k] === undefined);

  const entries: DealTrackerEntry[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const row = aoa[i];
    const dealNumber = getCell(row, idx.dealNumber);
    const facilityName = getCell(row, idx.facilityName);
    // Deal # is the primary key for write-back and Firestore. Rows without one
    // are excluded — they can't be uniquely keyed in the picker or updated in
    // SharePoint.
    if (!dealNumber) continue;

    const raw: Record<string, string> = {};
    headerRow.forEach((h, ci) => {
      if (h) raw[h] = cellString(row[ci]);
    });

    entries.push({
      dealNumber,
      dealType: getCell(row, idx.dealType),
      facilityName,
      fullAddress: getCell(row, idx.fullAddress),
      city: getCell(row, idx.city),
      state: getCell(row, idx.state),
      region: getCell(row, idx.region),
      currentManagement: getCell(row, idx.currentManagement),
      nrsf: parseNumeric(getCell(row, idx.nrsf)),
      totalUnits: parseNumeric(getCell(row, idx.totalUnits)),
      occupancyPct: parseNumeric(getCell(row, idx.occupancyPct)),
      effectiveRatePerSf: parseNumeric(getCell(row, idx.effectiveRatePerSf)),
      grossRevenue: parseNumeric(getCell(row, idx.grossRevenue)),
      noi: parseNumeric(getCell(row, idx.noi)),
      askingPrice: parseNumeric(getCell(row, idx.askingPrice)),
      pricePerSf: parseNumeric(getCell(row, idx.pricePerSf)),
      capRatePct: parseNumeric(getCell(row, idx.capRatePct)),
      active: parseBooleanish(getCell(row, idx.active)),
      dealStatus: getCell(row, idx.dealStatus),
      callForOffersDate: getCell(row, idx.callForOffersDate),
      brokerContact: getCell(row, idx.brokerContact),
      yearBuilt: getCell(row, idx.yearBuilt),
      climateControlled: getCell(row, idx.climateControlled),
      proformaStatus: getCell(row, idx.proformaStatus),
      notes: getCell(row, idx.notes),
      raw,
    });
  }
  return { entries, detectedHeaders: headerRow, missingHeaders };
}

export function formatTrackerEntryForPrompt(entry: DealTrackerEntry): string {
  const lines: string[] = [];
  const push = (label: string, value: string | number | boolean | null): void => {
    if (value === null || value === undefined || value === '') return;
    lines.push(`- ${label}: ${value}`);
  };
  push('Deal #', entry.dealNumber);
  push('Deal type', entry.dealType);
  push('Facility', entry.facilityName);
  push('Address', entry.fullAddress);
  push('City', entry.city);
  push('State', entry.state);
  push('Region', entry.region);
  push('Current management', entry.currentManagement);
  push('NRSF', entry.nrsf);
  push('Total units', entry.totalUnits);
  push('Occupancy %', entry.occupancyPct);
  push('Effective rate ($/SF)', entry.effectiveRatePerSf);
  push('Gross revenue', entry.grossRevenue);
  push('NOI', entry.noi);
  push('Asking price', entry.askingPrice);
  push('Price/SF', entry.pricePerSf);
  push('Cap rate %', entry.capRatePct);
  push('Active deal', entry.active);
  push('Deal status', entry.dealStatus);
  push('Call for offers date', entry.callForOffersDate);
  push('Broker/contact', entry.brokerContact);
  push('Year built', entry.yearBuilt);
  push('Climate controlled', entry.climateControlled);
  push('Proforma status', entry.proformaStatus);
  push('Notes', entry.notes);
  return lines.join('\n');
}
