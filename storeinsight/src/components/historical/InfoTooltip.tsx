import type { JSX } from 'react';

type InfoTooltipProps = {
  label: string;
};

export function InfoTooltip({ label }: InfoTooltipProps): JSX.Element {
  return (
    <span
      className="group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)] text-[10px] font-semibold text-[color:var(--text-muted)] shadow-inner transition-colors hover:text-[color:var(--text-primary)] focus-visible:text-[color:var(--text-primary)]"
      title={label}
      aria-label={label}
      tabIndex={0}
    >
      i
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-56 -translate-x-1/2 rounded-[10px] border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-2.5 py-2 text-[11px] font-normal leading-snug text-[color:var(--text-secondary)] opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </span>
  );
}
