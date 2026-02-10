/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

type FeatureTone = 'blue' | 'purple' | 'green' | 'amber';
type FeatureIconKey = 'document' | 'layers' | 'globe' | 'target';

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
    title: 'Daily Summary Report',
    description: 'Automate daily flash reports for STORE properties.',
    href: '/daily-summary',
    status: 'Active',
    tone: 'purple',
    icon: 'document',
    highlights: [
      'Pull daily metrics from Tenant management summary exports',
      'Fill Excel flash templates with rentals, vacates, and occupancy',
      'Schedule automatic email delivery to property owners',
    ],
  },
  {
    title: 'Accounting',
    description: 'Standardize bank and credit card spreadsheets for efficient, accurate Yardi imports.',
    href: '/accounting',
    status: 'WIP',
    tone: 'blue',
    icon: 'layers',
    highlights: [
      'Upload, map fields, validate, and export',
      'Normalize dates, descriptions, payees, and amounts',
      'Yardi-ready outputs with clear exceptions and audit logs',
    ],

    disabled: false,
  },
  {
    title: 'Owner Reports',
    description: 'Build owner report packages with STORE portfolio and market data.',
    href: '/owner-reports',
    status: 'Active',
    tone: 'green',
    icon: 'globe',
    highlights: [
      'Blend STORE portfolio results with market benchmarks',
      'Assemble owner decks with structured commentary sections',
      'Queue recurring owner report deliveries around asset manager cycles',
    ],
  },
  {
    title: 'Historical Data',
    description: 'Review facility history and performance drilldowns.',
    href: '/historical-data',
    status: 'Active',
    tone: 'amber',
    icon: 'layers',
    highlights: [
      'Collections and AR aging trends with graphs',
      'Pricing quality, variance, and rent cadence',
      'Demand, autopay, and inventory drilldowns',
    ],
  },
  {
    title: 'Comp Sets',
    description: 'Benchmark STORE assets against competitor pricing.',
    href: '/comp-sets',
    status: 'Planned',
    tone: 'blue',
    icon: 'target',
    highlights: [
      'Import rate shops, rent rolls, and competitor snapshots',
      'Normalize premiums, concessions, and occupancy deltas',
      'Export comp set notes for underwriting decks',
    ],
  },
];

const HERO_STATS = [
  {
    label: 'Active workspaces',
    value: '3',
    detail: 'Owner, Accounting, Proforma',
  },
  {
    label: 'Automations live',
    value: '42',
    detail: 'Token + validation routines',
  },
  {
    label: 'Last update',
    value: 'Jan, 2nd',
    detail: 'Audit surface refresh',
  },
];

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

const iconToneLight: Record<FeatureTone, string> = {
  blue: 'bg-[rgba(37,99,235,0.12)] text-[#1D4ED8]',
  purple: 'bg-[rgba(168,85,247,0.12)] text-[#7C3AED]',
  green: 'bg-[rgba(34,197,94,0.12)] text-[#047857]',
  amber: 'bg-[rgba(245,158,11,0.12)] text-[#B45309]',
};

