'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import type { WorkbookSectionKey } from '@/lib/lakehouse/proformaLakehouse';

type OperatorTemplate = {
  id: string;
  label: string;
  family: string;
  description: string;
  acceptedFiles: string[];
  exampleWorkbook: string;
  expectedSections: string[];
};

const operatorTemplates: OperatorTemplate[] = [
  {
    id: 'extra-space',
    label: 'Extra Space',
    family: 'Owner financials workbook',
    description: 'Ops Summary, Unit Status, Unit Rate, Rolling IS, Rent Roll, and Unit Mix style package.',
    acceptedFiles: ['.xlsx', '.xlsm', '.xls'],
    exampleWorkbook: 'Extra8938 Owner Financials 2025-12 North Charleston - Ashley Phosphate (002).xlsx',
    expectedSections: ['Ops Summary', 'Unit Status', 'Unit Rate', 'Rolling IS', 'Rent Roll', 'Unit Mix'],
  },
  {
    id: 'wentworth-results',
    label: 'Wentworth Results',
    family: 'Property results workbook',
    description: 'IS, BS, YOY, Act v Bud, Trial Balance, GL, and Rent Roll package for owner reporting.',
    acceptedFiles: ['.xlsx', '.xls'],
    exampleWorkbook: '01-2026 77712 - Wentworth (Vacaville, CA) Results.xlsx',
    expectedSections: ['Income Statement', 'Balance Sheet', 'Act v Bud', 'Trial Balance', 'GL', 'Rent Roll'],
  },
  {
    id: 'cubesmart',
    label: 'CubeSmart',
    family: 'Financials + rental experience',
    description: 'Summary of Rental Experience, SRE Detail, 36 Month Summary, Balance Sheets, and Rent Roll package.',
    acceptedFiles: ['.xlsx', '.xls'],
    exampleWorkbook: 'CUBE5773 Financials December 2025.xlsx',
    expectedSections: ['Rental Experience', 'SRE Detail', '36 Month Summary', 'Balance Sheets', 'Rent Roll'],
  },
  {
    id: 'public-storage',
    label: 'Public Storage',
    family: 'Operator workbook',
    description: 'Public Storage raw workbook family for future P-Builder parser support.',
    acceptedFiles: ['.xlsx', '.xls'],
    exampleWorkbook: 'Public Storage owner package',
    expectedSections: ['Income Statement', 'Balance Sheet', 'Rent Roll'],
  },
  {
    id: 'custom-other',
    label: 'Other / Custom',
    family: 'Unmapped workbook',
    description: 'Store the raw workbook, inspect sheets, and stage it for a future custom parser.',
    acceptedFiles: ['.xlsx', '.xls', '.xlsm'],
    exampleWorkbook: 'Unknown operator package',
    expectedSections: ['Sheet profiling', 'Manual parser mapping'],
  },
];

const workbookReferenceCards = [
  {
    title: 'Extra Space example',
    file: 'Extra8938 Owner Financials 2025-12 North Charleston - Ashley Phosphate (002).xlsx',
    highlights: ['Ops Sum 8938', 'Unit Status 8938', 'Unit Rate 8938', 'Rolling IS 8938', 'Rent Roll 8938'],
  },
  {
    title: 'Wentworth example',
    file: '01-2026 77712 - Wentworth (Vacaville, CA) Results.xlsx',
    highlights: ['IS', 'BS', 'YOY', 'Act v Bud', 'Trial Balance', 'GL', 'Rent Roll'],
  },
  {
    title: 'CubeSmart example',
    file: 'CUBE5773 Financials December 2025.xlsx',
    highlights: ['Summary of Rental Experience', 'SRE Detail', '36 Month Summary', 'Balance Sheets', 'Rent Roll'],
  },
];

