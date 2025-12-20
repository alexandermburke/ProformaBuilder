"use client";

import { useState } from "react";

type PropertyOption = {
  id: string;
  label: string;
  code?: string;
  ownerEmails: string[];
};

type Props = {
  properties: PropertyOption[];
};

export default function PptxMailForm({ properties }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [asOfDate, setAsOfDate] = useState(today);
  const [emailBody, setEmailBody] = useState("");
  const [attachPptx, setAttachPptx] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedProperty = properties.find((p) => p.id === propertyId);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/pptx-mail", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus(json?.error || "Failed to send email.");
      } else {
        const sentCount = Array.isArray(json.results)
          ? json.results.filter((r: { emailed: boolean }) => r.emailed).length
          : 0;
        setStatus(`Sent ${sentCount} file(s) for ${selectedProperty?.label ?? propertyId}.`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-5 shadow-sm dark:border-slate-800 dark:bg-slate-800/50"
      encType="multipart/form-data"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          Property
          <select
            name="propertyId"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            required
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} {p.code ? `(${p.code})` : ""}
              </option>
            ))}
          </select>
          {selectedProperty?.ownerEmails?.length ? (
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              Sending to: {selectedProperty.ownerEmails.join(", ")}
            </span>
          ) : (
            <span className="text-xs font-normal text-amber-600">No owner emails configured for this property.</span>
          )}
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          As-of date
          <input
            type="date"
            name="asOfDate"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            required
            className="rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Date shown in the email and subject.</span>
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          PPTX files
          <input
            type="file"
            name="pptx"
            accept=".pptx"
            multiple
            required
            className="rounded-lg border border-dashed border-slate-300/80 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition file:mr-4 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:border-indigo-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:file:bg-slate-700 dark:file:text-slate-100"
          />
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            We’ll convert each PPTX to PDF and email it. No PNG preview for owner decks.
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
        Email body (optional)
        <textarea
          name="emailBody"
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
          rows={4}
          className="rounded-lg border border-slate-300/80 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          placeholder="Include any monthly-owner context or instructions for this send."
        />
      </label>

      <div className="flex items-center gap-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-800 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-100 dark:ring-slate-700">
        <input
          type="checkbox"
          name="attachPptx"
          checked={attachPptx}
          onChange={(e) => setAttachPptx(e.target.checked)}
          className="h-4 w-4 rounded border-slate-400 text-indigo-600 focus:ring-indigo-500"
        />
        <span>Attach original PPTX file(s) to the email</span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? "Sending..." : "Convert & Send"}
        </button>
        {status && <div className="text-sm text-slate-700 dark:text-slate-200">{status}</div>}
      </div>
    </form>
  );
}
