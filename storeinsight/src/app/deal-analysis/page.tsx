'use client';

import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import DealAnalysisForm from './ui/DealAnalysisForm';

const overlayTopLight =
  'bg-[radial-gradient(circle_at_18%_12%,rgba(245,158,11,0.18),transparent_60%)]';
const overlayTopDark =
  'bg-[radial-gradient(circle_at_12%_10%,rgba(245,158,11,0.26),transparent_58%)]';
const overlayBottomLight =
  'bg-[radial-gradient(circle_at_82%_86%,rgba(217,119,6,0.14),transparent_62%)]';
const overlayBottomDark =
  'bg-[radial-gradient(circle_at_88%_82%,rgba(217,119,6,0.18),transparent_60%)]';

export default function DealAnalysisPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">Automation tools</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-4 sm:flex-1">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Deal Analysis
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Upload historical financials from a storage operator or CRE broker. We&rsquo;ll parse the
                workbook and ask an LLM whether STORE Management should pursue the property as an
                acquisition or management opportunity.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href="/deal-analysis/saved" className="ios-button px-4 py-2 text-sm">
                View saved deals
              </Link>
              <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                <span aria-hidden className="-ml-1 mr-1 text-base">
                  &larr;
                </span>
                Back to directory
              </Link>
            </div>
          </div>
        </header>

        <DealAnalysisForm />
      </div>
    </div>
  );
}
