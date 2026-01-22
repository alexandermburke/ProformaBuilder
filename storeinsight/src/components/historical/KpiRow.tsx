import type { JSX } from 'react';
import { InfoTooltip } from './InfoTooltip';

export type KpiItem = {
  label: string;
  value: string;
  detail?: string;
  info?: string;
};

type KpiRowProps = {
  items: KpiItem[];
  columns?: 2 | 3 | 4;
};

export function KpiRow({ items, columns = 3 }: KpiRowProps): JSX.Element {
  const columnClass =
    columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3';

  return (
    <div className={`grid gap-3 ${columnClass}`}>
      {items.map((item) => (
        <div key={item.label} className="ios-list-card space-y-1 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">
            <span>{item.label}</span>
            {item.info ? <InfoTooltip label={item.info} /> : null}
          </div>
          <div className="text-lg font-semibold text-[color:var(--text-primary)]">{item.value}</div>
          {item.detail ? <div className="text-xs text-[color:var(--text-secondary)]">{item.detail}</div> : null}
        </div>
      ))}
    </div>
  );
}
