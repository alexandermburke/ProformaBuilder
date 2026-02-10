import type { JSX, ReactNode } from 'react';
import { InfoTooltip } from './InfoTooltip';

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  info?: string;
};

export function SectionHeader({ title, subtitle, actions, info }: SectionHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="text-xl font-semibold text-[color:var(--text-primary)]">{title}</div>
          {info ? <InfoTooltip label={info} /> : null}
        </div>
        {subtitle ? <div className="text-sm text-[color:var(--text-secondary)]">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
