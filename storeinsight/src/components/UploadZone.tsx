'use client';

import React from 'react';
import type { JSX } from 'react';

export type UploadZoneProps = {
  onFile(file: File): void;
};

export default function UploadZone({ onFile }: UploadZoneProps): JSX.Element {
  const onChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    if (f) {
      console.log('[upload] file selected', { name: f.name, size: f.size });
      onFile(f);
    }
  };

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-5">
      <div className="text-sm text-[#4B5563] mb-3">Upload Excel Data</div>
      <input
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onChange}
        className="block w-full text-sm text-[#111827]"
      />
      <div className="mt-2 text-xs text-[#6B7280]">
        Your file is parsed in the browser for this demo.
      </div>
    </div>
  );
}