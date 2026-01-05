/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

"use client";

import Link from "next/link";
import { useState, type JSX } from "react";
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

type QuickCard = {
  id: string;
  tone: string;
  title: string;
  items: string[];
};

type GuideContent = {
  id: string;
  label: string;
  badge: string;
  heading: string;
  description: string;
  quickCards: QuickCard[];
  steps: GuideStep[];
  references: ReferenceCard[];
  faqs: FAQ[];
};

const guides: GuideContent[] = [
  {
    id: "owner-reports",
    label: "Owner Reports",
    badge: "Owner Reports",
    heading: "Owner report walkthrough",
    description:
      "Follow this runbook to move from Yardi exports to the finished PPTX with mapping, overrides, validation, and audit logs.",
    quickCards: [
      {
        id: "owner-required",
        tone: "blue",
        title: "Required uploads",
        items: ["Executive Summary (xlsx)", "Budget Comparison (xlsx)"],
      },
      {
        id: "owner-optional",
        tone: "green",
        title: "Optional uploads",
        items: [
          "Hummingbird Move-In/Move-Out Activity",
          "IPRC Change History",
          "Available Spaces + PPC performance",
          "Repairs ledger (appendix)",
        ],
      },
      {
        id: "owner-time",
        tone: "amber",
        title: "Run time",
        items: ["Detection + review: ~6 minutes", "Overrides + validation: 2-3 minutes", "Export + QA: < 1 minute"],
      },
    ],
    steps: [
      {
        id: "step-upload",
        title: "Upload Executive Summary",
        body:
          "Use the monthly Executive Summary (first sheet only). The wizard detects address, owner group, hero totals, occupancy, and move activity.",
        proTips: [
          "Name the file with the period end date (YYYY-MM-DD) so CURRENTDATE picks it up automatically.",
          "Delete extra audit tabs before uploading; only the first worksheet is read.",
        ],
        placeholderLabel: "Placeholder image: Executive Summary upload",
      },
      {
        id: "step-budget",
        title: "Add the Budget Comparison workbook",
        body:
          "Upload the budget file to unlock PTD/YTD mapping for every line. Values stay in memory as you move through the wizard.",
        proTips: [
          "Keep PTD/YTD columns in the expected B–I span; hidden columns are ignored safely.",
          "If a Current Month value is blank, add an override in the mapper or fix the source before re-uploading.",
        ],
        placeholderLabel: "Placeholder image: Budget upload + detection",
      },
      {
        id: "step-map",
        title: "Map budget table",
        body:
          "Review detected amounts, fill gaps with overrides, and confirm totals across pages 1/2 before continuing.",
        proTips: [
          "Manual overrides always win over detected numbers. Use them for rounding tweaks or last-minute updates.",
          "Select \"Reset row\" to revert overrides for a line back to the detected values.",
        ],
        placeholderLabel: "Placeholder image: Budget mapping table",
      },
      {
        id: "step-summary",
        title: "Review summary fields",
        body:
          "Confirm hero values: current date/month, address, owner group, units, RSF, rental income, total income/expenses, net income, occupancy, and move activity counts.",
        proTips: [
          "Numeric fields auto-format; you can still override any text or number inline.",
          "If something looks off, jump back to the earlier step instead of waiting until export.",
        ],
        placeholderLabel: "Placeholder image: Summary field review",
      },
      {
        id: "step-validate",
        title: "Validate and choose email behavior",
        body:
          "Run the validation checklist (units and RSF must be greater than zero) and decide whether to email owners automatically or just download locally.",
        proTips: [
          "Pick the target property from the dropdown; disabled properties are flagged inline.",
          "Toggle owner emails off when testing—downloads are still produced.",
        ],
        placeholderLabel: "Placeholder image: Validation + email toggle",
      },
      {
        id: "step-export",
        title: "Export, download, and audit",
        body:
          "Generate the PPTX, then use the export recap to download again or open the console log with token/value mapping for QA.",
        proTips: [
          "If a token is blank, check the log for the source cell and verify the PPTX token casing.",
          "Overrides persist until you start another session, so you can regenerate as needed.",
        ],
        placeholderLabel: "Placeholder image: Export complete + log viewer",
      },
    ],
    references: [
      {
        id: "ref-tokens",
        title: "Token matrix & slide map",
        summary: "Full PPTX token list grouped by slide with the source workbook/field for each.",
        actions: [
          { label: "Open owner reports", href: "/owner-reports" },
        ],
      },
      {
        id: "ref-template",
        title: "STORE PPTX template",
        summary: "Latest owner deck template used for generation.",
        actions: [{ label: "Download template", href: "/owner-reports" }],
      },
      {
        id: "ref-troubleshooting",
        title: "Troubleshooting & logs",
        summary: "Common blanks, percent/variance safeguards, and how to read the console log after export.",
        actions: [{ label: "View log guidance", href: "/owner-reports" }],
      },
    ],
    faqs: [
      {
        id: "faq-blank-values",
        question: "Why is a token blank after uploading both workbooks?",
        answer:
          "Check that the label matches our expected wording on the first sheet, confirm token casing in the PPTX, and use overrides for last-minute fixes.",
      },
      {
        id: "faq-overrides",
        question: "Do overrides stick around between exports?",
        answer:
          "Yes, for the current session. They reset when you refresh, close the tab, or start another report. You can regenerate/download multiple times.",
      },
      {
        id: "faq-email",
        question: "Can I skip emailing owners when testing?",
        answer:
          "Yes. Turn off the email toggle on the Validate step. The PPTX still downloads locally and the console log remains available.",
      },
    ],
  },
];

export default function GuidePage(): JSX.Element {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [activeGuideId, setActiveGuideId] = useState(guides[0]?.id ?? "");

  const activeGuide = guides.find((guide) => guide.id === activeGuideId) ?? guides[0];

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
              <span className="ios-badge text-[10px]">{activeGuide.badge}</span>
              <h1 className="text-3xl font-semibold tracking-tight text-[color:var(--text-primary)]">
                {activeGuide.heading}
              </h1>
              <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">{activeGuide.description}</p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
          <nav aria-label="Guide topics" className="flex flex-wrap gap-2">
            {guides.map((guide) => {
              const isActive = guide.id === activeGuide.id;
              return (
                <button
                  key={guide.id}
                  type="button"
                  onClick={() => setActiveGuideId(guide.id)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(59,130,246,0.55)] ${
                    isActive
                      ? "border-[rgba(59,130,246,0.45)] bg-[rgba(37,99,235,0.14)] text-[color:var(--text-primary)] shadow-sm"
                      : "border-transparent bg-[rgba(148,163,255,0.12)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                  }`}
                >
                  {guide.label}
                </button>
              );
            })}
          </nav>
          <div className="grid gap-4 md:grid-cols-3">
            {activeGuide.quickCards.map((card) => (
              <div key={card.id} className="ios-list-card space-y-2 p-4" data-tone={card.tone}>
                <p className="text-sm font-semibold text-[color:var(--text-primary)]">{card.title}</p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[color:var(--text-secondary)]">
                  {card.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
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
              {activeGuide.steps.map((step, index) => (
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
                {activeGuide.references.map((card) => (
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
