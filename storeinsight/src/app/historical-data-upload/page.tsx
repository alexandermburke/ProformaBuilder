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

  const templateString = useMemo(() => JSON.stringify(getHistoricalTemplatePayload(), null, 2), []);

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

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
    } catch (error) {
      setTemplateStatus('Copy failed.');
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
    } catch (error) {
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

