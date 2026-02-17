import type { JSX } from 'react';

type InfoTooltipProps = {
  label: string;
};

export function InfoTooltip({ label }: InfoTooltipProps): JSX.Element {
  return (
    <span
      className="info-tooltip group relative inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)] text-[10px] font-semibold text-[color:var(--text-muted)] shadow-inner transition-colors hover:text-[color:var(--text-primary)] focus-visible:text-[color:var(--text-primary)]"
      aria-label={label}
      tabIndex={0}
    >
      i
    </span>
  );
}
