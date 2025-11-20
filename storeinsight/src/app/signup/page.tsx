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

const toggleButtonClass = (active: boolean): string =>
  [
    'relative inline-flex h-6 w-12 shrink-0 items-center rounded-full border border-[rgba(148,163,255,0.24)] p-0.5 transition-all duration-500',
    active
      ? 'justify-end bg-[rgba(37,99,235,0.8)] shadow-[0_8px_22px_rgba(37,99,235,0.28)]'
      : 'justify-start bg-[rgba(148,163,255,0.28)]',
  ].join(' ');

const togglePillClass =
  'inline-block h-5 w-5 rounded-full bg-white shadow-[0_6px_16px_rgba(15,23,42,0.2)] transition-transform duration-500';

export default function SignupPage(): JSX.Element {
  const [status, setStatus] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus('Request captured. STORE Ops will approve seats shortly.');
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 py-12 md:px-10 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(82,138,255,0.22),transparent_50%),radial-gradient(circle_at_85%_25%,rgba(72,187,228,0.2),transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.12),rgba(255,255,255,0.14))] blur-2xl opacity-95 dark:bg-[radial-gradient(circle_at_18%_18%,rgba(147,197,253,0.28),transparent_55%),radial-gradient(circle_at_80%_28%,rgba(52,211,153,0.24),transparent_50%),linear-gradient(145deg,rgba(15,23,42,0.24),rgba(59,130,246,0.18))] dark:opacity-100 dark:mix-blend-screen" />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center justify-center">
        <section className="ios-card ios-animate-up w-full max-w-md space-y-6 p-8">
          <div className="space-y-1">
            <h2 className="text-2xl font-semibold text-[color:var(--text-primary)]">Create account</h2>
            <p className="text-sm text-[color:var(--text-secondary)]">
              Complete the form and the platform team will enable access once verified.
            </p>
          </div>

          {status && (
            <div
              className="rounded-2xl border border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.1)] px-4 py-3 text-sm text-[color:var(--accent-strong)]"
              role="status"
              aria-live="polite"
            >
              {status}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="signup-name">
                Full name
              </label>
              <input
                id="signup-name"
                name="name"
                placeholder="John Doe"
                autoComplete="name"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="signup-company">
                Team / property
              </label>
              <input
                id="signup-company"
                name="company"
                placeholder="STORE on the Grove"
                autoComplete="organization"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="signup-email">
                Work email
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                placeholder="name@STOREstorage.com"
                autoComplete="email"
                required
                className={inputClass}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className={labelClass} htmlFor="signup-password">
                  Password
                </label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  placeholder="********"
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={labelClass} htmlFor="signup-confirm">
                  Confirm
                </label>
                <input
                  id="signup-confirm"
                  name="confirm"
                  type="password"
                  placeholder="********"
                  autoComplete="new-password"
                  required
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-[color:var(--text-secondary)]">
              <button
                type="button"
                onClick={() => setAgree((prev) => !prev)}
                className={toggleButtonClass(agree)}
                aria-pressed={agree}
                aria-label="Agree to STORE policies"
              >
                <span className={togglePillClass} />
              </button>
              <span className="select-none">
                I agree to STORE&apos;s internal automation policies and owner data handling rules.
              </span>
              <input
                type="checkbox"
                name="agree"
                required
                checked={agree}
                onChange={(event) => setAgree(event.target.checked)}
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>

            <button type="submit" className="ios-button w-full justify-center py-3 text-sm font-semibold">
              Submit request
            </button>
          </form>

          <p className="text-center text-xs text-[color:var(--text-secondary)]">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-[color:var(--accent)] underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
