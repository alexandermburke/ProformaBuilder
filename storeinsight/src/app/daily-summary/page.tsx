/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { PropertyConfig } from '@/types/dailySummary';

type PropertyFormState = {
  id?: string;
  name: string;
  tenantPropertyId: string;
  sendTimeLocal: string;
  ownerEmails: string;
  enabled: boolean;
};

const DEFAULT_TIME = '08:00';

const createEmptyForm = (): PropertyFormState => ({
  name: '',
  tenantPropertyId: '',
  sendTimeLocal: DEFAULT_TIME,
  ownerEmails: '',
  enabled: true,
});

export default function DailySummaryPage() {
  const [properties, setProperties] = useState<PropertyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProperty, setSavingProperty] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [formState, setFormState] = useState<PropertyFormState>(createEmptyForm());
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [deleting, setDeleting] = useState(false);
  const [sortKey, setSortKey] = useState<'name' | 'tenantPropertyId' | 'sendTimeLocal' | 'enabled'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [propertyMessage, setPropertyMessage] = useState<string | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggleButtonClass = (active: boolean): string =>
    [
      'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-[rgba(148,163,255,0.28)] p-1 transition-all duration-300',
      active
        ? 'justify-end bg-[rgba(37,99,235,0.8)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]'
        : 'justify-start bg-[rgba(148,163,255,0.25)]',
    ].join(' ');

  const togglePillClass =
    'inline-block h-6 w-6 rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300';

  const sortedProperties = useMemo(() => {
    const list = [...properties];
    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'tenantPropertyId':
          return a.tenantPropertyId.localeCompare(b.tenantPropertyId) * dir;
        case 'sendTimeLocal':
          return a.sendTimeLocal.localeCompare(b.sendTimeLocal) * dir;
        case 'enabled':
          return (Number(a.enabled) - Number(b.enabled)) * dir;
        case 'name':
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
    return list;
  }, [properties, sortDir, sortKey]);

  const refreshProperties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/daily-summary/properties', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Unable to load properties');
      }
      const data = (await res.json()) as PropertyConfig[];
      setProperties(data);
      if (!selectedPropertyId && data.length > 0) {
        setSelectedPropertyId(data[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => {
    void refreshProperties();
  }, [refreshProperties]);

  const parseErrorMessage = async (res: Response): Promise<string | null> => {
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) return data.error;
    } catch {
      // ignore
    }
    return res.statusText || null;
  };

  const acceptUploadFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setToast('Upload must be a .xlsx file.');
      return;
    }
    setManualMessage(null);
    setUploadFile(file);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    acceptUploadFile(file);
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
    const file = event.dataTransfer?.files?.[0];
    acceptUploadFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFile(false);
  };

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openModal = (prop?: PropertyConfig) => {
    if (prop) {
      setFormState({
        id: prop.id,
        name: prop.name,
        tenantPropertyId: prop.tenantPropertyId,
        sendTimeLocal: prop.sendTimeLocal,
        ownerEmails: prop.ownerEmails.join(', '),
        enabled: prop.enabled,
      });
    } else {
      setFormState(createEmptyForm());
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setFormState(createEmptyForm());
    setPropertyMessage(null);
  };

  const handleFormChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = event.target;
    setFormState((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const persistProperty = async (draft: PropertyFormState) => {
    setSavingProperty(true);
    setPropertyMessage(null);
    try {
      const payload: Omit<PropertyConfig, 'id'> & { id?: string } = {
        id: draft.id && draft.id.trim() ? draft.id.trim() : undefined,
        name: draft.name.trim() || 'Untitled property',
        tenantPropertyId: draft.tenantPropertyId.trim(),
        timezone: 'America/Phoenix',
        sendTimeLocal: draft.sendTimeLocal || DEFAULT_TIME,
        ownerEmails: draft.ownerEmails
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean),
        enabled: draft.enabled,
      };

      const res = await fetch('/api/daily-summary/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error('Unable to save property');
      }
      const saved = (await res.json()) as PropertyConfig;
      await refreshProperties();
      setSelectedPropertyId((prev) => prev || saved.id);
      closeModal();
    } catch (err) {
      setPropertyMessage(err instanceof Error ? err.message : 'Unable to save property');
    } finally {
      setSavingProperty(false);
    }
  };

  const saveProperty = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await persistProperty(formState);
  };

  const toggleEnabled = async (prop: PropertyConfig) => {
    const draft: PropertyFormState = {
      id: prop.id,
      name: prop.name,
      tenantPropertyId: prop.tenantPropertyId,
      sendTimeLocal: prop.sendTimeLocal,
      ownerEmails: prop.ownerEmails.join(', '),
      enabled: !prop.enabled,
    };
    await persistProperty(draft);
  };

  const deleteProperty = async () => {
    if (!formState.id) return;
    const confirmed = window.confirm('Are you sure you want to delete this property? This action cannot be undone.');
    if (!confirmed) return;
    setDeleting(true);
    setPropertyMessage(null);
    try {
      const res = await fetch('/api/daily-summary/properties', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: formState.id }),
      });
      if (!res.ok) throw new Error('Unable to delete property');
      await refreshProperties();
      setSelectedPropertyId('');
      closeModal();
    } catch (err) {
      setPropertyMessage(err instanceof Error ? err.message : 'Unable to delete property');
    } finally {
      setDeleting(false);
    }
  };

  const handleManualFlash = async () => {
    if (!selectedPropertyId) {
      setToast('Select a property first.');
      return;
    }
    if (!asOfDate) {
      setToast('Choose an "As of" date.');
      return;
    }
    if (!uploadFile) {
      setToast('Upload a Management Summary Report (.xlsx).');
      return;
    }

    setManualSubmitting(true);
    setManualMessage(null);

    try {
      const form = new FormData();
      form.append('propertyId', selectedPropertyId);
      form.append('asOfDate', asOfDate);
      form.append('file', uploadFile);

      const res = await fetch('/api/flash-report/manual', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const message = await parseErrorMessage(res);
        setToast(message ?? 'Unable to generate PPTX.');
        return;
      }

      const blob = await res.blob();
      const property = properties.find((p) => p.id === selectedPropertyId);
      const propertyCodeOrName = property?.tenantPropertyId || property?.name || selectedPropertyId;
      const safeProperty = propertyCodeOrName.replace(/[^A-Za-z0-9._-]+/g, '_');
      const filename = `DailyFlash-${safeProperty}-${asOfDate}.pptx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setManualMessage('Daily Flash PPTX generated.');
    } catch (err) {
      console.error('[flash-report/manual] generation failed', err);
      setToast('Unable to generate Daily Flash PPTX.');
    } finally {
      setManualSubmitting(false);
    }
  };

  const overlayTop = 'bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.22),transparent_60%)]';
  const overlayBottom = 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.18),transparent_62%)]';

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up rounded-3xl p-8 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Daily Summary Report</h1>
              <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--text-secondary)] sm:text-base">
                Manage daily flash reporting for STORE properties. Configure delivery windows, owner recipients, and
                send emails when needed.
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="ios-card ios-animate-up rounded-3xl p-6 shadow-lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Property configuration</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Control who receives each daily flash and when it is sent (MST).
                </p>
              </div>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm font-semibold"
                data-variant="primary"
                onClick={() => openModal()}
              >
                Add property
              </button>
            </div>

            <div className="overflow-x-auto overflow-y-auto rounded-2xl border border-[color:var(--border-soft)] max-h-[480px]">
              <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
                <thead className="bg-[color:var(--surface-muted)] text-[color:var(--text-secondary)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left"
                        onClick={() => {
                          const dir = sortKey === 'name' && sortDir === 'asc' ? 'desc' : 'asc';
                          setSortKey('name');
                          setSortDir(dir);
                        }}
                      >
                        Property
                        <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {sortKey === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left"
                        onClick={() => {
                          const dir = sortKey === 'tenantPropertyId' && sortDir === 'asc' ? 'desc' : 'asc';
                          setSortKey('tenantPropertyId');
                          setSortDir(dir);
                        }}
                      >
                        Property ID
                        <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {sortKey === 'tenantPropertyId' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left"
                        onClick={() => {
                          const dir = sortKey === 'sendTimeLocal' && sortDir === 'asc' ? 'desc' : 'asc';
                          setSortKey('sendTimeLocal');
                          setSortDir(dir);
                        }}
                      >
                        Send time (MST)
                        <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {sortKey === 'sendTimeLocal' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-left"
                        onClick={() => {
                          const dir = sortKey === 'enabled' && sortDir === 'asc' ? 'desc' : 'asc';
                          setSortKey('enabled');
                          setSortDir(dir);
                        }}
                      >
                        Enabled
                        <span className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                          {sortKey === 'enabled' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-soft)]">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                        Loading properties...
                      </td>
                    </tr>
                  ) : sortedProperties.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                        No properties configured yet.
                      </td>
                    </tr>
                  ) : (
                    sortedProperties.map((prop) => (
                      <tr key={prop.id} className="hover:bg-[color:var(--surface-subtle)]/60">
                        <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)]">{prop.name}</td>
                        <td className="px-4 py-3 text-[color:var(--text-secondary)]">{prop.tenantPropertyId}</td>
                        <td className="px-4 py-3 text-[color:var(--text-secondary)]">{prop.sendTimeLocal}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            aria-pressed={prop.enabled}
                            aria-label={`Toggle ${prop.name} emails`}
                            className={toggleButtonClass(prop.enabled)}
                            onClick={() => void toggleEnabled(prop)}
                          >
                            <span className={togglePillClass} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="ios-button text-sm"
                            data-variant="secondary"
                            onClick={() => openModal(prop)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ios-card ios-animate-up rounded-3xl p-6 shadow-lg">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Manual Daily Flash Report</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Upload a Management Summary Report XLSX, fill the template, and download the Daily Flash PPTX.
                No emails are sent in this flow.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property
                </label>
                <select
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                >
                  <option value="">Select property</option>
                  {properties.map((prop) => (
                    <option key={prop.id} value={prop.id}>
                      {prop.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  As of date
                </label>
                <input
                  type="date"
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Management Summary Report (.xlsx)
                </label>
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-colors duration-150 ${
                    isDraggingFile ? 'border-[color:var(--accent)] bg-[color:var(--surface-muted)]' : 'border-[color:var(--border-soft)] bg-white'
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
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                  <div className="flex flex-col gap-1 text-sm text-[color:var(--text-secondary)]">
                    <span className="font-semibold text-[color:var(--text-primary)]">Drop XLSX here</span>
                    <span>or click to browse</span>
                  </div>
                  {uploadFile ? (
                    <span className="text-xs font-semibold text-[color:var(--text-primary)]">Selected: {uploadFile.name}</span>
                  ) : (
                    <span className="text-xs text-[color:var(--text-muted)]">Only one .xlsx file is needed.</span>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={!selectedPropertyId || !uploadFile || manualSubmitting}
                className="ios-button w-full px-4 py-2 text-sm font-semibold"
                data-variant="primary"
                onClick={handleManualFlash}
              >
                {manualSubmitting ? 'Generating...' : 'Generate Daily Flash PPTX'}
              </button>

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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
          <div className="ios-card ios-animate-up w-full max-w-md space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{formState.id ? 'Edit property' : 'Add property'}</h3>
                {formState.id && (
                  <button
                    type="button"
                    onClick={() => void deleteProperty()}
                    className="ios-icon-button text-[color:var(--text-secondary)] hover:text-[#DC2626]"
                    title="Delete property"
                    disabled={deleting || savingProperty}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="ios-icon-button text-[color:var(--text-secondary)]"
                aria-label="Close"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    fill="currentColor"
                    d="m7.05 7.757 4.242 4.243 4.243-4.243 1.414 1.415-4.242 4.243 4.242 4.242-1.414 1.415-4.243-4.243-4.242 4.243-1.414-1.415 4.242-4.242-4.242-4.243z"
                  />
                </svg>
              </button>
            </div>
            <form className="space-y-4" onSubmit={saveProperty}>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property name
                </label>
                <input
                  name="name"
                  value={formState.name}
                  onChange={handleFormChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. STORE at the Grove"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property ID
                </label>
                <input
                  name="tenantPropertyId"
                  value={formState.tenantPropertyId}
                  onChange={handleFormChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. L001"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Send time (MST)
                  </label>
                  <input
                    type="time"
                    name="sendTimeLocal"
                    value={formState.sendTimeLocal}
                    onChange={handleFormChange}
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                    required
                  />
                </div>
                <div className="flex items-center gap-3 pt-5">
                  <button
                    type="button"
                    className={toggleButtonClass(formState.enabled)}
                    aria-pressed={formState.enabled}
                    onClick={() =>
                      setFormState((prev) => ({
                        ...prev,
                        enabled: !prev.enabled,
                      }))
                    }
                  >
                    <span className={togglePillClass} />
                  </button>
                  <span className="text-sm font-semibold text-[color:var(--text-secondary)]">Enable daily emails</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Owner emails (comma-separated)
                </label>
                <input
                  name="ownerEmails"
                  value={formState.ownerEmails}
                  onChange={handleFormChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-white px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="owner@example.com, ops@example.com"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="ios-button px-4 py-2 text-sm font-semibold"
                  data-variant="primary"
                  disabled={savingProperty}
                >
                  {savingProperty ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="secondary"
                  onClick={closeModal}
                >
                  Cancel
                </button>
              </div>
              {propertyMessage && <p className="text-xs text-[color:var(--text-secondary)]">{propertyMessage}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
