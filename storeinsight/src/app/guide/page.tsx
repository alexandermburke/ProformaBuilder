"use client";

import Link from "next/link";
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
    body: "Begin with the monthly Executive Summary export from Yardi or the approved vendor layout. Once the file uploads, the wizard auto-detects facility details, totals, and reporting periods.",
    proTips: [
      "Rename the workbook with the period end date (YYYY-MM-DD) so the CURRENTDATE token populates automatically.",
      "If the summary contains extra audit tabs, delete them prior to upload—the parser only reads the first sheet.",
    ],
    placeholderLabel: "Placeholder image: Upload modal",
  },
  {
    id: "step-budget",
    title: "Add Budget Comparison & Financial Statements",
    body: "Drop in the Budget Comparison workbook to unlock automatic token mapping. Include the Financial Statements export when you need backup Current Month values for rows that are blank in Budget Comparison.",
    proTips: [
      "Confirm the header row includes PTD/YTD columns in positions B–I; hidden columns are safely ignored.",
      "If Current Month values are missing for a line, the Financial Statements file supplies the fallback.",
    ],
    placeholderLabel: "Placeholder image: Budget upload cards",
  },
  {
    id: "step-map",
    title: "Tune values on the Map Budget Table step",
    body: "Each budget line shows detected values, manual overrides, and blank status so you can spot gaps quickly. Flip between the two slide groupings with the page controls before moving on.",
    proTips: [
      "Manual overrides always win over detected numbers—use them to adjust for rounding or last-minute updates.",
      "Select “Reset row” to revert all overrides for a line back to the detected values.",
    ],
    placeholderLabel: "Placeholder image: Budget mapping table",
  },
  {
    id: "step-generate",
    title: "Validate summary fields and export the deck",
    body: "Complete the validation checklist (units and rentable square footage must be greater than zero) and hit Generate. Docxtemplater merges your tokens into the STORE-branded PPTX template.",
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
      "Token detection relies on the source labels matching our expected wording. If a vendor renamed a line (for example, 'Common Area Maintenance' instead of 'CAM Charges'), supply an override in the mapper or edit the source label.",
  },
  {
    id: "faq-financials",
    question: "Do I always need the Financial Statements file?",
    answer:
      "No. Use it only when the Budget Comparison doesn’t include the Current Month actual for a line item. We read the column labeled “Current Month” and ignore the rest.",
  },
  {
    id: "faq-overrides",
    question: "How long do overrides stick around?",
    answer:
      "Overrides live for the current session. They reset after you refresh, close the tab, or start another report.",
  },
];

