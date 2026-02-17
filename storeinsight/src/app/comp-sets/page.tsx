/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { useTheme } from '@/components/ThemeProvider';

type SpreadsheetProperty = {
  id: string;
  name: string;
  code?: string;
};

const normalizeFilenameValue = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const PROPERTY_NAME_HEADERS = [
  'property name',
  'facility name',
  'site name',
  'store name',
  'location name',
  'property',
  'facility',
  'site',
  'store',
  'location',
];
const PROPERTY_ID_HEADERS = [
  'property id',
  'property code',
  'facility id',
  'facility code',
  'site id',
  'site code',
  'store id',
  'store code',
  'store #',
  'store number',
  'facility #',
  'property #',
  'site #',
];
const PLACEHOLDER_PROPERTIES = Array.from({ length: 8 }, (_, idx) => `Placeholder property ${idx + 1}`);
const IGNORED_PROPERTY_TOKENS = new Set(
  ['', 'n/a', 'na', 'none', 'total', 'grand total', 'summary', '-'].map((value) => normalizeFilenameValue(value)),
);
const normalizeCellValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};
const normalizeHeaderValue = (value: unknown): string =>
  normalizeCellValue(value).toLowerCase().replace(/[\s_]+/g, ' ').trim();
const normalizeHeaderToken = (value: string): string => value.toLowerCase().replace(/\s+/g, '');
const hasIdMarker = (header: string): boolean =>
  ['id', 'code', '#', 'number'].some((marker) => header.includes(marker));

const COMPSET_HEADERS = {
  storeName: ['storename', 'store name', 'facility name', 'property name'],
  address: ['address', 'street', 'address1'],
  city: ['city'],
  state: ['state', 'st'],
} as const;

const findHeaderIndex = (headers: string[], keywords: string[], options?: { rejectIfId?: boolean }): number => {
  const { rejectIfId } = options ?? {};
  const normalizedKeywords = keywords.map((value) => ({
    raw: value,
    token: normalizeHeaderToken(value),
  }));
  for (let idx = 0; idx < headers.length; idx += 1) {
    const header = headers[idx] ?? '';
    const token = normalizeHeaderToken(header);
    if (!header) continue;
    if (rejectIfId && hasIdMarker(header)) continue;
    const match = normalizedKeywords.some((keyword) => header.includes(keyword.raw) || token.includes(keyword.token));
    if (match) return idx;
  }
  return -1;
};

const findHeaderRow = (rows: unknown[][]): { index: number; nameIndex: number; idIndex: number } | null => {
  const scanLimit = Math.min(rows.length, 12);
  for (let idx = 0; idx < scanLimit; idx += 1) {
    const row = rows[idx] ?? [];
    const headers = row.map((cell) => normalizeHeaderValue(cell));
    const nameIndex = findHeaderIndex(headers, PROPERTY_NAME_HEADERS, { rejectIfId: true });
    const idIndex = findHeaderIndex(headers, PROPERTY_ID_HEADERS);
    if (nameIndex >= 0 || idIndex >= 0) {
      return { index: idx, nameIndex, idIndex };
    }
  }
  return null;
};

const findCompSetHeaderRow = (
  rows: unknown[][],
): { index: number; storeIndex: number; addressIndex: number; cityIndex: number; stateIndex: number } | null => {
  const scanLimit = Math.min(rows.length, 12);
  for (let idx = 0; idx < scanLimit; idx += 1) {
    const row = rows[idx] ?? [];
    const headers = row.map((cell) => normalizeHeaderValue(cell));
    const storeIndex = findHeaderIndex(headers, COMPSET_HEADERS.storeName, { rejectIfId: true });
    const addressIndex = findHeaderIndex(headers, COMPSET_HEADERS.address);
    if (storeIndex < 0 || addressIndex < 0) continue;
    return {
      index: idx,
      storeIndex,
      addressIndex,
      cityIndex: findHeaderIndex(headers, COMPSET_HEADERS.city),
      stateIndex: findHeaderIndex(headers, COMPSET_HEADERS.state),
    };
  }
  return null;
};

