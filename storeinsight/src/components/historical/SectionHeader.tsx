import type { JSX, ReactNode } from 'react';

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <div className="text-xl font-semibold text-[color:var(--text-primary)]">{title}</div>
        {subtitle ? <div className="text-sm text-[color:var(--text-secondary)]">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
