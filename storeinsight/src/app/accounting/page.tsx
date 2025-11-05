'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { JSX } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export default function AutomatedAccountingPage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const overlayTop = isDark
    ? 'bg-[radial-gradient(circle_at_12%_10%,rgba(59,130,246,0.3),transparent_58%)]'
    : 'bg-[radial-gradient(circle_at_18%_12%,rgba(37,99,235,0.22),transparent_60%)]';
  const overlayBottom = isDark
    ? 'bg-[radial-gradient(circle_at_88%_82%,rgba(56,189,248,0.22),transparent_60%)]'
    : 'bg-[radial-gradient(circle_at_82%_86%,rgba(56,189,248,0.16),transparent_62%)]';
  const toneDot: Record<'blue' | 'purple' | 'amber', string> = {
    blue: 'bg-[rgba(37,99,235,0.75)]',
    purple: 'bg-[rgba(168,85,247,0.65)]',
    amber: 'bg-[rgba(245,158,11,0.75)]',
  };
  const tileTone = isDark
    ? {
        blue: 'border-[rgba(59,130,246,0.4)] bg-[rgba(37,99,235,0.18)] text-[color:var(--text-secondary)]',
        purple: 'border-[rgba(168,85,247,0.36)] bg-[rgba(129,140,248,0.2)] text-[color:var(--text-secondary)]',
        amber: 'border-[rgba(245,158,11,0.32)] bg-[rgba(253,186,116,0.18)] text-[color:var(--text-secondary)]',
      }
    : {
        blue: 'border-[rgba(37,99,235,0.24)] bg-[rgba(37,99,235,0.08)] text-[color:var(--text-secondary)]',
        purple: 'border-[rgba(168,85,247,0.22)] bg-[rgba(168,85,247,0.08)] text-[color:var(--text-secondary)]',
        amber: 'border-[rgba(245,158,11,0.22)] bg-[rgba(245,158,11,0.08)] text-[color:var(--text-secondary)]',
      };

  return (
    <div className="relative min-h-screen overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-14 lg:gap-16 lg:px-10">
        <header className="ios-card ios-animate-up space-y-6 p-10" data-tone="blue">
          <span className="ios-badge text-[10px]">Automated accounting</span>
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold leading-tight text-[color:var(--text-primary)] sm:text-4xl">
              Automate portfolio closes with confidence.
            </h1>
            <p className="max-w-3xl text-sm text-[color:var(--text-secondary)] sm:text-base">
              We are packaging ingestion, mapping, and exception handling into a guided experience tailored for STORE
              operators. Early partners will influence data connectors, variance intelligence, and the reconciliation
              workflow.
            </p>
          </div>
          <Link href="/" className="ios-button w-fit px-5 py-2 text-sm" data-variant="ghost">
            <span aria-hidden>{'<-'}</span>
            Back to main directory
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="ios-card ios-animate-up space-y-6 p-8">
            <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">What we are building</h2>
            <ul className="space-y-4 text-sm">
              <li className={`flex gap-3 rounded-2xl border p-5 shadow-inner transition ${tileTone.blue}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${toneDot.blue}`} />
                <div className="space-y-1">
                  <div className="font-semibold text-[color:var(--text-primary)]">Vendor-native ingestion</div>
                  <p className="text-[color:var(--text-secondary)]">
                    Connectors for SiteLink, storEDGE, and bespoke exports with reconciliation ledgers baked in.
                  </p>
                </div>
              </li>
              <li className={`flex gap-3 rounded-2xl border p-5 shadow-inner transition ${tileTone.purple}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${toneDot.purple}`} />
                <div className="space-y-1">
                  <div className="font-semibold text-[color:var(--text-primary)]">Automated mappings</div>
                  <p className="text-[color:var(--text-secondary)]">
                    Confidence-scored header mapping, clear overrides, and audit trails that work at portfolio scale.
                  </p>
                </div>
              </li>
              <li className={`flex gap-3 rounded-2xl border p-5 shadow-inner transition ${tileTone.amber}`}>
                <span className={`mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full ${toneDot.amber}`} />
                <div className="space-y-1">
                  <div className="font-semibold text-[color:var(--text-primary)]">Variance intelligence</div>
                  <p className="text-[color:var(--text-secondary)]">
                    Surface outliers instantly with narrative-ready context to accelerate close reviews.
                  </p>
                </div>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-6">
            <div className="ios-card ios-animate-up space-y-4 p-8">
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-strong)]">
                Pilot milestones
              </h3>
              <dl className="space-y-3 text-sm text-[color:var(--text-secondary)]">
                <div className={`rounded-2xl border p-4 ${tileTone.blue}`}>
                  <dt className="font-semibold text-[color:var(--accent-strong)]">Wave 1</dt>
                  <dd>Income statement ingestion with mapping suggestions and exception logging.</dd>
                </div>
                <div className={`rounded-2xl border p-4 ${tileTone.purple}`}>
                  <dt className="font-semibold text-[#7C3AED] dark:text-[#C084FC]">Wave 2</dt>
                  <dd>Variance intelligence with narrative prompts and shareable review packets.</dd>
                </div>
                <div className={`rounded-2xl border p-4 ${tileTone.amber}`}>
                  <dt className="font-semibold text-[#B45309] dark:text-[#FBBF24]">Wave 3</dt>
                  <dd>Automated exports into STORE templates with audit-ready reconciliation.</dd>
                </div>
              </dl>
            </div>

            <div className="ios-card ios-animate-up space-y-3 border border-dashed border-[rgba(37,99,235,0.28)] bg-[rgba(37,99,235,0.08)] p-7 text-sm text-[color:var(--text-secondary)] shadow-inner">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--accent-strong)]">
                Get involved
              </h3>
              <p>
                Insight Ops is enrolling beta partners now. Share your accounting package export and we will plug it into
                the automation build to accelerate delivery.
              </p>
              <Link
                href="mailto:alex@mystorestorage.com"
                className="ios-button w-fit px-5 py-2 text-sm"
              >
                Request access
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