const sectionLabels: Record<WorkbookSectionKey, string> = {
  ops_summary: 'Ops Summary',
  income_statement: 'Income Statement',
  balance_sheet: 'Balance Sheet',
  rent_roll: 'Rent Roll',
  unit_mix: 'Unit Mix',
  unit_rates: 'Unit Rates',
  trial_balance: 'Trial Balance',
  gl_detail: 'GL Detail',
  budget_variance: 'Budget / Variance',
  activity_summary: 'Activity Summary',
  other: 'Other',
};

type UploadResponse = {
  uploadId: string;
  createdAt: string;
  templateType: string;
  propertyName: string | null;
  reportMonth: string | null;
  originalFileName: string;
  storageBucket: string;
  storagePath: string;
  rawRowCount: number;
  normalizedRowCount: number;
  workbookTitle: string | null;
  sheetNames: string[];
  detectedSections: WorkbookSectionKey[];
  sheetProfiles: Array<{
    sheetName: string;
    sectionKey: WorkbookSectionKey;
    nonEmptyRowCount: number;
    firstMeaningfulRow: number | null;
    previewRows: Array<{
      rowNumber: number;
      values: string[];
    }>;
  }>;
};

export default function ProformaLakehousePage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [selectedTemplateId, setSelectedTemplateId] = useState('extra-space');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [propertyName, setPropertyName] = useState('');
  const [reportMonth, setReportMonth] = useState('2026-01');
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTemplate = useMemo(
    () => operatorTemplates.find((template) => template.id === selectedTemplateId) ?? operatorTemplates[0],
    [selectedTemplateId],
  );

  const selectedFileName = selectedFile?.name ?? selectedTemplate.exampleWorkbook;
  const sheetProfiles = uploadResult?.sheetProfiles ?? [];

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setUploadError('Choose an operator workbook first.');
      return;
    }

    setSubmitting(true);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append('file', selectedFile);
      form.append('templateType', selectedTemplateId);
      form.append('propertyName', propertyName);
      form.append('reportMonth', reportMonth);

      const response = await fetch('/api/finance/proforma-lakehouse/upload', {
        method: 'POST',
        body: form,
      });
      const body = (await response.json().catch(() => null)) as UploadResponse & { error?: string };
      if (!response.ok) {
        throw new Error(body?.error || 'Upload failed.');
      }
      setUploadResult(body);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.');
      setUploadResult(null);
    } finally {
      setSubmitting(false);
    }
  };

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_12%,rgba(34,197,94,0.28),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_16%_12%,rgba(16,185,129,0.2),transparent_62%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_86%,rgba(59,130,246,0.18),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(59,130,246,0.12),transparent_64%)]';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface)_88%,transparent),color-mix(in_srgb,var(--tint-green)_58%,transparent))] p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-4">
              <span className="ios-badge text-[10px]">Operator workbook intake</span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">P-Builder Lakehouse Intake</h1>
                <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                  Upload the raw owner financial workbook that feeds P-Builder. The first backend slice now stores the
                  workbook in Supabase, profiles the tabs, classifies major sections, and saves that inspection output
                  so we can build parser-by-operator from real files.
                </p>
              </div>
            </div>
            <Link href="/finance" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
          <div className="ios-card ios-animate-up space-y-6 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">
                Intake setup
              </p>
              <h2 className="text-xl font-semibold">Choose the workbook family</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                This is no longer modeled as competitor rate-shop intake. It is now modeled as raw operator workbooks
                that will eventually feed P-Builder assumptions and financial inputs.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Workbook family
                </span>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => {
                    setSelectedTemplateId(event.target.value);
                    setUploadResult(null);
                    setUploadError(null);
                  }}
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                >
                  {operatorTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Report month
                </span>
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(event) => setReportMonth(event.target.value)}
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property label
                </span>
                <input
                  type="text"
                  value={propertyName}
                  onChange={(event) => setPropertyName(event.target.value)}
                  placeholder="Optional property label for this upload"
                  className="owner-field-input w-full rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/75 px-3 py-3 text-sm text-[color:var(--text-primary)] shadow-inner"
                />
              </label>

              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Expected sections
                </span>
                <div className="flex flex-wrap gap-2">
                  {selectedTemplate.expectedSections.map((section) => (
                    <span key={section} className="ios-pill text-[11px]" data-tone="green">
                      {section}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)]/70 p-6">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm"
                className="hidden"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Upload workbook</p>
                  <p className="max-w-xl text-sm text-[color:var(--text-secondary)]">
                    The backend now profiles the tab structure and writes workbook-section records into SQL. Raw-file
                    storage is temporarily disabled so workbook inspection is not blocked by storage configuration.
                  </p>
                </div>
                <button type="button" onClick={handleChooseFile} className="ios-button px-4 py-2 text-sm" data-variant="secondary">
                  Choose workbook
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!selectedFile || submitting}
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="primary"
                >
                  {submitting ? 'Profiling...' : 'Profile workbook'}
                </button>
                <span className="text-sm text-[color:var(--text-secondary)]">
                  {selectedFile ? `Selected: ${selectedFile.name}` : `Example: ${selectedTemplate.exampleWorkbook}`}
                </span>
              </div>

              {uploadError && <p className="mt-3 text-sm text-[rgb(185,28,28)]">{uploadError}</p>}

              <div className="mt-5 grid gap-3 md:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-2xl border border-[color:var(--border-soft)]/80 bg-white/55 p-4 dark:bg-white/5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Selected family
                  </p>
                  <p className="mt-2 text-base font-semibold">{selectedTemplate.label}</p>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{selectedTemplate.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedTemplate.acceptedFiles.map((extension) => (
                      <span key={extension} className="ios-pill text-[11px]" data-tone="green">
                        {extension}
                      </span>
                    ))}
                    <span className="ios-pill text-[11px]" data-tone="blue">
                      {selectedTemplate.family}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-[color:var(--border-soft)]/80 bg-white/55 p-4 dark:bg-white/5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Current upload
                  </p>
                  <p className="mt-2 text-sm font-semibold">{selectedFileName}</p>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                    {uploadResult
                      ? `Profile saved to SQL with storage path placeholder ${uploadResult.storagePath}`
                      : 'Use this to test how the raw workbook lands before any operator-specific parser is written.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {workbookReferenceCards.map((card) => (
                <div key={card.title} className="ios-list-card space-y-2 p-4">
                  <p className="text-sm font-semibold">{card.title}</p>
                  <p className="text-xs leading-relaxed text-[color:var(--text-secondary)]">{card.file}</p>
                  <div className="flex flex-wrap gap-2">
                    {card.highlights.slice(0, 3).map((highlight) => (
                      <span key={highlight} className="ios-pill text-[11px]" data-tone="blue">
                        {highlight}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ios-card ios-animate-up space-y-6 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">
                Workbook profile
              </p>
              <h2 className="text-xl font-semibold">What the backend now detects</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                This first backend slice detects tabs and section families so we can design the normalized P-Builder
                schema around real workbook structures instead of guessing.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Workbook title</p>
                <p className="text-lg font-semibold">{uploadResult?.workbookTitle ?? 'Awaiting upload'}</p>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Detected sections</p>
                <p className="text-lg font-semibold">{uploadResult?.detectedSections.length ?? 0}</p>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Sheet count</p>
                <p className="text-lg font-semibold">{uploadResult?.sheetNames.length ?? 0}</p>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <p className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">Profiled rows</p>
                <p className="text-lg font-semibold">{uploadResult?.rawRowCount ?? 0}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[color:var(--border-soft)]/80 p-4">
              <p className="text-sm font-semibold">Detected section tags</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(uploadResult?.detectedSections ?? []).map((section) => (
                  <span key={section} className="ios-pill text-[11px]" data-tone="green">
                    {sectionLabels[section]}
                  </span>
                ))}
                {!uploadResult && <span className="text-sm text-[color:var(--text-secondary)]">Upload a workbook to classify its tabs.</span>}
              </div>
            </div>
          </div>
        </section>

        <section className="ios-card ios-animate-up space-y-5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">
                Sheet previews
              </p>
              <h2 className="text-xl font-semibold">First rows from each detected tab</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                This is the output you can use to confirm the backend is reading the workbook family correctly before
                we start extracting P-Builder fields.
              </p>
            </div>
          </div>

          {sheetProfiles.length === 0 ? (
            <div className="ios-list-card p-5 text-sm text-[color:var(--text-secondary)]">
              No workbook profile yet. Upload one of the owner financial workbooks and the tab previews will render here.
            </div>
          ) : (
            <div className="grid gap-4">
              {sheetProfiles.map((profile) => (
                <div key={profile.sheetName} className="rounded-2xl border border-[color:var(--border-soft)]/80 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border-soft)]/70 bg-[color:var(--surface-subtle)] px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold">{profile.sheetName}</p>
                      <p className="text-xs text-[color:var(--text-secondary)]">
                        {sectionLabels[profile.sectionKey]} · {profile.nonEmptyRowCount.toLocaleString()} non-empty rows
                      </p>
                    </div>
                    <span className="ios-pill text-[11px]" data-tone="blue">
                      {profile.firstMeaningfulRow ? `Starts at row ${profile.firstMeaningfulRow}` : 'No rows'}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-sm">
                      <tbody>
                        {profile.previewRows.map((row) => (
                          <tr key={`${profile.sheetName}-${row.rowNumber}`} className="border-t border-[color:var(--border-soft)]/70 first:border-t-0">
                            <td className="w-24 px-3 py-2 font-medium text-[color:var(--text-secondary)]">Row {row.rowNumber}</td>
                            <td className="px-3 py-2">{row.values.filter(Boolean).join(' | ') || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.98fr_1.02fr]">
          <div className="ios-card ios-animate-up space-y-4 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">
                What lands in SQL now
              </p>
              <h2 className="text-xl font-semibold">Current backend scope</h2>
            </div>
            <ul className="space-y-3 text-sm text-[color:var(--text-secondary)]">
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-[rgba(16,185,129,0.8)]" />
                <span>Raw workbook metadata in `proforma_uploads`.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-[rgba(16,185,129,0.8)]" />
                <span>Per-sheet previews and section classification in `proforma_workbook_sections`.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-2 w-2 rounded-full bg-[rgba(16,185,129,0.8)]" />
                <span>Raw workbook storage is intentionally skipped for now so profiling can proceed without storage blockers.</span>
              </li>
            </ul>
          </div>

          <div className="ios-card ios-animate-up space-y-4 p-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-secondary)]">
                Next parser milestones
              </p>
              <h2 className="text-xl font-semibold">What I’d build after this</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="ios-list-card space-y-2 p-4">
                <p className="text-sm font-semibold">1. Extra Space parser</p>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Extract `Ops Sum`, `Unit Rate`, `Rolling IS`, and `Rent Roll` into common monthly fact tables.
                </p>
              </div>
              <div className="ios-list-card space-y-2 p-4">
                <p className="text-sm font-semibold">2. Wentworth parser</p>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Normalize `IS`, `BS`, `Act v Bud`, and `Trial Balance` into financial statement tables.
                </p>
              </div>
              <div className="ios-list-card space-y-2 p-4">
                <p className="text-sm font-semibold">3. CubeSmart parser</p>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Extract rental experience, 36-month summary, and rent-roll style operational metrics.
                </p>
              </div>
              <div className="ios-list-card space-y-2 p-4">
                <p className="text-sm font-semibold">4. P-Builder pull layer</p>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Read normalized SQL facts into P-Builder instead of manually copying from each workbook family.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