const addPropertyCandidate = (candidates: Map<string, SpreadsheetProperty>, candidate: SpreadsheetProperty): void => {
  const key = normalizeFilenameValue(candidate.id || candidate.name);
  if (!key || IGNORED_PROPERTY_TOKENS.has(key)) return;
  if (candidates.has(key)) return;
  candidates.set(key, candidate);
};

const extractPropertiesFromRows = (rows: unknown[][]): SpreadsheetProperty[] => {
  const candidates = new Map<string, SpreadsheetProperty>();

  const compHeader = findCompSetHeaderRow(rows);
  if (compHeader) {
    const { index, storeIndex, addressIndex, cityIndex, stateIndex } = compHeader;
    for (let rowIdx = index + 1; rowIdx < rows.length; rowIdx += 1) {
      const row = rows[rowIdx] ?? [];
      const nameValue = normalizeCellValue(row[storeIndex]);
      const addressValue = normalizeCellValue(row[addressIndex]);
      const cityValue = cityIndex >= 0 ? normalizeCellValue(row[cityIndex]) : '';
      const stateValue = stateIndex >= 0 ? normalizeCellValue(row[stateIndex]) : '';
      if (!nameValue || !addressValue) continue;
      const id = [nameValue, addressValue, cityValue, stateValue].filter(Boolean).join(' | ');
      const candidate: SpreadsheetProperty = {
        id,
        name: nameValue,
        code: [cityValue, stateValue].filter(Boolean).join(', ') || undefined,
      };
      addPropertyCandidate(candidates, candidate);
    }
    return Array.from(candidates.values());
  }
  const headerInfo = findHeaderRow(rows);
  if (headerInfo) {
    const { index, nameIndex, idIndex } = headerInfo;
    for (let rowIdx = index + 1; rowIdx < rows.length; rowIdx += 1) {
      const row = rows[rowIdx] ?? [];
      const nameValue = nameIndex >= 0 ? normalizeCellValue(row[nameIndex]) : '';
      const idValue = idIndex >= 0 ? normalizeCellValue(row[idIndex]) : '';
      const name = nameValue.trim();
      const id = idValue.trim();
      if (!name && !id) continue;
      const candidate: SpreadsheetProperty = {
        id: id || name,
        name: name || id,
        code: id || undefined,
      };
      if (IGNORED_PROPERTY_TOKENS.has(normalizeFilenameValue(candidate.name))) continue;
      addPropertyCandidate(candidates, candidate);
    }
  }

  if (candidates.size === 0) {
    for (const row of rows) {
      const primaryValue = normalizeCellValue(row?.[0]);
      if (!primaryValue) continue;
      const normalizedValue = normalizeHeaderToken(primaryValue);
      if (IGNORED_PROPERTY_TOKENS.has(normalizeFilenameValue(normalizedValue))) continue;
      const candidate: SpreadsheetProperty = {
        id: primaryValue,
        name: primaryValue,
      };
      addPropertyCandidate(candidates, candidate);
    }
  }

  return Array.from(candidates.values());
};

const extractPropertiesFromWorkbook = async (file: File): Promise<SpreadsheetProperty[]> => {
  const buffer = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array' });
  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }) as unknown[][];
    if (!rows || rows.length === 0) continue;
    const result = extractPropertiesFromRows(rows);
    if (result.length > 0) {
      return result;
    }
  }
  return [];
};

