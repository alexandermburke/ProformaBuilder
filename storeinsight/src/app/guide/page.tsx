"use client";

import Link from "next/link";
import type { JSX } from "react";
import { useTheme } from "@/components/ThemeProvider";

type GuideStep = {
  id: string;
  title: string;
  body: string;
  proTips: string[];
  placeholderLabel: string;
};

type ReferenceCard = {
  id: string;
  title: string;
  summary: string;
  actions: Array<{ label: string; href: string }>;
};

type FAQ = {
  id: string;
  question: string;
  answer: string;
};

const steps: GuideStep[] = [
  {
    id: "step-upload",
    title: "Upload your Executive Summary",
    body:
      "Begin with the monthly Executive Summary export from Yardi or the approved vendor layout. Once the file uploads, the wizard detects facility details, totals, and reporting periods automatically.",
    proTips: [
      "Rename the workbook with the period end date (YYYY-MM-DD) so the CURRENTDATE token populates automatically.",
      "If the summary contains extra audit tabs, delete them before uploading. The parser only reads the first sheet.",
    ],
    placeholderLabel: "Placeholder image: Upload modal",
  },
  {
    id: "step-budget",
    title: "Add Budget Comparison and Financial Statements",
    body:
      "Drop in the Budget Comparison workbook to unlock automatic token mapping. Include the Financial Statements export when you need backup Current Month values for rows that are blank in Budget Comparison.",
    proTips: [
      "Confirm the header row includes PTD/YTD columns in positions B-I. Hidden columns are safely ignored.",
      "If Current Month values are missing for a line, the Financial Statements file supplies the fallback.",
    ],
    placeholderLabel: "Placeholder image: Budget upload cards",
  },
  {
    id: "step-map",
    title: "Tune values on the Map Budget Table step",
    body:
      "Each budget line shows detected values, manual overrides, and blank status so you can spot gaps quickly. Flip between the slide groupings with the page controls before moving on.",
    proTips: [
      "Manual overrides always win over detected numbers. Use them for rounding tweaks or last-minute updates.",
      "Select \"Reset row\" to revert overrides for a line back to the detected values.",
    ],
    placeholderLabel: "Placeholder image: Budget mapping table",
  },
  {
    id: "step-generate",
    title: "Validate summary fields and export the deck",
    body:
      "Complete the validation checklist (units and rentable square footage must both be greater than zero) and hit Generate. Docxtemplater merges your tokens into the STORE-branded PPTX template.",
    proTips: [
      "If a field comes through blank, verify the template uses the exact token casing shown in the mapper.",
      "You can regenerate and download again at any time; overrides persist until you start another session.",
    ],
    placeholderLabel: "Placeholder image: Export success toast",
  },
];

const references: ReferenceCard[] = [
  {
    id: "ref-template",
    title: "Template token reference",
    summary: "Complete list of PPTX tokens grouped by slide, plus the source workbook for each value.",
    actions: [
      { label: "View token matrix", href: "/owner-reports" },
      { label: "Download sample PPTX", href: "/owner-reports" },
    ],
  },
  {
    id: "ref-playbook",
    title: "Operations playbook",
    summary: "Process checklist for analysts covering intake, QA, and delivery expectations.",
    actions: [{ label: "Open playbook", href: "/updatelog" }],
  },
];

const faqs: FAQ[] = [
  {
    id: "faq-blank-values",
    question: "Why are some tokens blank even after uploading both workbooks?",
    answer:
      "Token detection relies on the source labels matching our expected wording. If a vendor renamed a line, supply an override in the mapper or edit the source label before uploading.",
  },
  {
    id: "faq-financials",
    question: "Do I always need the Financial Statements file?",
    answer:
      "No. Use it only when the Budget Comparison does not include the Current Month actual for a line item. The wizard reads the column labeled \"Current Month\" and ignores the rest.",
  },
  {
    id: "faq-overrides",
    question: "How long do overrides stick around?",
    answer:
      "Overrides live for the current session. They reset after you refresh, close the tab, or start another report.",
  },
];

export default function GuidePage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.28),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_60%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.2),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_62%)]";

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 -z-20 ${overlayBottom}`} />

      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <header className="ios-card ios-animate-up flex flex-col gap-6 p-8" data-tone="blue">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <span className="ios-badge text-[10px]">STORE Owner Reports</span>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--text-primary)]">Analyst guide</h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
                Move from raw vendor exports to a finished owner-ready deck with confidence. Follow the walkthrough below,
                drop in screenshots where the placeholders sit, and leverage the pro tips gathered from our onboarding playbooks.
              </p>
            </div>
             <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
               <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="ios-list-card space-y-2 p-4" data-tone="blue">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">Inputs needed</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[color:var(--text-secondary)]">
                <li>Executive Summary (xlsx)</li>
                <li>Budget Comparison (xlsx)</li>
                <li>Financial Statements (optional)</li>
              </ul>
            </div>
            <div className="ios-list-card space-y-2 p-4" data-tone="amber">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">Prep checklist</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[color:var(--text-secondary)]">
                <li>Confirm facility naming matches STORE conventions</li>
                <li>Remove trailing blank columns before upload</li>
                <li>Grab the latest PPT template from SharePoint</li>
              </ul>
            </div>
            <div className="ios-list-card space-y-2 p-4" data-tone="green">
              <p className="text-sm font-semibold text-[color:var(--text-primary)]">Time to complete</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[color:var(--text-secondary)]">
                <li>Detection + review: roughly 6 minutes</li>
                <li>Manual touchups: 2-3 minutes</li>
                <li>Export + QA: 1 minute</li>
              </ul>
            </div>
          </div>
        </header>

        <main className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="ios-card ios-animate-up space-y-6 p-6">
            <header className="space-y-1.5">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Step-by-step walkthrough</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Use the placeholder blocks to outline screenshots or short clips you plan to capture later.
              </p>
            </header>
            <div className="space-y-6">
              {steps.map((step, index) => (
                <article
                  key={step.id}
                  className={`ios-list-card ios-animate-up space-y-4 p-5 ${index % 2 === 1 ? "ios-animate-delay-sm" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="ios-pill text-[10px] " data-tone="neutral">
                        Step {index + 1}
                      </span>
                      <h3 className="mt-2 text-base font-semibold text-[color:var(--text-primary)]">{step.title}</h3>
                    </div>
                </div>
                  <p className="text-sm text-[color:var(--text-secondary)]">{step.body}</p>
                  <div className="rounded-[16px] border border-dashed border-[rgba(148,163,255,0.35)] bg-white/80 p-6 text-center text-sm text-[color:var(--text-muted)] ">
                    {step.placeholderLabel}
                  </div>
                  <div className="rounded-[16px] border border-[rgba(37,99,235,0.2)] bg-[rgba(37,99,235,0.08)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-strong)]">Pro tips</p>
                    <ul className="mt-2 space-y-1 text-sm text-[color:var(--text-primary)]">
                      {step.proTips.map((tip) => (
                        <li key={tip}>- {tip}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="ios-card ios-animate-up space-y-4 p-6">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Reference library</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">Quick jump links we share during onboarding sessions.</p>
              <ul className="space-y-3">
                {references.map((card) => (
                  <li key={card.id} className="ios-list-card space-y-3 p-4">
                    <p className="text-sm font-semibold text-[color:var(--text-primary)]">{card.title}</p>
                    <p className="text-xs text-[color:var(--text-secondary)]">{card.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      {card.actions.map((action) => (
                        <Link
                          key={action.label}
                          href={action.href}
                          className="ios-button px-3 py-1 text-xs"
                          data-variant="secondary"
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
