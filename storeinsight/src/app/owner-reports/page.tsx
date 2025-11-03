"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OwnerFields } from "@/types/ownerReport";

type Step = 1 | 2 | 3 | 4 | 5;

const FIELD_ORDER = [
  "CURRENTDATE",
  "ADDRESS",
  "OWNERGROUP",
  "ACQUIREDDATE",
  "TOTALUNITS",
  "RENTABLESQFT",
  "CURRENTMONTH",
  "TOTALRENTALINCOME",
  "TOTALINCOME",
  "TOTALEXPENSES",
  "NETINCOME",
  "OCCUPIEDAREASQFT",
  "OCCUPANCYBYUNITS",
  "OCCUPIEDAREAPERCENT",
  "MOVEINS_TODAY",
  "MOVEINS_MTD",
  "MOVEINS_YTD",
  "MOVEOUTS_TODAY",
  "MOVEOUTS_MTD",
  "MOVEOUTS_YTD",
  "NET_TODAY",
  "NET_MTD",
  "NET_YTD",
  "MOVEINS_SQFT_MTD",
  "MOVEOUTS_SQFT_MTD",
  "NET_SQFT_MTD",
] as const satisfies readonly (keyof OwnerFields)[];

type FieldKey = (typeof FIELD_ORDER)[number];
type OwnerFieldOverrides = Partial<Record<FieldKey, OwnerFields[FieldKey]>>;

const FIELD_TITLES: Record<FieldKey, string> = {
  CURRENTDATE: "Current Date",
  ADDRESS: "Property Address",
  OWNERGROUP: "Owner Group",
  ACQUIREDDATE: "Acquired Date",
  TOTALUNITS: "Total Units",
  RENTABLESQFT: "Rentable SqFt",
  CURRENTMONTH: "Current Month",
  TOTALRENTALINCOME: "Total Rental Income",
  TOTALINCOME: "Total Income",
  TOTALEXPENSES: "Total Expenses",
  NETINCOME: "Net Income",
  OCCUPIEDAREASQFT: "Occupied Area SqFt",
  OCCUPANCYBYUNITS: "Occupancy by Units",
  OCCUPIEDAREAPERCENT: "Occupied Area Percent",
  MOVEINS_TODAY: "Move-Ins Today",
  MOVEINS_MTD: "Move-Ins MTD",
  MOVEINS_YTD: "Move-Ins YTD",
  MOVEOUTS_TODAY: "Move-Outs Today",
  MOVEOUTS_MTD: "Move-Outs MTD",
  MOVEOUTS_YTD: "Move-Outs YTD",
  NET_TODAY: "Net Today",
  NET_MTD: "Net MTD",
  NET_YTD: "Net YTD",
  MOVEINS_SQFT_MTD: "Move-Ins SqFt MTD",
  MOVEOUTS_SQFT_MTD: "Move-Outs SqFt MTD",
  NET_SQFT_MTD: "Net SqFt MTD",
};

const NUMERIC_FIELDS = new Set<FieldKey>([
  "TOTALUNITS",
  "RENTABLESQFT",
  "TOTALRENTALINCOME",
  "TOTALINCOME",
  "TOTALEXPENSES",
  "NETINCOME",
  "OCCUPIEDAREASQFT",
  "OCCUPANCYBYUNITS",
  "OCCUPIEDAREAPERCENT",
  "MOVEINS_TODAY",
  "MOVEINS_MTD",
  "MOVEINS_YTD",
  "MOVEOUTS_TODAY",
  "MOVEOUTS_MTD",
  "MOVEOUTS_YTD",
  "NET_TODAY",
  "NET_MTD",
  "NET_YTD",
  "MOVEINS_SQFT_MTD",
  "MOVEOUTS_SQFT_MTD",
  "NET_SQFT_MTD",
]);
const REQUIRED_NUMERIC_FIELDS = new Set<FieldKey>(["TOTALUNITS", "RENTABLESQFT"]);

const STEP_LABELS: Record<Step, string> = {
  1: "Upload",
  2: "Map",
  3: "Validate",
  4: "Generate",
  5: "Export",
};

function downloadFromUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function OwnerReportsPage() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<OwnerFields | null>(null);
  const [overrides, setOverrides] = useState<OwnerFieldOverrides>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDownload, setLastDownload] = useState<{
    url: string;
    name: string;
    data: OwnerFields;
  } | null>(null);

  function formatNumericValue(key: FieldKey, raw: number | undefined | null): string {
    const value = Number(raw ?? 0);
    if (!Number.isFinite(value)) return "0";
    if (key === "OCCUPIEDAREAPERCENT") {
      const percent = Math.abs(value) <= 1 ? value * 100 : value;
      return `${percent.toFixed(1)}%`;
    }
    return value.toLocaleString();
  }

  const mergedFields = useMemo<OwnerFields | null>(() => {
    if (!fields) return null;
    const next: OwnerFields = { ...fields };
    const writableNext = next as Record<FieldKey, OwnerFields[FieldKey]>;
    for (const key of FIELD_ORDER) {
      const overrideValue = overrides[key];
      if (overrideValue === undefined) continue;
      if (NUMERIC_FIELDS.has(key)) {
        const cleaned = Number(String(overrideValue ?? "").replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(cleaned)) {
          writableNext[key] = cleaned as OwnerFields[FieldKey];
        }
        continue;
      }
      writableNext[key] = String(overrideValue ?? "") as OwnerFields[FieldKey];
    }
    return next;
  }, [fields, overrides]);

  const missingFields = useMemo(() => {
    const missing = new Set<FieldKey>();
    if (!mergedFields) return missing;
    for (const key of FIELD_ORDER) {
      const value = mergedFields[key];
      if (NUMERIC_FIELDS.has(key)) {
        if (REQUIRED_NUMERIC_FIELDS.has(key)) {
          const numeric = Number(value ?? 0);
          if (!Number.isFinite(numeric) || numeric <= 0) missing.add(key);
        }
      } else if (!String(value ?? "").trim()) {
        missing.add(key);
      }
    }
    return missing;
  }, [mergedFields]);

  async function onUpload(f: File) {
    setFile(f);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/owner-reports/preview", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Upload failed.");
      }
      const json = await res.json();
      setFields(json.fields as OwnerFields);
      setOverrides({});
      setStep(2);
      if (lastDownload) {
        URL.revokeObjectURL(lastDownload.url);
        setLastDownload(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to parse the workbook.";
      setError(message);
      setFields(null);
      setOverrides({});
      setStep(1);
    } finally {
      setBusy(false);
    }
  }

  function fieldValue(key: FieldKey): string | number {
    if (overrides[key] !== undefined) {
      return overrides[key] as OwnerFields[FieldKey];
    }
    if (!fields) return "";
    return fields[key];
  }

  function onOverride(key: FieldKey, raw: string) {
    setOverrides((prev) => {
      const next: OwnerFieldOverrides = { ...prev };
      if (!raw.trim()) {
        delete next[key];
        return next;
      }
      if (NUMERIC_FIELDS.has(key)) {
        const cleaned = Number(raw.replace(/[^0-9.\-]/g, ""));
        if (Number.isFinite(cleaned)) {
          next[key] = cleaned as OwnerFields[FieldKey];
        }
        return next;
      }
      next[key] = raw as OwnerFields[FieldKey];
      return next;
    });
  }

  function isValid(): boolean {
    if (!mergedFields) return false;
    return mergedFields.TOTALUNITS > 0 && mergedFields.RENTABLESQFT > 0;
  }

  async function generate() {
    if (!file || !mergedFields) return;
    setBusy(true);
    setError(null);
    setStep(4);
    try {
      const form = new FormData();
      form.append("file", file);
      const overridesPayload: OwnerFieldOverrides = {};
      for (const key of FIELD_ORDER) {
        if (overrides[key] !== undefined) {
          overridesPayload[key] = overrides[key] as OwnerFields[FieldKey];
        }
      }
      if (Object.keys(overridesPayload).length > 0) {
        form.append("overrides", JSON.stringify(overridesPayload));
      }
      const res = await fetch("/api/owner-reports/generate", { method: "POST", body: form });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Generation failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename = `Owner-Report-${mergedFields.CURRENTDATE || "report"}.pptx`;
      setLastDownload((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, name: filename, data: mergedFields };
      });
      downloadFromUrl(url, filename);
      setStep(5);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to generate the presentation.";
      setError(message);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  function downloadAgain() {
    if (!lastDownload) return;
    downloadFromUrl(lastDownload.url, lastDownload.name);
  }

  function startAnother() {
    if (lastDownload) {
      URL.revokeObjectURL(lastDownload.url);
    }
    setLastDownload(null);
    setFile(null);
    setFields(null);
    setOverrides({});
    setError(null);
    setBusy(false);
    setStep(1);
  }

  return (
    <div className="relative min-h-screen w-full bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFF] to-[#E0F2FE] text-[#0B1120]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.14),transparent_60%)]" />
      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-white/25 bg-white/85 p-6 shadow-lg backdrop-blur-md">
            <div className="space-y-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.35em] text-[#2563EB]">Store</div>
                <div className="text-[22px] font-semibold tracking-tight text-[#0B1120]">Insight Workbench</div>
              </div>
              <div className="rounded-xl bg-[#EEF2FF] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#1E3A8A]">
                Owner Reports
              </div>
              <div className="space-y-3 text-sm text-[#4B5563]">
                <p>Upload an Excel workbook, adjust any detected values, and export a templated PPTX in minutes.</p>
                <p className="text-[#1E3A8A]">No data is stored; everything stays in memory during generation.</p>
              </div>
              <div className="rounded-xl border border-dashed border-[#CBD5F5] bg-[#F8FAFF] p-4 text-xs text-[#1F2937]">
                <div className="font-semibold text-[#1E3A8A]">Need help?</div>
                <p className="mt-1 leading-relaxed">
                  Make sure the first worksheet contains the address, owner group, and key totals. Tokens in the
                  PPTX should use double braces like {"{{ADDRESS}}"} for best results.
                </p>
              </div>
            </div>
          </aside>

          <main className="rounded-2xl border border-white/25 bg-white/90 p-8 shadow-xl backdrop-blur">
            <div className="flex flex-col gap-6">
              <header>
                <h1 className="text-2xl font-semibold text-[#0B1120]">Create Owner Report</h1>
                <p className="mt-1 text-sm text-[#4B5563]">
                  Follow the guided flow to review extracted fields and merge them into the PowerPoint template.
                </p>
              </header>

              <ol className="flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-[#6B7280]">
                {(Object.keys(STEP_LABELS) as unknown as Step[]).map((keyStep) => (
                  <li
                    key={keyStep}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
                      keyStep === step
                        ? "border-[#2563EB] bg-[#2563EB]/10 text-[#1E40AF]"
                        : keyStep < step
                        ? "border-[#34D399] bg-[#D1FAE5]/60 text-[#047857]"
                        : "border-[#E5E7EB] bg-white text-[#9CA3AF]"
                    }`}
                  >
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#2563EB]">
                      {String(keyStep).padStart(2, "0")}
                    </span>
                    {STEP_LABELS[keyStep]}
                  </li>
                ))}
              </ol>

              {error && (
                <div className="rounded-lg border border-[#FEE2E2] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]">
                  {error}
                </div>
              )}

              {step === 1 && (
                <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1F2937]">Step 1 · Upload</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    Drop your <span className="font-bold">Executive Summary Report</span> (.xlsx) below. Only the first sheet is parsed for now.
                  </p>
                  <div className="mt-5">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="text-sm text-[#1F2937]"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0];
                        if (nextFile) onUpload(nextFile);
                      }}
                    />
                  </div>
                  {busy && <p className="mt-3 text-sm text-[#6B7280]">Parsing workbook…</p>}
                  {file && !busy && (
                    <p className="mt-3 text-sm text-[#4B5563]">
                      Last uploaded: <span className="font-medium text-[#1F2937]">{file.name}</span>
                    </p>
                  )}
                </section>
              )}

              {step === 2 && mergedFields && (
                <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1F2937]">Step 2 · Map</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    Review the detected values and override anything that needs to be adjusted before export.
                  </p>
                  <div className="mt-6 divide-y divide-[#F3F4F6]">
                    {FIELD_ORDER.map((key) => {
                      const rawValue = fieldValue(key);
                      const isNumeric = NUMERIC_FIELDS.has(key);
                      const numericValue = Number(rawValue ?? 0);
                      const displayValue = isNumeric
                        ? REQUIRED_NUMERIC_FIELDS.has(key) && (!Number.isFinite(numericValue) || numericValue <= 0)
                          ? ""
                          : rawValue == null
                          ? ""
                          : String(rawValue)
                        : String(rawValue ?? "");
                      return (
                        <div key={key} className="grid gap-4 py-3 md:grid-cols-[200px_minmax(0,1fr)]">
                          <div className="text-sm font-medium uppercase tracking-wide text-[#1E3A8A]">
                            {FIELD_TITLES[key]}
                          </div>
                          <input
                            className="w-full rounded-lg border border-[#CBD5F5] bg-white px-3 py-2 text-sm text-[#1F2937] shadow-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
                            type={isNumeric ? "number" : "text"}
                            inputMode={isNumeric ? "decimal" : undefined}
                            value={displayValue}
                            onChange={(event) => onOverride(key, event.target.value)}
                            placeholder={isNumeric ? "Enter a positive number" : "Enter a value"}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[#1E3A8A] hover:border-[#2563EB] hover:bg-[#EEF2FF]"
                      type="button"
                      onClick={() => setStep(1)}
                    >
                      Back
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                      type="button"
                      disabled={!isValid()}
                      onClick={() => setStep(3)}
                    >
                      Continue
                    </button>
                  </div>
                </section>
              )}

              {step === 3 && mergedFields && (
                <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1F2937]">Step 3 · Validate</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    Quick check before generation. Required totals must be greater than zero.
                  </p>
                  <ul className="mt-5 space-y-2 text-sm text-[#1F2937]">
                    {FIELD_ORDER.map((key) => {
                      const value = mergedFields[key];
                      const missing = missingFields.has(key);
                      return (
                        <li
                          key={key}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                            missing ? "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]" : "border-transparent bg-[#F9FAFB]"
                          }`}
                        >
                          <span className="font-medium">{FIELD_TITLES[key]}</span>
                          <span className="text-sm">
                            {NUMERIC_FIELDS.has(key)
                              ? formatNumericValue(key, typeof value === "number" ? value : Number(value ?? 0))
                              : String(value || "") || "(blank)"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[#1E3A8A] hover:border-[#2563EB] hover:bg-[#EEF2FF]"
                      type="button"
                      onClick={() => setStep(2)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#93C5FD]"
                      type="button"
                      onClick={generate}
                      disabled={busy}
                    >
                      Generate PPTX
                    </button>
                  </div>
                  {busy && <p className="mt-3 text-sm text-[#6B7280]">Generating presentation…</p>}
                </section>
              )}

              {step === 4 && (
                <section className="rounded-xl border border-[#DBEAFE] bg-[#EEF2FF] px-6 py-8 text-[#1E3A8A] shadow-inner">
                  <h2 className="text-lg font-semibold">Step 4 · Generate</h2>
                  <p className="mt-2 text-sm">Hold tight while we merge your data into the PowerPoint template.</p>
                  <p className="mt-4 text-sm font-medium">This only takes a moment…</p>
                </section>
              )}

              {step === 5 && lastDownload && (
                <section className="rounded-xl border border-[#E5E7EB] bg-white px-6 py-8 shadow-sm">
                  <h2 className="text-lg font-semibold text-[#1F2937]">Step 5 · Export complete</h2>
                  <p className="mt-1 text-sm text-[#6B7280]">
                    Your PowerPoint has been downloaded. Review the values below or download the file again.
                  </p>
                  <div className="mt-5 overflow-hidden rounded-lg border border-[#E5E7EB]">
                    <table className="min-w-full divide-y divide-[#F3F4F6] text-sm">
                      <tbody className="divide-y divide-[#F3F4F6] bg-white">
                        {FIELD_ORDER.map((key) => (
                          <tr key={key}>
                            <td className="px-4 py-2 font-medium text-[#1E3A8A]">{FIELD_TITLES[key]}</td>
                            <td className="px-4 py-2 text-right text-[#1F2937]">
                              {NUMERIC_FIELDS.has(key)
                                ? formatNumericValue(key, lastDownload.data[key] as number)
                                : String(lastDownload.data[key] || "") || "(blank)"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <button
                      className="rounded-full bg-[#2563EB] px-6 py-2 text-sm font-semibold text-white shadow hover:bg-[#1D4ED8]"
                      type="button"
                      onClick={downloadAgain}
                    >
                      Download again
                    </button>
                    <button
                      className="rounded-full border border-[#CBD5F5] bg-white px-5 py-2 text-sm font-medium text-[#1E3A8A] hover:border-[#2563EB] hover:bg-[#EEF2FF]"
                      type="button"
                      onClick={startAnother}
                    >
                      Start another
                    </button>
                    <Link
                      href="/"
                      className="rounded-full border border-transparent bg-[#F9FAFB] px-5 py-2 text-sm font-medium text-[#1E3A8A] shadow hover:border-[#CBD5F5] hover:bg-white"
                    >
                      Return home
                    </Link>
                  </div>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
