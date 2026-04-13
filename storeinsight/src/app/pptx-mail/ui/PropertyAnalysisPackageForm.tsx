"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  PropertyAnalysisParseResponse,
  PropertyAnalysisTokenField,
  PropertyAnalysisTokenSection,
  PropertyAnalysisTokenSource,
} from "@/lib/propertyAnalysisPackage";

const SECTION_META: Record<PropertyAnalysisTokenSection, { title: string; description: string }> = {
  reportHeader: {
    title: "Report Header",
    description: "Deck-level header content for the opening slide.",
  },
  returnProfile: {
    title: "Return Profile",
    description: "Hold-period return metrics and investment-profile callouts for slide 2.",
  },
  marketSnapshot: {
    title: "Market / Property Snapshot",
    description: "Core physical property metrics shown on slide 3.",
  },
  incomeProforma: {
    title: "Income Proforma",
    description: "Slide 4 values copied directly from the Proforma income table.",
  },
  expenseProforma: {
    title: "Expense Proforma",
    description: "Slide 5 values copied directly from the Proforma expense table.",
  },
  dealEconomics: {
    title: "Deal Economics",
    description: "Slide 6 values copied directly from Valuation Sheet and Inputs & Drivers.",
  },
  exitSensitivity: {
    title: "Exit / Sensitivity",
    description: "Slide 7 hold-period and sensitivity values copied directly from Valuation Sheet.",
  },
  manualInputs: {
    title: "Manual Inputs",
    description: "Template placeholders that stay editable until they have a defined workbook or external data source.",
  },
};

const SOURCE_META: Record<PropertyAnalysisTokenSource, string> = {
  extracted: "Workbook",
  derived: "Derived",
  manual: "Manual",
};

function groupFields(fields: PropertyAnalysisTokenField[]): Record<PropertyAnalysisTokenSection, PropertyAnalysisTokenField[]> {
  return fields.reduce<Record<PropertyAnalysisTokenSection, PropertyAnalysisTokenField[]>>(
    (accumulator, field) => {
      accumulator[field.section].push(field);
      return accumulator;
    },
    {
      reportHeader: [],
      returnProfile: [],
      marketSnapshot: [],
      incomeProforma: [],
      expenseProforma: [],
      dealEconomics: [],
      exitSensitivity: [],
      manualInputs: [],
    },
  );
}

function sourceClass(source: PropertyAnalysisTokenSource): string {
  switch (source) {
    case "extracted":
      return "green";
    case "derived":
      return "blue";
    default:
      return "warning";
  }
}

