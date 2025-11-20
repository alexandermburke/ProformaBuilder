import type { JSX } from "react";

export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--surface-muted)] px-6 py-16 text-center">
      <div className="space-y-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Not found</p>
        <h1 className="text-3xl font-semibold text-[color:var(--text-primary)]">Page not found</h1>
        <p className="text-[color:var(--text-secondary)]">The page you are looking for does not exist.</p>
      </div>
    </main>
  );
}
