'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

type Feature = {
  title: string;
  description: string;
  href: string;
  badge: string;
  accent: string;
  icon: string;
  highlights: string[];
  disabled?: boolean;
};

const features: Feature[] = [
  {
    title: 'Accounting',
    description: 'Manage vendor statement ingestion and mapping for monthly closes.',
    href: '/accounting',
    badge: 'WIP',
    accent: 'bg-[#DBEAFE] text-[#1D4ED8]',
    icon: '/file.svg',
    highlights: [
      'Ingest income statements directly into STORE templates',
      'Flag mapping exceptions and variance discrepancies',
      'Suggest headers based on vendor history',
    ],
    disabled: true,
  },
  {
    title: 'Proforma',
    description: 'Prepare facility proformas with shared STORE assumptions.',
    href: '/proforma',
    badge: 'WIP',
    accent: 'bg-[#DBEAFE] text-[#1D4ED8]',
    icon: '/window.svg',
    highlights: [
      'Walk through upload, mapping, validation, and export steps',
      'Model NOI scenarios with configurable STORE assumptions',
      'Produce outputs formatted for internal review',
    ],
     disabled: true,
  },
  {
    title: 'Owner Reports',
    description: 'Build owner report packages with STORE portfolio and market data.',
    href: '/owner-reports',
    badge: 'Beta',
    accent: 'bg-[#DCFCE7] text-[#15803D]',
    icon: '/globe.svg',
    highlights: [
      'Combine STORE portfolio data with market comparisons',
      'Assemble OSR packs with internal commentary sections',
      'Schedule recurring deliveries aligned to asset manager timelines',
    ],
  },
];

