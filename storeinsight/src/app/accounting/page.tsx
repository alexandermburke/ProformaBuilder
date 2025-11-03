'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export default function AutomatedAccountingPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const pageBackground = isDark
    ? 'bg-gradient-to-br from-[#020817] via-[#0f172a] to-[#111c33] text-[var(--text-primary)]'
    : 'bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFF] to-[#E0F2FE] text-[#0B1120]';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.25),transparent_55%)]'
    : 'bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.15),transparent_55%)]';

  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.12),transparent_60%)]';

  const glassPanel = isDark
    ? 'border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--text-primary)]'
    : 'border border-white/30 bg-white/85 text-[#0B1120]';

  const badgeClass = isDark
    ? 'inline-flex items-center gap-2 rounded-full bg-[rgba(37,99,235,0.18)] px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[var(--accent)]'
    : 'inline-flex items-center gap-2 rounded-full bg-[#2563EB]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#1D4ED8]';

  const bodyText = isDark ? 'text-[var(--text-secondary)]' : 'text-[#4B5563]';

  const tinted = {
    blue: isDark ? 'bg-[rgba(37,99,235,0.18)] text-[var(--text-secondary)]' : 'bg-[#F3F7FF] text-[#374151]',
    purple: isDark ? 'bg-[rgba(168,85,247,0.18)] text-[var(--text-secondary)]' : 'bg-[#F5ECFF] text-[#374151]',
    amber: isDark ? 'bg-[rgba(245,158,11,0.18)] text-[var(--text-secondary)]' : 'bg-[#FFF6EB] text-[#374151]',
  };

  const tintedDot = {
    blue: isDark ? 'bg-[#60A5FA]' : 'bg-[#2563EB]',
    purple: isDark ? 'bg-[#C084FC]' : 'bg-[#A855F7]',
    amber: isDark ? 'bg-[#FBBF24]' : 'bg-[#F59E0B]',
  };

  const cardHeading = isDark ? 'text-[var(--text-primary)]' : 'text-[#0B1120]';
  const accentText = isDark ? 'text-[var(--accent)]' : 'text-[#1D4ED8]';
  const dashedCard = isDark
    ? 'rounded-3xl border border-dashed border-[var(--border-strong)] bg-[rgba(37,99,235,0.12)] p-7 text-sm text-[var(--text-secondary)] shadow-inner'
    : 'rounded-3xl border border-dashed border-[#CBD5F5]/80 bg-[#EEF2FF]/70 p-7 text-sm text-[#1E3A8A] shadow-inner';

  return (
    <div className={`relative min-h-screen ${pageBackground}`}>
      <div className={`pointer-events-none absolute inset-0 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-14 lg:gap-16 lg:px-10">
        <header className={`space-y-6 rounded-3xl p-10 shadow-2xl backdrop-blur-xl ${glassPanel}`}>
          <div className="space-y-4">
            <span className={badgeClass}>Automated Accounting</span>
            <h1 className={`text-3xl font-semibold leading-tight sm:text-4xl ${cardHeading}`}>
              Automate portfolio closes with confidence.
            </h1>
            <p className={`max-w-3xl text-sm sm:text-base ${bodyText}`}>
              We are packaging ingestion, mapping, and exception handling into a guided experience tailored for STORE
              operators. Early partners will influence data connectors, variance intelligence, and the reconciliation
              workflow.
            </p>
          </div>
          <Link
            href="/"
            className={`inline-flex items-center gap-2 rounded-full border px-5 py-2 text-sm font-semibold transition ${isDark ? 'border-[var(--border-soft)] bg-[var(--surface-muted)] text-[var(--accent)] hover:border-[var(--accent)]/70 hover:bg-[rgba(37,99,235,0.12)]' : 'border-[#CBD5F5] bg-white/90 text-[#1D4ED8] hover:border-[#2563EB] hover:bg-[#EEF2FF]'}`}
          >
            <span aria-hidden>{'<-'}</span>
            Back to main directory
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className={`rounded-3xl p-8 shadow-xl backdrop-blur-lg ${glassPanel}`}>
            <h2 className={`text-lg font-semibold ${cardHeading}`}>What we are building</h2>
            <ul className="mt-6 space-y-4 text-sm">
              <li className={`flex gap-3 rounded-2xl p-5 ${tinted.blue}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${tintedDot.blue}`} />
                <div>
                  <div className={`font-semibold ${cardHeading}`}>Vendor-native ingestion</div>
                  <p className={bodyText}>
                    Connectors for SiteLink, storEDGE, and bespoke exports with reconciliation ledgers baked in.
                  </p>
                </div>
              </li>
              <li className={`flex gap-3 rounded-2xl p-5 ${tinted.purple}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${tintedDot.purple}`} />
                <div>
                  <div className={`font-semibold ${cardHeading}`}>Automated mappings</div>
                  <p className={bodyText}>
                    Confidence-scored header mapping, clear overrides, and audit trails that work at portfolio scale.
                  </p>
                </div>
              </li>
              <li className={`flex gap-3 rounded-2xl p-5 ${tinted.amber}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${tintedDot.amber}`} />
                <div>
                  <div className={`font-semibold ${cardHeading}`}>Variance intelligence</div>
                  <p className={bodyText}>
                    Surface outliers instantly with narrative-ready context to accelerate close reviews.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-6">
            <div className={`rounded-3xl p-8 shadow-xl backdrop-blur-lg ${glassPanel}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-[0.2em] ${accentText}`}>Pilot milestones</h3>
              <dl className={`mt-4 space-y-3 text-sm ${bodyText}`}>
                <div className={`rounded-2xl p-4 ${tinted.blue}`}>
                  <dt className={`font-semibold ${accentText}`}>Wave 1</dt>
                  <dd>Income statement ingestion with mapping suggestions and exception logging.</dd>
                </div>
                <div className={`rounded-2xl p-4 ${tinted.purple}`}>
                  <dt className="font-semibold text-[#7C3AED] dark:text-[#C084FC]">Wave 2</dt>
                  <dd>Variance intelligence with narrative prompts and shareable review packets.</dd>
                </div>
                <div className={`rounded-2xl p-4 ${tinted.amber}`}>
                  <dt className="font-semibold text-[#B45309] dark:text-[#FBBF24]">Wave 3</dt>
                  <dd>Automated exports into STORE templates with audit-ready reconciliation.</dd>
                </div>
              </dl>
            </div>

            <div className={dashedCard}>
              <h3 className={`text-sm font-semibold uppercase tracking-wide ${accentText}`}>Get involved</h3>
              <p className={`mt-2 ${bodyText}`}>
                Insight Ops is enrolling beta partners now. Share your accounting package export and we will plug it into
                the automation build to accelerate delivery.
              </p>
              <Link
                href="mailto:insightops@store.com"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#2563EB] px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-[#1D4ED8]"
              >
                Request beta access
                <span aria-hidden>{'->'}</span>
              </Link>
            </div>
          </div>
        </section>
      </div>

      <div className="sr-only">
        <Image src="/file.svg" alt="" width={1} height={1} />
        <Image src="/window.svg" alt="" width={1} height={1} />
        <Image src="/globe.svg" alt="" width={1} height={1} />
      </div>
    </div>
  );
}
