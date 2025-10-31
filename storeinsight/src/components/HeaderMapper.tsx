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
    <div className="space-y-5 rounded-2xl border border-white/30 bg-white/85 p-6 shadow-lg backdrop-blur-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2563EB]">
            Header mapping
          </p>
          <h2 className="text-lg font-semibold text-[#0B1120]">
            Align required STORE fields with your uploaded columns.
          </h2>
          <p className="text-sm text-[#4B5563]">
            We detected {detectedCount} column{detectedCount === 1 ? '' : 's'}. Map anything missing to unlock automation.
          </p>
        </div>
        {onApplyAll && hasSuggestions && (
          <button
            type="button"
            onClick={onApplyAll}
            className="inline-flex items-center gap-2 rounded-full border border-[#2563EB]/20 bg-[#2563EB]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#1D4ED8] transition hover:border-[#2563EB]/40 hover:bg-[#2563EB]/15"
          >
            Apply suggestions
            <span aria-hidden className="text-[#2563EB]">{'->'}</span>
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {requiredFields.map((field) => {
          const hint = hints?.[field] ?? null;
          const hintScore = hint ? `${Math.round(hint.score * 100)}%` : null;

          return (
            <label
              key={field}
              className="group flex flex-col gap-2 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB]/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#93C5FD] hover:shadow-md"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#0B1120]">
                {field}
                {hint && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#E0F2FE] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#0369A1]">
                    {hintScore}
                    <span aria-hidden className="text-[#0284C7]">*</span>
                    {hint.header}
                  </span>
                )}
              </span>
              <select
                className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] transition focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/30"
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
                <span className="text-xs text-[#6B7280]">
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
