'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import { usePreferences } from '@/components/PreferencesProvider';

type FeatureTone = 'blue' | 'purple' | 'green';
type FeatureIconKey = 'document' | 'layers' | 'globe';

type Feature = {
  title: string;
  description: string;
  href: string;
  status: string;
  tone: FeatureTone;
  icon: FeatureIconKey;
  highlights: string[];
  disabled?: boolean;
};

const features: Feature[] = [
  {
    title: 'Accounting',
    description: 'Manage vendor statement ingestion and mapping for monthly closes.',
    href: '/accounting',
    status: 'WIP',
    tone: 'purple',
    icon: 'document',
    highlights: [
      'Map income statement exports into STORE chart of accounts',
      'Surface unmapped and mismatched ledger lines before month-end',
      'Apply header suggestions learned from prior vendor imports',
    ],
    disabled: true,
  },
  {
    title: 'Proforma',
    description: 'Prepare facility proformas with shared STORE assumptions.',
    href: '/proforma',
    status: 'WIP',
    tone: 'blue',
    icon: 'layers',
    highlights: [
      'Guide analysts through upload, mapping, validation, and export',
      'Calculate NOI scenarios with configurable STORE assumptions',
      'Generate proforma workbooks ready for review',
    ],
    disabled: true,
  },
  {
    title: 'Owner Reports',
    description: 'Build owner report packages with STORE portfolio and market data.',
    href: '/owner-reports',
    status: 'Beta',
    tone: 'green',
    icon: 'globe',
    highlights: [
      'Blend STORE portfolio results with market benchmarks',
      'Assemble owner decks with structured commentary sections',
      'Queue recurring owner report deliveries around asset manager cycles',
    ],
  },
];

const PLATFORM_VERSION = '0.8.1';
const NEXT_VERSION = '15.5.4';

const iconToneLight: Record<FeatureTone, string> = {
  blue: 'bg-[rgba(37,99,235,0.12)] text-[#1D4ED8]',
  purple: 'bg-[rgba(168,85,247,0.12)] text-[#7C3AED]',
  green: 'bg-[rgba(34,197,94,0.12)] text-[#047857]',
};

const iconToneDark: Record<FeatureTone, string> = {
  blue: 'bg-[rgba(59,130,246,0.22)] text-[#93C5FD]',
  purple: 'bg-[rgba(168,85,247,0.24)] text-[#C4B5FD]',
  green: 'bg-[rgba(34,197,94,0.22)] text-[#BBF7D0]',
};

function FeatureIcon({ name, tone }: { name: FeatureIconKey; tone: FeatureTone }): JSX.Element {
  switch (name) {
    case 'document':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 3.5h7l4.5 4.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M14 3.5V9h5" />
          <path d="M9 14h6" />
          <path d="M9 18h6" />
        </svg>
      );
    case 'layers':
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 4 4 8l8 4 8-4-8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 16 8 4 8-4" />
        </svg>
      );
    case 'globe':
    default:
      return (
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7 text-current"
          data-tone={tone}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16" />
          <path d="M12 4a12 12 0 0 1 3.5 8A12 12 0 0 1 12 20a12 12 0 0 1-3.5-8A12 12 0 0 1 12 4Z" />
        </svg>
      );
  }
}

export default function DirectoryPage(): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const { delinquencyAudit, toggleDelinquencyAudit } = usePreferences();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [modalFeature, setModalFeature] = useState<string | null>(null);

  const toggleDarkMode = () => toggleTheme();
  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  const handleUnavailable = (featureTitle: string) => {
    setModalFeature(featureTitle);
  };

  const closeModal = () => {
    setModalFeature(null);
  };

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
  const badgeTone: Record<FeatureTone, 'neutral' | 'success'> = {
    blue: 'neutral',
    purple: 'neutral',
    green: 'success',
  };
  const iconTone = isDark ? iconToneDark : iconToneLight;

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-20">
        <header className="ios-card ios-animate-up grid gap-8 p-10">
          <span className="ios-badge text-[10px]">STORE Internal platform</span>
          <div className="grid gap-6 md:flex md:items-end md:justify-between">
            <div className="max-w-3xl space-y-4">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Workspace directory for STORE Management.
              </h1>
              <p className="text-base leading-relaxed text-[color:var(--text-secondary)] sm:text-lg">
                Access the active workspaces used for underwriting, accounting, and owner reporting. Select a workspace
                to open the tools you rely on every day.
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-3">
          {features.map((feature, index) => {
            const delayClass = index === 1 ? 'ios-animate-delay-sm' : index === 2 ? 'ios-animate-delay-md' : '';
            const cardClass = `group ios-card ios-animate-up ${delayClass} flex flex-col gap-6 p-8 transition-all duration-500 hover:-translate-y-1`;
            const sharedContent = (
              <>
                <span className="ios-pill text-[11px]" data-tone={badgeTone[feature.tone]}>
                  {feature.status}
                </span>
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-sm ${iconTone[feature.tone]}`}
                    aria-hidden
                  >
                    <FeatureIcon name={feature.icon} tone={feature.tone} />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">
                      {feature.title}
                    </h2>
                    <p className="text-sm text-[color:var(--text-secondary)]">
                      {feature.description}
                    </p>
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-[color:var(--text-muted)]">
                  {feature.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2 text-left">
                      <span className="mt-1 inline-flex h-1.5 w-1.5 flex-none rounded-full bg-[rgba(37,99,235,0.7)]" />
                      <span className="flex-1 leading-snug">{highlight}</span>
                    </li>
                  ))}
                </ul>
                <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--accent-strong)]">
                  {feature.disabled ? 'Request access' : 'Enter workspace'}
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
              </>
            );

            if (feature.disabled) {
              return (
                <button
                  key={feature.title}
                  type="button"
                  onClick={() => handleUnavailable(feature.title)}
                  className={cardClass}
                  data-tone={feature.tone}
                >
                  {sharedContent}
                </button>
              );
            }

            return (
              <Link key={feature.title} href={feature.href} className={cardClass} data-tone={feature.tone}>
                {sharedContent}
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
          </div>
        </footer>
      </div>

      {modalFeature ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[color:var(--overlay)]/65 px-4 py-10 backdrop-blur-sm">
          <div className="ios-card ios-animate-up w-full max-w-sm space-y-4 p-6">
            <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Not yet available</h3>
            <p className="text-sm text-[color:var(--text-secondary)]">
              {modalFeature} is currently in development within the STORE Internal platform.
            </p>
            <button
              type="button"
              onClick={closeModal}
              className="ios-button w-full justify-center px-5 py-2 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--overlay)]/70 px-4 py-10 backdrop-blur-sm">
          <div className="ios-card ios-animate-up w-full max-w-md space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">Settings</h3>
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
                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                    Audit Console
                  </div>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    Surface the ESR delinquency audit workspace in this app and append the PPT audit slide on export.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleDelinquencyAudit}
                  aria-pressed={delinquencyAudit}
                  className={toggleButtonClass(delinquencyAudit)}
                >
                  <span className={togglePillClass} />
                </button>
              </div>
              <div className="rounded-[16px] border border-[rgba(148,163,255,0.28)] bg-white/60 p-4 text-xs text-[color:var(--text-secondary)]">
                <p>Preferences sync locally in this browser. More personalization options are coming soon.</p>
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