export default function CompSetsPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [properties, setProperties] = useState<SpreadsheetProperty[]>([]);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [asOfDate, setAsOfDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [manualNotes, setManualNotes] = useState('');
  const [propertyListMessage, setPropertyListMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const propertiesRef = useRef<SpreadsheetProperty[]>([]);

  const autoDetectFromFile = useCallback(
    (
      file: File | null | undefined,
      propertyList: SpreadsheetProperty[],
    ): { foundProperty?: SpreadsheetProperty; date?: string } => {
      if (!file) return {};
      const fileName = file.name.toLowerCase();
      const normalizedFileName = normalizeFilenameValue(file.name);
      const dateMatch = fileName.match(/\d{4}-\d{2}-\d{2}/);
      const date = dateMatch?.[0];
      const foundProperty = propertyList.find((prop) => {
        const candidates = [prop.name, prop.code, prop.id].filter(Boolean);
        return candidates.some((candidate) => normalizedFileName.includes(normalizeFilenameValue(String(candidate))));
      });
      return { foundProperty, date };
    },
    [],
  );

  const refreshProperties = useCallback((nextProperties: SpreadsheetProperty[]) => {
    setProperties(nextProperties);
    propertiesRef.current = nextProperties;
  }, []);

  useEffect(() => {
    if (!uploadFile || properties.length === 0) return;
    const { foundProperty, date } = autoDetectFromFile(uploadFile, properties);
    if (foundProperty) {
      setSelectedPropertyId(foundProperty.id);
    } else if (!selectedPropertyId || !properties.some((prop) => prop.id === selectedPropertyId)) {
      setSelectedPropertyId(properties[0].id);
    }
    if (date) {
      setAsOfDate(date);
    }
  }, [uploadFile, properties, autoDetectFromFile, selectedPropertyId]);

  const parseErrorMessage = async (res: Response): Promise<string | null> => {
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) return data.error;
    } catch {
      // ignore
    }
    return res.statusText || null;
  };

  const acceptUploadFile = async (file: File | null | undefined) => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.csv')) {
      setToast('Upload must be a .xlsx or .csv file.');
      return;
    }
    setManualMessage(null);
    setPropertyListMessage(null);
    setUploadFile(file);
    const { date } = autoDetectFromFile(file, propertiesRef.current);
    if (date) {
      setAsOfDate(date);
    }

    try {
      const extracted = await extractPropertiesFromWorkbook(file);
      refreshProperties(extracted);
      if (extracted.length > 0) {
        const propertyFromFilename = autoDetectFromFile(file, extracted).foundProperty;
        if (propertyFromFilename) {
          setSelectedPropertyId(propertyFromFilename.id);
        } else if (!selectedPropertyId || !extracted.some((prop) => prop.id === selectedPropertyId)) {
          setSelectedPropertyId(extracted[0].id);
        }
        setPropertyListMessage(`Loaded ${extracted.length} properties from the spreadsheet.`);
      } else {
        refreshProperties([]);
        setSelectedPropertyId('');
        setPropertyListMessage('No properties detected in the spreadsheet.');
      }
    } catch (err) {
      console.error('[comp-sets] unable to parse spreadsheet properties', err);
      refreshProperties([]);
      setSelectedPropertyId('');
      setPropertyListMessage('Unable to read property list from the spreadsheet.');
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    void acceptUploadFile(file);
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
    const file = event.dataTransfer?.files?.[0];
    void acceptUploadFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDraggingFile) setIsDraggingFile(false);
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const handleManualCompSet = async () => {
    if (!selectedPropertyId) {
      setToast('Select a property from the spreadsheet.');
      return;
    }
    if (!asOfDate) {
      setToast('Choose an "As of" date.');
      return;
    }
    if (!uploadFile) {
      setToast('Upload a comp set workbook (.xlsx).');
      return;
    }

    setManualSubmitting(true);
    setManualMessage(null);

    try {
      const property = properties.find((prop) => prop.id === selectedPropertyId);
      if (!property) {
        setToast('Select a property from the spreadsheet.');
        return;
      }
      const form = new FormData();
      form.append('propertyId', selectedPropertyId);
      form.append('propertyName', property.name || selectedPropertyId);
      if (property.code) {
        form.append('propertyCode', property.code);
      }
      form.append('asOfDate', asOfDate);
      form.append('file', uploadFile);
      if (manualNotes.trim()) {
        form.append('notes', manualNotes.trim());
      }

      const res = await fetch('/api/comp-sets/manual', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const message = await parseErrorMessage(res);
        setToast(message ?? 'Unable to generate comp set PPTX.');
        return;
      }

      const blob = await res.blob();
      const propertyLabel = property.code || property.name || property.id || selectedPropertyId;
      const safeProperty = propertyLabel.replace(/[^A-Za-z0-9._-]+/g, '_');
      const safeDate = (asOfDate || 'latest').replace(/[^0-9A-Za-z._-]+/g, '_');
      const filename = `CompSet-${safeProperty}-${safeDate}.pptx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setManualMessage('Comp set PPTX generated.');
    } catch (err) {
      console.error('[comp-sets/manual] generation failed', err);
      setToast('Unable to generate comp set PPTX.');
    } finally {
      setManualSubmitting(false);
    }
  };

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.3),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_16%_12%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_84%_86%,rgba(125,211,252,0.14),transparent_62%)]';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Comp Set Reports</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                Build competitive pricing snapshots for STORE assets. Upload the latest comp set workbook and download a
                ready-to-share PPTX.
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
        </header>

        <section className="grid gap-6">
          <div className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Manual Comp Set Report</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Upload the latest comp set workbook and download a presentation-ready PPTX.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property list
                </label>
                <div
                  className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 p-2 shadow-inner"
                  role="listbox"
                  aria-label="Comp set properties"
                  aria-disabled={properties.length === 0}
                >
                  <ul className="max-h-60 divide-y divide-[color:var(--border-soft)] overflow-y-auto">
                    {properties.length > 0 ? (
                      properties.map((prop) => {
                        const isSelected = prop.id === selectedPropertyId;
                        return (
                          <li key={prop.id}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => setSelectedPropertyId(prop.id)}
                              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                                isSelected
                                  ? 'bg-[rgba(37,99,235,0.16)] text-[color:var(--text-primary)]'
                                  : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--surface-subtle)]/70'
                              }`}
                            >
                              <span className="font-semibold text-[color:var(--text-primary)]">{prop.name}</span>
                              {prop.code && (
                                <span className="text-xs font-semibold text-[color:var(--text-muted)]">{prop.code}</span>
                              )}
                            </button>
                          </li>
                        );
                      })
                    ) : (
                      PLACEHOLDER_PROPERTIES.map((label) => (
                        <li key={label} className="px-3 py-2 text-xs text-[color:var(--text-muted)]">
                          {label}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
                {propertyListMessage && (
                  <p className="text-xs text-[color:var(--text-secondary)]">{propertyListMessage}</p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  As of date
                </label>
                <input
                  type="date"
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Comp set workbook (.xlsx)
                </label>
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center shadow-inner transition-colors duration-150 ${
                    isDraggingFile
                      ? 'border-[color:var(--accent)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface-muted) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 50%,transparent))]'
                      : 'border-[color:var(--border-soft)] bg-[color:var(--surface)]/70'
                  }`}
                  onDrop={handleFileDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                  <div className="flex flex-col gap-1 text-sm text-[color:var(--text-secondary)]">
                    <span className="font-semibold text-[color:var(--text-primary)]">Drop XLSX or CSV here</span>
                    <span>or click to browse</span>
                  </div>
                  {uploadFile ? (
                    <span className="text-xs font-semibold text-[color:var(--text-primary)]">Selected: {uploadFile.name}</span>
                  ) : (
                    <span className="text-xs text-[color:var(--text-muted)]">Only one .xlsx or .csv file is needed.</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Optional notes (included on the cover slide)
                </label>
                <textarea
                  rows={3}
                  value={manualNotes}
                  onChange={(e) => setManualNotes(e.target.value)}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="Add context about the comp set or timing"
                />
              </div>

              <button
                type="button"
                disabled={!selectedPropertyId || !uploadFile || manualSubmitting}
                className="ios-button w-full px-4 py-2 text-sm font-semibold"
                data-variant="primary"
                onClick={handleManualCompSet}
              >
                {manualSubmitting ? 'Generating...' : 'Generate Comp Set PPTX'}
              </button>
              {manualSubmitting && (
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-[color:var(--surface-subtle)]">
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(37,99,235,0.15),rgba(125,179,255,0.3),rgba(37,99,235,0.15))]" />
                  <div className="progress-gleam absolute left-[-50%] top-0 h-full w-1/2 rounded-full bg-[color:var(--accent)] opacity-90" />
                </div>
              )}

              {manualMessage && <p className="text-xs text-[color:var(--text-secondary)]">{manualMessage}</p>}
            </div>
          </div>
        </section>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-40">
          <div className="flex items-center gap-3 rounded-2xl border border-[rgba(248,113,113,0.35)] bg-[rgba(248,113,113,0.9)] px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-black/20 backdrop-blur-sm dark:border-[rgba(248,113,113,0.55)] dark:bg-[rgba(239,68,68,0.92)]">
            <span>{toast}</span>
            <button
              type="button"
              className="rounded-full bg-white/20 px-2 py-1 text-xs font-semibold transition hover:bg-white/30"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