export default function PropertyAnalysisPackageForm() {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<PropertyAnalysisParseResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const groupedFields = useMemo(() => groupFields(parsed?.tokenFields ?? []), [parsed]);

  const handleFileChange = (nextFile: File | null) => {
    setFile(nextFile);
    setParsed(null);
    setValues({});
    setParseError(null);
    setParseStatus(null);
    setGenerateError(null);
  };

  const handleParse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setParseError("Select a supported proforma workbook first.");
      return;
    }

    setParsing(true);
    setParseError(null);
    setParseStatus(null);
    setGenerateError(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const response = await fetch("/api/property-analysis-package/parse", {
        method: "POST",
        body: form,
      });
      const json = (await response.json()) as PropertyAnalysisParseResponse & { error?: string };
      if (!response.ok) {
        setParsed(null);
        setValues({});
        setParseError(json.error ?? "Unable to parse workbook.");
        return;
      }

      setParsed(json);
      setValues(Object.fromEntries(json.tokenFields.map((field) => [field.token, field.defaultValue])));
      setParseStatus(
        `Parsed ${json.metadata.propertyName || json.metadata.fileName} with ${json.templateTokens.length} template token${json.templateTokens.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setParsed(null);
      setValues({});
      setParseError(error instanceof Error ? error.message : "Unexpected parse error.");
    } finally {
      setParsing(false);
    }
  };

  const handleGenerate = async () => {
    if (!file || !parsed) return;

    setGenerating(true);
    setGenerateError(null);

    const form = new FormData();
    form.append("file", file);
    form.append("overrides", JSON.stringify(values));

    try {
      const response = await fetch("/api/property-analysis-package/generate", {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as { error?: string } | null;
        setGenerateError(json?.error ?? "Unable to generate the property analysis package.");
        return;
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = contentDisposition.match(/filename="([^"]+)"/i)?.[1] ?? "Property-Analysis-Package.pptx";
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Unexpected generation error.");
    } finally {
      setGenerating(false);
    }
  };

  const unresolvedCount = parsed?.unresolvedTokens.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleParse}
        className="ios-card ios-animate-up flex flex-col gap-5 p-6"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <label className="flex flex-col gap-2 text-sm font-medium text-[color:var(--text-primary)]">
            Proforma workbook
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
              className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-4 text-sm text-[color:var(--text-primary)] shadow-sm outline-none transition file:mr-4 file:rounded-xl file:border-0 file:bg-[rgba(37,99,235,0.12)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[color:var(--accent-strong)] hover:border-[rgba(37,99,235,0.36)] focus:border-[color:var(--accent-strong)] focus:ring-2 focus:ring-[rgba(37,99,235,0.24)]"
              required
            />
            <span className="text-xs font-normal text-[color:var(--text-secondary)]">
              Upload one supported workbook. The generator uses the managed template at <code>public/PackageTemplate.pptx</code>.
            </span>
          </label>

          <button
            type="submit"
            disabled={parsing || !file}
            className="ios-button h-11 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {parsing ? "Parsing..." : "1. Parse Workbook"}
          </button>
        </div>

        {parseStatus ? <div className="text-sm text-[color:var(--text-secondary)]">{parseStatus}</div> : null}
        {parseError ? (
          <div className="ios-list-card border border-[rgba(244,63,94,0.2)] bg-[rgba(244,63,94,0.08)] px-4 py-3 text-sm text-[color:var(--text-primary)]">
            {parseError}
          </div>
        ) : null}
      </form>

      {parsed ? (
        <>
          <section className="ios-card ios-animate-up ios-animate-delay-sm p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent-strong)]">Step 2</div>
                <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Review token values</h2>
                <p className="text-sm text-[color:var(--text-secondary)]">
                  Slides 1-7 are driven from workbook-backed values where available. Unresolved placeholders stay editable and render blank if left empty.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="ios-pill px-3 py-1" data-tone="neutral">
                  {parsed.templateTokens.length} template tokens
                </span>
                <span className="ios-pill px-3 py-1" data-tone="warning">
                  {unresolvedCount} unresolved
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="ios-list-card space-y-1 p-4">
                <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Property</div>
                <div className="mt-1 text-base font-semibold text-[color:var(--text-primary)]">
                  {parsed.metadata.propertyName || "Unknown property"}
                </div>
                <div className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  {parsed.metadata.propertyAddress || "No address detected"}
                </div>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Deal No.</div>
                <div className="mt-1 text-base font-semibold text-[color:var(--text-primary)]">
                  {parsed.metadata.dealNumber || "Not detected"}
                </div>
                <div className="mt-1 text-sm text-[color:var(--text-secondary)]">{parsed.metadata.fileName}</div>
              </div>
              <div className="ios-list-card space-y-1 p-4">
                <div className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Template</div>
                <div className="mt-1 text-base font-semibold text-[color:var(--text-primary)]">
                  {parsed.metadata.templatePath}
                </div>
                <div className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  {parsed.metadata.workbookType === "public-proforma-template" ? "Public-style workbook" : "Wentworth-style workbook"}
                </div>
              </div>
            </div>

            {parsed.warnings.length ? (
              <div className="ios-list-card mt-5 border border-[rgba(245,158,11,0.18)] bg-[rgba(245,158,11,0.08)] p-4 text-sm text-[color:var(--text-primary)]">
                <div className="font-semibold">Warnings</div>
                <ul className="mt-2 space-y-1">
                  {parsed.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {(Object.entries(groupedFields) as Array<[PropertyAnalysisTokenSection, PropertyAnalysisTokenField[]]>)
            .filter(([, fields]) => fields.length > 0)
            .map(([section, fields]) => (
              <section
                key={section}
                className="ios-card ios-animate-up p-6"
              >
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent-strong)]">
                    {SECTION_META[section].title}
                  </div>
                  <p className="mt-1 text-sm text-[color:var(--text-secondary)]">{SECTION_META[section].description}</p>
                </div>

                <div className="grid max-h-[40rem] gap-4 overflow-y-auto pr-2 md:grid-cols-2">
                  {fields.map((field) => (
                    <label
                      key={field.token}
                      className="ios-list-card flex flex-col gap-2 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-[color:var(--text-primary)]">{field.label}</div>
                          <div className="text-xs text-[color:var(--text-secondary)]">
                            <code>{field.token}</code>
                          </div>
                        </div>
                        <span className="ios-pill px-2.5 py-1 text-[11px]" data-tone={sourceClass(field.source)}>
                          {SOURCE_META[field.source]}
                        </span>
                      </div>

                      <input
                        type="text"
                        value={values[field.token] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.token]: event.target.value,
                          }))
                        }
                        className="rounded-xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-primary)] shadow-sm outline-none transition focus:border-[color:var(--accent-strong)] focus:ring-2 focus:ring-[rgba(37,99,235,0.22)]"
                        placeholder={field.source === "manual" ? "Enter manual text for this token" : ""}
                      />

                      {field.matchedKey ? (
                        <div className="text-xs text-[color:var(--text-secondary)]">
                          Matched from <code>{field.matchedKey}</code>
                        </div>
                      ) : null}
                    </label>
                  ))}
                </div>
              </section>
            ))}

          <section className="ios-card ios-animate-up ios-animate-delay-md p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-[color:var(--accent-strong)]">Step 3</div>
                <div className="mt-1 text-lg font-semibold text-[color:var(--text-primary)]">Generate PowerPoint</div>
                <p className="mt-1 text-sm text-[color:var(--text-secondary)]">
                  Generate the slides 1-7 package deck as a templated <code>.pptx</code>. Any unresolved token left blank will stay blank in the deck.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="ios-button h-11 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? "Generating..." : "3. Generate PPTX"}
              </button>
            </div>

            {generateError ? (
              <div className="ios-list-card mt-4 border border-[rgba(244,63,94,0.2)] bg-[rgba(244,63,94,0.08)] px-4 py-3 text-sm text-[color:var(--text-primary)]">
                {generateError}
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