export default function GuidePage() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const pageBackground = isDark
    ? "bg-gradient-to-br from-[#020817] via-[#0f172a] to-[#0b1120] text-[var(--text-primary)]"
    : "bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFF] to-[#E0F2FE] text-[#0B1120]";
  const overlayTop = isDark
    ? "bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.22),transparent_55%)]"
    : "bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_55%)]";
  const overlayBottom = isDark
    ? "bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.18),transparent_60%)]"
    : "bg-[radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.14),transparent_60%)]";

  return (
    <div className={`relative min-h-screen w-full ${pageBackground}`}>
      <div className={`pointer-events-none absolute inset-0 ${overlayTop}`} />
      <div className={`pointer-events-none absolute inset-0 ${overlayBottom}`} />

      <div className="relative mx-auto max-w-[1200px] px-6 py-10 lg:px-10 lg:py-16">
        <header className="flex flex-col gap-6 rounded-2xl border border-white/30 bg-white/90 p-8 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#2563EB]">STORE Owner Reports</p>
              <h1 className="text-3xl font-semibold tracking-tight text-[#0B1120]">Analyst Guide</h1>
              <p className="mt-2 max-w-2xl text-sm text-[#4B5563]">
                Move from raw vendor exports to a finished owner-ready deck with confidence. Follow the walkthrough below, add
                screenshots where the placeholders sit, and leverage the pro tips gathered from our onboarding playbooks.
              </p>
            </div>
            <Link
              href="/owner-reports"
              className="inline-flex items-center gap-2 rounded-full border border-[#CBD5F5] bg-white px-4 py-2 text-sm font-medium text-[#1E3A8A] transition hover:border-[#2563EB] hover:bg-[#EEF2FF]"
            >
              Launch owner flow
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#DBEAFE] bg-[#EFF6FF] p-4 text-sm text-[#1E3A8A]">
              <p className="font-semibold">Inputs needed</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Executive Summary (xlsx)</li>
                <li>Budget Comparison (xlsx)</li>
                <li>Financial Statements (optional)</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[#FDE68A] bg-[#FEFCE8] p-4 text-sm text-[#78350F]">
              <p className="font-semibold">Prep checklist</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Confirm facility naming matches STORE conventions</li>
                <li>Remove trailing blank columns before upload</li>
                <li>Grab the latest PPT template from SharePoint</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[#D1FAE5] bg-[#ECFDF5] p-4 text-sm text-[#064E3B]">
              <p className="font-semibold">Time to complete</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Detection + review: ~6 minutes</li>
                <li>Manual touch-ups: 2–3 minutes</li>
                <li>Export + QA: 1 minute</li>
              </ul>
            </div>
          </div>
        </header>

        <main className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6 rounded-2xl border border-white/25 bg-white/95 p-6 shadow-lg backdrop-blur">
            <header>
              <h2 className="text-lg font-semibold text-[#0B1120]">Step-by-step walkthrough</h2>
              <p className="text-sm text-[#4B5563]">
                Use the placeholder blocks to remind yourself where screenshots or short clips should live later.
              </p>
            </header>
            <div className="space-y-6">
              {steps.map((step, index) => (
                <article
                  key={step.id}
                  className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-5 shadow-sm transition hover:border-[#CBD5F5]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-[#2563EB]">
                        Step {index + 1}
                      </span>
                      <h3 className="mt-1 text-base font-semibold text-[#111827]">{step.title}</h3>
                    </div>
                    <span className="hidden rounded-full bg-[#EEF2FF] px-3 py-1 text-xs font-semibold text-[#1E40AF] md:inline">
                      {step.proTips.length} pro tips
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-[#4B5563]">{step.body}</p>
                  <div className="mt-4 rounded-lg border border-dashed border-[#CBD5F5] bg-white p-6 text-center text-sm text-[#6B7280]">
                    {step.placeholderLabel}
                  </div>
                  <div className="mt-4 rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#1E3A8A]">Pro tips</p>
                    <ul className="mt-2 space-y-1 text-sm text-[#1F2937]">
                      {step.proTips.map((tip) => (
                        <li key={tip}>• {tip}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-white/25 bg-white/95 p-6 shadow-lg backdrop-blur">
              <h2 className="text-lg font-semibold text-[#0B1120]">Reference library</h2>
              <p className="mt-1 text-sm text-[#4B5563]">Quick jump links we share during onboarding sessions.</p>
              <ul className="mt-4 space-y-3">
                {references.map((card) => (
                  <li key={card.id} className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    <p className="text-sm font-semibold text-[#111827]">{card.title}</p>
                    <p className="mt-2 text-xs text-[#4B5563]">{card.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {card.actions.map((action) => (
                        <Link
                          key={action.label}
                          href={action.href}
                          className="inline-flex items-center rounded-full border border-[#CBD5F5] bg-white px-3 py-1 text-xs font-semibold text-[#1E3A8A] transition hover:border-[#2563EB] hover:bg-[#EEF2FF]"
                        >
                          {action.label}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-white/25 bg-white/95 p-6 shadow-lg backdrop-blur">
              <h2 className="text-lg font-semibold text-[#0B1120]">FAQ</h2>
              <div className="mt-4 space-y-4">
                {faqs.map((item) => (
                  <article key={item.id} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
                    <h3 className="text-sm font-semibold text-[#111827]">{item.question}</h3>
                    <p className="mt-2 text-sm text-[#4B5563]">{item.answer}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-dashed border-[#CBD5F5] bg-white/80 p-6 text-sm text-[#1F2937] shadow-inner backdrop-blur">
              <p className="font-semibold text-[#1E3A8A]">Add your own material</p>
              <p className="mt-2">
                Drop screenshots, Loom recordings, or quick notes here as the process evolves. The layout is flexible enough to
                handle embedded media without extra styling work.
              </p>
            </section>
          </aside>
        </main>
      </div>
    </div>
  );
}
