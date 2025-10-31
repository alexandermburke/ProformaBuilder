'use client';

import React from 'react';
import type { JSX } from 'react';

export type UploadZoneProps = {
  onFile(file: File): void;
};

export default function UploadZone({ onFile }: UploadZoneProps): JSX.Element {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handleFile = React.useCallback(
    (file: File | null | undefined): void => {
      if (!file) return;
      console.log('[upload] file selected', { name: file.name, size: file.size });
      onFile(file);
    },
    [onFile],
  );

  const onChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      handleFile(file);
    },
    [handleFile],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent<HTMLLabelElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      handleFile(file);
    },
    [handleFile],
  );

  const toggleDrag = (active: boolean) => (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(active);
  };

  return (
    <label
      htmlFor="upload-zone-input"
      className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-white/30 bg-gradient-to-br from-[#F8FAFF] via-white to-[#EEF2FF] p-6 text-center shadow-lg transition-all hover:-translate-y-0.5 hover:border-[#93C5FD] hover:shadow-xl ${
        isDragging ? 'ring-2 ring-[#2563EB]/40' : ''
      }`}
      onDragEnter={toggleDrag(true)}
      onDragOver={toggleDrag(true)}
      onDragLeave={toggleDrag(false)}
      onDrop={onDrop}
    >
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,#DBEAFE_0%,transparent_60%)] opacity-80 transition-opacity group-hover:opacity-100" />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-7 w-7 text-[#2563EB] transition-transform group-hover:scale-105"
        >
          <path
            fill="currentColor"
            d="M12 3a1 1 0 0 1 .993.883L13 4v7h4a1 1 0 0 1 .117 1.993L17 13h-4v4a1 1 0 0 1-1.993.117L11 17v-4H7a1 1 0 0 1-.117-1.993L7 11h4V4a1 1 0 0 1 1-1Z"
          />
          <path
            fill="currentColor"
            d="M5 20a2 2 0 0 1-1.995-1.85L3 18V9a2 2 0 0 1 1.85-1.995L5 7h3a1 1 0 0 1 .117 1.993L8 9H5v9h14V9h-3a1 1 0 0 1-.117-1.993L16 7h3a2 2 0 0 1 1.995 1.85L21 9v9a2 2 0 0 1-1.85 1.995L19 20H5Z"
          />
        </svg>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-base font-semibold text-[#0B1120]">
          Drop your Excel file here
        </p>
        <p className="text-sm text-[#4B5563]">
          .xls or .xlsx - streamlined parsing happens right in your browser.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="rounded-full border border-[#DBEAFE] bg-[#EEF2FF] px-4 py-1 text-xs font-semibold text-[#2563EB]">
          Secure &amp; private
        </span>
        <button
          type="button"
          className="rounded-full bg-[#2563EB] px-5 py-2 text-xs font-semibold uppercase tracking-wider text-white shadow-sm transition hover:bg-[#1D4ED8]"
          onClick={() => inputRef.current?.click()}
        >
          Browse files
        </button>
      </div>

      <input
        id="upload-zone-input"
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onChange}
        className="sr-only"
      />
    </label>
  );
}
