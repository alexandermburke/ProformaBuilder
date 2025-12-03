'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PropertyConfig } from '@/types/dailySummary';

const devEnabled = process.env.NEXT_PUBLIC_ENABLE_MSR_DEV_UI === 'true' || process.env.NODE_ENV !== 'production';
const defaultSender = process.env.NEXT_PUBLIC_MSR_DEV_SENDER || 'info@tenantinc.com';
const defaultSubject = process.env.NEXT_PUBLIC_MSR_DEV_SUBJECT || 'Reports Delivery';

type FetchState<T> = { loading: boolean; error: string | null; data: T | null };

export default function DevMsrPage() {
  const [emailState, setEmailState] = useState<FetchState<unknown>>({ loading: false, error: null, data: null });
  const [viewerState, setViewerState] = useState<FetchState<unknown>>({ loading: false, error: null, data: null });
  const [dailyState, setDailyState] = useState<FetchState<unknown>>({ loading: false, error: null, data: null });
  const [autoState, setAutoState] = useState<FetchState<unknown>>({ loading: false, error: null, data: null });
  const [chainState, setChainState] = useState<FetchState<unknown>>({ loading: false, error: null, data: null });
  const [properties, setProperties] = useState<PropertyConfig[]>([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);

  const [senderEmail, setSenderEmail] = useState(defaultSender);
  const [subjectPhrase, setSubjectPhrase] = useState(defaultSubject);
  const [maxMessages, setMaxMessages] = useState<string>('');
  const [viewerUrl, setViewerUrl] = useState('');
  const [dailySenderEmail, setDailySenderEmail] = useState(defaultSender);
  const [dailySubjectPhrase, setDailySubjectPhrase] = useState(defaultSubject);
  const [dailyMaxMessages, setDailyMaxMessages] = useState<string>('');
  const [autoReportDate, setAutoReportDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [respectSendTime, setRespectSendTime] = useState<boolean>(false);
  const [useAllEnabled, setUseAllEnabled] = useState<boolean>(true);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());

  const sectionClass =
    'rounded-3xl border border-[color:var(--border-soft,#1f2937)] bg-[color:var(--surface,#0b1222)]/90 p-6 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.6)] backdrop-blur space-y-4 transition';
  const labelClass = 'block text-sm font-semibold text-[color:var(--text,#e5e7eb)]';
  const helperClass = 'text-xs text-[color:var(--text-muted,#9ca3af)]';
  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-soft,#1f2937)] bg-[color:var(--surface-subtle,#0f172a)] px-3 py-2 text-sm text-[color:var(--text,#e5e7eb)] shadow-inner focus:border-[color:var(--tint-blue,#60a5fa)] focus:outline-none placeholder:text-[color:var(--text-muted,#9ca3af)]';
  const buttonClass =
    'inline-flex items-center justify-center rounded-xl bg-[linear-gradient(120deg,#2563eb,#7c3aed)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:translate-y-[-1px] hover:shadow-xl disabled:opacity-60';

  useEffect(() => {
    const loadProps = async () => {
      setPropsLoading(true);
      setPropsError(null);
      try {
        const res = await fetch('/api/daily-summary/properties', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as PropertyConfig[];
        setProperties(data);
      } catch (err) {
        setPropsError(err instanceof Error ? err.message : 'Unable to load properties');
      } finally {
        setPropsLoading(false);
      }
    };
    if (devEnabled) void loadProps();
  }, []);

  const toggleProperty = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const runEmailIngest = async () => {
    setEmailState({ loading: true, error: null, data: null });
    try {
      const res = await fetch('/api/dev/msr/ingest/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderEmail,
          subjectPhrase,
          maxMessages: maxMessages ? Number(maxMessages) : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setEmailState({ loading: false, error: null, data: json });
    } catch (err) {
      setEmailState({ loading: false, error: err instanceof Error ? err.message : 'Request failed', data: null });
    }
  };

  const runViewerIngest = async () => {
    setViewerState({ loading: true, error: null, data: null });
    try {
      const res = await fetch('/api/dev/msr/ingest/viewer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewerUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setViewerState({ loading: false, error: null, data: json });
    } catch (err) {
      setViewerState({ loading: false, error: err instanceof Error ? err.message : 'Request failed', data: null });
    }
  };

  const runDailyIngest = async () => {
    setDailyState({ loading: true, error: null, data: null });
    try {
      const res = await fetch('/api/dev/msr/ingest/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderEmail: dailySenderEmail,
          subjectPhrase: dailySubjectPhrase,
          maxMessages: dailyMaxMessages ? Number(dailyMaxMessages) : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setDailyState({ loading: false, error: null, data: json });
    } catch (err) {
      setDailyState({ loading: false, error: err instanceof Error ? err.message : 'Request failed', data: null });
    }
  };

  const runAutoFlash = async (sendEmails: boolean) => {
    setAutoState({ loading: true, error: null, data: null });
    try {
      const body: Record<string, unknown> = {
        reportDate: autoReportDate,
        sendEmails,
        respectSendTime,
        propertyCodes: useAllEnabled ? undefined : Array.from(selectedCodes),
      };
      const res = await fetch('/api/flash-report/auto/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setAutoState({ loading: false, error: null, data: json });
    } catch (err) {
      setAutoState({ loading: false, error: err instanceof Error ? err.message : 'Request failed', data: null });
    }
  };

  const runIngestAndAuto = async () => {
    setChainState({ loading: true, error: null, data: null });
    try {
      const ingestRes = await fetch('/api/dev/msr/ingest/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderEmail: dailySenderEmail,
          subjectPhrase: dailySubjectPhrase,
          maxMessages: dailyMaxMessages ? Number(dailyMaxMessages) : undefined,
        }),
      });
      if (!ingestRes.ok) throw new Error(await ingestRes.text());
      const ingestJson = await ingestRes.json();

      const autoRes = await fetch('/api/flash-report/auto/daily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportDate: autoReportDate,
          sendEmails: true,
          respectSendTime,
          propertyCodes: useAllEnabled ? undefined : Array.from(selectedCodes),
        }),
      });
      if (!autoRes.ok) throw new Error(await autoRes.text());
      const autoJson = await autoRes.json();

      setChainState({ loading: false, error: null, data: { ingest: ingestJson, auto: autoJson } });
    } catch (err) {
      setChainState({ loading: false, error: err instanceof Error ? err.message : 'Request failed', data: null });
    }
  };

  if (!devEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-[color:var(--text,#111827)]">
        <h1 className="text-xl font-semibold">MSR Dev Tools</h1>
        <p className="text-sm text-[color:var(--text-muted,#6b7280)]">MSR dev tools are disabled in this environment.</p>
      </div>
    );
  }

  const renderResult = (state: FetchState<unknown>) => (
    <div className="text-sm text-[color:var(--text,#111827)]">
      {state.loading && <StatusPill tone="info" text="Running..." />}
      {state.error && <StatusPill tone="danger" text={`Error: ${state.error}`} />}
      {state.data !== null && state.data !== undefined && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-[color:var(--border-soft,#1f2937)] bg-[color:var(--surface-subtle,#0f172a)] p-3 text-xs text-[color:var(--text,#e5e7eb)]">
          {JSON.stringify(state.data, null, 2)}
        </pre>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 text-[color:var(--text,#e5e7eb)]">
      <div className="relative overflow-hidden rounded-3xl border border-[color:var(--border-soft,#1f2937)] bg-[radial-gradient(circle_at_20%_20%,rgba(37,99,235,0.18),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(124,58,237,0.18),transparent_35%),#0b1222] p-8 shadow-[0_30px_80px_-40px_rgba(37,99,235,0.55)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_90%,rgba(14,165,233,0.14),transparent_45%)]" />
        <div className="relative flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--text-muted,#94a3b8)]">Developer</p>
              <h1 className="text-3xl font-bold drop-shadow-sm">MSR Dev Control Panel</h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-muted,#cbd5e1)]">
                Manually drive the MSR ingestion pipeline for testing: pull emails, ingest viewer URLs, and run the full daily
                flow. Only available in dev mode.
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-[color:var(--text-muted,#cbd5e1)]">
            <StatusPill tone="info" text={`Sender default: ${defaultSender}`} />
            <StatusPill tone="info" text={`Subject default: ${defaultSubject}`} />
          </div>
        </div>
      </div>

      <section className={sectionClass}>
        <SectionHeader title="Ingest MSR emails" subtitle="Pull recent MSR emails into Firestore for manual testing." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Sender email"
            value={senderEmail}
            onChange={setSenderEmail}
            placeholder="info@tenantinc.com"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
          <Field
            label="Subject phrase"
            value={subjectPhrase}
            onChange={setSubjectPhrase}
            placeholder="Reports Delivery"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
          <Field
            label="Max messages (optional)"
            value={maxMessages}
            onChange={setMaxMessages}
            placeholder="50"
            type="number"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
        </div>
        <button className={buttonClass} onClick={runEmailIngest} disabled={emailState.loading}>
          Run email ingestion
        </button>
        {renderResult(emailState)}
      </section>

      <section className={sectionClass}>
        <SectionHeader
          title="Ingest from viewer URL"
          subtitle="Provide a reportviewer URL to download and store CloudFront XLSX files."
        />
        <label className="block">
          <span className={labelClass}>Viewer URL</span>
          <span className={helperClass}>Copy the full reportviewer.tenantinc.com URL from the MSR email.</span>
          <textarea
            className={`${inputClass} mt-1 h-28`}
            value={viewerUrl}
            onChange={(e) => setViewerUrl(e.target.value)}
            placeholder="https://reportviewer.tenantinc.com/shared-reports/owners/..."
          />
        </label>
        <button className={buttonClass} onClick={runViewerIngest} disabled={viewerState.loading}>
          Ingest management summaries
        </button>
        {renderResult(viewerState)}
      </section>

      <section className={sectionClass}>
        <SectionHeader
          title="Run daily MSR ingestion"
          subtitle="Execute the full daily ingestion orchestrator (email -> viewer -> storage)."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Sender email"
            value={dailySenderEmail}
            onChange={setDailySenderEmail}
            placeholder="info@tenantinc.com"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
          <Field
            label="Subject phrase"
            value={dailySubjectPhrase}
            onChange={setDailySubjectPhrase}
            placeholder="Reports Delivery"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
          <Field
            label="Max messages (optional)"
            value={dailyMaxMessages}
            onChange={setDailyMaxMessages}
            placeholder="50"
            type="number"
            className="sm:col-span-1"
            labelClass={labelClass}
            inputClass={inputClass}
          />
        </div>
        <button className={buttonClass} onClick={runDailyIngest} disabled={dailyState.loading}>
          Run daily ingestion
        </button>
        {renderResult(dailyState)}
      </section>

      <section className={sectionClass}>
        <SectionHeader
          title="Automatic Daily Flash (dev)"
          subtitle="Generate PPTXs from ingested MSRs and optionally send owner emails."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Report date"
            value={autoReportDate}
            onChange={setAutoReportDate}
            type="date"
            labelClass={labelClass}
            inputClass={inputClass}
          />
          <div className="flex items-center gap-3">
            <input
              id="toggle-enabled"
              type="checkbox"
              className="h-4 w-4"
              checked={useAllEnabled}
              onChange={(e) => setUseAllEnabled(e.target.checked)}
            />
            <label htmlFor="toggle-enabled" className={labelClass}>
              Use all enabled properties (ignore selection)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="toggle-respect"
              type="checkbox"
              className="h-4 w-4"
              checked={respectSendTime}
              onChange={(e) => setRespectSendTime(e.target.checked)}
            />
            <label htmlFor="toggle-respect" className={labelClass}>
              Respect send time (MST) when generating
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--border-soft,#1f2937)] bg-[color:var(--surface-subtle,#0f172a)] p-3 text-sm text-[color:var(--text,#e5e7eb)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted,#9ca3af)]">
              Properties ({properties.length})
            </p>
            {propsLoading && <StatusPill tone="info" text="Loading properties..." />}
            {propsError && <StatusPill tone="danger" text={propsError} />}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {properties.map((prop) => {
              const code = prop.propertyCode || prop.id || prop.tenantPropertyId;
              const checked = selectedCodes.has(code);
              return (
                <label
                  key={code}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--border-soft,#1f2937)] bg-[color:var(--surface,#0b1222)]/70 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">{prop.name}</span>
                    <span className="text-[11px] text-[color:var(--text-muted,#9ca3af)]">
                      {code} • {prop.enabled ? 'enabled' : 'disabled'} • send {prop.sendTimeMst ?? prop.sendTimeLocal ?? '—'} MST
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    disabled={useAllEnabled}
                    checked={useAllEnabled ? prop.enabled : checked}
                    onChange={() => toggleProperty(code)}
                  />
                </label>
              );
            })}
            {properties.length === 0 && !propsLoading && (
              <p className="text-xs text-[color:var(--text-muted,#9ca3af)]">No properties loaded yet.</p>
            )}
          </div>
          {useAllEnabled && (
            <p className="mt-2 text-[11px] text-[color:var(--text-muted,#9ca3af)]">
              Selections are ignored while "Use all enabled properties" is on.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <button className={buttonClass} onClick={() => void runAutoFlash(false)} disabled={autoState.loading}>
            Generate flashes only
          </button>
          <button className={buttonClass} onClick={() => void runAutoFlash(true)} disabled={autoState.loading}>
            Generate flashes + send emails (TEST)
          </button>
          <button className={buttonClass} onClick={() => void runIngestAndAuto()} disabled={chainState.loading}>
            Ingest MSRs + Generate + Send (today)
          </button>
        </div>

        {renderResult(autoState)}
        {renderResult(chainState)}
      </section>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  labelClass: string;
  inputClass: string;
};

function Field({ label, value, onChange, placeholder, type = 'text', className, labelClass, inputClass }: FieldProps) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className={labelClass}>{label}</span>
      <input
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        min={type === 'number' ? 1 : undefined}
      />
    </label>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      {subtitle ? <p className="text-sm text-[color:var(--text-muted,#6b7280)]">{subtitle}</p> : null}
    </div>
  );
}

function StatusPill({ tone, text }: { tone: 'info' | 'danger'; text: string }) {
  const toneClass =
    tone === 'danger'
      ? 'bg-rose-100 text-rose-700 border border-rose-200'
      : 'bg-blue-100 text-blue-700 border border-blue-200';
  const dotClass = tone === 'danger' ? 'bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.15)]' : 'bg-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${toneClass}`}>
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      {text}
    </span>
  );
}