const iconToneDark: Record<FeatureTone, string> = {
  blue: 'bg-[rgba(59,130,246,0.22)] text-[#93C5FD]',
  purple: 'bg-[rgba(168,85,247,0.24)] text-[#C4B5FD]',
  green: 'bg-[rgba(34,197,94,0.22)] text-[#BBF7D0]',
  amber: 'bg-[rgba(245,158,11,0.25)] text-[#FDE68A]',
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
    case 'target':
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
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3" />
          <path d="M12 19v3" />
          <path d="M2 12h3" />
          <path d="M19 12h3" />
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
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const carouselPaused = useRef(false);
  const [flashDevMode, setFlashDevMode] = useState(false);
  const [devModeLoading, setDevModeLoading] = useState(true);
  const [devModeSaving, setDevModeSaving] = useState(false);
  const [devModeError, setDevModeError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [modalFeature, setModalFeature] = useState<string | null>(null);
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
  const iconTone = isDark ? iconToneDark : iconToneLight;
  const heroStats = HERO_STATS.map((stat) =>
    stat.label === 'Last update' ? { ...stat, value: formatHeroDate(new Date()) } : stat,
  );
  const carouselItems = features.length > 1 ? [...features, ...features] : features;

  useEffect(() => {
    const container = carouselRef.current;
    if (!container || features.length < 2) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const shouldAnimate = !prefersReducedMotion.matches;

    let rafId = 0;
    let lastTime = 0;
    const speed = 0.04;
    let resumeTimer = 0;
    let dragPointerId: number | null = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartScroll = 0;
    let isDragging = false;
    let dragMoved = false;
    const dragThreshold = 6;

    const scheduleResume = () => {
      if (resumeTimer) window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        carouselPaused.current = false;
        lastTime = 0;
      }, 1200);
    };

    const pause = () => {
      carouselPaused.current = true;
      if (resumeTimer) window.clearTimeout(resumeTimer);
    };

    const resume = () => {
      if (isDragging) return;
      scheduleResume();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button && event.button !== 0) return;
      pause();
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragStartScroll = container.scrollLeft;
      isDragging = false;
      dragMoved = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragPointerId !== event.pointerId) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;

      if (!isDragging) {
        if (Math.hypot(deltaX, deltaY) < dragThreshold) return;
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          dragPointerId = null;
          resume();
          return;
        }
        isDragging = true;
        dragMoved = true;
        container.classList.add('is-dragging');
        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // ignore capture errors
        }
      }

      if (isDragging) {
        container.scrollLeft = dragStartScroll - deltaX;
        lastTime = 0;
        event.preventDefault();
      }
    };

    const endDrag = () => {
      if (isDragging && dragPointerId !== null) {
        try {
          container.releasePointerCapture(dragPointerId);
        } catch {
          // ignore capture errors
        }
      }
      isDragging = false;
      dragPointerId = null;
      container.classList.remove('is-dragging');
      resume();
    };

    const onWheel = (event: WheelEvent) => {
      pause();
      const dominantDelta = Math.abs(event.deltaY) > Math.abs(event.deltaX);
      if (dominantDelta) {
        container.scrollLeft += event.deltaY;
        event.preventDefault();
      } else {
        container.scrollLeft += event.deltaX;
      }
      scheduleResume();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!dragMoved) return;
      event.preventDefault();
      event.stopPropagation();
      dragMoved = false;
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', endDrag);
    container.addEventListener('pointercancel', endDrag);
    container.addEventListener('focusin', pause);
    container.addEventListener('focusout', resume);
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('click', onClickCapture, true);

    if (shouldAnimate) {
      carouselPaused.current = false;
      lastTime = 0;

      const step = (timestamp: number) => {
        if (!lastTime) lastTime = timestamp;
        const delta = timestamp - lastTime;
        lastTime = timestamp;

        if (!carouselPaused.current) {
          container.scrollLeft += delta * speed;
          const resetAt = container.scrollWidth / 2;
          if (container.scrollLeft >= resetAt) {
            container.scrollLeft -= resetAt;
          }
        }

        rafId = window.requestAnimationFrame(step);
      };

      container.scrollLeft = 0;
      rafId = window.requestAnimationFrame(step);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (resumeTimer) window.clearTimeout(resumeTimer);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', endDrag);
      container.removeEventListener('pointercancel', endDrag);
      container.removeEventListener('focusin', pause);
      container.removeEventListener('focusout', resume);
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-20">
        <header className="ios-card ios-animate-up grid gap-8 p-10">
          <span className="ios-badge inline-flex items-center gap-2 text-[10px]">
            STORE Internal platform
          </span>
          <div className="grid gap-6 md:flex md:items-end md:justify-between">
            <div className="max-w-3xl space-y-4">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Workspace directory for STORE Management.
              </h1>
              <p className="text-base leading-relaxed text-[color:var(--text-secondary)] sm:text-lg">
                Access the active workspaces used for underwriting, summaries, and owner reporting. Select a workspace
                to open the tool you desire to use.
              </p>
              <div className="grid gap-4 pt-2 text-sm sm:grid-cols-3">
                {heroStats.map((stat) => (
                  <div key={stat.label} className="stat-card hero-stat rounded-2xl p-4">
                    <p className="hero-stat__label">{stat.label}</p>
                    <p
                      className="hero-stat__value"
                      suppressHydrationWarning={stat.label === 'Last update'}
                    >
                      {stat.value}
                    </p>
                    <p className="hero-stat__detail">{stat.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </header>

        <section className="feature-carousel feature-carousel--scroll gap-6" ref={carouselRef}>
          {carouselItems.map((feature, index) => {
            const slotIndex = index % features.length;
            const delayClass = slotIndex === 1 ? 'ios-animate-delay-sm' : slotIndex === 2 ? 'ios-animate-delay-md' : '';
            const cardClass = [
              'group ios-card ios-animate-up feature-card feature-carousel__card',
              delayClass,
              'relative overflow-hidden flex h-full flex-col gap-6 p-8 transition-all duration-500',
            ]
              .filter(Boolean)
              .join(' ');
            const isDuplicate = index >= features.length;
            const sharedContent = (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-px rounded-[26px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),transparent_70%)] opacity-0 transition duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.2),transparent_75%)]"
                />
                <div className="relative z-10 flex flex-col gap-6">
                  <span className="ios-pill text-[11px]" data-tone={feature.tone}>
                    {feature.status}
                  </span>
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-sm ${iconTone[feature.tone]} dark:border-white/15 dark:bg-white/10`}
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
                </div>
              </>
            );

            if (feature.disabled) {
              return (
                <button
                  key={`${feature.title}-${index}`}
                  type="button"
                  onClick={() => handleUnavailable(feature.title)}
                  className={cardClass}
                  data-tone={feature.tone}
                  tabIndex={isDuplicate ? -1 : undefined}
                  aria-hidden={isDuplicate}
                >
                  {sharedContent}
                </button>
              );
            }

            return (
              <Link
                key={`${feature.title}-${index}`}
                href={feature.href}
                className={cardClass}
                data-tone={feature.tone}
                tabIndex={isDuplicate ? -1 : undefined}
                aria-hidden={isDuplicate}
              >
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

