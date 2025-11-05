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
      className={`ios-card ios-animate-up group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden p-8 text-center transition-all duration-500 ${
        isDragging ? 'ring-4 ring-[var(--accent)]/40' : ''
      }`}
      onDragEnter={toggleDrag(true)}
      onDragOver={toggleDrag(true)}
      onDragLeave={toggleDrag(false)}
      onDrop={onDrop}
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.18)_0%,transparent_65%)] opacity-75 transition-opacity duration-500 group-hover:opacity-95" />
      <div className="pointer-events-none absolute -top-20 right-0 -z-10 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(14,165,233,0.25),transparent_65%)] blur-3xl opacity-60 group-hover:opacity-75" />

      <div className="flex h-16 w-16 items-center justify-center rounded-[26px] border border-white/60 bg-white/70 text-[color:var(--accent-strong)] shadow-[0_16px_36px_rgba(15,23,42,0.12)] backdrop-blur-md transition-transform duration-500 group-hover:scale-110 group-hover:shadow-[0_22px_44px_rgba(37,99,235,0.22)]">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-8 w-8 text-[var(--accent-strong)] transition-transform duration-500 group-hover:rotate-3"
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

      <div className="mt-5 space-y-2 text-balance">
        <p className="text-lg font-semibold text-[color:var(--text-primary)]">
          Drop your Excel file here
        </p>
        <p className="text-sm text-[color:var(--text-secondary)]">
          .xls or .xlsx &mdash; streamlined parsing happens securely in your browser.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="ios-pill text-[11px] uppercase tracking-[0.24em]">
          Secure &amp; private
        </span>
        <button
          type="button"
          className="ios-button px-6 py-2 text-xs uppercase tracking-[0.18em]"
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
