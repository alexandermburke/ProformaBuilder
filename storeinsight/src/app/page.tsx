/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import WorkflowIcon from '@/components/WorkflowIcon';
import { workflowCategories, type WorkflowCard, type WorkflowTone } from '@/lib/workflowDirectory';
import { getAutoDownloadPptx, setAutoDownloadPptx } from '@/lib/flashPrefs';

type DirectoryCard = WorkflowCard & { href: string };

const PLATFORM_VERSION = '0.8.8';
const NEXT_VERSION = '15.5.7';
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const iconToneLight: Record<WorkflowTone, string> = {
  blue: 'bg-[rgba(37,99,235,0.12)] text-[#1D4ED8]',
  purple: 'bg-[rgba(168,85,247,0.12)] text-[#7C3AED]',
  green: 'bg-[rgba(34,197,94,0.12)] text-[#047857]',
  amber: 'bg-[rgba(245,158,11,0.12)] text-[#B45309]',
};

const iconToneDark: Record<WorkflowTone, string> = {
  blue: 'bg-[rgba(59,130,246,0.22)] text-[#93C5FD]',
  purple: 'bg-[rgba(168,85,247,0.24)] text-[#C4B5FD]',
  green: 'bg-[rgba(34,197,94,0.22)] text-[#BBF7D0]',
  amber: 'bg-[rgba(245,158,11,0.25)] text-[#FDE68A]',
};

