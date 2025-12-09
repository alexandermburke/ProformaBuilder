/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import type { PropertyConfig } from '@/types/dailySummary';
import type { FlashCloudStatus, FlashStatus } from './types';
import type { CloudRunState, CloudStatusResponse } from '@/types/cloudStatus';

type PropertyFormState = {
  id?: string;
  propertyCode: string;
  propertyId: string;
  name: string;
  tenantPropertyId: string;
  sendTimeLocal: string;
  ownerEmails: string;
  enabled: boolean;
  propertyImageData: string;
  heroImagePath?: string;
  heroImageRemove?: boolean;
};

const DEFAULT_TIME = '08:00';

const createEmptyForm = (): PropertyFormState => ({
  name: '',
  propertyCode: '',
  propertyId: '',
  tenantPropertyId: '',
  sendTimeLocal: DEFAULT_TIME,
  ownerEmails: '',
  enabled: true,
  propertyImageData: '',
  heroImagePath: '',
  heroImageRemove: false,
});

const statusMeta: Record<FlashStatus, { label: string; tone?: 'success' | 'warning' | 'danger'; dotClass: string }> = {
  success: { label: 'Healthy', tone: 'success', dotClass: 'bg-emerald-400 dark:bg-emerald-300' },
  pending: { label: 'Pending', tone: 'warning', dotClass: 'bg-amber-400 dark:bg-amber-300' },
  failed: { label: 'Failed', tone: 'danger', dotClass: 'bg-rose-400 dark:bg-rose-300' },
  no_msr: { label: 'Waiting for MSR', dotClass: 'bg-slate-400 dark:bg-slate-300' },
};

const cloudToFlashStatus: Record<CloudRunState, FlashStatus> = {
  healthy: 'success',
  HEALTHY: 'success',
  pending: 'pending',
  PENDING: 'pending',
  failed: 'failed',
  FAILED: 'failed',
  awaiting_msr: 'no_msr',
  AWAITING_MSR: 'no_msr',
};

const mapCloudState = (state: CloudRunState): FlashStatus => cloudToFlashStatus[state] ?? 'pending';

const statTileClass =
  'rounded-2xl border border-[color:var(--border-soft)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface) 86%,transparent),color-mix(in_srgb,var(--tint-blue) 62%,transparent))] px-3 py-4 shadow-[0_14px_36px_rgba(3,7,18,0.14)] backdrop-blur flex flex-col items-center justify-center gap-2 text-center';

