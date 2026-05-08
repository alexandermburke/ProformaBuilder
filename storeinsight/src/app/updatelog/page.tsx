/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import type { JSX } from "react";

export const dynamic = "force-dynamic";

type ValidationTone = "success" | "neutral" | "warning";

type LogEntry = {
  id: string;
  date: string;
  session: string;
  files: string[];
  summary: string;
  validation: string;
  validationTone: ValidationTone;
  followUps: string;
};

const AGENT_LOG_PATH = "src/context/agent-update-log.txt";

function classifyValidation(raw: string): ValidationTone {
  const value = raw.toLowerCase();
  if (!value || value === "not run" || value === "n/a" || value === "none") return "neutral";
  if (value.includes("fail") || value.includes("error")) return "warning";
  if (value.includes("pass") || value.includes("clean") || value.includes("ok")) return "success";
  return "neutral";
}

function parseLogLine(line: string, index: number): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(" | ").map((part) => part.trim());
  if (parts.length < 4) return null;

  const [date, session, filesField, summary, validation = "Not run", followUps = ""] = parts;
  const files = filesField
    .split(/;\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    id: `${date}-${index}`,
    date,
    session,
    files,
    summary,
    validation,
    validationTone: classifyValidation(validation),
    followUps,
  };
}

async function loadEntries(): Promise<LogEntry[]> {
  const filePath = path.join(process.cwd(), AGENT_LOG_PATH);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    const entries: LogEntry[] = [];
    lines.forEach((line, index) => {
      const parsed = parseLogLine(line, index);
      if (parsed) entries.push(parsed);
    });
    return entries.reverse();
  } catch {
    return [];
  }
}

export default async function UpdateLogPage(): Promise<JSX.Element> {
  const entries = await loadEntries();

  return (
    <div className="relative min-h-screen w-full overflow-hidden text-[color:var(--text-primary)]">
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_18%_10%,rgba(37,99,235,0.18),transparent_62%)] dark:bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.28),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(circle_at_84%_88%,rgba(125,211,252,0.16),transparent_60%)] dark:bg-[radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.22),transparent_60%)]" />

      <div className="relative mx-auto max-w-3xl px-6 py-10 lg:px-8 lg:py-14">
        <header className="ios-card ios-animate-up flex flex-col gap-4 p-6" data-tone="blue">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <span className="ios-badge text-[10px]">Patch notes</span>
              <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--text-primary)]">Update log</h1>
              <p className="text-xs text-[color:var(--text-secondary)]">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} &middot; newest first
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="secondary">
              <span aria-hidden className="-ml-1 mr-1 text-base">&larr;</span>
              Back to directory
            </Link>
          </div>
        </header>

        <section className="ios-card ios-animate-up mt-6 p-2 sm:p-3">
          {entries.length === 0 ? (
            <div className="p-6 text-sm text-[color:var(--text-secondary)]">
              No updates have been logged yet. Entries from <code>{AGENT_LOG_PATH}</code> appear here automatically.
            </div>
          ) : (
            <ol className="max-h-[70vh] space-y-3 overflow-y-auto pr-2 sm:max-h-[75vh]">
              {entries.map((entry) => (
                <li key={entry.id} className="ios-list-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs uppercase tracking-wider text-[color:var(--accent-strong)]">
                      v{entry.date}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="ios-pill text-[10px]" data-tone="neutral">
                        alex@storestorage.com
                      </span>
                      <span className="ios-pill text-[10px]" data-tone={entry.validationTone}>
                        {entry.validation}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-[color:var(--text-primary)]">{entry.summary}</p>
                  {entry.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.files.map((file) => (
                        <span
                          key={`${entry.id}-${file}`}
                          className="rounded-md bg-[color:var(--surface-muted,rgba(148,163,184,0.16))] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text-secondary)]"
                        >
                          {file}
                        </span>
                      ))}
                    </div>
                  )}
                  {entry.followUps && entry.followUps.toLowerCase() !== "none" && (
                    <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                      <span className="font-semibold uppercase tracking-wide">Follow-ups:</span> {entry.followUps}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
