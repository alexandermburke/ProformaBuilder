/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import {
  HISTORICAL_DATA_STORAGE_KEY,
  getHistoricalTemplatePayload,
  parseHistoricalInput,
} from '@/lib/historical/dataInput';

export default function HistoricalDataUploadPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [dataInput, setDataInput] = useState('');
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [hasStoredData, setHasStoredData] = useState(false);

  const templateString = useMemo(() => JSON.stringify(getHistoricalTemplatePayload(), null, 2), []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(HISTORICAL_DATA_STORAGE_KEY);
    if (!stored) return;
    setDataInput(stored);
    const parsed = parseHistoricalInput(stored);
    if (parsed.data) {
      setHasStoredData(true);
      setDataStatus('Loaded custom data from this browser.');
      setDataError(null);
    } else {
      setDataError(parsed.error ?? 'Stored data is invalid.');
    }
  }, []);

  const handleLoadTemplate = () => {
    setDataInput(templateString);
    setDataError(null);
    setDataStatus('Template loaded. Update the values and apply to save.');
  };

  const handleApplyData = () => {
    setDataError(null);
    setDataStatus(null);
    if (!dataInput.trim()) {
      setDataError('Paste JSON or load the template first.');
      return;
    }
    const parsed = parseHistoricalInput(dataInput);
    if (!parsed.data) {
      setDataError(parsed.error ?? 'Unable to parse historical data payload.');
      return;
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HISTORICAL_DATA_STORAGE_KEY, dataInput);
    }
    setHasStoredData(true);
    setDataStatus('Custom data saved. Go back to Historical Data to view it.');
  };

  const handleClearData = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(HISTORICAL_DATA_STORAGE_KEY);
    }
    setDataInput('');
    setHasStoredData(false);
    setDataError(null);
    setDataStatus('Stored custom data cleared.');
  };

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

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
                Upload historical data
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                Paste the JSON payload to replace placeholder charts and tables. Data is saved to this browser only.
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
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Historical data JSON</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Required: historicalByRange with 3M, 6M, 12M. Optional: momSeriesByProperty.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="ios-pill text-[10px]" data-tone={hasStoredData ? 'success' : 'neutral'}>
                {hasStoredData ? 'Custom data stored' : 'No data stored'}
              </span>
              <button
                type="button"
                onClick={handleLoadTemplate}
                className="ios-button px-4 py-2 text-xs"
                data-variant="secondary"
              >
                Load template
              </button>
              <button type="button" onClick={handleApplyData} className="ios-button px-4 py-2 text-xs">
                Apply data
              </button>
              <button
                type="button"
                onClick={handleClearData}
                className="ios-button px-4 py-2 text-xs"
                data-variant="ghost"
              >
                Clear stored data
              </button>
            </div>
          </div>

          <textarea
            className="owner-field-input min-h-[320px] w-full resize-y rounded-2xl p-4 font-mono text-[11px] text-[color:var(--text-primary)] shadow-inner focus:outline-none"
            placeholder="Paste the historical data JSON payload here."
            value={dataInput}
            onChange={(event) => setDataInput(event.target.value)}
            spellCheck={false}
          />

          <div className="space-y-1 text-[11px]">
            {dataError ? <p className="text-red-500">Error: {dataError}</p> : null}
            {dataStatus ? <p className="text-[color:var(--text-secondary)]">{dataStatus}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
