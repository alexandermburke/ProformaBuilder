'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { JSX } from 'react';
import type { HistoricalPropertyOption } from '@/lib/historical/dashboardTypes';

type InternalHistoricalRouteBarProps = {
  propertyOptions: HistoricalPropertyOption[];
  selectedPropertyId: string;
  title: string;
  description: string;
  statusLabel?: string;
  showUploadLink?: boolean;
};

export function InternalHistoricalRouteBar({
  propertyOptions,
  selectedPropertyId,
  title,
  description,
  statusLabel,
  showUploadLink,
}: InternalHistoricalRouteBarProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const resolvedPathname = pathname ?? '/historical-data';

  return (
    <div className="mx-auto mt-8 flex w-full max-w-[1200px] flex-col gap-4 px-6">
      <div className="ios-card ios-animate-up space-y-4 p-6" data-tone="amber">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ios-badge text-[10px]">Historical data</span>
              {statusLabel ? (
                <span className="ios-pill text-[10px]" data-tone="neutral">
                  {statusLabel}
                </span>
              ) : null}
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">{title}</h1>
              <p className="max-w-3xl text-sm text-[color:var(--text-secondary)]">{description}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {showUploadLink ? (
              <Link href="/historical-data-upload" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
                Upload data
              </Link>
            ) : null}
          </div>
        </div>

        <label className="flex w-full max-w-md items-center gap-3 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-2 shadow-inner">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
            Property
          </span>
          <select
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[color:var(--text-primary)] focus:outline-none"
            value={selectedPropertyId}
            onChange={(event) => {
              const params = new URLSearchParams(searchParams?.toString() ?? '');
              params.set('propertyId', event.target.value);
              const query = params.toString();
              router.replace(query ? `${resolvedPathname}?${query}` : resolvedPathname, { scroll: false });
            }}
          >
            {propertyOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
