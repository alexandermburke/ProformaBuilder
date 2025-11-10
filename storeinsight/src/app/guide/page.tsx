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
    heading: "Owner's reports guide",
    description:
      "Move from raw vendor exports to a finished owner-ready deck with confidence. Follow the walkthrough below, drop in screenshots where the placeholders sit, and leverage the pro tips gathered from our onboarding playbooks.",
    quickCards: [
      {
        id: "owner-inputs",
        tone: "blue",
        title: "Inputs needed",
        items: ["Executive Summary (xlsx)", "Budget Comparison (xlsx)", "Move-In/Move-Out Activity (optional)"],
      },
      {
        id: "owner-prep",
        tone: "amber",
        title: "Prep checklist",
        items: [
          "Confirm facility naming matches STORE conventions",
          "Remove trailing blank columns before upload",
          "Grab the latest PPT template from SharePoint",
        ],
      },
      {
        id: "owner-time",
        tone: "green",
        title: "Time to complete",
        items: ["Detection + review: roughly 6 minutes", "Manual touchups: 2-3 minutes", "Export + QA: 1 minute"],
      },
    ],
    steps: [
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
        title: "Add the Budget Comparison workbook",
        body:
          "Drop in the Budget Comparison workbook to unlock automatic token mapping. The wizard holds it in memory so you can reuse it across mapping and export steps.",
        proTips: [
          "Confirm the header row includes PTD/YTD columns in positions B-I. Hidden columns are safely ignored.",
          "If Current Month values are missing for a line, supply an override in the mapper or update the source workbook before uploading.",
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
    ],
    references: [
      {
        id: "ref-template",
        title: "Template token reference",
        summary: "Complete list of PPTX tokens grouped by slide, plus the source workbook for each value.",
        actions: [
          { label: "View token matrix", href: "/owner-reports" },
          { label: "Download sample PPTX", href: "/owner-reports" },
        ],
      },
    ],
    faqs: [
      {
        id: "faq-blank-values",
        question: "Why are some tokens blank even after uploading both workbooks?",
        answer:
          "Token detection relies on the source labels matching our expected wording. If a vendor renamed a line, supply an override in the mapper or edit the source label before uploading.",
      },
      {
        id: "faq-overrides",
        question: "How long do overrides stick around?",
        answer:
          "Overrides live for the current session. They reset after you refresh, close the tab, or start another report.",
      },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    badge: "Accounting",
    heading: "Workflow outline",
    description:
      "We are drafting the detailed accounting walkthrough. In the meantime, lean on your existing checklist and jot notes where the placeholders sit so the final build goes faster.",
    quickCards: [
      {
        id: "accounting-inputs",
        tone: "blue",
        title: "Inputs (draft)",
        items: ["Monthly GL export", "Accrual notes", "Variance commentary (optional)"],
      },
      {
        id: "accounting-prep",
        tone: "amber",
        title: "Prep reminders",
        items: [
          "Flag upstream schedule dependencies",
          "Collect open JE requests before handoff",
          "Document owner questions for the final guide",
        ],
      },
      {
        id: "accounting-time",
        tone: "green",
        title: "ETA for full guide",
        items: ["Drafting in progress", "Screenshots to be captured", "Target publish: next sprint"],
      },
    ],
    steps: [
      {
        id: "accounting-coming-soon",
        title: "Coming soon",
        body:
          "The accounting runbook is being assembled. Use this space to sketch the walkthrough steps you plan to capture once the official screenshots are ready.",
        proTips: [
          "Keep your month-end checklist nearby so you can drop it in here later.",
          "Capture any tricky reconciliations you want highlighted when the guide ships.",
        ],
        placeholderLabel: "Placeholder image: Accounting workflow storyboard",
      },
    ],
    references: [
      {
        id: "accounting-reference",
        title: "Reference library (draft)",
        summary: "Links will land here once the accounting SOP is finalized. For now, note the documents you reach for most.",
        actions: [],
      },
    ],
    faqs: [],
  },
  {
    id: "proforma",
    label: "Proforma",
    badge: "Proforma Builder",
    heading: "Guide in progress",
    description:
      "We are curating the proforma walkthrough to mirror the owner reports playbook. Drop placeholder notes now so you can swap in rich content once the template is ready.",
    quickCards: [
      {
        id: "proforma-inputs",
        tone: "blue",
        title: "Inputs (planned)",
        items: ["Revenue assumptions", "Expense schedule draft", "Capital plan snapshot"],
      },
      {
        id: "proforma-prep",
        tone: "amber",
        title: "Prep checklist (placeholder)",
        items: [
          "List the KPIs you want highlighted",
          "Identify any tabs that need screenshots",
          "Collect talking points from the underwriting team",
        ],
      },
      {
        id: "proforma-time",
        tone: "green",
        title: "Next steps",
        items: ["Outline the sections you expect to narrate", "Flag data sources to cross-check", "Gather feedback from pilot users"],
      },
    ],
    steps: [
      {
        id: "proforma-coming-soon",
        title: "Storyboard your walkthrough",
        body:
          "Use this draft space to plan the narrative for the proforma experience. Replace the placeholders with real screenshots and commentary once the tooling is locked.",
        proTips: [
          "Sketch which scenarios you want to feature so the visuals land quickly later.",
          "Capture early learnings from SMEs and note them here for future you.",
        ],
        placeholderLabel: "Placeholder image: Proforma storyboard",
      },
    ],
    references: [
      {
        id: "proforma-reference",
        title: "Resource links (coming soon)",
        summary: "We'll add calculators, template decks, and KPI glossaries here once the team finalizes them.",
        actions: [],
      },
    ],
    faqs: [],
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
