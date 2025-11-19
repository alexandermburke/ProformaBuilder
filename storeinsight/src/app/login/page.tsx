/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

const labelClass =
  'text-xs font-semibold uppercase tracking-wide text-[color:var(--text-secondary)] select-none';
const inputClass =
  'owner-field-input rounded-2xl border border-[color:var(--border-soft)] bg-white/90 px-4 py-2.5 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--focus-ring)]';

const loginHighlights = [
  'Secure access to Daily Summary, Owner Report, and Proforma workspaces.',
  'Session awareness persists across the iOS-inspired UI shell.',
  'MFA and SSO enforcement are provisioned through Azure AD.',
];

export default function LoginPage(): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('Authentication wiring ships next. Your request is staged.');
  };

  return (
    <main className="min-h-screen px-6 pb-16 pt-12 md:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 lg:flex-row">
        <section className="ios-card ios-animate-up flex-1 space-y-8 p-10" data-tone="blue">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-[color:var(--text-muted)]">
                STORE Platform
              </p>
              <h1 className="text-3xl font-semibold text-[color:var(--text-primary)]">
                Welcome back
              </h1>
              <p className="max-w-xl text-sm text-[color:var(--text-secondary)]">
                Sign in to continue building flash reports, owner decks, and STORE-grade proformas.
                Access follows the same tone as the rest of the workspace—calm, intentional, and
                ready for automation.
              </p>
            </div>
            <Link href="/" className="ios-button px-4 py-2 text-sm" data-variant="ghost">
              Back home
            </Link>
          </div>
          <div className="space-y-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface-subtle)]/80 p-5 shadow-inner">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[color:var(--text-muted)]">
              Why sign in?
            </p>
            <ul className="space-y-2 text-sm text-[color:var(--text-secondary)]">
              {loginHighlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2">
                  <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="ios-card ios-animate-up w-full max-w-md space-y-6 p-8">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Log in</h2>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Continue with your STORE email. Provisioning remains managed by STORES Ops.
            </p>
          </div>

          {status && (
            <div
              className="rounded-2xl border border-[rgba(37,99,235,0.4)] bg-[rgba(37,99,235,0.08)] px-4 py-3 text-sm text-[color:var(--accent-strong)]"
              role="status"
              aria-live="polite"
            >
              {status}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="login-email">
                Work email
              </label>
              <input
                id="login-email"
                name="email"
                type="email"
                placeholder="name@storemanagement.com"
                autoComplete="email"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className={inputClass}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  name="remember"
                  className="h-4 w-4 rounded border-[color:var(--border-soft)] text-[color:var(--accent)] focus:ring-[color:var(--accent-soft)]"
                />
                Remember device
              </label>
              <button type="button" className="text-[color:var(--accent)] hover:underline">
                Forgot password
              </button>
            </div>

            <button type="submit" className="ios-button w-full justify-center py-3 text-sm font-semibold">
              Continue
            </button>
          </form>

          <p className="text-center text-xs text-[color:var(--text-secondary)]">
            Need an account?{' '}
            <Link href="/signup" className="font-semibold text-[color:var(--accent)] underline-offset-4 hover:underline">
              Request access
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
