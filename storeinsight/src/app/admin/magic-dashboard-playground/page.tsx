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
import { resolveDashboardEmailPropertyId } from '@/lib/flash/dashboardEmailConfig';

type ShareLinkRecord = {
  id: string;
  token: string | null;
  propertyId: string;
  investorId: string;
  snapshotMonthIso: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
};

type CreateResult = {
  id: string;
  url: string;
  expiresAt: string;
  snapshotMonthIso?: string | null;
  ttlHours?: number | null;
};

type ValidateResult = {
  status: string;
  record?: ShareLinkRecord | null;
};

type FirebaseStatus = {
  exists: boolean;
  updatedAt: string | null;
  rangesAvailable: string[];
  latestMonth: string | null;
};

type MonthlyFinancialRow = {
  monthIso: string;
  expenses: number | null;
  noi: number | null;
};

type ActiveTokensResult = {
  tokens: ShareLinkRecord[];
  count: number;
};

type DailySummaryProperty = {
  id: string;
  propertyId?: string;
  tenantPropertyId?: string;
  propertyCode?: string;
  name?: string;
};

type PropertyOption = {
  value: string;
  label: string;
};

const extractToken = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/dash\/t\/([^?#/]+)/i);
  if (match?.[1]) return match[1];
  return trimmed;
};

export default function MagicDashboardPlaygroundPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [propertyId, setPropertyId] = useState('');
  const [investorId, setInvestorId] = useState('');
  const [snapshotMonthIso, setSnapshotMonthIso] = useState('');
  const [ttlHours, setTtlHours] = useState('24');
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const [validateInput, setValidateInput] = useState('');
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const [revokeId, setRevokeId] = useState('');
  const [revokeStatus, setRevokeStatus] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const [statusPropertyId, setStatusPropertyId] = useState('');
  const [firebaseStatus, setFirebaseStatus] = useState<FirebaseStatus | null>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  const [financialEditorPropertyId, setFinancialEditorPropertyId] = useState('');
  const [monthlyFinancialRows, setMonthlyFinancialRows] = useState<MonthlyFinancialRow[]>([]);
  const [monthlyFinancialStatus, setMonthlyFinancialStatus] = useState<string | null>(null);
  const [monthlyFinancialError, setMonthlyFinancialError] = useState<string | null>(null);
  const [isLoadingMonthlyFinancials, setIsLoadingMonthlyFinancials] = useState(false);
  const [isSavingMonthlyFinancials, setIsSavingMonthlyFinancials] = useState(false);

  const [activeTokensPropertyId, setActiveTokensPropertyId] = useState('');
  const [activeTokensResult, setActiveTokensResult] = useState<ActiveTokensResult | null>(null);
  const [activeTokensError, setActiveTokensError] = useState<string | null>(null);
  const [activeTokensStatus, setActiveTokensStatus] = useState<string | null>(null);
  const [isLoadingActiveTokens, setIsLoadingActiveTokens] = useState(false);
  const [propertyOptionsStatus, setPropertyOptionsStatus] = useState<string | null>(null);
  const [propertyOptionsError, setPropertyOptionsError] = useState<string | null>(null);
  const [isLoadingPropertyOptions, setIsLoadingPropertyOptions] = useState(false);
  const [propertyRecords, setPropertyRecords] = useState<DailySummaryProperty[]>([]);

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_18%_10%,rgba(59,130,246,0.28),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.18),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_85%,rgba(56,189,248,0.22),transparent_65%)]'
    : 'bg-[radial-gradient(circle_at_82%_88%,rgba(125,211,252,0.16),transparent_62%)]';

  const propertyOptions = useMemo<PropertyOption[]>(() => {
    const deduped = new Map<string, PropertyOption>();
    propertyRecords.forEach((record) => {
      const value =
        resolveDashboardEmailPropertyId(
          record.propertyId?.trim(),
          record.tenantPropertyId?.trim(),
          record.propertyCode?.trim(),
          record.id?.trim(),
        ) ||
        record.propertyId?.trim() ||
        record.tenantPropertyId?.trim() ||
        record.id?.trim();
      if (!value || deduped.has(value)) return;
      const name = record.name?.trim() || record.propertyCode?.trim() || record.id?.trim() || value;
      deduped.set(value, { value, label: `${name} (${value})` });
    });
    return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [propertyRecords]);

  const loadPropertyOptions = async () => {
    setPropertyOptionsError(null);
    setPropertyOptionsStatus(null);
    setIsLoadingPropertyOptions(true);
    try {
      const response = await fetch('/api/daily-summary/properties', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) {
        setPropertyOptionsError('Failed to load properties from Firebase.');
        return;
      }
      setPropertyRecords(data as DailySummaryProperty[]);
      setPropertyOptionsStatus(`Loaded ${(data as DailySummaryProperty[]).length} properties from Firebase.`);
    } catch {
      setPropertyOptionsError('Failed to load properties from Firebase.');
    } finally {
      setIsLoadingPropertyOptions(false);
    }
  };

  useEffect(() => {
    void loadPropertyOptions();
  }, []);

  const handleCreate = async () => {
    setCreateError(null);
    setCreateStatus(null);
    if (!propertyId.trim() || !investorId.trim()) {
      setCreateError('Enter both propertyId and investorId.');
      return;
    }
    const ttlHoursNumber = Number(ttlHours);
    if (!Number.isFinite(ttlHoursNumber) || ttlHoursNumber < 1) {
      setCreateError('Enter a TTL of at least 1 hour.');
      return;
    }
    setIsCreating(true);
    try {
      const response = await fetch('/api/share-links/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          investorId,
          snapshotMonthIso: snapshotMonthIso || null,
          ttlHours: ttlHoursNumber,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCreateError(data?.message ?? 'Failed to create share link.');
        return;
      }
      setCreateResult(data as CreateResult);
      setCreateStatus('Token generated.');
    } catch {
      setCreateError('Failed to create share link.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async (value: string, setStatus: (msg: string) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Copied to clipboard.');
    } catch {
      setStatus('Copy failed.');
    }
  };

  const handleValidate = async (inputOverride?: string) => {
    setValidateError(null);
    const inputValue = (inputOverride ?? validateInput).trim();
    if (!inputValue) {
      setValidateError('Paste a token or URL.');
      return;
    }
    if (inputOverride) {
      setValidateInput(inputOverride);
    }
    setIsValidating(true);
    try {
      const response = await fetch('/api/share-links/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inputValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        setValidateError('Validation failed.');
        setValidateResult(null);
        return;
      }
      setValidateResult(data as ValidateResult);
    } catch {
      setValidateError('Validation failed.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleRevoke = async (idOverride?: string) => {
    setRevokeError(null);
    setRevokeStatus(null);
    const idValue = (idOverride ?? revokeId).trim();
    if (!idValue) {
      setRevokeError('Enter a share link record id.');
      return;
    }
    if (idOverride) {
      setRevokeId(idOverride);
    }
    const confirmRevoke = window.confirm('Revoke this share link? This cannot be undone.');
    if (!confirmRevoke) return;
    setIsRevoking(true);
    try {
      const response = await fetch('/api/share-links/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: idValue }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRevokeError(data?.message ?? 'Failed to revoke share link.');
        return;
      }
      setRevokeStatus('Share link revoked.');
    } catch {
      setRevokeError('Failed to revoke share link.');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleGenerateAndValidate = async () => {
    setCreateError(null);
    setCreateStatus(null);
    setTestStatus(null);
    setValidateError(null);
    if (!propertyId.trim() || !investorId.trim()) {
      setCreateError('Enter both propertyId and investorId.');
      return;
    }
    const ttlHoursNumber = Number(ttlHours);
    if (!Number.isFinite(ttlHoursNumber) || ttlHoursNumber < 1) {
      setCreateError('Enter a TTL of at least 1 hour.');
      return;
    }
    setIsTesting(true);
    try {
      const response = await fetch('/api/share-links/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          investorId,
          snapshotMonthIso: snapshotMonthIso || null,
          ttlHours: ttlHoursNumber,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setCreateError(data?.message ?? 'Failed to create share link.');
        return;
      }
      const created = data as CreateResult;
      setCreateResult(created);
      setCreateStatus('Token generated.');
      setRevokeId(created.id);
      await handleValidate(created.url);
      setTestStatus('Token generated and validated.');
    } catch {
      setCreateError('Failed to create share link.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleStatusCheck = async () => {
    setFirebaseError(null);
    setFirebaseStatus(null);
    if (!statusPropertyId.trim()) {
      setFirebaseError('Enter a propertyId.');
      return;
    }
    setIsCheckingStatus(true);
    try {
      const response = await fetch(
        `/api/firebase/property-historical/status?propertyId=${encodeURIComponent(statusPropertyId.trim())}`,
      );
      const data = await response.json();
      if (!response.ok) {
        setFirebaseError('Failed to load Firebase status.');
        return;
      }
      setFirebaseStatus(data as FirebaseStatus);
    } catch {
      setFirebaseError('Failed to load Firebase status.');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleLoadActiveTokens = async () => {
    setActiveTokensError(null);
    setActiveTokensStatus(null);
    setActiveTokensResult(null);
    setIsLoadingActiveTokens(true);
    try {
      const params = new URLSearchParams();
      if (activeTokensPropertyId.trim()) {
        params.set('propertyId', activeTokensPropertyId.trim());
      }
      const response = await fetch(`/api/share-links/active?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        setActiveTokensError(data?.message ?? 'Failed to load active tokens.');
        return;
      }
      const tokens = (data?.tokens ?? []) as ShareLinkRecord[];
      setActiveTokensResult({
        tokens,
        count: Number(data?.count ?? tokens.length),
      });
      setActiveTokensStatus(`Loaded ${tokens.length} active tokens.`);
    } catch {
      setActiveTokensError('Failed to load active tokens.');
    } finally {
      setIsLoadingActiveTokens(false);
    }
  };

  const handleMonthlyFinancialChange = (
    monthIso: string,
    field: 'expenses' | 'noi',
    value: string,
  ) => {
    setMonthlyFinancialRows((current) =>
      current.map((row) =>
        row.monthIso === monthIso
          ? {
              ...row,
              [field]: value.trim() === '' ? null : Number(value.replace(/,/g, '')),
            }
          : row,
      ),
    );
  };

  const handleLoadMonthlyFinancials = async () => {
    setMonthlyFinancialError(null);
    setMonthlyFinancialStatus(null);
    setMonthlyFinancialRows([]);
    if (!financialEditorPropertyId.trim()) {
      setMonthlyFinancialError('Select a propertyId.');
      return;
    }
    setIsLoadingMonthlyFinancials(true);
    try {
      const response = await fetch(
        `/api/firebase/property-historical/monthly-financials?propertyId=${encodeURIComponent(financialEditorPropertyId.trim())}`,
        { cache: 'no-store' },
      );
      const data = await response.json();
      if (!response.ok) {
        setMonthlyFinancialError(data?.message ?? 'Failed to load monthly financials.');
        return;
      }
      const rows = Array.isArray(data?.rows) ? (data.rows as MonthlyFinancialRow[]) : [];
      setMonthlyFinancialRows(rows);
      setMonthlyFinancialStatus(`Loaded ${rows.length} monthly financial rows.`);
    } catch {
      setMonthlyFinancialError('Failed to load monthly financials.');
    } finally {
      setIsLoadingMonthlyFinancials(false);
    }
  };

  const handleSaveAllMonthlyFinancials = async () => {
    setMonthlyFinancialError(null);
    setMonthlyFinancialStatus(null);
    if (!financialEditorPropertyId.trim()) {
      setMonthlyFinancialError('Select a propertyId.');
      return;
    }
    if (!monthlyFinancialRows.length) {
      setMonthlyFinancialError('Load monthly financials first.');
      return;
    }
    setIsSavingMonthlyFinancials(true);
    try {
      for (const row of monthlyFinancialRows) {
        const response = await fetch('/api/firebase/property-historical/monthly-financials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyId: financialEditorPropertyId.trim(),
            monthIso: row.monthIso,
            expenses: row.expenses,
            noi: row.noi,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          setMonthlyFinancialError(data?.message ?? `Failed to save ${row.monthIso}.`);
          return;
        }
      }
      setMonthlyFinancialStatus(`Saved ${monthlyFinancialRows.length} monthly financial rows.`);
    } catch {
      setMonthlyFinancialError('Failed to save monthly financial rows.');
    } finally {
      setIsSavingMonthlyFinancials(false);
    }
  };

  const getInvestorViewUrl = (input: string): string => {
    const token = extractToken(input);
    const base = typeof window === 'undefined' ? '' : window.location.origin;
    if (!token || !base) return '';
    return input.includes('/dash/t/') ? input : `${base}/dash/t/${token}`;
  };

  const openInvestorView = (input: string) => {
    const url = getInvestorViewUrl(input);
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <header className="ios-card ios-animate-up space-y-4 p-6 md:p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <span className="ios-badge text-[10px]">Dashboard access admin</span>
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                Historical dashboard access
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                Generate, validate, and revoke investor access tokens. Check Firebase data status for a property.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/historical-data-upload" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
                Historical upload
              </Link>
              <Link href="/historical-data" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                Historical dashboard
              </Link>
            </div>
          </div>
        </header>

        <section className="ios-card ios-animate-up space-y-8 p-6">
            <div className="space-y-4 border-b border-[color:var(--border-soft)] pb-6">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Generate token</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Optionally pin the token to data through a specific month and customize the TTL in hours.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                data-variant="secondary"
                onClick={() => {
                  void loadPropertyOptions();
                }}
                disabled={isLoadingPropertyOptions}
              >
                {isLoadingPropertyOptions ? 'Refreshing properties...' : 'Refresh properties'}
              </button>
              {propertyOptionsStatus ? <span className="text-[11px] text-[color:var(--text-secondary)]">{propertyOptionsStatus}</span> : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                value={propertyId}
                onChange={(event) => setPropertyId(event.target.value)}
              >
                <option value="">Select propertyId</option>
                {propertyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                placeholder="investorId"
                value={investorId}
                onChange={(event) => setInvestorId(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="month"
                className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                value={snapshotMonthIso}
                onChange={(event) => setSnapshotMonthIso(event.target.value)}
              />
              <input
                type="number"
                min="1"
                step="1"
                className="owner-field-input rounded-2xl px-4 py-2 text-sm"
                placeholder="TTL hours"
                value={ttlHours}
                onChange={(event) => setTtlHours(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ios-button px-4 py-2 text-sm" onClick={handleCreate} disabled={isCreating}>
                {isCreating ? 'Generating...' : 'Generate token'}
              </button>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                data-variant="secondary"
                onClick={handleGenerateAndValidate}
                disabled={isCreating || isTesting}
              >
                {isTesting ? 'Testing...' : 'Generate + Validate'}
              </button>
              {createResult?.url ? (
                <>
                  <button
                    type="button"
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="secondary"
                    onClick={() => handleCopy(createResult.url, (msg) => setCreateStatus(msg))}
                  >
                    Copy URL
                  </button>
                  <button
                    type="button"
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="ghost"
                    onClick={() => openInvestorView(createResult.url)}
                  >
                    Open Investor View
                  </button>
                </>
              ) : null}
            </div>

            {createResult ? (
              <div className="ios-list-card space-y-2 p-4 text-xs">
                <div className="text-[color:var(--text-secondary)]">id: {createResult.id}</div>
                <div className="text-[color:var(--text-secondary)]">expires: {createResult.expiresAt}</div>
                <div className="text-[color:var(--text-secondary)]">
                  pinned month: {createResult.snapshotMonthIso ?? 'latest'}
                </div>
                <div className="text-[color:var(--text-secondary)]">ttl hours: {createResult.ttlHours ?? '24'}</div>
                <a
                  href={createResult.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[color:var(--accent-strong)] underline underline-offset-2"
                >
                  {createResult.url}
                </a>
              </div>
            ) : null}

            <div className="space-y-1 text-[11px]">
              {propertyOptionsError ? <p className="text-red-500">Error: {propertyOptionsError}</p> : null}
              {createError ? <p className="text-red-500">Error: {createError}</p> : null}
              {createStatus ? <p className="text-[color:var(--text-secondary)]">{createStatus}</p> : null}
              {testStatus ? <p className="text-[color:var(--text-secondary)]">{testStatus}</p> : null}
            </div>
          </div>

          <div className="space-y-4 border-b border-[color:var(--border-soft)] pb-6">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Validate token</div>
              <p className="text-xs text-[color:var(--text-secondary)]">Paste a token or full URL.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <input
                className="owner-field-input flex-1 rounded-2xl px-4 py-2 text-sm"
                placeholder="token or https://.../dash/t/..."
                value={validateInput}
                onChange={(event) => setValidateInput(event.target.value)}
              />
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                onClick={() => {
                  void handleValidate();
                }}
                disabled={isValidating}
              >
                {isValidating ? 'Validating...' : 'Validate'}
              </button>
              {createResult?.url ? (
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="secondary"
                  onClick={() => handleValidate(createResult.url)}
                  disabled={isValidating}
                >
                  Validate last token
                </button>
              ) : null}
              {validateResult?.status === 'VALID' ? (
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="ghost"
                  onClick={() => openInvestorView(validateInput)}
                >
                  Open Investor View
                </button>
              ) : null}
            </div>

            {validateResult ? (
              <div className="ios-list-card space-y-2 p-4 text-xs">
                <div className="text-[color:var(--text-primary)]">Status: {validateResult.status}</div>
                {validateResult.record ? (
                  <>
                    <div className="text-[color:var(--text-secondary)]">id: {validateResult.record.id}</div>
                    <div className="text-[color:var(--text-secondary)]">property: {validateResult.record.propertyId}</div>
                    <div className="text-[color:var(--text-secondary)]">investor: {validateResult.record.investorId}</div>
                    <div className="text-[color:var(--text-secondary)]">
                      pinned month: {validateResult.record.snapshotMonthIso ?? 'latest'}
                    </div>
                    <div className="text-[color:var(--text-secondary)]">expires: {validateResult.record.expiresAt}</div>
                    <div className="text-[color:var(--text-secondary)]">revoked: {validateResult.record.revokedAt ?? 'n/a'}</div>
                    <div className="text-[color:var(--text-secondary)]">last used: {validateResult.record.lastUsedAt ?? 'n/a'}</div>
                    <div className="text-[color:var(--text-secondary)]">use count: {validateResult.record.useCount}</div>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1 text-[11px]">
              {validateError ? <p className="text-red-500">Error: {validateError}</p> : null}
            </div>
          </div>

          <div className="space-y-4 border-b border-[color:var(--border-soft)] pb-6">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Revoke token</div>
              <p className="text-xs text-[color:var(--text-secondary)]">Revoke by share link record id.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <input
                className="owner-field-input flex-1 rounded-2xl px-4 py-2 text-sm"
                placeholder="share link id"
                value={revokeId}
                onChange={(event) => setRevokeId(event.target.value)}
              />
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                onClick={() => {
                  void handleRevoke();
                }}
                disabled={isRevoking}
              >
                {isRevoking ? 'Revoking...' : 'Revoke'}
              </button>
              {(createResult?.id || validateResult?.record?.id) ? (
                <button
                  type="button"
                  className="ios-button px-4 py-2 text-sm"
                  data-variant="secondary"
                  onClick={() => handleRevoke(createResult?.id ?? validateResult?.record?.id ?? '')}
                  disabled={isRevoking}
                >
                  Revoke last token
                </button>
              ) : null}
            </div>

            <div className="space-y-1 text-[11px]">
              {revokeError ? <p className="text-red-500">Error: {revokeError}</p> : null}
              {revokeStatus ? <p className="text-[color:var(--text-secondary)]">{revokeStatus}</p> : null}
            </div>
          </div>

          <div className="space-y-4 border-b border-[color:var(--border-soft)] pb-6">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Active tokens</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Active = not revoked and not expired.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="owner-field-input flex-1 rounded-2xl px-4 py-2 text-sm"
                value={activeTokensPropertyId}
                onChange={(event) => setActiveTokensPropertyId(event.target.value)}
              >
                <option value="">All properties</option>
                {propertyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                onClick={handleLoadActiveTokens}
                disabled={isLoadingActiveTokens}
              >
                {isLoadingActiveTokens ? 'Loading...' : 'Load active tokens'}
              </button>
            </div>

            {activeTokensResult ? (
              <div className="ios-list-card overflow-hidden p-0 text-xs">
                <div className="grid grid-cols-7 gap-3 border-b border-[color:var(--border-soft)] px-4 py-2 text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                  <span className="col-span-2">Token id</span>
                  <span>Property</span>
                  <span>Investor</span>
                  <span>Month</span>
                  <span>Expires</span>
                  <span>Usage</span>
                </div>
                <div className="divide-y divide-[color:var(--border-soft)]">
                  {activeTokensResult.tokens.length ? (
                    activeTokensResult.tokens.map((token) => {
                      return (
                        <div key={token.id} className="grid grid-cols-7 gap-3 px-4 py-3 text-[color:var(--text-secondary)]">
                          <div className="col-span-2 space-y-2">
                            <div className="break-all text-[color:var(--text-primary)]">{token.id}</div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="ios-button px-3 py-1 text-[11px]"
                                data-variant="secondary"
                                onClick={() => openInvestorView(token.token ?? '')}
                                disabled={!token.token}
                              >
                                Open link
                              </button>
                              {!token.token ? (
                                <span className="self-center text-[11px] text-[color:var(--text-muted)]">
                                  Link unavailable for older token
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div>{token.propertyId}</div>
                          <div>{token.investorId}</div>
                          <div>{token.snapshotMonthIso ?? 'latest'}</div>
                          <div>{token.expiresAt ?? 'n/a'}</div>
                          <div>{token.useCount}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-4 py-3 text-[color:var(--text-muted)]">No active tokens found.</div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="space-y-1 text-[11px]">
              {activeTokensError ? <p className="text-red-500">Error: {activeTokensError}</p> : null}
              {activeTokensStatus ? <p className="text-[color:var(--text-secondary)]">{activeTokensStatus}</p> : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Firebase data status</div>
              <p className="text-xs text-[color:var(--text-secondary)]">Check if historical data is available.</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="owner-field-input flex-1 rounded-2xl px-4 py-2 text-sm"
                value={statusPropertyId}
                onChange={(event) => setStatusPropertyId(event.target.value)}
              >
                <option value="">Select propertyId</option>
                {propertyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                onClick={handleStatusCheck}
                disabled={isCheckingStatus}
              >
                {isCheckingStatus ? 'Checking...' : 'Check status'}
              </button>
            </div>

            {firebaseStatus ? (
              <div className="ios-list-card space-y-2 p-4 text-xs">
                <div className="text-[color:var(--text-primary)]">
                  {firebaseStatus.exists ? 'Data found' : 'No data'}
                </div>
                <div className="text-[color:var(--text-secondary)]">updated: {firebaseStatus.updatedAt ?? 'n/a'}</div>
                <div className="text-[color:var(--text-secondary)]">
                  ranges: {firebaseStatus.rangesAvailable?.length ? firebaseStatus.rangesAvailable.join(', ') : 'n/a'}
                </div>
                <div className="text-[color:var(--text-secondary)]">latest month: {firebaseStatus.latestMonth ?? 'n/a'}</div>
              </div>
            ) : null}

            <div className="space-y-1 text-[11px]">
              {firebaseError ? <p className="text-red-500">Error: {firebaseError}</p> : null}
            </div>
          </div>

          <div className="space-y-4 border-t border-[color:var(--border-soft)] pt-6">
            <div className="space-y-1">
              <div className="text-base font-semibold text-[color:var(--text-primary)]">Monthly NOI / Expenses editor</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Edit stored financial values by month for a property. Changes write directly into the historical snapshot record.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <select
                className="owner-field-input flex-1 rounded-2xl px-4 py-2 text-sm"
                value={financialEditorPropertyId}
                onChange={(event) => setFinancialEditorPropertyId(event.target.value)}
              >
                <option value="">Select propertyId</option>
                {propertyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                onClick={handleLoadMonthlyFinancials}
                disabled={isLoadingMonthlyFinancials}
              >
                {isLoadingMonthlyFinancials ? 'Loading...' : 'Load monthly financials'}
              </button>
              <button
                type="button"
                className="ios-button px-4 py-2 text-sm"
                data-variant="secondary"
                onClick={handleSaveAllMonthlyFinancials}
                disabled={isSavingMonthlyFinancials || !monthlyFinancialRows.length}
              >
                {isSavingMonthlyFinancials ? 'Saving...' : 'Save all'}
              </button>
            </div>

            {monthlyFinancialRows.length ? (
              <div className="ios-list-card overflow-hidden p-0 text-xs">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="border-b border-[color:var(--border-soft)] text-left text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">Expenses</th>
                      <th className="px-4 py-3">NOI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border-soft)]">
                    {monthlyFinancialRows.map((row) => (
                      <tr key={row.monthIso}>
                        <td className="px-4 py-3 font-medium text-[color:var(--text-primary)]">{row.monthIso}</td>
                        <td className="px-4 py-3">
                          <input
                            className="owner-field-input w-full rounded-xl px-3 py-2 text-sm"
                            inputMode="decimal"
                            value={row.expenses ?? ''}
                            onChange={(event) => handleMonthlyFinancialChange(row.monthIso, 'expenses', event.target.value)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="owner-field-input w-full rounded-xl px-3 py-2 text-sm"
                            inputMode="decimal"
                            value={row.noi ?? ''}
                            onChange={(event) => handleMonthlyFinancialChange(row.monthIso, 'noi', event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="space-y-1 text-[11px]">
              {monthlyFinancialError ? <p className="text-red-500">Error: {monthlyFinancialError}</p> : null}
              {monthlyFinancialStatus ? <p className="text-[color:var(--text-secondary)]">{monthlyFinancialStatus}</p> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

