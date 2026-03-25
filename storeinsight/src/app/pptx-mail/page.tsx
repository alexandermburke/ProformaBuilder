'use client';

import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import PropertyAnalysisPackageForm from './ui/PropertyAnalysisPackageForm';

const overlayTopLight =
  'bg-[radial-gradient(circle_at_18%_12%,rgba(34,197,94,0.2),transparent_60%)]';
const overlayTopDark =
  'bg-[radial-gradient(circle_at_12%_10%,rgba(34,197,94,0.28),transparent_58%)]';
const overlayBottomLight =
  'bg-[radial-gradient(circle_at_82%_86%,rgba(74,222,128,0.16),transparent_62%)]';
const overlayBottomDark =
  'bg-[radial-gradient(circle_at_88%_82%,rgba(74,222,128,0.2),transparent_60%)]';

export default function PptxMailPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const overlayTop = isDark ? overlayTopDark : overlayTopLight;
  const overlayBottom = isDark ? overlayBottomDark : overlayBottomLight;

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-10">
          <span className="ios-badge text-[10px]">Automation tools</span>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-4 sm:flex-1">
              <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
                Property Analysis Package
              </h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
                Upload a supported proforma workbook, review the first 3 slides of extracted package tokens, and
                generate a templated PowerPoint from the managed <code>PackageTemplate.pptx</code> asset.
              </p>
            </div>
            <Link href="/" className="ios-button shrink-0 px-4 py-2 text-sm" data-variant="ghost">
              <span aria-hidden className="-ml-1 mr-1 text-base">
                &larr;
              </span>
              Back to directory
            </Link>
          </div>
        </header>

        <PropertyAnalysisPackageForm />
      </div>
    </div>
  );
}