export default function DirectoryPage(): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
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

  const pageClass = isDark ? 'bg-[#0B1120] text-[#F9FAFB]' : 'bg-[#F3F4F6] text-[#0B1120]';
  const gradientClass = isDark
    ? 'bg-[radial-gradient(circle_at_top,#1F2937_0%,transparent_55%)]'
    : 'bg-[radial-gradient(circle_at_top,#E0E7FF_0%,transparent_55%)]';
  const surfaceClass = isDark ? 'border-white/10 bg-[#111827]/90' : 'border-white/25 bg-white/85';
  const secondarySurfaceClass = isDark ? 'border-white/10 bg-[#111827]/95' : 'border-white/25 bg-white/90';
  const headingTextClass = isDark ? 'text-white' : 'text-[#0B1120]';
  const bodyTextClass = isDark ? 'text-[#CBD5F5]' : 'text-[#4B5563]';
  const detailTextClass = isDark ? 'text-[#E5E7FF]' : 'text-[#374151]';
  const cardHoverShadow = isDark ? 'hover:shadow-[0_20px_40px_rgba(15,23,42,0.55)]' : 'hover:shadow-2xl';
  const buttonBase =
    'inline-flex items-center gap-2 rounded-full font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]';
  const primaryButtonClass = `${buttonBase} px-4 py-2 text-sm bg-[#2563EB] text-white hover:bg-[#1D4ED8]`;
  const secondaryButtonClass = isDark
    ? `${buttonBase} px-4 py-2 text-sm border border-white/20 bg-[#1F2937] text-[#E5E7FF] hover:bg-[#111827]`
    : `${buttonBase} px-4 py-2 text-sm border border-[#2563EB]/20 bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]`;
  const tertiaryButtonClass = isDark
    ? `${buttonBase} px-3 py-1 text-xs border border-white/20 bg-transparent text-[#E5E7FF] hover:bg-[#1F2937]`
    : `${buttonBase} px-3 py-1 text-xs border border-[#CBD5F5] bg-white text-[#1F2937] hover:bg-[#EFF6FF]`;

  return (
    <div className={`min-h-screen ${pageClass}`}>
      <div className="relative isolate">
        <div className={`absolute inset-0 -z-10 ${gradientClass}`} />
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-12 px-6 py-12 lg:gap-16 lg:px-10 lg:py-20">
          <header className={`grid gap-6 rounded-3xl ${surfaceClass} p-10 shadow-2xl backdrop-blur-xl`}>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
              Store Insight Platform
            </span>
            <div className="grid gap-4 md:flex md:items-end md:justify-between">
              <div className="max-w-3xl space-y-4">
                <h1 className={`text-3xl font-bold leading-tight ${headingTextClass} sm:text-4xl`}>
                  Workspace directory for STORE Management.
                </h1>
                <p className={`text-base ${bodyTextClass} sm:text-lg`}>
                  Access the active workspaces used for underwriting, accounting, and owner reporting. Select a workspace
                  to open the tools you need for day-to-day tasks.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 md:items-end">
              </div>
            </div>
          </header>

          <section className="grid gap-6 lg:grid-cols-3">
            {features.map((feature) => (
              feature.disabled ? (
                <button
                  key={feature.title}
                  type="button"
                  onClick={() => handleUnavailable(feature.title)}
                  className={`group relative flex flex-col rounded-3xl ${secondarySurfaceClass} p-8 text-left shadow-xl backdrop-blur-lg transition hover:-translate-y-1 ${cardHoverShadow} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]`}
                >
                  <span
                    className={`pointer-events-none inline-flex items-center self-start rounded-full px-3 py-1 text-xs font-semibold ${feature.accent}`}
                  >
                    {feature.badge}
                  </span>
                  <div className="mt-6 flex items-center gap-4">
                    <div className={`rounded-full p-3 shadow-inner ${isDark ? 'bg-[#1E293B]' : 'bg-[#EEF2FF]'}`}>
                      <Image src={feature.icon} alt="" width={36} height={36} />
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                        {feature.title}
                      </h2>
                      <p className={`mt-1 text-sm ${bodyTextClass}`}>{feature.description}</p>
                    </div>
                  </div>
                  <ul className={`mt-6 space-y-2 text-sm ${detailTextClass}`}>
                    {feature.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2">
                        <span className="mt-[6px] inline-flex h-1.5 w-1.5 flex-none rounded-full bg-[#2563EB]" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#2563EB]">
                    Check status
                  </span>
                </button>
              ) : (
                <Link
                  key={feature.title}
                  href={feature.href}
                  className={`group relative flex flex-col rounded-3xl ${secondarySurfaceClass} p-8 shadow-xl backdrop-blur-lg transition hover:-translate-y-1 ${cardHoverShadow}`}
                >
                  <span
                    className={`pointer-events-none inline-flex items-center self-start rounded-full px-3 py-1 text-xs font-semibold ${feature.accent}`}
                  >
                    {feature.badge}
                  </span>
                  <div className="mt-6 flex items-center gap-4">
                    <div className={`rounded-full p-3 shadow-inner ${isDark ? 'bg-[#1E293B]' : 'bg-[#EEF2FF]'}`}>
                      <Image src={feature.icon} alt="" width={36} height={36} />
                    </div>
                    <div>
                      <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-[#111827]'}`}>
                        {feature.title}
                      </h2>
                      <p className={`mt-1 text-sm ${bodyTextClass}`}>{feature.description}</p>
                    </div>
                  </div>
                  <ul className={`mt-6 space-y-2 text-sm ${detailTextClass}`}>
                    {feature.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2">
                        <span className="mt-[6px] inline-flex h-1.5 w-1.5 flex-none rounded-full bg-[#2563EB]" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#2563EB]">
                    Enter workspace
                  </span>
                </Link>
              )
            ))}
          </section>

          <footer className={`rounded-3xl ${surfaceClass} p-7 text-sm ${bodyTextClass} shadow-xl backdrop-blur-lg`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-[#94A3B8]' : 'text-[#6B7280]'}`}>
                  Platform Notes
                </div>
                <p>All workspaces share source data, audit history, and permissions managed by STORE Management.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={openSettings}
                  className={`${secondaryButtonClass}`}
                >
                  Settings
                </button>
                <Link
                  href="/updatelog"
                  className={`${buttonBase} px-4 py-2 text-sm bg-[#2563EB] text-white hover:opacity-75`}
                >
                  Update Log
                </Link>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {modalFeature ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B1120]/50 px-4 py-10">
          <div
            className={`w-full max-w-sm rounded-3xl border p-6 shadow-2xl ${
              isDark ? 'border-white/15 bg-[#111827]' : 'border-white/40 bg-white'
            }`}
          >
            <h3 className={`text-lg font-semibold ${headingTextClass}`}>Not yet available</h3>
            <p className={`mt-2 text-sm ${bodyTextClass}`}>
              {modalFeature} is currently in development within the STORE Insight platform.
            </p>
            <button
              type="button"
              onClick={closeModal}
              className={`${primaryButtonClass} mt-6 justify-center`}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1120]/60 px-4 py-10">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 shadow-2xl ${
              isDark ? 'border-white/15 bg-[#0F172A]' : 'border-white/40 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className={`text-lg font-semibold ${headingTextClass}`}>Settings</h3>
                <p className={`mt-1 text-sm ${bodyTextClass}`}>Adjust workspace preferences for this directory view.</p>
              </div>
              <button
                type="button"
                onClick={closeSettings}
                className={tertiaryButtonClass}
              >
                Close
              </button>
            </div>

            <div className={`mt-6 rounded-2xl ${secondarySurfaceClass} p-4`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className={`text-sm font-semibold ${headingTextClass}`}>Dark mode</div>
                  <p className={`text-xs ${bodyTextClass}`}>Toggle the directory between light and dark palettes.</p>
                </div>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  aria-pressed={isDark}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition ${
                    isDark ? 'bg-[#2563EB]' : 'bg-[#D1D5DB]'
                  }`}
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition ${
                      isDark ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className={`mt-4 rounded-2xl ${secondarySurfaceClass} p-4`}>
              <div className={`text-sm font-semibold ${headingTextClass}`}>Workspace defaults</div>
              <p className={`mt-1 text-xs ${bodyTextClass}`}>
                Settings persist for this browser session. Additional preferences will surface here as they become
                available.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="sr-only">
        <Image src="/next.svg" alt="" width={1} height={1} />
        <Image src="/vercel.svg" alt="" width={1} height={1} />
        <Image src="/file.svg" alt="" width={1} height={1} />
        <Image src="/window.svg" alt="" width={1} height={1} />
        <Image src="/globe.svg" alt="" width={1} height={1} />
      </div>
    </div>
  );
}
