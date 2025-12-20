import { listProperties } from "@/app/api/daily-summary/store";
import PptxMailForm from "./ui/PptxMailForm";

export const runtime = "nodejs";

export default async function PptxMailPage() {
  const properties = await listProperties().catch(() => []);
  const propertyOptions = properties
    .filter((p) => p.enabled !== false)
    .map((p) => ({
      id: p.id,
      label: p.name || p.propertyCode || p.tenantPropertyId || p.id,
      code: p.propertyCode || p.tenantPropertyId || "",
      ownerEmails: p.ownerEmails ?? [],
    }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 text-slate-900 dark:text-slate-100">
      <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-slate-800/80 dark:bg-slate-900/70">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600"
          >
            ← Back
          </a>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">Owner Reports</p>
          <h1 className="text-3xl font-semibold">Monthly PPTX ➜ PDF Mailer</h1>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Upload monthly owner-report PPTX files, select the property, and we&apos;ll convert them to PDF and send to the configured owner email list. No PNG preview is generated for these long decks.
          </p>
        </div>
        <div className="mt-6">
          <PptxMailForm properties={propertyOptions} />
        </div>
      </div>
    </div>
  );
}