const formatDateTime = (value?: string): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatDateOnly = (value?: string): string => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

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
  const [asOfDate, setAsOfDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [propertyMessage, setPropertyMessage] = useState<string | null>(null);
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [cloudStatuses, setCloudStatuses] = useState<FlashCloudStatus[]>([]);
  const [cloudStatusLoading, setCloudStatusLoading] = useState(false);
  const [cloudStatusMessage, setCloudStatusMessage] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [manualEmailBody, setManualEmailBody] = useState('');
  const propertiesRef = useRef<PropertyConfig[]>([]);
  const parsedOwnerEmails = useMemo(
    () =>
      formState.ownerEmails
        .split(',')
        .map((email) => email.trim())
        .filter((email) => email.length > 0 && email.includes('@')),
    [formState.ownerEmails],
  );
  const parseMsrFilename = useCallback((name: string): { propertyLabel?: string; date?: string } => {
    const match = name.match(/management\s+summary\s+report\s*-\s*(.+?)\s*-\s*(\d{4}-\d{2}-\d{2})/i);
    if (!match) return {};
    const propertyLabel = match[1]?.trim();
    const date = match[2]?.trim();
    return { propertyLabel, date };
  }, []);

  const autoDetectFromFile = useCallback(
    (file: File | null | undefined, propertyList: PropertyConfig[]): { foundProperty?: PropertyConfig; date?: string } => {
      if (!file) return {};
      const { propertyLabel, date } = parseMsrFilename(file.name);
      if (!propertyLabel && !date) return {};
      let found: PropertyConfig | undefined;
      if (propertyLabel) {
        const normalized = propertyLabel.toLowerCase();
        found =
          propertyList.find((p) => p.name.toLowerCase() === normalized) ||
          propertyList.find((p) => (p.propertyCode ?? '').toLowerCase() === normalized) ||
          propertyList.find((p) => (p.propertyId ?? '').toLowerCase() === normalized) ||
          propertyList.find((p) => p.tenantPropertyId.toLowerCase() === normalized) ||
          propertyList.find((p) => p.id.toLowerCase() === normalized);
      }
      return { foundProperty: found, date };
    },
    [parseMsrFilename],
  );

  const toggleButtonClass = (active: boolean): string =>
    [
      'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-[rgba(148,163,255,0.28)] p-1 transition-all duration-300',
      active
        ? 'justify-end bg-[rgba(37,99,235,0.8)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]'
        : 'justify-start bg-[rgba(148,163,255,0.25)]',
    ].join(' ');

  const togglePillClass =
    'inline-block h-6 w-6 rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-300';

  const buildFallbackCloudStatuses = useCallback(
    (list: PropertyConfig[]): FlashCloudStatus[] =>
      list.map((prop) => ({
        propertyId: prop.propertyId ?? prop.tenantPropertyId ?? prop.id,
        propertyName: prop.name,
        status: 'no_msr',
      })),
    [],
  );

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

  const cloudStatusCounts = useMemo(
    () =>
      cloudStatuses.reduce(
        (acc, item) => {
          acc[item.status] += 1;
          return acc;
        },
        { success: 0, pending: 0, failed: 0, no_msr: 0 },
      ),
    [cloudStatuses],
  );

  const refreshProperties = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/daily-summary/properties', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Unable to load properties');
      }
      const data = (await res.json()) as PropertyConfig[];
      setProperties(data);
      propertiesRef.current = data;
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

  useEffect(() => {
    if (!uploadFile || properties.length === 0) return;
    const { foundProperty, date } = autoDetectFromFile(uploadFile, properties);
    if (foundProperty) {
      setSelectedPropertyId(foundProperty.id);
    }
    if (date) {
      setAsOfDate(date);
    }
  }, [uploadFile, properties, autoDetectFromFile]);

  const refreshCloudStatus = useCallback(async () => {
    setCloudStatusLoading(true);
    setCloudStatusMessage(null);
    try {
      const res = await fetch('/api/flash-report/cloud-status', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error('Unable to load cloud run status');
      }
      const data = (await res.json()) as CloudStatusResponse;
      const mapped = data.rows.map<FlashCloudStatus>((row) => ({
        propertyId: row.propertyId,
        propertyName: row.propertyName,
        lastMsrReceivedAt: row.msrReceivedAt ?? undefined,
        lastRunAt: row.lastRunAt ?? undefined,
        nextRunAt: row.nextRunAt ?? undefined,
        status: mapCloudState(row.lastRunStatus),
        errorMessage: row.errorMessage ?? undefined,
      }));
      setCloudStatuses(mapped);
    } catch (err) {
      const fallback = propertiesRef.current.length > 0 ? buildFallbackCloudStatuses(propertiesRef.current) : [];
      const baseMessage = 'Waiting for cloud status feed';
      if (fallback.length > 0) {
        setCloudStatuses(fallback);
        setCloudStatusMessage(`${baseMessage}. Showing property list until data is connected.`);
      } else {
        const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
        setCloudStatusMessage(`Unable to load cloud run status${detail}`);
      }
    } finally {
      setCloudStatusLoading(false);
    }
  }, [buildFallbackCloudStatuses]);

  useEffect(() => {
    void refreshCloudStatus();
  }, [refreshCloudStatus]);

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
    const { foundProperty, date } = autoDetectFromFile(file, propertiesRef.current);
    if (foundProperty) {
      setSelectedPropertyId(foundProperty.id);
    }
    if (date) {
      setAsOfDate(date);
    }
    if (foundProperty || date) {
      setManualMessage(
        `Detected ${foundProperty ? `"${foundProperty.name}"` : 'property'}${foundProperty && date ? ' and ' : ''}${
          date ? `date ${date}` : ''
        } from file name.`,
      );
    }
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
    if (!isDraggingFile) setIsDraggingFile(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDraggingFile) setIsDraggingFile(false);
  };

  const handleImageUpload = async (file: File | null | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setFormState((prev) => ({ ...prev, propertyImageData: result, heroImageRemove: false }));
      }
    };
    reader.readAsDataURL(file);
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
        propertyCode: prop.propertyCode ?? '',
        propertyId: prop.propertyId ?? prop.tenantPropertyId ?? prop.id,
        name: prop.name,
        tenantPropertyId: prop.tenantPropertyId ?? prop.propertyId ?? prop.id,
        sendTimeLocal: prop.sendTimeLocal,
      ownerEmails: prop.ownerEmails.join(', '),
      enabled: prop.enabled,
      propertyImageData: prop.propertyImageData ?? prop.heroImageUrl ?? '',
      heroImagePath: prop.heroImagePath ?? '',
      heroImageRemove: false,
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
      ...(name === 'propertyId'
        ? { propertyId: value, tenantPropertyId: value }
        : { [name]: type === 'checkbox' ? checked : value }),
    }));
  };

  const persistProperty = async (draft: PropertyFormState) => {
    setSavingProperty(true);
    setPropertyMessage(null);
    try {
      const payload: Omit<PropertyConfig, 'id'> & { id?: string } = {
        id: draft.id && draft.id.trim() ? draft.id.trim() : undefined,
        propertyCode: draft.propertyCode.trim() || draft.id || draft.propertyId || draft.tenantPropertyId,
        propertyId: draft.propertyId.trim() || draft.tenantPropertyId.trim() || draft.id || draft.propertyCode,
        name: draft.name.trim() || 'Untitled property',
        tenantPropertyId: draft.tenantPropertyId.trim() || draft.propertyId.trim(),
        timezone: 'America/Phoenix',
        sendTimeLocal: draft.sendTimeLocal || DEFAULT_TIME,
        sendTimeMst: draft.sendTimeLocal || DEFAULT_TIME,
        ownerEmails: draft.ownerEmails
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean),
        enabled: draft.enabled,
        propertyImageData: draft.propertyImageData || '',
        heroImagePath: draft.heroImagePath,
        heroImageRemove: draft.heroImageRemove ?? false,
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
       propertyCode: prop.propertyCode ?? prop.id ?? prop.tenantPropertyId,
      propertyId: prop.propertyId ?? prop.tenantPropertyId ?? prop.id,
      name: prop.name,
      tenantPropertyId: prop.tenantPropertyId,
      sendTimeLocal: prop.sendTimeLocal,
      ownerEmails: prop.ownerEmails.join(', '),
      enabled: !prop.enabled,
      propertyImageData: prop.propertyImageData ?? prop.heroImageUrl ?? '',
      heroImagePath: prop.heroImagePath ?? '',
      heroImageRemove: false,
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
      if (manualEmailBody.trim()) {
        form.append('emailBody', manualEmailBody.trim());
      }

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
      const propertyLabel =
        property?.propertyId || property?.tenantPropertyId || property?.name || property?.propertyCode || selectedPropertyId;
      const safeProperty = propertyLabel.replace(/[^A-Za-z0-9._-]+/g, '_');
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
        <header className="ios-card ios-animate-up rounded-3xl bg-[linear-gradient(140deg,color-mix(in_srgb,var(--surface) 88%,transparent),color-mix(in_srgb,var(--tint-blue) 58%,transparent))] p-8 shadow-lg">
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

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.95fr]">
          <div className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 48%,transparent))] p-6 shadow-lg">
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

            <div
              className="overflow-x-auto overflow-y-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 shadow-inner max-h-[480px]"
              style={{ contentVisibility: 'auto', containIntrinsicSize: '720px' }}
            >
              <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
                <thead className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted) 92%,transparent),color-mix(in_srgb,var(--tint-blue) 36%,transparent))] text-[color:var(--text-secondary)]">
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
                          {sortKey === 'name' ? (sortDir === 'asc' ? '^' : 'v') : ''}
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
                          {sortKey === 'tenantPropertyId' ? (sortDir === 'asc' ? '^' : 'v') : ''}
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
                          {sortKey === 'sendTimeLocal' ? (sortDir === 'asc' ? '^' : 'v') : ''}
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
                          {sortKey === 'enabled' ? (sortDir === 'asc' ? '^' : 'v') : ''}
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
                      <tr key={prop.id} className="transition-colors hover:bg-[color:var(--surface-subtle)]/70">
                        <td className="px-4 py-3 font-semibold text-[color:var(--text-primary)]">{prop.name}</td>
                        <td className="px-4 py-3 text-[color:var(--text-secondary)]">
                          {prop.propertyId || prop.tenantPropertyId || prop.id}
                        </td>
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

          <div className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(150deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 48%,transparent))] p-6 shadow-lg">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Cloud run status</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Monitor nightly flash automation and the latest MSR ingestion.
                </p>
              </div>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm font-semibold"
                data-variant="primary"
                onClick={() => void refreshCloudStatus()}
                disabled={cloudStatusLoading}
              >
                {cloudStatusLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Healthy', value: cloudStatusCounts.success },
                { label: 'Pending', value: cloudStatusCounts.pending },
                { label: 'Failed', value: cloudStatusCounts.failed },
                { label: 'Awaiting MSR', value: cloudStatusCounts.no_msr },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`${statTileClass} border-[color:var(--border-soft)]`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-secondary)] leading-tight">
                    {item.label}
                  </div>
                  <span className="inline-flex h-10 min-w-[46px] items-center justify-center rounded-xl bg-[color:var(--surface)]/80 px-3 text-base font-semibold tabular-nums text-[color:var(--text-primary)] shadow-inner">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            <div
              className="overflow-x-auto overflow-y-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 shadow-inner max-h-[480px]"
              style={{ contentVisibility: 'auto', containIntrinsicSize: '720px' }}
            >
              <table className="min-w-full divide-y divide-[color:var(--border-soft)] text-sm">
                <thead className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-muted) 92%,transparent),color-mix(in_srgb,var(--tint-blue) 36%,transparent))] text-[color:var(--text-secondary)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Property</th>
                    <th className="px-4 py-3 text-left font-semibold">MSR received</th>
                    <th className="px-4 py-3 text-left font-semibold">Last run</th>
                    <th className="px-4 py-3 text-left font-semibold">Next run</th>
                    <th className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-soft)]">
                  {cloudStatusLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                        Loading cloud run status...
                      </td>
                    </tr>
                  ) : cloudStatuses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[color:var(--text-secondary)]">
                        No cloud run records yet.
                      </td>
                    </tr>
                  ) : (
                    cloudStatuses.map((entry) => {
                      const meta = statusMeta[entry.status];
                      return (
                        <tr
                          key={`${entry.propertyId}-${entry.status}-${entry.lastRunAt ?? 'na'}`}
                          className="transition-colors hover:bg-[color:var(--surface-subtle)]/70"
                        >
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-[color:var(--text-primary)]">{entry.propertyName}</span>
                              <span className="text-sm text-[color:var(--text-secondary)]">{entry.propertyId}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-[color:var(--text-secondary)]">
                            <div className="flex flex-col whitespace-nowrap leading-tight">
                              <span className="font-medium text-[color:var(--text-primary)]">
                                {formatDateOnly(entry.lastMsrReceivedAt)}
                              </span>
                              <span className="text-xs text-[color:var(--text-secondary)]">
                                {formatDateTime(entry.lastMsrReceivedAt)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-[color:var(--text-secondary)]">
                            <div className="flex flex-col whitespace-nowrap leading-tight">
                              <span className="font-medium text-[color:var(--text-primary)]">
                                {formatDateOnly(entry.lastRunAt)}
                              </span>
                              <span className="text-xs text-[color:var(--text-secondary)]">
                                {formatDateTime(entry.lastRunAt)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 align-top text-[color:var(--text-secondary)]">
                            <div className="flex flex-col whitespace-nowrap leading-tight min-w-[140px]">
                              <span className="font-medium text-[color:var(--text-primary)]">
                                {formatDateOnly(entry.nextRunAt)}
                              </span>
                              <span className="text-xs text-[color:var(--text-secondary)]">
                                {formatDateTime(entry.nextRunAt)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1.5">
                              <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 px-3 py-1 text-[12px] font-semibold text-[color:var(--text-primary)]">
                                <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                                {meta.label}
                              </span>
                              {entry.errorMessage && (
                                <span className="text-xs text-[color:var(--text-secondary)]">{entry.errorMessage}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {cloudStatusMessage && (
              <p className="pt-3 text-xs text-[color:var(--text-secondary)]">{cloudStatusMessage}</p>
            )}
          </div>

          <div className="ios-card ios-animate-up rounded-3xl border border-[color:var(--border-soft)] bg-[linear-gradient(160deg,color-mix(in_srgb,var(--surface) 90%,transparent),color-mix(in_srgb,var(--tint-blue) 46%,transparent))] p-6 shadow-lg lg:col-span-2">
            <div className="mb-4 space-y-1">
              <h2 className="text-lg font-semibold">Manual Daily Flash Report</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Upload a Management Summary Report XLSX, fill the template, and download/email the Daily Flash PPTX.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property
                </label>
                <select
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
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
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Management Summary Report (.xlsx)
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

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Optional email body (shown above the slide)
                </label>
                <textarea
                  rows={3}
                  value={manualEmailBody}
                  onChange={(e) => setManualEmailBody(e.target.value)}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="Add a short note for owners (optional)"
                />
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
          <div
            className={`ios-card ios-animate-up w-full max-h-[90vh] space-y-6 !overflow-y-auto overscroll-contain p-6 ${
              formState.propertyImageData ? 'max-w-4xl' : 'max-w-md'
            }`}
          >
            <div className="flex items-start justify-between gap-4 ">
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
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. STORE at the Grove"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property code (slug)
                </label>
                <input
                  name="propertyCode"
                  value={formState.propertyCode}
                  onChange={handleFormChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. storeatthegrove"
                  required
                />
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  Must match the Management Summary Report filename slug (used for automation).
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                  Property ID
                </label>
                <input
                  name="propertyId"
                  value={formState.propertyId}
                  onChange={handleFormChange}
                  className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                  placeholder="e.g. L001"
                  required
                />
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Send time gate (MST)
                  </label>
                  <input
                    type="time"
                    name="sendTimeLocal"
                    value={formState.sendTimeLocal}
                    onChange={handleFormChange}
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                    required
                  />
                  <span className="text-[11px] text-[color:var(--text-muted)]">
                    Auto flash only runs for this property if the current MST time is at/after this gate when cron fires.
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Owner emails (comma-separated)
                  </label>
                  <input
                    name="ownerEmails"
                    value={formState.ownerEmails}
                    onChange={handleFormChange}
                    className="owner-field-input rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-inner focus:border-[color:var(--accent)] focus:outline-none"
                    placeholder="owner@example.com, ops@example.com"
                  />
                </div>
                <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)]/70 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">Parsed recipients</span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {parsedOwnerEmails.map((email) => (
                      <span
                        key={email}
                        className="rounded-full bg-[rgba(37,99,235,0.12)] px-3 py-1 text-xs font-semibold text-[color:var(--accent-strong)]"
                      >
                        {email}
                      </span>
                    ))}
                    {parsedOwnerEmails.length === 0 && (
                      <span className="text-xs text-[color:var(--text-muted)]">No recipients parsed yet.</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)]">
                    Property image (PNG/JPG)
                  </label>
                  <div className="flex flex-col gap-2 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 p-3 shadow-inner">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="ios-button px-3 py-2 text-xs"
                        data-variant="secondary"
                        onClick={() => document.getElementById('property-image-input')?.click()}
                      >
                        Upload image
                      </button>
                      <span className="text-[11px] text-[color:var(--text-muted)]">Appears in property config</span>
                    </div>
                    <input
                      id="property-image-input"
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                      onChange={(e) => void handleImageUpload(e.target.files?.[0] ?? null)}
                    />
                    {formState.propertyImageData ? (
                      <div className="space-y-2">
                        <div className="relative h-48 w-full overflow-hidden rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)]">
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.08),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(125,179,255,0.12),transparent_55%)]" />
                          <Image
                            src={formState.propertyImageData}
                            alt="Property"
                            fill
                            sizes="(max-width: 768px) 100vw, 640px"
                            className="rounded-2xl object-cover"
                            unoptimized
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="ios-button px-2 py-1 text-[11px]"
                            data-variant="secondary"
                            onClick={() => {
                              setFormState((prev) => ({
                                ...prev,
                                propertyImageData: '',
                                heroImagePath: '',
                                heroImageRemove: true,
                              }));
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)] text-[12px] text-[color:var(--text-muted)]">
                        No image selected
                      </div>
                    )}
                  </div>
                </div>
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







