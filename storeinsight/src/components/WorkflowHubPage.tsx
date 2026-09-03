'use client';

import Link from 'next/link';
import BackLink from '@/components/BackLink';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import WorkflowIcon from '@/components/WorkflowIcon';
import type { WorkflowCard, WorkflowTone } from '@/lib/workflowDirectory';

type WorkflowHubPageProps = {
  accent: WorkflowTone;
  badge: string;
  title: string;
  description: string;
  options: WorkflowCard[];
};

const overlayTopLight: Record<WorkflowTone, string> = {
  blue: 'bg-[radial-gradient(circle_at_18%_12%,rgba(37,99,235,0.22),transparent_60%)]',
  purple: 'bg-[radial-gradient(circle_at_18%_12%,rgba(168,85,247,0.22),transparent_60%)]',
  green: 'bg-[radial-gradient(circle_at_18%_12%,rgba(34,197,94,0.2),transparent_60%)]',
  amber: 'bg-[radial-gradient(circle_at_18%_12%,rgba(245,158,11,0.2),transparent_60%)]',
};

const overlayTopDark: Record<WorkflowTone, string> = {
  blue: 'bg-[radial-gradient(circle_at_12%_10%,rgba(59,130,246,0.3),transparent_58%)]',
  purple: 'bg-[radial-gradient(circle_at_12%_10%,rgba(168,85,247,0.28),transparent_58%)]',
  green: 'bg-[radial-gradient(circle_at_12%_10%,rgba(34,197,94,0.28),transparent_58%)]',
  amber: 'bg-[radial-gradient(circle_at_12%_10%,rgba(245,158,11,0.28),transparent_58%)]',
};

const overlayBottomLight: Record<WorkflowTone, string> = {
  blue: 'bg-[radial-gradient(circle_at_82%_86%,rgba(56,189,248,0.16),transparent_62%)]',
  purple: 'bg-[radial-gradient(circle_at_82%_86%,rgba(196,181,253,0.16),transparent_62%)]',
  green: 'bg-[radial-gradient(circle_at_82%_86%,rgba(74,222,128,0.16),transparent_62%)]',
  amber: 'bg-[radial-gradient(circle_at_82%_86%,rgba(251,191,36,0.16),transparent_62%)]',
};

const overlayBottomDark: Record<WorkflowTone, string> = {
  blue: 'bg-[radial-gradient(circle_at_88%_82%,rgba(56,189,248,0.22),transparent_60%)]',
  purple: 'bg-[radial-gradient(circle_at_88%_82%,rgba(196,181,253,0.22),transparent_60%)]',
  green: 'bg-[radial-gradient(circle_at_88%_82%,rgba(74,222,128,0.2),transparent_60%)]',
  amber: 'bg-[radial-gradient(circle_at_88%_82%,rgba(251,191,36,0.2),transparent_60%)]',
};

export default function WorkflowHubPage({
  accent,
  badge,
  title,
  description,
  options,
}: WorkflowHubPageProps): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const overlayTop = isDark ? overlayTopDark[accent] : overlayTopLight[accent];
  const overlayBottom = isDark ? overlayBottomDark[accent] : overlayBottomLight[accent];
  const iconTone = isDark
    ? {
        blue: 'border-[rgba(59,130,246,0.45)] bg-[rgba(37,99,235,0.22)] text-[#93C5FD]',
        purple: 'border-[rgba(168,85,247,0.4)] bg-[rgba(168,85,247,0.22)] text-[#E9D5FF]',
        green: 'border-[rgba(34,197,94,0.38)] bg-[rgba(34,197,94,0.2)] text-[#BBF7D0]',
        amber: 'border-[rgba(245,158,11,0.38)] bg-[rgba(245,158,11,0.22)] text-[#FCD34D]',
      }
    : {
        blue: 'border-[rgba(37,99,235,0.25)] bg-[rgba(37,99,235,0.12)] text-[#1D4ED8]',
        purple: 'border-[rgba(168,85,247,0.22)] bg-[rgba(168,85,247,0.12)] text-[#7C3AED]',
        green: 'border-[rgba(34,197,94,0.22)] bg-[rgba(34,197,94,0.12)] text-[#047857]',
        amber: 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.12)] text-[#B45309]',
      };

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">{badge}</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-4 sm:flex-1">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">{description}</p>
            </div>
            <BackLink href="/" label="Back to directory" />
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {options.map((option, index) => {
            const delayClass = index === 1 ? 'ios-animate-delay-sm' : index === 2 ? 'ios-animate-delay-md' : '';
            const cardClass = [
              'group ios-card ios-animate-up feature-card',
              delayClass,
              'relative overflow-hidden flex h-full flex-col gap-6 p-8 transition-all duration-500',
              option.disabled ? 'cursor-not-allowed opacity-80' : 'hover:-translate-y-1',
            ]
              .filter(Boolean)
              .join(' ');

            const sharedContent = (
              <>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-px rounded-[26px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),transparent_70%)] opacity-0 transition duration-500 group-hover:opacity-100 dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.2),transparent_75%)]"
                />
                <div className="relative z-10 flex h-full flex-col gap-6">
                  <span className="ios-pill text-[11px]" data-tone={option.tone === 'amber' ? 'warning' : option.tone}>
                    {option.status}
                  </span>
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl border shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-sm ${iconTone[option.tone]}`}
                      aria-hidden
                    >
                      <WorkflowIcon name={option.icon} tone={option.tone} />
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">{option.title}</h2>
                      <p className="text-sm text-[color:var(--text-secondary)]">{option.description}</p>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm text-[color:var(--text-muted)]">
                    {option.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2 text-left">
                        <span className="mt-1 inline-flex h-1.5 w-1.5 flex-none rounded-full bg-[rgba(37,99,235,0.7)]" />
                        <span className="flex-1 leading-snug">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--accent-strong)]">
                    {option.disabled ? 'Coming soon' : 'Enter workflow'}
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

            if (option.disabled || !option.href) {
              return (
                <div key={option.id} className={cardClass} aria-disabled="true">
                  {sharedContent}
                </div>
              );
            }

            return (
              <Link key={option.id} href={option.href} className={cardClass}>
                {sharedContent}
              </Link>
            );
          })}
        </section>
      </div>
    </div>
  );
}
