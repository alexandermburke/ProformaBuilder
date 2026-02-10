import type { JSX, ReactNode } from 'react';
import { InfoTooltip } from './InfoTooltip';

type ChartCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  info?: string;
  actions?: ReactNode;
  children?: ReactNode;
  emptyMessage?: ReactNode;
  className?: string;
};

export function ChartCard({
  title,
  subtitle,
  info,
  actions,
  children,
  emptyMessage,
  className,
}: ChartCardProps): JSX.Element {
  return (
    <section className={['ios-card ios-animate-up space-y-4 p-6', className].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-[color:var(--text-primary)]">
            <span>{title}</span>
            {info ? <InfoTooltip label={info} /> : null}
          </div>
          {subtitle ? (
            <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">{subtitle}</div>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {emptyMessage ? (
        <div className="ios-list-card border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-[color:var(--text-secondary)] shadow-inner">
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
