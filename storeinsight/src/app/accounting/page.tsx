'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { JSX } from 'react';

export default function AutomatedAccountingPage(): JSX.Element {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFF] to-[#E0F2FE] text-[#0B1120]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.15),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.12),transparent_60%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-12 px-6 py-14 lg:gap-16 lg:px-10">
        <header className="space-y-6 rounded-3xl border border-white/30 bg-white/85 p-10 shadow-2xl backdrop-blur-xl">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#2563EB]/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-[#1D4ED8]">
              Automated Accounting
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-[#0B1120] sm:text-4xl">
              Automate portfolio closes with confidence.
            </h1>
            <p className="max-w-3xl text-sm text-[#4B5563] sm:text-base">
              We are packaging ingestion, mapping, and exception handling into a guided experience tailored for STORE operators.
              Early partners will influence data connectors, variance intelligence, and the reconciliation workflow.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-[#CBD5F5] bg-white/90 px-5 py-2 text-sm font-semibold text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[#EEF2FF]"
          >
            <span aria-hidden>{'<-'}</span>
            Back to main directory
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-3xl border border-white/30 bg-white/85 p-8 shadow-xl backdrop-blur-lg">
            <h2 className="text-lg font-semibold text-[#0B1120]">What we are building</h2>
            <ul className="mt-6 space-y-4 text-sm text-[#374151]">
              <li className="flex gap-3 rounded-2xl bg-[#F3F7FF] p-5">
                <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#2563EB]" />
                <div>
                  <div className="font-semibold text-[#0B1120]">Vendor-native ingestion</div>
                  <p>Connectors for SiteLink, storEDGE, and bespoke exports with reconciliation ledgers baked in.</p>
                </div>
              </li>
              <li className="flex gap-3 rounded-2xl bg-[#F5ECFF] p-5">
                <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#A855F7]" />
                <div>
                  <div className="font-semibold text-[#0B1120]">Automated mappings</div>
                  <p>Confidence-scored header mapping, clear overrides, and audit trails that work at portfolio scale.</p>
                </div>
              </li>
              <li className="flex gap-3 rounded-2xl bg-[#FFF6EB] p-5">
                <span className="mt-1 inline-flex h-2.5 w-2.5 flex-none rounded-full bg-[#F59E0B]" />
                <div>
                  <div className="font-semibold text-[#0B1120]">Variance intelligence</div>
                  <p>Surface outliers instantly with narrative-ready context to accelerate close reviews.</p>
                </div>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-6">
            <div className="rounded-3xl border border-white/30 bg-white/85 p-8 shadow-xl backdrop-blur-lg">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#2563EB]">Pilot milestones</h3>
              <dl className="mt-4 space-y-3 text-sm text-[#4B5563]">
                <div className="rounded-2xl bg-[#F3F7FF] p-4">
                  <dt className="font-semibold text-[#1D4ED8]">Wave 1</dt>
                  <dd>Income statement ingestion with mapping suggestions and exception logging.</dd>
                </div>
                <div className="rounded-2xl bg-[#F5ECFF] p-4">
                  <dt className="font-semibold text-[#7C3AED]">Wave 2</dt>
                  <dd>Variance intelligence with narrative prompts and shareable review packets.</dd>
                </div>
                <div className="rounded-2xl bg-[#FFF6EB] p-4">
                  <dt className="font-semibold text-[#B45309]">Wave 3</dt>
                  <dd>Automated exports into STORE templates with audit-ready reconciliation.</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-3xl border border-dashed border-[#CBD5F5]/80 bg-[#EEF2FF]/70 p-7 text-sm text-[#1E3A8A] shadow-inner">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#1D4ED8]">Get involved</h3>
              <p className="mt-2">
                Insight Ops is enrolling beta partners now. Share your accounting package export and we will plug it into the automation build to accelerate delivery.
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
