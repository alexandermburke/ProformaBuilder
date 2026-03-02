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

const DATE_MATCH = /\d{4}-\d{2}-\d{2}/;
const SUBJECT_NAME_SOFT_MAX = 80;
const SUBJECT_ADDRESS_SOFT_MAX = 140;

type AddressCheckState = {
  status: 'idle' | 'checking' | 'success' | 'error';
  message: string;
};

export default function CompSetsPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [asOfDate, setAsOfDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [subjectName, setSubjectName] = useState('');
  const [subjectAddress, setSubjectAddress] = useState('');
  const [preparedFor, setPreparedFor] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [manualNotes, setManualNotes] = useState('');
  const [addressCheck, setAddressCheck] = useState<AddressCheckState>({
    status: 'idle',
    message: 'Distance ranking uses subject address only. Start typing to verify geocoding.',
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const geocodeRequestRef = useRef(0);
  const autoDetectDateFromFile = useCallback((file: File | null | undefined): string | null => {
    if (!file) return null;
    const match = file.name.match(DATE_MATCH);
    return match?.[0] ?? null;
  }, []);

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
    setUploadFile(file);
    const date = autoDetectDateFromFile(file);
    if (date) {
      setAsOfDate(date);
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

  useEffect(() => {
    const address = subjectAddress.trim();
    if (!address) {
      setAddressCheck({
        status: 'idle',
        message: 'Distance ranking uses subject address only. Start typing to verify geocoding.',
      });
      return;
    }

    if (address.length < 6) {
      setAddressCheck({
        status: 'idle',
        message: 'Keep typing address details to verify geocoding.',
      });
      return;
    }

    const requestId = ++geocodeRequestRef.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setAddressCheck({ status: 'checking', message: 'Checking address geocode...' });
      try {
        const res = await fetch(`/api/comp-sets/geocode?address=${encodeURIComponent(address)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; status?: string; error?: string }
          | null;
        if (requestId !== geocodeRequestRef.current) return;
        if (!res.ok) {
          const msg = data?.error || 'Unable to verify address geocode.';
          setAddressCheck({ status: 'error', message: msg });
          return;
        }
        if (data?.ok) {
          setAddressCheck({
            status: 'success',
            message: 'Address geocode matched. Distance ranking will use this address only.',
          });
          return;
        }
        const status = data?.status || 'not_found';
        const msg =
          status === 'not_found'
            ? 'Address not found for geocoding. Comp set still generates, but distances may be unavailable.'
            : 'Address check failed. Comp set still generates, but distances may be unavailable.';
        setAddressCheck({ status: 'error', message: msg });
      } catch {
        if (requestId !== geocodeRequestRef.current) return;
        setAddressCheck({
          status: 'error',
          message: 'Address check failed. Comp set still generates, but distances may be unavailable.',
        });
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [subjectAddress]);

  const handleManualCompSet = async () => {
    if (!subjectName.trim()) {
      setToast('Enter the subject property name.');
      return;
    }
    if (!subjectAddress.trim()) {
      setToast('Enter the subject property address.');
      return;
    }
    if (!preparedFor.trim()) {
      setToast('Enter who this comp set is prepared for.');
      return;
    }
    if (!asOfDate) {
      setToast('Choose an "As of" date.');
      return;
    }
    if (!uploadFile) {
      setToast('Upload a comp set workbook (.xlsx or .csv).');
      return;
    }

    setManualSubmitting(true);
    setManualMessage(null);

    try {
      const form = new FormData();
      form.append('subjectName', subjectName.trim());
      form.append('subjectAddress', subjectAddress.trim());
      form.append('preparedFor', preparedFor.trim());
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
      const subjectGeocodeStatus = (res.headers.get('x-subject-geocode-status') || '').toLowerCase();
      if (subjectGeocodeStatus === 'matched') {
        setAddressCheck({
          status: 'success',
          message: 'Address geocode matched. Distances were calculated from address only.',
        });
      } else if (subjectGeocodeStatus) {
        setAddressCheck({
          status: 'error',
          message:
            'Address geocode did not match. PPTX generated, but distance ordering may be fallback-only for this run.',
        });
      }
      const safeProperty = subjectName.trim().replace(/[^A-Za-z0-9._-]+/g, '_');
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
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Subject property name
                  </label>
                  <input
                    type="text"
                    value={subjectName}
                    onChange={(e) => setSubjectName(e.target.value)}
                    placeholder="Subject property name"
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  />
                  <span className="text-[11px] text-[color:var(--text-muted)]">
                    {subjectName.length}/{SUBJECT_NAME_SOFT_MAX} characters
                    {subjectName.length > SUBJECT_NAME_SOFT_MAX ? ' (recommended to shorten)' : ''}
                  </span>
                </div>
                <div className="flex flex-col gap-1 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Subject property address
                  </label>
                  <input
                    type="text"
                    value={subjectAddress}
                    onChange={(e) => setSubjectAddress(e.target.value)}
                    placeholder="Street, City, State ZIP"
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-xs ${
                        addressCheck.status === 'success'
                          ? 'text-emerald-600 dark:text-emerald-300'
                          : addressCheck.status === 'error'
                            ? 'text-rose-600 dark:text-rose-300'
                            : 'text-[color:var(--text-secondary)]'
                      }`}
                    >
                      {addressCheck.message}
                    </span>
                  </div>
                  <span className="text-[11px] text-[color:var(--text-muted)]">
                    {subjectAddress.length}/{SUBJECT_ADDRESS_SOFT_MAX} characters
                    {subjectAddress.length > SUBJECT_ADDRESS_SOFT_MAX ? ' (recommended to shorten)' : ''}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Prepared for
                  </label>
                  <input
                    type="text"
                    value={preparedFor}
                    onChange={(e) => setPreparedFor(e.target.value)}
                    placeholder="Client or owner"
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  />
                </div>
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
                disabled={!subjectName.trim() || !subjectAddress.trim() || !preparedFor.trim() || !uploadFile || manualSubmitting}
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
