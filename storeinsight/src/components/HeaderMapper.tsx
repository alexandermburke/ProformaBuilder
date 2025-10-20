'use client';

import React from 'react';
import type { JSX } from 'react';
import { HeaderMapping } from '@/lib/types';

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

  const setField = (req: string, hdr: string): void => {
    const next = { ...value, [req]: hdr };
    console.log('[mapper] set', { req, hdr });
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Map required fields</div>
        {onApplyAll && (
          <button
            className="text-xs rounded-md border border-[#D1D5DB] px-2 py-1 hover:bg-[#F3F4F6]"
            onClick={onApplyAll}
          >
            Apply all suggestions
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {requiredFields.map((req) => {
          const hint = hints?.[req] ?? null;
          return (
            <label key={req} className="text-sm">
              <span className="block mb-1 text-[#4B5563]">
                {req}
                {hint && (
                  <span className="ml-2 text-xs text-[#6B7280]">
                    Suggest: <span className="font-mono">{hint.header}</span> ({hint.score.toFixed(2)})
                  </span>
                )}
              </span>
              <select
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-sm"
                value={value[req] ?? ''}
                onChange={(e) => setField(req, e.target.value)}
              >
                <option value="">— Select column —</option>
                {detectedHeaders.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}