function getOrdinalSuffix(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

function formatHeroDate(date: Date): string {
  const month = MONTH_LABELS[date.getMonth()] ?? '';
  const day = date.getDate();
  return `${month}, ${day}${getOrdinalSuffix(day)}`;
}

export default function DirectoryPage(): JSX.Element {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const directoryCards: DirectoryCard[] = workflowCategories.map((category) => ({
    id: category.key,
    title: category.title,
    description: category.summaryDescription,
    href: category.href,
    status: `${category.features.length} ${category.features.length === 1 ? 'workflow' : 'workflows'}`,
    tone: category.summaryTone,
    icon: category.summaryIcon,
    highlights: category.summaryHighlights,
  }));
  const [flashDevMode, setFlashDevMode] = useState(false);
  const [devModeLoading, setDevModeLoading] = useState(true);
  const [devModeSaving, setDevModeSaving] = useState(false);
  const [devModeError, setDevModeError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [autoDownloadPptx, setAutoDownloadPptxState] = useState(true);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/me', { method: 'GET' });
        if (!active) return;
        if (!res.ok) {
          setSessionEmail(null);
          setIsAdmin(false);
          const redirectTarget =
            typeof window !== 'undefined'
              ? encodeURIComponent(`${window.location.pathname}${window.location.search}`)
              : '';
          router.replace(`/login${redirectTarget ? `?redirect=${redirectTarget}` : ''}`);
          return;
        }
        const data = (await res.json().catch(() => null)) as { email?: string; isAdmin?: boolean } | null;
        if (active) {
          setSessionEmail(data?.email ?? null);
          setIsAdmin(Boolean(data?.isAdmin));
        }
      } finally {
        if (active) setSessionChecked(true);
      }
    };

    checkSession();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    setAutoDownloadPptxState(getAutoDownloadPptx());
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setDevModeLoading(false);
      setDevModeError(null);
      return;
    }
    let active = true;
    const fetchDevMode = async () => {
      setDevModeLoading(true);
      setDevModeError(null);
      try {
        const res = await fetch('/api/flash-report/dev-mode', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { flashDevMode?: boolean };
        if (active) setFlashDevMode(Boolean(json.flashDevMode));
      } catch (err) {
        if (active) setDevModeError(err instanceof Error ? err.message : 'Unable to load development mode');
      } finally {
        if (active) setDevModeLoading(false);
      }
    };
    fetchDevMode();
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const handleLogout = async () => {
    setActionStatus('Signing out...');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error', err);
    } finally {
      setSessionEmail(null);
      setIsAdmin(false);
      router.replace('/login');
    }
  };

  const handlePasswordRequest = () => {
    setActionStatus('Password change request noted.'); // simple feedback for now
    if (typeof window !== 'undefined') {
      window.open('mailto:platform@store.com?subject=Password%20change%20request', '_blank');
    }
  };

  const toggleDarkMode = () => toggleTheme();
  const toggleFlashDevMode = async () => {
    const next = !flashDevMode;
    setDevModeSaving(true);
    setDevModeError(null);
    try {
      const res = await fetch('/api/flash-report/dev-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flashDevMode: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { flashDevMode?: boolean };
      setFlashDevMode(Boolean(json.flashDevMode));
    } catch (err) {
      setDevModeError(err instanceof Error ? err.message : 'Unable to update development mode');
    } finally {
      setDevModeSaving(false);
    }
  };
  const toggleAutoDownloadPptx = () => {
    const next = !autoDownloadPptx;
    setAutoDownloadPptxState(next);
    setAutoDownloadPptx(next);
  };
  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  const toggleButtonClass = (active: boolean): string =>
    [
      'relative inline-flex h-8 w-16 shrink-0 items-center rounded-full border border-[rgba(148,163,255,0.28)] p-1 transition-all duration-500',
      active
        ? 'justify-end bg-[rgba(37,99,235,0.75)] shadow-[0_10px_25px_rgba(37,99,235,0.25)]'
        : 'justify-start bg-[rgba(148,163,255,0.3)]',
    ].join(' ');

  const togglePillClass =
    'inline-block h-6 w-6 rounded-full bg-white shadow-[0_8px_18px_rgba(15,23,42,0.22)] transition-transform duration-500';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.25),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_20%_10%,rgba(37,99,235,0.22),transparent_58%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_85%_80%,rgba(56,189,248,0.18),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_82%_85%,rgba(125,211,252,0.16),transparent_62%)]';
  const iconTone = isDark ? iconToneDark : iconToneLight;
  const totalWorkflowCount = workflowCategories.reduce((sum, category) => sum + category.features.length, 0);
  const activeWorkflowCount = workflowCategories.reduce(
    (sum, category) => sum + category.features.filter((feature) => !feature.disabled).length,
    0,
  );
  const heroLastUpdated = formatHeroDate(new Date());

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-20">
        <header className="ios-card ios-animate-up grid gap-8 p-8 lg:p-10">
          <div className="max-w-4xl space-y-6">
            <span className="ios-badge inline-flex items-center gap-2 text-[10px]">
              STORE Internal platform
            </span>
            <div className="space-y-4">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Workflow directory for STORE Management.
              </h1>
              <p className="text-base leading-relaxed text-[color:var(--text-secondary)] sm:text-lg">
                Start from accounting, finance, historical data, or automation tools. Each section opens its own view
                with the workflows that belong there.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="ios-pill px-3 py-2 text-[11px]" data-tone="blue">
                {workflowCategories.length} sections
              </div>
              <div className="ios-pill px-3 py-2 text-[11px]" data-tone="green">
                {activeWorkflowCount} active workflows
              </div>
              <div className="ios-pill px-3 py-2 text-[11px]" data-tone="amber">
                {totalWorkflowCount} workflows mapped
              </div>
              <div className="ios-pill px-3 py-2 text-[11px]" data-tone="neutral" suppressHydrationWarning>
                Updated {heroLastUpdated}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="ios-list-card space-y-2 p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--text-muted)]">
                  What This Covers
                </div>
                <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
                  Accounting handles prep and reconciliation work, finance handles planning, owner reporting, and
                  underwriting intake, historical data covers dashboards and uploads, and automations covers recurring
                  reporting and package delivery workspaces.
                </p>
              </div>
              <div className="ios-list-card space-y-2 p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--text-muted)]">
                  How To Use It
                </div>
                <p className="text-sm leading-6 text-[color:var(--text-secondary)]">
                  Pick a section first, then open the workflow inside that hub that matches the task you need to run.
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-7xl gap-6 md:grid-cols-2 lg:grid-cols-4">
          {directoryCards.map((card, index) => {
            const delayClass = index === 1 ? 'ios-animate-delay-sm' : index === 2 ? 'ios-animate-delay-md' : '';
            const cardClass = [
              'group ios-card ios-animate-up feature-card',
              delayClass,
              'relative overflow-hidden flex h-full flex-col gap-6 p-8 transition-all duration-500',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <Link key={card.id} href={card.href} className={cardClass}>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-px rounded-[26px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),transparent_70%)] opacity-0 transition duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.2),transparent_75%)]"
                />
                <div className="relative z-10 flex flex-col gap-6">
                  <span className="ios-pill text-[11px]" data-tone={card.tone}>
                    {card.status}
                  </span>
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-sm ${iconTone[card.tone]} dark:border-white/15 dark:bg-white/10`}
                      aria-hidden
                    >
                      <WorkflowIcon name={card.icon} tone={card.tone} />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">{card.title}</h2>
                      <p className="text-sm text-[color:var(--text-secondary)]">{card.description}</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-[color:var(--text-muted)]">
                    {card.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2 text-left">
                        <span className="mt-1 inline-flex h-1.5 w-1.5 flex-none rounded-full bg-[rgba(37,99,235,0.7)]" />
                        <span className="flex-1 leading-snug">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--accent-strong)]">
                    Open section
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="h-4 w-4 transition-transform duration-500 group-hover:translate-x-1"
                    >
                      <path
                        fill="currentColor"
                        d="M13.172 12 8.586 7.414 10 6l6 6-6 6-1.414-1.414L13.172 12Z"
                      />
                    </svg>
                  </span>
                </div>
              </Link>
            );
          })}
        </section>

        <footer className="ios-card ios-animate-up flex flex-col gap-4 p-7 text-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                Platform notes
              </div>
              <p className="text-[color:var(--text-secondary)]">
                All workspaces share source data, audit history, and permissions managed by STORE Management.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openSettings}
                className="ios-button px-5 py-2 text-sm"
                data-variant="secondary"
              >
                Preferences
              </button>
              <Link href="/updatelog" className="ios-button px-5 py-2 text-sm" data-variant="ghost">
                Update log
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[rgba(148,163,255,0.24)] pt-3 text-xs text-[color:var(--text-muted)]">
            <span>Platform v{PLATFORM_VERSION}</span>
            <span aria-hidden>|</span>
            <span>Next.js v{NEXT_VERSION}</span>
            <span aria-hidden>|</span>
            <span>
              {sessionEmail
                ? `Logged in as ${sessionEmail}`
                : sessionChecked
                  ? 'Logged out'
                  : 'Checking session...'}
            </span>
            {isAdmin ? (
              <span className="ios-badge inline-flex items-center gap-2 text-[10px]">
                Admin
              </span>
            ) : sessionEmail ? (
              <span className="ios-pill text-[10px]" data-tone="green">
                User
              </span>
            ) : null}
          </div>
        </footer>
      </div>

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
          <div className="ios-card ios-animate-up w-full max-w-md space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Settings</h3>
              </div>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Adjust workspace preferences for this directory view.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSettings}
                className="ios-icon-button text-[color:var(--text-secondary)]"
              >
                <span className="sr-only">Close</span>
                <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4">
                  <path
                    fill="currentColor"
                    d="m7.05 7.757 4.242 4.243 4.243-4.243 1.414 1.415-4.242 4.243 4.242 4.242-1.414 1.415-4.243-4.243-4.242 4.243-1.414-1.415 4.242-4.242-4.242-4.243z"
                  />
                </svg>
              </button>
            </div>

            <div className="ios-list-card space-y-4 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">Dark mode</div>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    Toggle the directory between light and dark palettes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  aria-pressed={isDark}
                  className={toggleButtonClass(isDark)}
                >
                  <span className={togglePillClass} />
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">Auto-download PPTX</div>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    When enabled, generating a manual Daily Flash also downloads the .pptx to this browser. The email still sends either way.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleAutoDownloadPptx}
                  aria-pressed={autoDownloadPptx}
                  className={toggleButtonClass(autoDownloadPptx)}
                >
                  <span className={togglePillClass} />
                </button>
              </div>
              {isAdmin ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-[color:var(--text-primary)]">Development Mode</div>
                    <p className="text-xs text-[color:var(--text-secondary)]">
                      When enabled, Daily Flash automation emails only alex@storestorage.com instead of owner recipients.
                    </p>
                    {devModeError ? (
                      <p className="text-xs text-red-500">Error: {devModeError}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={toggleFlashDevMode}
                    aria-pressed={flashDevMode}
                    disabled={devModeLoading || devModeSaving}
                    className={toggleButtonClass(flashDevMode)}
                  >
                    <span className={togglePillClass} />
                  </button>
                </div>
              ) : null}
              <div className="rounded-[16px] border border-[rgba(148,163,255,0.28)] bg-white/60 p-4 text-xs text-[color:var(--text-secondary)]">
                <p>Preferences sync locally in this browser. More personalization options are coming soon.</p>
              </div>

              <div className="border-t border-[rgba(148,163,255,0.18)] pt-4">
                <div className="text-sm font-semibold text-[color:var(--text-primary)]">Account</div>
                <p className="text-xs text-[color:var(--text-secondary)]">
                  Manage your session for this internal workspace. Contact Ops for credential changes.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="secondary"
                  >
                    Log out
                  </button>
                  <button
                    type="button"
                    onClick={handlePasswordRequest}
                    className="ios-button px-4 py-2 text-sm"
                    data-variant="ghost"
                  >
                    Request password change
                  </button>
                </div>
                {actionStatus ? (
                  <p className="mt-2 text-xs text-[color:var(--text-muted)]" role="status">
                    {actionStatus}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="ios-list-card space-y-2 p-5">
              <div className="text-sm font-semibold text-[color:var(--text-primary)]">Workspace defaults</div>
              <p className="text-xs text-[color:var(--text-secondary)]">
                Settings persist for this session. Additional preferences will surface here as they become available.
              </p>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

