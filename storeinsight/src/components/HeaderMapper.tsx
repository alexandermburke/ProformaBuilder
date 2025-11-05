'use client';

import React from 'react';
import type { JSX } from 'react';
import type { HeaderMapping } from '@/lib/types';

export type HeaderMapperProps = {
  requiredFields: string[];
  detectedHeaders: string[];
  value: HeaderMapping;
  onChange(next: HeaderMapping): void;
  hints?: Record<string, { header: string; score: number } | null>;
  onApplyAll?: () => void;
};

export default function HeaderMapper(props: HeaderMapperProps): JSX.Element {
  const { requiredFields, detectedHeaders, value, onChange, hints, onApplyAll } = props;

  const setField = React.useCallback(
    (req: string, hdr: string): void => {
      const next = { ...value, [req]: hdr };
      console.log('[mapper] set', { req, hdr });
      onChange(next);
    },
    [onChange, value],
  );

  const detectedCount = detectedHeaders.length;
  const hasSuggestions = React.useMemo(
    () => requiredFields.some((field) => Boolean(hints?.[field]?.header)),
    [hints, requiredFields],
  );

  return (
    <div className="ios-card ios-animate-up space-y-6 p-6 md:p-7">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <span className="ios-badge text-[10px]">Header mapping</span>
          <h2 className="text-lg font-semibold text-[color:var(--text-primary)] md:text-xl">
            Align required STORE fields with your uploaded columns.
          </h2>
          <p className="text-sm leading-relaxed text-[color:var(--text-secondary)]">
            We detected {detectedCount} column{detectedCount === 1 ? '' : 's'}. Map anything missing to unlock automation.
          </p>
        </div>
        {onApplyAll && hasSuggestions && (
          <button
            type="button"
            onClick={onApplyAll}
            className="ios-button px-6 py-2 text-xs uppercase tracking-[0.2em]"
            data-variant="secondary"
          >
            Apply suggestions
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {requiredFields.map((field, index) => {
          const hint = hints?.[field] ?? null;
          const hintScore = hint ? `${Math.round(hint.score * 100)}%` : null;

          return (
            <label
              key={field}
              className={`group ios-list-card flex flex-col gap-3 p-4 transition-all duration-500 hover:-translate-y-1 md:p-5 ${
                index > 1 ? 'ios-animate-up ios-animate-delay-sm' : 'ios-animate-up'
              }`}
            >
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-[color:var(--text-primary)]">
                {field}
                {hint && (
                  <span className="ios-pill text-[11px]" data-tone="neutral">
                    {hintScore}
                    <span aria-hidden className="font-semibold text-[color:var(--accent-strong)]">|</span>
                    {hint.header}
                  </span>
                )}
              </span>
              <select
                className="w-full rounded-[18px] border border-[color:var(--border-soft)] bg-white/90 px-3 py-2.5 text-sm text-[color:var(--text-primary)] shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-4 focus:ring-[color:var(--focus-ring)]"
                value={value[field] ?? ''}
                onChange={(event) => setField(field, event.target.value)}
              >
                <option value="">- Select column -</option>
                {detectedHeaders.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              {!value[field] && (
                <span className="text-xs text-[color:var(--text-muted)]">
                  Required mapping missing - choose a source column.
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
