/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import packageJson from '../../../package.json';

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

const appVersion = packageJson.version;

export default function LoginPage(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent(): JSX.Element {
  const searchParams = useSearchParams();
  const redirectPath = searchParams?.get('redirect') ?? '/';
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setStatus(body?.message ?? 'Unable to sign in. Check your credentials.');
        setSubmitting(false);
        return;
      }

      setStatus('Authenticated. Redirecting...');
      // Hard navigation (full reload) so the just-set session cookie is sent on the
      // next request and seen by the middleware/auth check. A soft router.push can
      // reuse a pre-auth cached route and bounce back to /login, leaving the page
      // stuck on "Authenticated. Redirecting...". Guard against open redirects.
      const safeRedirect =
        redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/';
      window.location.assign(safeRedirect);
    } catch (err) {
      console.error('Login error', err);
      setStatus('Network error while signing in. Please retry.');
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 py-12 md:px-10 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(82,138,255,0.22),transparent_50%),radial-gradient(circle_at_85%_25%,rgba(72,187,228,0.2),transparent_45%),linear-gradient(135deg,rgba(15,23,42,0.12),rgba(255,255,255,0.14))] blur-2xl opacity-95 dark:bg-[radial-gradient(circle_at_18%_18%,rgba(147,197,253,0.28),transparent_55%),radial-gradient(circle_at_80%_28%,rgba(52,211,153,0.24),transparent_50%),linear-gradient(145deg,rgba(15,23,42,0.24),rgba(59,130,246,0.18))] dark:opacity-100 dark:mix-blend-screen" />
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center justify-center">
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
                placeholder="name@STOREstorage.com"
                autoComplete="email"
                required
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} htmlFor="login-password">
                Password
              </label>
              <div className="relative w-full">
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="********"
                  autoComplete="current-password"
                  required
                  className={`${inputClass} w-full pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3.5 text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--accent)] focus:outline-none focus-visible:text-[color:var(--accent)]"
                >
                  {showPassword ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setRememberDevice((prev) => !prev)}
                  className={toggleButtonClass(rememberDevice)}
                  aria-pressed={rememberDevice}
                  aria-label="Remember device"
                >
                  <span className={togglePillClass} />
                </button>
                <span className="select-none">Remember device</span>
                <input
                  type="checkbox"
                  name="remember"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                  className="sr-only"
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </div>
              <button type="button" className="text-[color:var(--accent)] hover:underline">
                Request password change
              </button>
            </div>

            <button
              type="submit"
              className="ios-button w-full justify-center py-3 text-sm font-semibold"
              disabled={submitting}
            >
              {submitting ? 'Signing in...' : 'Continue'}
            </button>
          </form>

          <p className="text-center text-xs text-[color:var(--text-secondary)]">
            Need an account?{' '}
            <Link href="/signup" className="font-semibold text-[color:var(--accent)] underline-offset-4 hover:underline">
              Request access
            </Link>
          </p>

          <p className="text-center text-[11px] text-[color:var(--text-secondary)] opacity-75">
            Version {appVersion}
          </p>
        </section>
      </div>
    </main>
  );
}
